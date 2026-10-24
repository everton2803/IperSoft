from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional, List, Any

from app.database import get_db
from app.models.user import User
from app.models.integration import IntegrationConfig
from app.models.asset import Asset, AssetZabbix
from app.routers.auth import get_current_user
from app.services.zabbix import ZabbixService

router = APIRouter(prefix="/integrations/zabbix", tags=["Integração Zabbix"])

class ZabbixConfigRequest(BaseModel):
    url: str
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None

class ZabbixConfigResponse(BaseModel):
    url: str
    has_token: bool
    username: Optional[str] = None
    is_active: bool
    last_sync: Optional[Any] = None

class ZabbixTestRequest(BaseModel):
    url: str
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


@router.get("/config", response_model=Optional[ZabbixConfigResponse])
def get_zabbix_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg:
        return None
    return {
        "url": cfg.url,
        "has_token": bool(cfg.token),
        "username": cfg.username,
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }


@router.post("/config", response_model=ZabbixConfigResponse)
def save_zabbix_config(
    req: ZabbixConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem configurar integrações."
        )

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg:
        cfg = IntegrationConfig(name="zabbix", url=req.url.strip())
        db.add(cfg)

    cfg.url = req.url.strip()
    if req.token:
        cfg.token = req.token.strip()
    if req.username is not None:
        cfg.username = req.username.strip()
    if req.password:
        cfg.password = req.password

    cfg.is_active = True
    db.commit()
    db.refresh(cfg)

    return {
        "url": cfg.url,
        "has_token": bool(cfg.token),
        "username": cfg.username,
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }


@router.post("/test")
async def test_zabbix_connection(
    req: ZabbixTestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Se token/password não foram enviados, tenta resgatar do banco
    url = req.url
    token = req.token
    username = req.username
    password = req.password

    if not token and not password:
        saved = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
        if saved:
            token = saved.token
            username = saved.username
            password = saved.password

    try:
        version = await ZabbixService.get_version(url)
        # Se tem token ou login, testa autenticação também
        if token or (username and password):
            hosts = await ZabbixService.fetch_hosts(url, token=token, username=username, password=password)
            return {
                "success": True,
                "version": version,
                "message": f"Conectado com sucesso ao Zabbix v{version}. {len(hosts)} host(s) acessível(is)."
            }
        return {
            "success": True,
            "version": version,
            "message": f"Servidor Zabbix v{version} respondendo com sucesso."
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )


@router.post("/preview")
async def preview_zabbix_hosts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuração do Zabbix não encontrada. Configure a URL e Token primeiro."
        )

    try:
        hosts = await ZabbixService.fetch_hosts(
            cfg.url,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return {
            "total": len(hosts),
            "hosts": hosts
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao consultar hosts: {exc}"
        )


async def sync_zabbix_hosts_with_db(db: Session) -> dict:
    """
    Importa e vincula hosts do Zabbix Server para o banco de dados do IperSoft.
    Pode ser invocada tanto manualmente via endpoint REST quanto pelo agendador horário (1h).
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg or not cfg.url:
        raise ValueError("Zabbix não configurado.")

    hosts = await ZabbixService.fetch_hosts(
        cfg.url,
        token=cfg.token,
        username=cfg.username,
        password=cfg.password
    )

    all_assets = db.query(Asset).all()
    created_count = 0
    updated_count = 0

    for h in hosts:
        h_ext_id = str(h.get("external_id") or h.get("hostid") or "").strip()
        h_hostname = (h.get("hostname") or "").strip()
        h_name = (h.get("name") or "").strip()
        h_ip = (h.get("ip_address") or "").strip()
        h_groups = h.get("host_groups") or []
        first_group = h_groups[0] if len(h_groups) > 0 else None

        existing = None

        # 1. Prioridade: Match por hostid (external_id ou AssetZabbix.hostid)
        if h_ext_id:
            for a in all_assets:
                z_hid = str(a.zabbix.hostid).strip() if (a.zabbix and a.zabbix.hostid) else ""
                a_ext = str(a.external_id or "").strip()
                if z_hid == h_ext_id or a_ext == h_ext_id:
                    existing = a
                    break

        # 2. Match exato por hostname ou name (case-insensitive)
        if not existing:
            for a in all_assets:
                a_host = (a.hostname or "").strip().lower()
                a_name = (a.name or "").strip().lower()
                if (h_hostname and h_hostname.lower() in (a_host, a_name)) or \
                   (h_name and h_name.lower() in (a_host, a_name)):
                    existing = a
                    break

        # 3. Match por endereço IP (caso ainda não tenha outro hostid diferente vinculado)
        if not existing and h_ip and h_ip not in ("-", "127.0.0.1", "0.0.0.0", "localhost"):
            ip_candidates = [
                a for a in all_assets
                if (a.ip_address or "").strip() == h_ip
                and not (a.zabbix and a.zabbix.hostid and str(a.zabbix.hostid).strip() != h_ext_id)
            ]
            if len(ip_candidates) == 1:
                existing = ip_candidates[0]

        if existing:
            if not existing.name and h_name:
                existing.name = h_name
            if not existing.hostname and h_hostname:
                existing.hostname = h_hostname
            if h_ip and (not existing.ip_address or existing.ip_address == "-"):
                existing.ip_address = h_ip
            if h.get("dns") and not existing.dns:
                existing.dns = h["dns"]
            if h.get("port"):
                existing.port = h["port"]
            if h.get("snmp_community"):
                existing.snmp_community = h["snmp_community"]
            if h_groups:
                existing.host_groups = h_groups
                if not existing.client_group and first_group:
                    existing.client_group = first_group
            if h.get("templates"):
                existing.templates = h["templates"]
            existing.status = h["status"]
            existing.external_id = h_ext_id
            if existing.source == "guacamole":
                existing.source = "unified"

            # Preserva metadados locais do IperSoft (ex: ignore_guacamole, enabled_tests) dentro de raw_data
            merged_raw = dict(h.get("raw_data") or {})
            old_raw = dict(existing.raw_data or {})
            for preserved_key in ("ignore_guacamole", "enabled_tests"):
                if preserved_key in old_raw:
                    merged_raw[preserved_key] = old_raw[preserved_key]
            existing.raw_data = merged_raw

            updated_count += 1
            target_asset = existing
        else:
            new_asset = Asset(
                name=h_name or h_hostname,
                hostname=h_hostname or h_name,
                ip_address=h_ip or None,
                dns=h.get("dns"),
                port=h.get("port"),
                snmp_community=h.get("snmp_community"),
                client_group=first_group,
                host_groups=h_groups,
                templates=h.get("templates") or [],
                status=h["status"],
                source="zabbix",
                external_id=h_ext_id,
                raw_data=h.get("raw_data") or {}
            )
            db.add(new_asset)
            db.flush()
            all_assets.append(new_asset)
            created_count += 1
            target_asset = new_asset

        # Sincroniza na tabela modular asset_zabbix
        zbx_entry = db.query(AssetZabbix).filter(AssetZabbix.asset_id == target_asset.id).first()
        if not zbx_entry:
            zbx_entry = AssetZabbix(
                asset_id=target_asset.id,
                hostid=h_ext_id,
                port=h.get("port"),
                snmp_community=h.get("snmp_community"),
                host_groups=h_groups,
                templates=h.get("templates") or [],
                status=h["status"],
                last_sync=func.now()
            )
            db.add(zbx_entry)
        else:
            zbx_entry.hostid = h_ext_id
            zbx_entry.port = h.get("port")
            zbx_entry.snmp_community = h.get("snmp_community")
            zbx_entry.host_groups = h_groups
            zbx_entry.templates = h.get("templates") or []
            zbx_entry.status = h["status"]
            zbx_entry.last_sync = func.now()

    cfg.last_sync = func.now()
    db.commit()

    return {
        "success": True,
        "total_zabbix": len(hosts),
        "created": created_count,
        "updated": updated_count,
        "message": f"Sincronização Zabbix concluída: {created_count} novo(s) importado(s), {updated_count} vinculado(s)/atualizado(s)."
    }


@router.post("/sync")
async def sync_zabbix_hosts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem iniciar a sincronização de ativos."
        )

    try:
        return await sync_zabbix_hosts_with_db(db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao sincronizar hosts do Zabbix: {exc}"
        )


class ZabbixAcknowledgeRequest(BaseModel):
    eventid: Optional[str] = None
    triggerid: Optional[str] = None
    acknowledged: bool = True
    message: Optional[str] = None


class ZabbixCloseRequest(BaseModel):
    eventid: Optional[str] = None
    triggerid: Optional[str] = None
    message: Optional[str] = None


@router.get("/problems")
async def get_zabbix_global_problems(
    search: Optional[str] = None,
    severity: Optional[int] = None,
    acknowledged: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna todos os alarmes/triggers ativos em estado de PROBLEM no Zabbix Server,
    cruzando e enriquecendo com os dados do inventário do IperSoft.
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuração do Zabbix não encontrada."
        )

    try:
        raw_problems = await ZabbixService.fetch_all_problems(
            cfg.url,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password,
            limit=500
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao consultar alarmes no Zabbix: {exc}"
        )

    # Carregar ativos do IperSoft para mapeamento ágil em memória
    assets = db.query(Asset).all()
    asset_by_hostid = {}
    asset_by_hostname = {}
    asset_by_name = {}

    for a in assets:
        if a.zabbix and a.zabbix.hostid:
            asset_by_hostid[str(a.zabbix.hostid)] = a
        if a.external_id:
            asset_by_hostid[str(a.external_id)] = a
        if a.hostname:
            asset_by_hostname[a.hostname.strip().lower()] = a
        if a.name:
            asset_by_name[a.name.strip().lower()] = a

    enriched_problems = []

    # Estatísticas globais
    stats = {
        "total": len(raw_problems),
        "disaster": 0,
        "high": 0,
        "average": 0,
        "warning": 0,
        "info": 0,
        "not_classified": 0,
        "acknowledged": 0,
        "unacknowledged": 0
    }

    for p in raw_problems:
        p_prio = p.get("priority", 0)
        p_ack = p.get("acknowledged", False)

        # Atualiza contadores globais
        if p_prio == 5:
            stats["disaster"] += 1
        elif p_prio == 4:
            stats["high"] += 1
        elif p_prio == 3:
            stats["average"] += 1
        elif p_prio == 2:
            stats["warning"] += 1
        elif p_prio == 1:
            stats["info"] += 1
        else:
            stats["not_classified"] += 1

        if p_ack:
            stats["acknowledged"] += 1
        else:
            stats["unacknowledged"] += 1

        # Match com ativo do IperSoft
        matched_asset = None
        for h in p.get("hosts", []):
            hid = str(h.get("hostid"))
            h_host = (h.get("host") or "").strip().lower()
            h_name = (h.get("name") or "").strip().lower()

            if hid in asset_by_hostid:
                matched_asset = asset_by_hostid[hid]
                break
            elif h_host in asset_by_hostname:
                matched_asset = asset_by_hostname[h_host]
                break
            elif h_name in asset_by_name:
                matched_asset = asset_by_name[h_name]
                break

        primary_host = p["hosts"][0] if p.get("hosts") else {}

        item_data = {
            "triggerid": p["triggerid"],
            "description": p["description"],
            "opdata": p.get("opdata", ""),
            "comments": p["comments"],
            "priority": p["priority"],
            "severity_label": p["severity_label"],
            "severity_level": p["severity_level"],
            "severity_color": p["severity_color"],
            "lastchange": p["lastchange"],
            "eventid": p["eventid"],
            "acknowledged": p["acknowledged"],
            "hostid": primary_host.get("hostid"),
            "host_technical": primary_host.get("host"),
            "host_name": primary_host.get("name"),
            "hosts": p.get("hosts", []),
            "items": p.get("items", []),
            "tags": p.get("tags", []),
            "asset_id": matched_asset.id if matched_asset else None,
            "asset_name": matched_asset.name if matched_asset else (primary_host.get("name") or primary_host.get("host")),
            "asset_ip": matched_asset.ip_address if matched_asset else None,
            "asset_group": matched_asset.client_group if matched_asset else None,
            "is_matched": bool(matched_asset)
        }

        # Filtros no backend
        if severity is not None and item_data["priority"] != severity:
            continue
        if acknowledged is not None and item_data["acknowledged"] != acknowledged:
            continue
        if search:
            s_lower = search.strip().lower()
            desc = (item_data["description"] or "").lower()
            opdata_txt = (item_data["opdata"] or "").lower()
            h_tech = (item_data["host_technical"] or "").lower()
            h_n = (item_data["host_name"] or "").lower()
            a_n = (item_data["asset_name"] or "").lower()
            a_ip = (item_data["asset_ip"] or "").lower()
            a_grp = (item_data["asset_group"] or "").lower()
            if not any(s_lower in field for field in (desc, opdata_txt, h_tech, h_n, a_n, a_ip, a_grp)):
                continue

        enriched_problems.append(item_data)

    return {
        "stats": stats,
        "total_filtered": len(enriched_problems),
        "problems": enriched_problems
    }


@router.post("/acknowledge")
async def acknowledge_zabbix_problem(
    req: ZabbixAcknowledgeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Reconhece ou remove o reconhecimento de um evento/trigger no Zabbix.
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuração do Zabbix não encontrada."
        )

    try:
        user_label = current_user.full_name or current_user.username
        default_msg = f"{'Reconhecido' if req.acknowledged else 'Reconhecimento desmarcado'} por {user_label} via IperSoft"
        msg = req.message or default_msg

        res = await ZabbixService.acknowledge_event(
            cfg.url,
            eventid=req.eventid,
            triggerid=req.triggerid,
            acknowledged=req.acknowledged,
            message=msg,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return res
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao atualizar reconhecimento no Zabbix: {exc}"
        )


@router.post("/close")
async def close_zabbix_problem(
    req: ZabbixCloseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Encerra (resolve manualmente) um evento/problema no Zabbix.
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuração do Zabbix não encontrada."
        )

    try:
        user_label = current_user.full_name or current_user.username
        default_msg = f"Alarme encerrado por {user_label} via IperSoft"
        msg = req.message or default_msg

        res = await ZabbixService.close_event(
            cfg.url,
            eventid=req.eventid,
            triggerid=req.triggerid,
            message=msg,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return res
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao encerrar alarme no Zabbix: {exc}"
        )

