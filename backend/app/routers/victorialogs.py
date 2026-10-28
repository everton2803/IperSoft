from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any

from app.database import get_db
from app.models.integration import IntegrationConfig
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.victorialogs import VictoriaLogsService

router = APIRouter(prefix="/integrations/victorialogs", tags=["Integração VictoriaLogs (Syslog)"])

class VictoriaLogsConfigRequest(BaseModel):
    url: str
    is_active: Optional[bool] = True

class VictoriaLogsTestRequest(BaseModel):
    url: Optional[str] = None

@router.get("/config")
def get_victorialogs_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "victorialogs").first()
    if not cfg:
        cfg = IntegrationConfig(
            name="victorialogs",
            url="http://10.10.1.2:9428",
            is_active=True
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    return {
        "id": cfg.id,
        "name": cfg.name,
        "url": cfg.url,
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }

@router.post("/config")
def save_victorialogs_config(
    req: VictoriaLogsConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem configurar integrações."
        )

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "victorialogs").first()
    if not cfg:
        cfg = IntegrationConfig(
            name="victorialogs",
            url=req.url.strip(),
            is_active=req.is_active
        )
        db.add(cfg)
    else:
        cfg.url = req.url.strip()
        cfg.is_active = req.is_active

    db.commit()
    db.refresh(cfg)
    return {"message": "Configuração do VictoriaLogs salva com sucesso.", "url": cfg.url}

@router.post("/test")
async def test_victorialogs_connection(
    req: VictoriaLogsTestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    url = req.url
    if not url:
        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "victorialogs").first()
        if cfg and cfg.url:
            url = cfg.url
        else:
            url = "http://10.10.1.2:9428"

    result = await VictoriaLogsService.test_connection(url)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Falha de conexão com VictoriaLogs."))
    return result

@router.get("/stats")
async def get_victorialogs_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "victorialogs").first()
    url = cfg.url if cfg and cfg.url else "http://10.10.1.2:9428"
    stats = await VictoriaLogsService.get_stats(url)
    return stats


@router.get("/activity")
async def get_victorialogs_activity(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna em lote a lista de IPs que geraram logs nos últimos 15 minutos e contagem em 24h.
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "victorialogs").first()
    url = cfg.url if cfg and cfg.url else "http://10.10.1.2:9428"
    activity = await VictoriaLogsService.get_all_devices_activity(url)
    return activity
