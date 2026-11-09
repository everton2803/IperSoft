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
from app.models.ip_scanner import IPScannerProbe, IPCommunity, IPPrefix, DiscoveredIP, DiscoveredVLAN
from app.models.asset import Asset
from app.routers.auth import get_current_user
from app.services.diagnostics import sync_discovered_ips_with_assets
from app.services.phpipam_sync import sync_ipersoft_to_phpipam
from app.services.oxidized_vlan_extractor import extract_vlans_from_oxidized

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


class CommunityUpdate(BaseModel):
    name: Optional[str] = None
    community: Optional[str] = None
    version: Optional[str] = None
    port: Optional[int] = None
    is_default: Optional[bool] = None


class CommunityResponse(BaseModel):
    id: int
    name: str
    community: str
    version: Optional[str] = "2c"
    port: Optional[int] = 161
    is_default: Optional[bool] = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProbeCreate(BaseModel):
    name: str = Field(..., example="VM Zabbix Proxy - Inforline")
    url: str = Field(..., example="http://172.16.10.22:8005")
    client_group: Optional[str] = Field(default="", example="inforline")
    phpipam_agent_code: Optional[str] = Field(default="", example="")
    is_default: bool = Field(default=False)


class ProbeUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    client_group: Optional[str] = None
    phpipam_agent_code: Optional[str] = None
    is_default: Optional[bool] = None


class ProbeResponse(BaseModel):
    id: int
    name: str
    url: str
    client_group: Optional[str] = ""
    phpipam_agent_code: Optional[str] = ""
    is_default: Optional[bool] = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PrefixCreate(BaseModel):
    prefix: str = Field(..., example="10.90.10.0/24")
    client_group: str = Field(..., example="atm")
    description: Optional[str] = Field(default="", example="Switches de agregação Matriz")
    community_id: Optional[int] = None
    community_ids: Optional[List[int]] = Field(default_factory=list)
    probe_id: Optional[int] = None


class PrefixUpdate(BaseModel):
    prefix: Optional[str] = None
    client_group: Optional[str] = None
    description: Optional[str] = None
    community_id: Optional[int] = None
    community_ids: Optional[List[int]] = None
    probe_id: Optional[int] = None


class PrefixResponse(BaseModel):
    id: int
    prefix: str
    client_group: str
    description: Optional[str] = ""
    community_id: Optional[int] = None
    community_ids: List[int] = []
    community_names: List[str] = []
    community_name: Optional[str] = None
    probe_id: Optional[int] = None
    probe_name: Optional[str] = None
    last_scan_at: Optional[datetime] = None
    total_hosts_found: Optional[int] = 0
    created_at: Optional[datetime] = None

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


class DiscoveredVLANResponse(BaseModel):
    id: int
    client_group: str
    vlan_id: int
    name: str
    description: Optional[str] = None
    subnets: List[str] = []
    devices: List[dict] = []
    phpipam_vlan_id: Optional[int] = None
    last_extracted_at: Optional[datetime] = None

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
# ROTAS DE PROBES / AGENTES REMOTOS DE SCAN
# ==============================================================================

def _ensure_default_probe(db: Session) -> List[IPScannerProbe]:
    probes = db.query(IPScannerProbe).order_by(IPScannerProbe.id).all()
    if not probes:
        default_probe = IPScannerProbe(
            name="Probe Central (brdrive)",
            url=SCANNER_PROBE_URL,
            client_group="",
            phpipam_agent_code="",
            is_default=True
        )
        db.add(default_probe)
        db.commit()
        db.refresh(default_probe)
        probes = [default_probe]
    return probes


@router.get("/probes", response_model=List[ProbeResponse])
def list_probes(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return _ensure_default_probe(db)


@router.post("/probes", response_model=ProbeResponse)
def create_probe(item: ProbeCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    _ensure_default_probe(db)
    if item.is_default:
        db.query(IPScannerProbe).update({IPScannerProbe.is_default: False})

    new_probe = IPScannerProbe(
        name=item.name.strip(),
        url=item.url.strip().rstrip("/"),
        client_group=(item.client_group or "").strip().lower(),
        phpipam_agent_code=(item.phpipam_agent_code or "").strip(),
        is_default=item.is_default
    )
    db.add(new_probe)
    db.commit()
    db.refresh(new_probe)
    return new_probe


@router.put("/probes/{probe_id}", response_model=ProbeResponse)
def update_probe(
    probe_id: int,
    item: ProbeUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    probe = db.query(IPScannerProbe).filter(IPScannerProbe.id == probe_id).first()
    if not probe:
        raise HTTPException(status_code=404, detail="Probe não encontrado.")

    if item.is_default is True:
        db.query(IPScannerProbe).filter(IPScannerProbe.id != probe_id).update({IPScannerProbe.is_default: False})
        probe.is_default = True
    elif item.is_default is False:
        probe.is_default = False

    if item.name is not None and item.name.strip():
        probe.name = item.name.strip()
    if item.url is not None and item.url.strip():
        probe.url = item.url.strip().rstrip("/")
    if item.client_group is not None:
        probe.client_group = item.client_group.strip().lower()
    if item.phpipam_agent_code is not None:
        probe.phpipam_agent_code = item.phpipam_agent_code.strip()

    db.commit()
    db.refresh(probe)
    return probe


@router.delete("/probes/{probe_id}")
def delete_probe(probe_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    probe = db.query(IPScannerProbe).filter(IPScannerProbe.id == probe_id).first()
    if not probe:
        raise HTTPException(status_code=404, detail="Probe não encontrado.")
    db.delete(probe)
    db.commit()
    return {"message": "Probe excluído com sucesso."}


@router.post("/probes/{probe_id}/test")
async def test_probe_connection(probe_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    probe = db.query(IPScannerProbe).filter(IPScannerProbe.id == probe_id).first()
    if not probe:
        raise HTTPException(status_code=404, detail="Probe não encontrado.")

    health_url = f"{probe.url.rstrip('/')}/health"
    import time
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(health_url)
            latency_ms = round((time.perf_counter() - t0) * 1000, 1)
            if resp.status_code == 200:
                return {
                    "status": "online",
                    "latency_ms": latency_ms,
                    "message": f"Online ({latency_ms} ms) - {probe.url}"
                }
            return {
                "status": "offline",
                "latency_ms": latency_ms,
                "message": f"HTTP {resp.status_code} ao consultar {health_url}"
            }
    except Exception as e:
        return {
            "status": "offline",
            "latency_ms": None,
            "message": f"Sem resposta em {health_url}: {str(e)}"
        }


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


@router.put("/communities/{comm_id}", response_model=CommunityResponse)
def update_community(
    comm_id: int,
    item: CommunityUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    comm = db.query(IPCommunity).filter(IPCommunity.id == comm_id).first()
    if not comm:
        raise HTTPException(status_code=404, detail="Comunidade não encontrada.")

    if item.is_default is True:
        db.query(IPCommunity).filter(IPCommunity.id != comm_id).update({IPCommunity.is_default: False})
        comm.is_default = True
    elif item.is_default is False:
        comm.is_default = False

    if item.name is not None and item.name.strip():
        comm.name = item.name.strip()
    if item.community is not None and item.community.strip():
        comm.community = item.community.strip()
    if item.version is not None and item.version.strip():
        comm.version = item.version.strip()
    if item.port is not None:
        comm.port = int(item.port)

    db.commit()
    db.refresh(comm)
    return comm


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

def _resolve_prefix_community_ids(p: IPPrefix) -> List[int]:
    raw_ids = p.community_ids if isinstance(p.community_ids, list) else []
    clean_ids = []
    for cid in raw_ids:
        try:
            val = int(cid)
            if val not in clean_ids:
                clean_ids.append(val)
        except (ValueError, TypeError):
            pass
    if not clean_ids and p.community_id:
        clean_ids = [int(p.community_id)]
    return clean_ids


def _resolve_target_probe(p: IPPrefix, probes: List[IPScannerProbe]) -> Optional[IPScannerProbe]:
    probe_map = {pr.id: pr for pr in probes}
    if p.probe_id and p.probe_id in probe_map:
        return probe_map[p.probe_id]
    # Tenta probe vinculado ao mesmo client_group
    cg = (p.client_group or "").strip().lower()
    if cg:
        for pr in probes:
            if (pr.client_group or "").strip().lower() == cg:
                return pr
    # Fallback para o probe padrão
    for pr in probes:
        if pr.is_default:
            return pr
    return probes[0] if probes else None


def _build_prefix_response(p: IPPrefix, comm_map: dict, probes: List[IPScannerProbe]) -> PrefixResponse:
    c_ids = _resolve_prefix_community_ids(p)
    valid_ids = [cid for cid in c_ids if cid in comm_map]
    c_names = [comm_map[cid].name for cid in valid_ids]
    comm_label = ", ".join(c_names) if c_names else "Todas cadastradas"
    target_probe = _resolve_target_probe(p, probes)
    if p.probe_id and target_probe:
        probe_label = target_probe.name
    elif target_probe:
        probe_label = f"Automático ({target_probe.name})"
    else:
        probe_label = "Central (brdrive)"

    return PrefixResponse(
        id=p.id,
        prefix=p.prefix,
        client_group=p.client_group,
        description=p.description or "",
        community_id=valid_ids[0] if valid_ids else None,
        community_ids=valid_ids,
        community_names=c_names,
        community_name=comm_label,
        probe_id=p.probe_id,
        probe_name=probe_label,
        last_scan_at=p.last_scan_at,
        total_hosts_found=p.total_hosts_found or 0,
        created_at=p.created_at
    )


@router.get("/prefixes", response_model=List[PrefixResponse])
def list_prefixes(
    client_group: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    probes = _ensure_default_probe(db)
    comm_map = {c.id: c for c in db.query(IPCommunity).all()}
    query = db.query(IPPrefix)
    if client_group and client_group.lower() != "todos":
        query = query.filter(IPPrefix.client_group == client_group)
    
    prefixes = query.order_by(IPPrefix.prefix).all()
    return [_build_prefix_response(p, comm_map, probes) for p in prefixes]


@router.post("/prefixes", response_model=PrefixResponse)
def create_prefix(item: PrefixCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    exists = db.query(IPPrefix).filter(IPPrefix.prefix == item.prefix.strip()).first()
    if exists:
        raise HTTPException(status_code=400, detail="Este prefixo já está cadastrado.")

    c_ids = []
    if item.community_ids:
        for cid in item.community_ids:
            if int(cid) not in c_ids:
                c_ids.append(int(cid))
    elif item.community_id:
        c_ids = [int(item.community_id)]

    new_pref = IPPrefix(
        prefix=item.prefix.strip(),
        client_group=item.client_group.strip().lower(),
        description=item.description,
        community_id=c_ids[0] if c_ids else None,
        community_ids=c_ids,
        probe_id=int(item.probe_id) if item.probe_id else None
    )
    db.add(new_pref)
    db.commit()
    db.refresh(new_pref)

    probes = _ensure_default_probe(db)
    comm_map = {c.id: c for c in db.query(IPCommunity).all()}
    return _build_prefix_response(new_pref, comm_map, probes)


@router.put("/prefixes/{prefix_id}", response_model=PrefixResponse)
def update_prefix(
    prefix_id: int,
    item: PrefixUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    pref = db.query(IPPrefix).filter(IPPrefix.id == prefix_id).first()
    if not pref:
        raise HTTPException(status_code=404, detail="Prefixo não encontrado.")

    if item.prefix is not None and item.prefix.strip():
        new_cidr = item.prefix.strip()
        if new_cidr != pref.prefix:
            exists = db.query(IPPrefix).filter(IPPrefix.prefix == new_cidr, IPPrefix.id != prefix_id).first()
            if exists:
                raise HTTPException(status_code=400, detail="Já existe outro prefixo cadastrado com este CIDR.")
            pref.prefix = new_cidr

    if item.client_group is not None and item.client_group.strip():
        pref.client_group = item.client_group.strip().lower()

    if item.description is not None:
        pref.description = item.description.strip()

    if item.community_ids is not None:
        c_ids = []
        for cid in item.community_ids:
            try:
                val = int(cid)
                if val not in c_ids:
                    c_ids.append(val)
            except (ValueError, TypeError):
                pass
        pref.community_ids = c_ids
        pref.community_id = c_ids[0] if c_ids else None
    elif item.community_id is not None:
        pref.community_id = int(item.community_id) if item.community_id else None
        pref.community_ids = [int(item.community_id)] if item.community_id else []

    if "probe_id" in item.model_fields_set:
        pref.probe_id = int(item.probe_id) if item.probe_id else None

    db.commit()
    db.refresh(pref)

    probes = _ensure_default_probe(db)
    comm_map = {c.id: c for c in db.query(IPCommunity).all()}
    return _build_prefix_response(pref, comm_map, probes)


@router.delete("/prefixes/{prefix_id}")
def delete_prefix(prefix_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    pref = db.query(IPPrefix).filter(IPPrefix.id == prefix_id).first()
    if not pref:
        raise HTTPException(status_code=404, detail="Prefixo não encontrado.")
    db.delete(pref)
    db.commit()
    return {"message": "Prefixo e seus IPs descobertos foram excluídos com sucesso."}


# ==============================================================================
# DISPARO MANUAL E EM LOTE DE SCAN NOS CONTAINERS DOS PROBES
# ==============================================================================

async def scan_single_prefix_by_id(prefix_id: int, db: Session) -> ScanTriggerResponse:
    pref = db.query(IPPrefix).filter(IPPrefix.id == prefix_id).first()
    if not pref:
        raise HTTPException(status_code=404, detail="Prefixo não encontrado.")

    # Obter lista de comunidades para testar:
    # Se o prefixo possui comunidades específicas associadas, testa APENAS elas.
    # Caso contrário (nenhuma específica selecionada), testa todas as cadastradas.
    all_comms = db.query(IPCommunity).all()
    comm_map = {c.id: c for c in all_comms}
    selected_c_ids = _resolve_prefix_community_ids(pref)

    communities_to_try = []
    if selected_c_ids:
        for cid in selected_c_ids:
            c_obj = comm_map.get(cid)
            if c_obj and c_obj.community not in communities_to_try:
                communities_to_try.append(c_obj.community)

    if not communities_to_try:
        for c in all_comms:
            if c.community not in communities_to_try:
                communities_to_try.append(c.community)

    if not communities_to_try:
        communities_to_try = ["ipermonitor", "public"]

    # Resolver em qual Probe (Central ou VM Zabbix Proxy do Cliente) o scan será executado
    probes = _ensure_default_probe(db)
    target_probe = _resolve_target_probe(pref, probes)
    base_probe_url = (target_probe.url if target_probe else SCANNER_PROBE_URL).rstrip("/")
    probe_name = target_probe.name if target_probe else "Probe Central"

    # Chamada ao microsserviço de Scanner (Local ou Remoto)
    probe_url = f"{base_probe_url}/api/v1/scan"
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
                raise HTTPException(status_code=502, detail=f"Erro no {probe_name}: {resp.text}")
            scan_data = resp.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Falha ao conectar no {probe_name} ({probe_url}): {e}")
        raise HTTPException(status_code=502, detail=f"Não foi possível conectar ao {probe_name} em {probe_url}. Detalhe: {e}")

    # Processamento dos resultados e matching com Assets
    devices = scan_data.get("devices", [])
    now = datetime.utcnow()

    # Pre-carregar todos os assets para associação por IP ou por Hostname SNMP (sysName)
    all_assets = db.query(Asset).all()
    asset_ip_map = {a.ip_address.strip(): a for a in all_assets if a.ip_address and a.ip_address.strip()}
    asset_snmp_host_map = {a.snmp_hostname.strip().lower(): a for a in all_assets if a.snmp_hostname and a.snmp_hostname.strip()}
    asset_host_map = {a.hostname.strip().lower(): a for a in all_assets if a.hostname and a.hostname.strip()}
    asset_name_map = {a.name.strip().lower(): a for a in all_assets if a.name and a.name.strip()}

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

        dev_host = (dev.get("hostname") or "").strip()
        dev_host_low = dev_host.lower() if dev_host else ""

        matched_asset = asset_ip_map.get(ip_str)
        if not matched_asset and dev_host_low:
            matched_asset = (
                asset_snmp_host_map.get(dev_host_low)
                or asset_host_map.get(dev_host_low)
                or asset_name_map.get(dev_host_low)
            )

        asset_id = matched_asset.id if matched_asset else None

        # Se encontrou ativo no IperSoft e descobriu hostname via SNMP, grava no snmp_hostname!
        if matched_asset:
            matched_assets_count += 1
            if dev_host and dev_host != matched_asset.snmp_hostname:
                matched_asset.snmp_hostname = dev_host
                asset_snmp_host_map[dev_host_low] = matched_asset
                logger.info(f"SNMP Hostname do ativo '{matched_asset.name}' salvo como: {dev_host}")

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


async def scan_all_prefixes_batch(db: Session, client_group: Optional[str] = None) -> dict:
    """
    Executa a varredura em todos os prefixos cadastrados (ou filtrados por client_group)
    utilizando o Scanner Probe associado a cada prefixo.
    """
    import time
    t0 = time.perf_counter()

    query = db.query(IPPrefix)
    if client_group and client_group.strip().lower() != "todos":
        query = query.filter(IPPrefix.client_group == client_group.strip().lower())

    prefixes = query.order_by(IPPrefix.id).all()
    stats = {
        "total_prefixes": len(prefixes),
        "prefixes_scanned": 0,
        "prefixes_failed": 0,
        "total_active": 0,
        "total_snmp": 0,
        "total_icmp_only": 0,
        "matched_assets": 0,
        "duration_seconds": 0.0,
        "errors": []
    }

    for pref in prefixes:
        try:
            res = await scan_single_prefix_by_id(pref.id, db)
            stats["prefixes_scanned"] += 1
            stats["total_active"] += res.total_active
            stats["total_snmp"] += res.total_snmp
            stats["total_icmp_only"] += res.total_icmp_only
            stats["matched_assets"] += res.matched_assets
        except HTTPException as he:
            stats["prefixes_failed"] += 1
            err_msg = f"{pref.prefix} ({pref.client_group}): {he.detail}"
            logger.warning(f"Falha ao escanear prefixo {err_msg}")
            stats["errors"].append(err_msg)
        except Exception as e:
            stats["prefixes_failed"] += 1
            err_msg = f"{pref.prefix} ({pref.client_group}): {str(e)}"
            logger.warning(f"Falha inesperada ao escanear prefixo {err_msg}")
            stats["errors"].append(err_msg)

    stats["duration_seconds"] = round(time.perf_counter() - t0, 2)
    return stats


@router.post("/prefixes/scan-all")
async def trigger_all_prefixes_scan(
    client_group: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    stats = await scan_all_prefixes_batch(db, client_group=client_group)
    return {
        "status": "ok",
        "message": "Varredura em lote de prefixos concluída!",
        "stats": stats
    }


@router.post("/prefixes/{prefix_id}/scan", response_model=ScanTriggerResponse)
async def trigger_prefix_scan(
    prefix_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    return await scan_single_prefix_by_id(prefix_id, db)


@router.post("/vlans/extract-oxidized")
async def trigger_oxidized_vlan_extraction(
    client_group: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Varre os backups de configuração dos equipamentos no Oxidized (MikroTik RouterOS,
    Huawei VRP, Datacom DmOS e Juniper JunOS) e extrai as VLANs, interfaces e sub-redes L3.
    """
    try:
        stats = await extract_vlans_from_oxidized(db, client_group=client_group)
        return {
            "status": "ok",
            "message": "Extração de VLANs via Oxidized concluída com sucesso!",
            "stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao extrair VLANs do Oxidized: {e}")


@router.get("/vlans", response_model=List[DiscoveredVLANResponse])
def list_discovered_vlans(
    client_group: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=500, le=2000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    query = db.query(DiscoveredVLAN)
    if client_group and client_group.lower() != "todos":
        cg = client_group.strip().lower()
        if cg == "oestenets":
            cg = "oestenet"
        query = query.filter(DiscoveredVLAN.client_group == cg)

    if search and search.strip():
        s_raw = search.strip()
        s_like = f"%{s_raw}%"
        if s_raw.isdigit():
            query = query.filter(
                or_(
                    DiscoveredVLAN.vlan_id == int(s_raw),
                    DiscoveredVLAN.name.ilike(s_like),
                    DiscoveredVLAN.description.ilike(s_like)
                )
            )
        else:
            query = query.filter(
                or_(
                    DiscoveredVLAN.name.ilike(s_like),
                    DiscoveredVLAN.description.ilike(s_like),
                    DiscoveredVLAN.client_group.ilike(s_like)
                )
            )

    return query.order_by(DiscoveredVLAN.client_group, DiscoveredVLAN.vlan_id).limit(limit).all()


@router.post("/sync-phpipam")
def trigger_phpipam_sync(
    prefix_id: Optional[int] = None,
    client_group: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Sincroniza equipamentos (devices), seções (sections), VLANs (vlans + vlanDomains),
    prefixos (subnets) e IPs descobertos + vínculo com equipamentos (ipaddresses.switch)
    do IperSoft para o phpIPAM.
    """
    try:
        stats = sync_ipersoft_to_phpipam(db, prefix_id=prefix_id, client_group=client_group)
        return {
            "status": "ok",
            "message": "Sincronização com phpIPAM concluída com sucesso!",
            "stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Falha ao sincronizar com phpIPAM: {e}")


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
    # Garante associação automática de IPs já descobertos caso snmp_hostname tenha sido atualizado
    if sync_discovered_ips_with_assets(db) > 0:
        db.commit()

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
    total_vlans = db.query(DiscoveredVLAN).count()

    return {
        "total_prefixes": total_prefixes,
        "total_discovered_ips": total_ips,
        "total_snmp": total_snmp,
        "total_icmp_only": total_icmp_only,
        "total_matched_assets": total_matched,
        "total_vlans": total_vlans
    }
