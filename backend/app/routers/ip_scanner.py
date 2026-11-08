import os
import httpx
import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.ip_scanner import IPCommunity, IPPrefix, DiscoveredIP
from app.models.asset import Asset
from app.routers.auth import get_current_user

logger = logging.getLogger("IPScannerRouter")

router = APIRouter(prefix="/ip-scanner", tags=["IP Scanner & Gestão de Prefixos"])

SCANNER_PROBE_URL = os.getenv("SCANNER_PROBE_URL", "http://172.18.0.1:8005")

# ==============================================================================
# SCHEMAS PYDANTIC
# ==============================================================================

class CommunityCreate(BaseModel):
    name: str = Field(..., example="Comunidade Principal")
    community: str = Field(..., example="ipermonitor")
    version: str = Field(default="2c", example="2c")
    port: int = Field(default=161)
    is_default: bool = Field(default=False)


class CommunityResponse(BaseModel):
    id: int
    name: str
    community: str
    version: str
    port: int
    is_default: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class PrefixCreate(BaseModel):
    prefix: str = Field(..., example="10.90.10.0/24")
    client_group: str = Field(..., example="atm")
    description: Optional[str] = Field(default="", example="Switches de agregação Matriz")
    community_id: Optional[int] = None


class PrefixResponse(BaseModel):
    id: int
    prefix: str
    client_group: str
    description: Optional[str]
    community_id: Optional[int]
    community_name: Optional[str] = None
    last_scan_at: Optional[datetime]
    total_hosts_found: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class DiscoveredIPResponse(BaseModel):
    id: int
    prefix_id: int
    prefix_str: Optional[str] = None
    client_group: Optional[str] = None
    ip_address: str
    icmp_alive: bool
    snmp_alive: bool
    status: str
    hostname: Optional[str]
    description: Optional[str]
    community: Optional[str]
    rtt_ms: Optional[float]
    asset_id: Optional[int]
    asset_name: Optional[str] = None
    last_seen_at: Optional[datetime]

    class Config:
        from_attributes = True


class ScanTriggerResponse(BaseModel):
    prefix: str
    duration_seconds: float
    total_scanned: int
    total_active: int
    total_snmp: int
    total_icmp_only: int
    matched_assets: int


# ==============================================================================
# ROTAS DE COMUNIDADES SNMP
# ==============================================================================

@router.get("/communities", response_model=List[CommunityResponse])
def list_communities(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(IPCommunity).order_by(IPCommunity.name).all()


@router.post("/communities", response_model=CommunityResponse)
def create_community(item: CommunityCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if item.is_default:
        db.query(IPCommunity).update({IPCommunity.is_default: False})

    new_comm = IPCommunity(
        name=item.name,
        community=item.community,
        version=item.version,
        port=item.port,
        is_default=item.is_default
    )
    db.add(new_comm)
    db.commit()
    db.refresh(new_comm)
    return new_comm


@router.delete("/communities/{comm_id}")
def delete_community(comm_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    comm = db.query(IPCommunity).filter(IPCommunity.id == comm_id).first()
    if not comm:
        raise HTTPException(status_code=404, detail="Comunidade não encontrada.")
    db.delete(comm)
    db.commit()
    return {"message": "Comunidade excluída com sucesso."}


# ==============================================================================
# ROTAS DE PREFIXOS
# ==============================================================================

@router.get("/prefixes", response_model=List[PrefixResponse])
def list_prefixes(
    client_group: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    query = db.query(IPPrefix)
    if client_group and client_group.lower() != "todos":
        query = query.filter(IPPrefix.client_group == client_group)
    
    prefixes = query.order_by(IPPrefix.prefix).all()
    results = []
    for p in prefixes:
        comm_name = p.community_rel.name if p.community_rel else "Padrão"
        results.append(PrefixResponse(
            id=p.id,
            prefix=p.prefix,
            client_group=p.client_group,
            description=p.description,
            community_id=p.community_id,
            community_name=comm_name,
            last_scan_at=p.last_scan_at,
            total_hosts_found=p.total_hosts_found,
            created_at=p.created_at
        ))
    return results


@router.post("/prefixes", response_model=PrefixResponse)
def create_prefix(item: PrefixCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    exists = db.query(IPPrefix).filter(IPPrefix.prefix == item.prefix.strip()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Este prefixo já está cadastrado.")

    new_pref = IPPrefix(
        prefix=item.prefix.strip(),
        client_group=item.client_group.strip().lower(),
        description=item.description,
        community_id=item.community_id
    )
    db.add(new_pref)
    db.commit()
    db.refresh(new_pref)
    
    comm_name = new_pref.community_rel.name if new_pref.community_rel else "Padrão"
    return PrefixResponse(
        id=new_pref.id,
        prefix=new_pref.prefix,
        client_group=new_pref.client_group,
        description=new_pref.description,
        community_id=new_pref.community_id,
        community_name=comm_name,
        last_scan_at=new_pref.last_scan_at,
        total_hosts_found=0,
        created_at=new_pref.created_at
    )


@router.delete("/prefixes/{prefix_id}")
def delete_prefix(prefix_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    pref = db.query(IPPrefix).filter(IPPrefix.id == prefix_id).first()
    if not pref:
        raise HTTPException(status_code=404, detail="Prefixo não encontrado.")
    db.delete(pref)
    db.commit()
    return {"message": "Prefixo e seus IPs descobertos foram excluídos com sucesso."}


# ==============================================================================
# DISPARO MANUAL DE SCAN NO CONTAINER DO PROBE
# ==============================================================================

@router.post("/prefixes/{prefix_id}/scan", response_model=ScanTriggerResponse)
async def trigger_prefix_scan(
    prefix_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    pref = db.query(IPPrefix).filter(IPPrefix.id == prefix_id).first()
    if not pref:
        raise HTTPException(status_code=404, detail="Prefixo não encontrado.")

    # Obter lista de comunidades para testar
    communities_to_try = []
    if pref.community_rel:
        communities_to_try.append(pref.community_rel.community)
    
    # Adicionar comunidades padrão
    all_comms = db.query(IPCommunity).all()
    for c in all_comms:
        if c.community not in communities_to_try:
            communities_to_try.append(c.community)

    if not communities_to_try:
        communities_to_try = ["ipermonitor", "public"]

    # Chamada ao microsserviço de Scanner
    probe_url = f"{SCANNER_PROBE_URL}/api/v1/scan"
    payload = {
        "cidr": pref.prefix,
        "communities": communities_to_try,
        "check_icmp": True,
        "timeout": 1.0,
        "concurrency": 50
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(probe_url, json=payload)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Erro no container Scanner Probe: {resp.text}")
            scan_data = resp.json()
    except Exception as e:
        logger.error(f"Falha ao conectar no container iper-scanner ({probe_url}): {e}")
        raise HTTPException(status_code=502, detail=f"Não foi possível conectar ao container Scanner Probe em {probe_url}. Detalhe: {e}")

    # Processamento dos resultados e matching com Assets
    devices = scan_data.get("devices", [])
    now = datetime.utcnow()

    # Pre-carregar assets que possam estar nesta subnet
    all_assets = db.query(Asset).filter(Asset.ip_address.isnot(None)).all()
    asset_ip_map = {a.ip_address.strip(): a for a in all_assets if a.ip_address}

    # Carregar IPs existentes deste prefixo
    existing_discovered = {d.ip_address: d for d in pref.discovered_ips}

    total_active = 0
    total_snmp = 0
    total_icmp_only = 0
    matched_assets_count = 0

    for dev in devices:
        ip_str = dev["ip"]
        status_str = dev["status"]
        if status_str == "inactive":
            continue

        total_active += 1
        if dev["snmp_alive"]:
            total_snmp += 1
        elif dev["icmp_alive"]:
            total_icmp_only += 1

        matched_asset = asset_ip_map.get(ip_str)
        asset_id = matched_asset.id if matched_asset else None

        # Se encontrou ativo no IperSoft e descobriu novo hostname via SNMP, atualiza o ativo!
        if matched_asset:
            matched_assets_count += 1
            if dev.get("hostname") and dev["hostname"] != matched_asset.hostname:
                matched_asset.hostname = dev["hostname"]
                logger.info(f"Hostname do ativo '{matched_asset.name}' atualizado para: {dev['hostname']}")

        if ip_str in existing_discovered:
            # Atualiza registro existente
            d_obj = existing_discovered[ip_str]
            d_obj.icmp_alive = dev["icmp_alive"]
            d_obj.snmp_alive = dev["snmp_alive"]
            d_obj.status = status_str
            d_obj.hostname = dev.get("hostname") or d_obj.hostname
            d_obj.description = dev.get("description") or d_obj.description
            d_obj.community = dev.get("community") or d_obj.community
            d_obj.rtt_ms = dev.get("rtt_ms")
            d_obj.asset_id = asset_id
            d_obj.last_seen_at = now
        else:
            # Novo IP descoberto
            new_ip = DiscoveredIP(
                prefix_id=pref.id,
                ip_address=ip_str,
                icmp_alive=dev["icmp_alive"],
                snmp_alive=dev["snmp_alive"],
                status=status_str,
                hostname=dev.get("hostname"),
                description=dev.get("description"),
                community=dev.get("community"),
                rtt_ms=dev.get("rtt_ms"),
                asset_id=asset_id,
                last_seen_at=now
            )
            db.add(new_ip)

    pref.last_scan_at = now
    pref.total_hosts_found = total_active
    db.commit()

    return ScanTriggerResponse(
        prefix=pref.prefix,
        duration_seconds=scan_data.get("duration_seconds", 0.0),
        total_scanned=scan_data.get("total_scanned", 0),
        total_active=total_active,
        total_snmp=total_snmp,
        total_icmp_only=total_icmp_only,
        matched_assets=matched_assets_count
    )


# ==============================================================================
# TABELA GERAL COM TODOS OS IPS DESCOBERTOS
# ==============================================================================

@router.get("/ips", response_model=List[DiscoveredIPResponse])
def list_discovered_ips(
    client_group: Optional[str] = None,
    prefix_id: Optional[int] = None,
    status_filter: Optional[str] = None,  # "all", "snmp_and_icmp", "icmp_only"
    search: Optional[str] = None,
    limit: int = Query(default=300, le=1000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    query = db.query(DiscoveredIP).join(IPPrefix, DiscoveredIP.prefix_id == IPPrefix.id)

    if client_group and client_group.lower() != "todos":
        query = query.filter(IPPrefix.client_group == client_group)

    if prefix_id:
        query = query.filter(DiscoveredIP.prefix_id == prefix_id)

    if status_filter and status_filter.lower() != "all":
        query = query.filter(DiscoveredIP.status == status_filter)

    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            or_(
                DiscoveredIP.ip_address.ilike(s),
                DiscoveredIP.hostname.ilike(s),
                DiscoveredIP.description.ilike(s)
            )
        )

    ips = query.order_by(desc(DiscoveredIP.last_seen_at)).limit(limit).all()

    # Formatar resposta enriquecida
    results = []
    for item in ips:
        asset_name = item.asset_rel.name if item.asset_rel else None
        results.append(DiscoveredIPResponse(
            id=item.id,
            prefix_id=item.prefix_id,
            prefix_str=item.prefix_rel.prefix if item.prefix_rel else None,
            client_group=item.prefix_rel.client_group if item.prefix_rel else None,
            ip_address=item.ip_address,
            icmp_alive=item.icmp_alive,
            snmp_alive=item.snmp_alive,
            status=item.status,
            hostname=item.hostname,
            description=item.description,
            community=item.community,
            rtt_ms=item.rtt_ms,
            asset_id=item.asset_id,
            asset_name=asset_name,
            last_seen_at=item.last_seen_at
        ))

    # Ordenar numericamente pelo IP
    try:
        results.sort(key=lambda x: [int(p) for p in x.ip_address.split(".")])
    except Exception:
        pass

    return results


@router.get("/stats")
def get_scanner_stats(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    total_prefixes = db.query(IPPrefix).count()
    total_ips = db.query(DiscoveredIP).count()
    total_snmp = db.query(DiscoveredIP).filter(DiscoveredIP.snmp_alive == True).count()
    total_icmp_only = db.query(DiscoveredIP).filter(
        DiscoveredIP.icmp_alive == True, DiscoveredIP.snmp_alive == False
    ).count()
    total_matched = db.query(DiscoveredIP).filter(DiscoveredIP.asset_id.isnot(None)).count()

    return {
        "total_prefixes": total_prefixes,
        "total_discovered_ips": total_ips,
        "total_snmp": total_snmp,
        "total_icmp_only": total_icmp_only,
        "total_matched_assets": total_matched
    }
