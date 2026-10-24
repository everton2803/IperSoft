from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime
import asyncio
import logging

from app.database import get_db
from app.models.user import User
from app.models.asset import Asset, NetworkDiagnostic
from app.routers.auth import get_current_user
from app.services.diagnostics import (
    run_diagnostics_for_asset,
    run_all_diagnostics_batch,
    diagnostic_state,
    _is_snmp_applicable_by_default
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diagnostics", tags=["Diagnósticos e Alarmes"])

class AlarmItem(BaseModel):
    id: int
    asset_id: int
    asset_name: str
    target_host: str
    target_port: Optional[str] = None
    test_type: str # icmp, snmp, ssh, telnet, rdp
    status: str # failed, timeout, ok
    latency_ms: Optional[float] = None
    message: Optional[str] = None
    tested_at: datetime

    class Config:
        from_attributes = True

class DiagnosticStats(BaseModel):
    total_alarms: int
    icmp_alarms: int
    snmp_alarms: int
    ssh_alarms: int
    telnet_alarms: int
    rdp_alarms: int
    total_monitored_services: int
    is_running: bool
    current_progress: int
    total_assets: int
    last_run_started: Optional[str] = None
    last_run_finished: Optional[str] = None

@router.get("/stats", response_model=DiagnosticStats)
def get_diagnostic_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna métricas consolidadas dos alarmes ativos e status da rotina de teste.
    """
    failed_statuses = ["failed", "timeout"]
    active_asset_statuses = ["active", "monitored"]

    base_q = db.query(NetworkDiagnostic).join(Asset, NetworkDiagnostic.asset_id == Asset.id).filter(
        Asset.status.in_(active_asset_statuses)
    )

    total_alarms = base_q.filter(NetworkDiagnostic.status.in_(failed_statuses)).count()
    icmp_alarms = base_q.filter(
        NetworkDiagnostic.test_type == "icmp",
        NetworkDiagnostic.status.in_(failed_statuses)
    ).count()
    snmp_alarms = base_q.filter(
        NetworkDiagnostic.test_type == "snmp",
        NetworkDiagnostic.status.in_(failed_statuses)
    ).count()
    ssh_alarms = base_q.filter(
        NetworkDiagnostic.test_type == "ssh",
        NetworkDiagnostic.status.in_(failed_statuses)
    ).count()
    telnet_alarms = base_q.filter(
        NetworkDiagnostic.test_type == "telnet",
        NetworkDiagnostic.status.in_(failed_statuses)
    ).count()
    rdp_alarms = base_q.filter(
        NetworkDiagnostic.test_type == "rdp",
        NetworkDiagnostic.status.in_(failed_statuses)
    ).count()
    total_services = base_q.count()

    return DiagnosticStats(
        total_alarms=total_alarms,
        icmp_alarms=icmp_alarms,
        snmp_alarms=snmp_alarms,
        ssh_alarms=ssh_alarms,
        telnet_alarms=telnet_alarms,
        rdp_alarms=rdp_alarms,
        total_monitored_services=total_services,
        is_running=diagnostic_state["is_running"],
        current_progress=diagnostic_state["current_progress"],
        total_assets=diagnostic_state["total_assets"],
        last_run_started=diagnostic_state["last_run_started"],
        last_run_finished=diagnostic_state["last_run_finished"]
    )

@router.get("/alarms", response_model=List[AlarmItem])
def list_alarms(
    test_type: Optional[str] = Query(None, description="Filtro por tipo: icmp, snmp, ssh, telnet, rdp ou all"),
    search: Optional[str] = Query(None, description="Busca por nome do ativo, IP ou host"),
    only_failures: bool = Query(True, description="Se True, retorna apenas falhas e timeouts"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Lista todos os alarmes de conectividade com suporte a filtros e busca.
    """
    query = db.query(NetworkDiagnostic, Asset.name.label("asset_name")).join(
        Asset, NetworkDiagnostic.asset_id == Asset.id
    ).filter(
        Asset.status.in_(["active", "monitored"])
    )

    if only_failures:
        query = query.filter(NetworkDiagnostic.status.in_(["failed", "timeout"]))

    if test_type and test_type.lower() != "all":
        query = query.filter(NetworkDiagnostic.test_type == test_type.lower())

    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Asset.name.ilike(term),
                Asset.ip_address.ilike(term),
                NetworkDiagnostic.target_host.ilike(term),
                NetworkDiagnostic.message.ilike(term)
            )
        )

    records = query.order_by(NetworkDiagnostic.tested_at.desc()).all()

    results = []
    for diag, asset_name in records:
        results.append(AlarmItem(
            id=diag.id,
            asset_id=diag.asset_id,
            asset_name=asset_name,
            target_host=diag.target_host,
            target_port=diag.target_port,
            test_type=diag.test_type,
            status=diag.status,
            latency_ms=diag.latency_ms,
            message=diag.message,
            tested_at=diag.tested_at
        ))

    return results

@router.post("/run")
async def trigger_diagnostics(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user)
):
    """
    Dispara varredura assíncrona de todos os testes em segundo plano.
    """
    if diagnostic_state["is_running"]:
        return {
            "message": "Uma varredura de diagnósticos já está em execução.",
            "is_running": True
        }

    # Inicia como task assíncrona desacoplada
    asyncio.create_task(run_all_diagnostics_batch())

    return {
        "message": "Varredura de diagnósticos iniciada com sucesso em segundo plano.",
        "is_running": True
    }

class SingleAssetTestRequest(BaseModel):
    include_icmp: Optional[bool] = None
    include_snmp: Optional[bool] = None
    include_remote: Optional[bool] = None

@router.post("/test-asset/{asset_id}")
async def test_single_asset(
    asset_id: int,
    payload: Optional[SingleAssetTestRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Executa testes imediatos para um único ativo selecionado, respeitando as opções ativas.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado")

    saved_tests = (asset.raw_data or {}).get("enabled_tests") or {}
    inc_icmp = payload.include_icmp if (payload and payload.include_icmp is not None) else saved_tests.get("icmp", True)
    if payload and payload.include_snmp is not None:
        inc_snmp = payload.include_snmp
    elif "snmp" in saved_tests:
        inc_snmp = bool(saved_tests["snmp"])
    else:
        inc_snmp = _is_snmp_applicable_by_default(asset)
    inc_remote = payload.include_remote if (payload and payload.include_remote is not None) else saved_tests.get("remote", True)

    results = await run_diagnostics_for_asset(
        db=db,
        asset=asset,
        include_icmp=inc_icmp,
        include_snmp=inc_snmp,
        include_remote=inc_remote
    )
    return {
        "message": f"Diagnóstico concluído para o ativo '{asset.name}'",
        "asset_id": asset.id,
        "results": results
    }
