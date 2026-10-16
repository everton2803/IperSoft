from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional, List, Any, Dict
from pydantic import BaseModel
from datetime import datetime, timezone
import logging

from app.database import get_db
from app.models.user import User
from app.models.asset import Asset, AssetZabbix, AssetGuacamole, AssetOxidized, NetworkDiagnostic
from app.models.integration import IntegrationConfig
from app.routers.auth import get_current_user
from app.services.zabbix import ZabbixService
from app.services.guacamole import GuacamoleService
from app.services.oxidized import OxidizedService, parse_oxidized_datetime
import time

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assets", tags=["Ativos de Rede"])


async def notify_oxidized_reload_if_active(db: Session, reason: str = "") -> bool:
    """Dispara recarregamento automático da lista de nós no Oxidized (/reload) se a integração estiver ativa."""
    try:
        ox_cfg = db.query(IntegrationConfig).filter(
            IntegrationConfig.name == "oxidized",
            IntegrationConfig.is_active == True
        ).first()
        if ox_cfg and ox_cfg.url:
            await OxidizedService.reload_nodes(ox_cfg.url, ox_cfg.username, ox_cfg.password)
            logger.info(f"Oxidized recarregado automaticamente: {reason}")
            return True
    except Exception as ox_err:
        logger.warning(f"Aviso ao notificar reload no Oxidized ({reason}): {ox_err}")
    return False


async def remove_asset_guacamole_connections(
    asset: Asset,
    db: Session,
    live_conns: Optional[List[Dict[str, Any]]] = None
) -> List[str]:
    """
    Remove todas as conexões remotas correspondentes ao ativo no Apache Guacamole
    e limpa os vínculos locais (AssetGuacamole e guacamole_connection_id).
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    deleted_identifiers = []

    if cfg and cfg.url and cfg.username and cfg.password:
        try:
            if live_conns is None:
                live_conns = await GuacamoleService.fetch_connections_with_parameters(
                    url=cfg.url,
                    username=cfg.username,
                    password=cfg.password
                )

            primary_guac = asset.guacamole[0] if asset.guacamole and len(asset.guacamole) > 0 else None
            saved_cid = str(primary_guac.connection_id) if primary_guac else str(asset.guacamole_connection_id or "")
            target_ip = (asset.ip_address or "").strip().lower()
            target_name = (asset.name or "").strip().lower()
            target_host = (asset.hostname or "").strip().lower()

            for c in (live_conns or []):
                ident = str(c.get("identifier") or "")
                client_id = str(c.get("client_id") or "")
                c_name = (c.get("name") or "").strip().lower()
                c_host = (c.get("hostname") or "").strip().lower()

                # Se corresponder por ID, por IP ou por Nome de conexão
                is_match = False
                if saved_cid and (ident == saved_cid or client_id == saved_cid):
                    is_match = True
                elif target_ip and c_host == target_ip and (target_name in c_name or c_name in target_name):
                    is_match = True
                elif target_name and (c_name == target_name):
                    is_match = True
                elif target_host and (c_name == target_host):
                    is_match = True

                if is_match and ident:
                    try:
                        await GuacamoleService.delete_connection_from_guacamole(
                            url=cfg.url,
                            username=cfg.username,
                            password=cfg.password,
                            identifier=ident
                        )
                        deleted_identifiers.append(ident)
                        logger.info(f"Conexão Guacamole {ident} ({c.get('name')}) deletada com sucesso para ativo {asset.id} ({asset.name}).")
                    except Exception as e:
                        logger.warning(f"Aviso ao deletar conexão {ident} no Guacamole: {e}")

        except Exception as exc:
            logger.error(f"Erro ao consultar/deletar no Guacamole para o ativo {asset.id}: {exc}")

    # Remove registros locais no banco
    db.query(AssetGuacamole).filter(AssetGuacamole.asset_id == asset.id).delete()
    asset.guacamole_connection_id = None
    db.commit()
    db.refresh(asset)
    return deleted_identifiers


class ZabbixDetail(BaseModel):
    id: int
    hostid: Optional[str] = None
    port: Optional[str] = None
    snmp_community: Optional[str] = None
    host_groups: List[str] = []
    templates: List[str] = []
    status: Optional[str] = "monitored"
    last_sync: Optional[datetime] = None
    icmp_status: Optional[str] = None
    icmp_latency_ms: Optional[float] = None
    snmp_status: Optional[str] = None
    snmp_message: Optional[str] = None
    last_diagnostics: Optional[datetime] = None

    class Config:
        from_attributes = True

class GuacamoleDetail(BaseModel):
    id: int
    connection_id: str
    connection_name: Optional[str] = None
    protocol: str = "ssh"
    port: Optional[str] = "22"
    hostname: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    last_sync: Optional[datetime] = None
    tcp_status: Optional[str] = None
    tcp_latency_ms: Optional[float] = None
    tcp_message: Optional[str] = None
    last_diagnostics: Optional[datetime] = None

    class Config:
        from_attributes = True

class OxidizedDetail(BaseModel):
    node_name: str
    model: Optional[str] = "RouterOS"
    group: Optional[str] = "default"
    status: Optional[str] = None
    last_backup: Optional[datetime] = None
    backup_time_taken: Optional[float] = None
    timeout: Optional[int] = 30
    last_sync: Optional[datetime] = None

    class Config:
        from_attributes = True

class AssetResponse(BaseModel):
    id: int
    name: str
    hostname: str
    ip_address: Optional[str] = None
    dns: Optional[str] = None
    status: str
    source: str
    created_at: datetime
    updated_at: datetime

    # Sub-objetos modulares
    zabbix: Optional[ZabbixDetail] = None
    guacamole: List[GuacamoleDetail] = []
    oxidized: Optional[OxidizedDetail] = None

    # Propriedades de compatibilidade com versões anteriores
    client_group: Optional[str] = None
    backup_model: Optional[str] = "RouterOS"
    backup_enabled: Optional[bool] = True
    backup_timeout: Optional[int] = 30
    port: Optional[str] = None
    snmp_community: Optional[str] = None
    host_groups: List[str] = []
    templates: List[str] = []
    external_id: Optional[str] = None
    guacamole_connection_id: Optional[str] = None
    guacamole_protocol: Optional[str] = None
    guacamole_port: Optional[str] = None
    ignore_guacamole: Optional[bool] = False

    class Config:
        from_attributes = True

class AssetUpdate(BaseModel):
    name: Optional[str] = None
    hostname: Optional[str] = None
    client_group: Optional[str] = None
    ip_address: Optional[str] = None
    dns: Optional[str] = None
    port: Optional[str] = None
    snmp_community: Optional[str] = None
    guacamole_connection_id: Optional[str] = None
    guacamole_protocol: Optional[str] = None
    guacamole_port: Optional[str] = None
    guacamole_username: Optional[str] = None
    guacamole_password: Optional[str] = None
    backup_model: Optional[str] = None
    backup_enabled: Optional[bool] = None
    backup_timeout: Optional[int] = None
    status: Optional[str] = None
    sync_zabbix: Optional[bool] = True
    sync_guacamole: Optional[bool] = False
    enabled_tests: Optional[Dict[str, bool]] = None
    ignore_guacamole: Optional[bool] = None

class StatusToggleRequest(BaseModel):
    status: str # "monitored" | "unmonitored"
    sync_zabbix: Optional[bool] = True

class BulkIntegrationsRequest(BaseModel):
    asset_ids: List[int]
    zabbix_enabled: Optional[bool] = None      # True -> monitored, False -> unmonitored
    guacamole_enabled: Optional[bool] = None   # True -> active, False -> ignored
    oxidized_enabled: Optional[bool] = None    # True -> backup_enabled=True, False -> backup_enabled=False


def _ip_sort_key(ip_val: Optional[str]):
    if not ip_val:
        return (1, 0, 0, 0, 0, "")
    ip_clean = str(ip_val).strip()
    parts = ip_clean.split(".")
    if len(parts) == 4 and all(p.isdigit() for p in parts):
        try:
            return (0, int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3]), ip_clean)
        except ValueError:
            pass
    return (1, 0, 0, 0, 0, ip_clean.lower())


@router.get("", response_model=List[AssetResponse])
def list_assets(
    search: Optional[str] = Query(None, description="Busca por nome, hostname ou IP"),
    group: Optional[str] = Query(None, description="Filtrar por grupo"),
    status_filter: Optional[str] = Query(None, alias="status", description="monitored, unmonitored ou all"),
    presence: Optional[str] = Query(None, description="all, both, zabbix_only, guacamole_only, missing_zabbix, missing_guacamole"),
    sort_by: Optional[str] = Query(None, description="name, ip_address, ip, hostname"),
    sort_dir: Optional[str] = Query("asc", description="asc ou desc"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Asset)

    if search:
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Asset.name.ilike(term),
                Asset.hostname.ilike(term),
                Asset.ip_address.ilike(term),
                Asset.snmp_community.ilike(term)
            )
        )

    if status_filter and status_filter.lower() != "all":
        query = query.filter(Asset.status == status_filter.lower())

    assets = query.order_by(Asset.name.asc()).all()

    # Filtro por grupo Zabbix / Empresa
    if group:
        filtered = []
        for a in assets:
            groups = (a.zabbix.host_groups if a.zabbix else a.host_groups) or []
            if (a.client_group and group.lower() == a.client_group.lower()) or any(group.lower() == str(g).lower() for g in groups):
                filtered.append(a)
        assets = filtered

    # Filtro por presença de integração
    if presence:
        p = presence.lower()
        if p in ("both", "integrated"):
            assets = [a for a in assets if a.zabbix and a.guacamole]
        elif p in ("zabbix_only", "missing_guacamole"):
            assets = [a for a in assets if a.zabbix and (not a.guacamole or len(a.guacamole) == 0)]
        elif p in ("guacamole_only", "missing_zabbix"):
            assets = [a for a in assets if not a.zabbix and a.guacamole and len(a.guacamole) > 0]

    # Ordenação
    if sort_by in ("ip", "ip_address"):
        is_desc = (sort_dir or "").lower() == "desc"
        assets = sorted(assets, key=lambda a: _ip_sort_key(a.ip_address or a.hostname), reverse=is_desc)
    elif sort_by == "name":
        is_desc = (sort_dir or "").lower() == "desc"
        assets = sorted(assets, key=lambda a: (a.name or "").lower(), reverse=is_desc)
    elif sort_by == "hostname":
        is_desc = (sort_dir or "").lower() == "desc"
        assets = sorted(assets, key=lambda a: (a.hostname or "").lower(), reverse=is_desc)

    return assets


@router.get("/stats")
def get_assets_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    all_assets = db.query(Asset).all()
    total = len(all_assets)
    
    monitored = 0
    unmonitored = 0
    with_zabbix = 0
    with_guacamole = 0
    with_both = 0
    missing_guacamole = 0
    missing_zabbix = 0
    groups_set = set()
    ip_counts = {}

    for a in all_assets:
        has_zbx = a.zabbix is not None or bool(a.external_id)
        has_guac = (a.guacamole and len(a.guacamole) > 0) or bool(a.guacamole_connection_id)

        if a.ip_address and a.ip_address.strip() and a.ip_address.strip() != "-":
            clean_ip = a.ip_address.strip()
            ip_counts[clean_ip] = ip_counts.get(clean_ip, 0) + 1

        if has_zbx:
            with_zabbix += 1
            z_status = a.zabbix.status if a.zabbix else a.status
            if z_status == "monitored":
                monitored += 1
            else:
                unmonitored += 1

            groups = (a.zabbix.host_groups if a.zabbix else a.host_groups) or []
            for g in groups:
                if g:
                    groups_set.add(g)

        if a.client_group:
            groups_set.add(a.client_group)

        if has_guac:
            with_guacamole += 1

        if has_zbx and has_guac:
            with_both += 1
        elif has_zbx and not has_guac:
            missing_guacamole += 1
        elif has_guac and not has_zbx:
            missing_zabbix += 1

    duplicate_ips = {ip: c for ip, c in ip_counts.items() if c > 1}
    duplicate_assets_count = sum(duplicate_ips.values())

    return {
        "total": total,
        "monitored": monitored,
        "unmonitored": unmonitored,
        "with_zabbix": with_zabbix,
        "with_guacamole": with_guacamole,
        "with_both": with_both,
        "missing_guacamole": missing_guacamole,
        "missing_zabbix": missing_zabbix,
        "groups_count": len(groups_set),
        "groups_list": sorted(list(groups_set)),
        "duplicate_ips_count": len(duplicate_ips),
        "duplicate_assets_count": duplicate_assets_count
    }


@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")
    return asset


@router.post("/{asset_id}/status")
async def toggle_asset_status(
    asset_id: int,
    payload: StatusToggleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    new_status = payload.status.lower()
    if new_status not in ["monitored", "unmonitored"]:
        raise HTTPException(status_code=400, detail="Status inválido. Use 'monitored' ou 'unmonitored'.")

    asset.status = new_status
    if asset.zabbix:
        asset.zabbix.status = new_status

    zabbix_updated = False
    warning_msg = None

    hostid_to_sync = None
    if asset.zabbix and asset.zabbix.hostid and str(asset.zabbix.hostid).strip().lower() != "none":
        hostid_to_sync = str(asset.zabbix.hostid).strip()
    elif asset.external_id and str(asset.external_id).strip().lower() != "none":
        hostid_to_sync = str(asset.external_id).strip()

    if payload.sync_zabbix:
        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
        if cfg and cfg.url:
            try:
                # Se não temos hostid, tenta resolver no Zabbix pelo hostname ou IP
                if not hostid_to_sync:
                    auth_token = cfg.token
                    if not auth_token and cfg.username and cfg.password:
                        auth_token = await ZabbixService.authenticate_user(cfg.url, cfg.username, cfg.password)
                    if auth_token:
                        search_params = {"filter": {"host": [asset.hostname]}, "output": ["hostid", "host"]}
                        hosts_found = await ZabbixService.call_api(cfg.url, "host.get", search_params, auth=auth_token)
                        if hosts_found:
                            hostid_to_sync = str(hosts_found[0]["hostid"])
                            asset.external_id = hostid_to_sync
                            if asset.zabbix:
                                asset.zabbix.hostid = hostid_to_sync

                if hostid_to_sync:
                    status_code = 0 if new_status == "monitored" else 1
                    await ZabbixService.update_host_status(
                        cfg.url,
                        hostid_to_sync,
                        status_code,
                        token=cfg.token,
                        username=cfg.username,
                        password=cfg.password
                    )
                    zabbix_updated = True
            except Exception as exc:
                logger.warning(f"Erro ao sincronizar status com Zabbix: {exc}")
                warning_msg = f"Status atualizado localmente, mas houve erro no Zabbix: {exc}"

    db.commit()
    db.refresh(asset)

    status_pt = "Ativo (Monitorado)" if new_status == "monitored" else "Inativo (Desativado)"
    message = f"Host alterado para {status_pt}."
    if zabbix_updated:
        message += " Sincronizado também no Zabbix Server."
    elif warning_msg:
        message += f" ({warning_msg})"

    return {
        "success": True,
        "asset": asset,
        "message": message,
        "zabbix_synced": zabbix_updated
    }


@router.post("/bulk-integrations")
async def bulk_update_integrations(
    payload: BulkIntegrationsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Atualiza status de integrações (Zabbix, Guacamole, Oxidized) em lote
    para múltiplos equipamentos selecionados.
    """
    if not payload.asset_ids:
        raise HTTPException(status_code=400, detail="Nenhum ativo informado para atualização em lote.")

    assets = db.query(Asset).filter(Asset.id.in_(payload.asset_ids)).all()
    if not assets:
        raise HTTPException(status_code=404, detail="Nenhum ativo encontrado para os IDs informados.")

    updated_count = len(assets)
    zbx_synced_count = 0
    ox_reloaded = False

    # 1. Zabbix (Ativar / Desativar monitoramento)
    if payload.zabbix_enabled is not None:
        new_status = "monitored" if payload.zabbix_enabled else "unmonitored"
        status_code = 0 if payload.zabbix_enabled else 1
        cfg_zbx = db.query(IntegrationConfig).filter(
            IntegrationConfig.name == "zabbix",
            IntegrationConfig.is_active == True
        ).first()

        for a in assets:
            a.status = new_status
            if a.zabbix:
                a.zabbix.status = new_status

        if cfg_zbx and cfg_zbx.url:
            for a in assets:
                h_id = a.zabbix.hostid if (a.zabbix and a.zabbix.hostid) else a.external_id
                if h_id and str(h_id).strip().lower() != "none":
                    try:
                        await ZabbixService.update_host_status(
                            cfg_zbx.url,
                            str(h_id),
                            status_code,
                            token=cfg_zbx.token,
                            username=cfg_zbx.username,
                            password=cfg_zbx.password
                        )
                        zbx_synced_count += 1
                    except Exception as err:
                        logger.warning(f"Erro ao alterar status Zabbix do host {h_id} em lote: {err}")

    # 2. Apache Guacamole (Ativar / Desativar/Ignorar e expurgar conexões)
    if payload.guacamole_enabled is not None:
        guac_conns_cache = None
        if not payload.guacamole_enabled:
            cfg_guac = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
            if cfg_guac and cfg_guac.url and cfg_guac.username and cfg_guac.password:
                try:
                    guac_conns_cache = await GuacamoleService.fetch_connections_with_parameters(
                        url=cfg_guac.url,
                        username=cfg_guac.username,
                        password=cfg_guac.password
                    )
                except Exception as err:
                    logger.warning(f"Erro ao obter conexões do Guacamole para exclusão em lote: {err}")

        for a in assets:
            raw = dict(a.raw_data or {})
            raw["ignore_guacamole"] = not payload.guacamole_enabled
            a.raw_data = raw
            if not payload.guacamole_enabled:
                await remove_asset_guacamole_connections(a, db, live_conns=guac_conns_cache)

    # 3. Oxidized (Ativar backup / Desativar backup e expurgar do daemon)
    if payload.oxidized_enabled is not None:
        for a in assets:
            a.backup_enabled = payload.oxidized_enabled
            if not payload.oxidized_enabled:
                if a.oxidized:
                    db.delete(a.oxidized)

        db.commit()

        # Recarrega daemon do Oxidized para refletir inclusão ou expurgo imediato
        ox_reloaded = await notify_oxidized_reload_if_active(
            db, f"bulk update de backup_enabled={payload.oxidized_enabled}"
        )
    else:
        db.commit()

    return {
        "success": True,
        "updated_count": updated_count,
        "zabbix_synced_count": zbx_synced_count,
        "oxidized_reloaded": ox_reloaded,
        "message": f"{updated_count} equipamentos atualizados em lote com sucesso."
    }


@router.patch("/{asset_id}", response_model=AssetResponse)
async def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    old_backup_enabled = asset.backup_enabled

    if payload.name is not None:
        asset.name = payload.name.strip()
        if asset.guacamole:
            for g in asset.guacamole:
                g.connection_name = asset.name
    if payload.hostname is not None:
        asset.hostname = payload.hostname.strip()
    if payload.client_group is not None:
        cg_val = payload.client_group.strip() or None
        asset.client_group = cg_val
        if cg_val:
            cur_groups = list(asset.host_groups or [])
            if cg_val not in cur_groups:
                asset.host_groups = [cg_val] + cur_groups
            if asset.zabbix:
                z_groups = list(asset.zabbix.host_groups or [])
                if cg_val not in z_groups:
                    asset.zabbix.host_groups = [cg_val] + z_groups
    if payload.ip_address is not None:
        asset.ip_address = payload.ip_address.strip() or None
    if payload.dns is not None:
        asset.dns = payload.dns.strip() or None
    if payload.port is not None:
        asset.port = payload.port.strip() or None
        if asset.zabbix:
            asset.zabbix.port = asset.port

    if payload.snmp_community is not None:
        asset.snmp_community = payload.snmp_community.strip() or None
        if asset.zabbix:
            asset.zabbix.snmp_community = asset.snmp_community

    # Atualização de parâmetros de Acesso Remoto (Guacamole / SSH / Telnet / RDP)
    has_remote_updates = any(
        x is not None for x in [
            payload.guacamole_connection_id,
            payload.guacamole_protocol,
            payload.guacamole_username,
            payload.guacamole_password,
            payload.guacamole_port
        ]
    )

    if has_remote_updates:
        proto = (payload.guacamole_protocol or asset.guacamole_protocol or "ssh").strip().lower()
        default_port = "22" if proto == "ssh" else ("23" if proto == "telnet" else "3389")

        guac_entry = db.query(AssetGuacamole).filter(AssetGuacamole.asset_id == asset.id).first()
        existing_port = guac_entry.port if guac_entry and guac_entry.port else default_port
        if payload.guacamole_port is not None and str(payload.guacamole_port).strip():
            port_val = str(payload.guacamole_port).strip()
        else:
            port_val = existing_port

        asset.guacamole_protocol = proto

        if payload.guacamole_connection_id is not None:
            cid = payload.guacamole_connection_id.strip() or None
            asset.guacamole_connection_id = cid

        if not guac_entry:
            conn_id = asset.guacamole_connection_id or f"local-{asset.id}"
            guac_entry = AssetGuacamole(
                asset_id=asset.id,
                connection_id=conn_id,
                connection_name=asset.name,
                protocol=proto,
                port=port_val,
                hostname=asset.ip_address or asset.hostname,
                username=payload.guacamole_username.strip() if (payload.guacamole_username and payload.guacamole_username.strip()) else None,
                password=payload.guacamole_password if (payload.guacamole_password and payload.guacamole_password != "") else None
            )
            db.add(guac_entry)
        else:
            if asset.guacamole_connection_id:
                guac_entry.connection_id = asset.guacamole_connection_id
            guac_entry.connection_name = asset.name
            guac_entry.protocol = proto
            guac_entry.port = port_val
            guac_entry.hostname = asset.ip_address or asset.hostname
            if payload.guacamole_username is not None:
                guac_entry.username = payload.guacamole_username.strip() if payload.guacamole_username.strip() else None
            if payload.guacamole_password is not None and payload.guacamole_password != "":
                guac_entry.password = payload.guacamole_password

        # Sincronização automática no Guacamole quando solicitado
        if payload.sync_guacamole:
            cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
            if cfg and cfg.url and cfg.username and cfg.password:
                try:
                    c_group = asset.client_group or (asset.host_groups[0] if (asset.host_groups and len(asset.host_groups) > 0) else None)
                    raw_id = guac_entry.connection_id or asset.guacamole_connection_id
                    identifier = raw_id if (raw_id and not str(raw_id).startswith("local-")) else None
                    conn_data = {
                        "identifier": identifier,
                        "name": asset.name,
                        "protocol": proto,
                        "hostname": asset.ip_address or asset.hostname,
                        "port": port_val,
                        "client_group": c_group,
                        "username": guac_entry.username,
                        "password": guac_entry.password
                    }
                    guac_res = await GuacamoleService.push_connection_to_guacamole(
                        url=cfg.url,
                        username=cfg.username,
                        password=cfg.password,
                        conn_data=conn_data
                    )
                    client_id = guac_res.get("client_id")
                    if client_id:
                        guac_entry.connection_id = client_id
                        asset.guacamole_connection_id = client_id
                    guac_entry.last_sync = func.now()
                except Exception as g_err:
                    logger.warning(f"Erro ao sincronizar com Guacamole durante atualização do ativo {asset.id}: {g_err}")

    if payload.status is not None:
        new_status = payload.status.lower()
        hostid = asset.zabbix.hostid if (asset.zabbix and asset.zabbix.hostid) else asset.external_id
        if new_status != asset.status and payload.sync_zabbix and hostid:
            cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
            if cfg and cfg.url:
                try:
                    status_code = 0 if new_status == "monitored" else 1
                    await ZabbixService.update_host_status(
                        cfg.url,
                        hostid,
                        status_code,
                        token=cfg.token,
                        username=cfg.username,
                        password=cfg.password
                    )
                except Exception as exc:
                    logger.warning(f"Erro ao sincronizar status com Zabbix: {exc}")
        asset.status = new_status
        if asset.zabbix:
            asset.zabbix.status = new_status

    if payload.enabled_tests is not None:
        raw = dict(asset.raw_data or {})
        raw["enabled_tests"] = payload.enabled_tests
        asset.raw_data = raw

        # Limpar registros e alarmes dos testes desabilitados
        if payload.enabled_tests.get("icmp") is False:
            db.query(NetworkDiagnostic).filter(
                NetworkDiagnostic.asset_id == asset.id,
                NetworkDiagnostic.test_type == "icmp"
            ).delete()
            if asset.zabbix:
                asset.zabbix.icmp_status = None
                asset.zabbix.icmp_latency_ms = None

        if payload.enabled_tests.get("snmp") is False:
            db.query(NetworkDiagnostic).filter(
                NetworkDiagnostic.asset_id == asset.id,
                NetworkDiagnostic.test_type == "snmp"
            ).delete()
            if asset.zabbix:
                asset.zabbix.snmp_status = None
                asset.zabbix.snmp_message = None

        if payload.enabled_tests.get("remote") is False:
            db.query(NetworkDiagnostic).filter(
                NetworkDiagnostic.asset_id == asset.id,
                NetworkDiagnostic.test_type.in_(["ssh", "telnet", "rdp"])
            ).delete()
            if asset.guacamole:
                for g in asset.guacamole:
                    g.tcp_status = None
                    g.tcp_latency_ms = None
                    g.tcp_message = None

    if payload.backup_model is not None:
        asset.backup_model = payload.backup_model.strip() or "RouterOS"
        if asset.oxidized:
            asset.oxidized.model = asset.backup_model
    if payload.backup_enabled is not None:
        asset.backup_enabled = payload.backup_enabled
        if payload.backup_enabled is False and asset.oxidized:
            db.delete(asset.oxidized)
    if payload.backup_timeout is not None:
        try:
            t_val = int(payload.backup_timeout)
            if t_val > 0:
                asset.backup_timeout = t_val
                if asset.oxidized:
                    asset.oxidized.timeout = t_val
                    ox_vars = dict(asset.oxidized.vars or {})
                    ox_vars["timeout"] = t_val
                    asset.oxidized.vars = ox_vars
        except (ValueError, TypeError):
            pass

    if payload.ignore_guacamole is not None:
        raw = dict(asset.raw_data or {})
        raw["ignore_guacamole"] = payload.ignore_guacamole
        asset.raw_data = raw
        if payload.ignore_guacamole is True:
            await remove_asset_guacamole_connections(asset, db)

    db.commit()
    db.refresh(asset)

    # Notificação automática ao Oxidized caso parâmetros do nó ou credenciais tenham sido alterados
    needs_ox_reload = False
    if payload.backup_enabled is not None and old_backup_enabled != payload.backup_enabled:
        needs_ox_reload = True
    elif (asset.backup_enabled or old_backup_enabled):
        if has_remote_updates or any(x is not None for x in [payload.backup_model, payload.backup_timeout, payload.ip_address, payload.name, payload.client_group]):
            needs_ox_reload = True

    if needs_ox_reload:
        await notify_oxidized_reload_if_active(db, f"atualização no ativo {asset.id} ({asset.name})")

    return asset


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas administradores podem remover ativos.")

    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    was_backup_enabled = bool(asset.backup_enabled)
    # Remove conexões no Apache Guacamole antes de excluir o ativo
    await remove_asset_guacamole_connections(asset, db)

    db.delete(asset)
    db.commit()

    # Se o equipamento fazia backup no Oxidized, notifica o Oxidized para recarregar e remover o nó da memória
    if was_backup_enabled:
        await notify_oxidized_reload_if_active(db, f"exclusão do ativo {asset_id}")

    return None


@router.get("/{asset_id}/comparison")
async def get_asset_comparison(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna a comparação detalhada dos dados do ativo no IperSoft, Zabbix e Guacamole,
    além dos últimos diagnósticos e divergências encontradas.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    # 1. Dados no IperSoft
    primary_guac = asset.guacamole[0] if asset.guacamole and len(asset.guacamole) > 0 else None
    c_group = asset.client_group or (asset.host_groups[0] if (asset.host_groups and len(asset.host_groups) > 0) else "")
    ipersoft_data = {
        "id": asset.id,
        "name": asset.name,
        "hostname": asset.hostname,
        "client_group": c_group,
        "ip_address": asset.ip_address,
        "dns": asset.dns,
        "port": asset.port or "10050",
        "snmp_community": (asset.zabbix.snmp_community if asset.zabbix else None) or asset.snmp_community or "ipermonitor",
        "status": asset.status,
        "backup_model": asset.backup_model or "RouterOS",
        "backup_enabled": asset.backup_enabled if asset.backup_enabled is not None else True,
        "backup_timeout": asset.backup_timeout or 30,
        "remote_protocol": (primary_guac.protocol if primary_guac else asset.guacamole_protocol) or "ssh",
        "remote_port": (primary_guac.port if primary_guac else ("22" if (asset.guacamole_protocol or "ssh") == "ssh" else ("23" if asset.guacamole_protocol == "telnet" else "3389"))),
        "remote_username": primary_guac.username if primary_guac else None,
        "remote_password": primary_guac.password if primary_guac else None,
        "has_remote_password": bool(primary_guac.password if primary_guac else None),
        "enabled_tests": (asset.raw_data or {}).get("enabled_tests", {"icmp": True, "snmp": True, "remote": True}),
        "updated_at": asset.updated_at
    }

    # 2. Dados no Zabbix (leitura local do banco do IperSoft - sem chamada externa síncrona)
    zbx_config = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    zbx_rec = asset.zabbix
    real_hid = str(zbx_rec.hostid) if (zbx_rec and zbx_rec.hostid) else str(asset.external_id or "")
    is_zbx_synced = bool(real_hid and real_hid != "None")

    zabbix_data = {
        "is_configured": bool(zbx_config and zbx_config.url),
        "is_synced": is_zbx_synced,
        "hostid": real_hid if is_zbx_synced else None,
        "name": asset.name,
        "hostname": asset.hostname,
        "ip_address": asset.ip_address,
        "port": (zbx_rec.port if zbx_rec else None) or asset.port or "10050",
        "snmp_community": (zbx_rec.snmp_community if zbx_rec else None) or asset.snmp_community or "ipermonitor",
        "status": (zbx_rec.status if zbx_rec else None) or ("monitored" if asset.status == "active" else "unmonitored"),
        "last_sync": zbx_rec.last_sync if zbx_rec else None
    }

    # 3. Dados no Guacamole (leitura local do banco do IperSoft - sem chamada externa síncrona)
    guac_config = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    ignore_guac = bool((asset.raw_data or {}).get("ignore_guacamole", False))
    has_valid_conn = bool(primary_guac and primary_guac.connection_id and not str(primary_guac.connection_id).startswith("local-"))
    real_cid = str(primary_guac.connection_id) if has_valid_conn else (str(asset.guacamole_connection_id) if asset.guacamole_connection_id and not str(asset.guacamole_connection_id).startswith("local-") else None)
    is_guac_synced = bool(real_cid and not ignore_guac)

    guacamole_data = {
        "is_configured": bool(guac_config and guac_config.url),
        "is_synced": is_guac_synced,
        "ignore_guacamole": ignore_guac,
        "folder_name": c_group or "Raiz (ROOT)",
        "connection_id": real_cid,
        "connection_name": (primary_guac.connection_name if primary_guac else None) or asset.name,
        "protocol": (primary_guac.protocol if primary_guac else None) or asset.guacamole_protocol or "ssh",
        "hostname": (primary_guac.hostname if primary_guac else None) or asset.ip_address,
        "port": str(primary_guac.port if primary_guac else ("22" if (asset.guacamole_protocol or "ssh") == "ssh" else ("23" if asset.guacamole_protocol == "telnet" else "3389"))),
        "username": primary_guac.username if primary_guac else None,
        "has_password": bool(primary_guac.password if primary_guac else False),
        "last_sync": primary_guac.last_sync if primary_guac else None
    }

    # 4. Dados no Oxidized
    ox_cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized", IntegrationConfig.is_active == True).first()
    ox_rec = asset.oxidized
    oxidized_data = {
        "is_configured": bool(ox_cfg and ox_cfg.url),
        "is_synced": bool(ox_rec),
        "node_name": ox_rec.node_name if ox_rec else asset.name,
        "model": ox_rec.model if ox_rec else (asset.backup_model or "RouterOS"),
        "group": ox_rec.group if ox_rec else (asset.client_group or "default"),
        "status": ox_rec.status if ox_rec else None,
        "last_backup": ox_rec.last_backup if ox_rec else None,
        "backup_time_taken": ox_rec.backup_time_taken if ox_rec else None,
        "backup_enabled": asset.backup_enabled if asset.backup_enabled is not None else True,
        "backup_timeout": asset.backup_timeout or 30,
        "timeout": (ox_rec.timeout if (ox_rec and hasattr(ox_rec, 'timeout') and ox_rec.timeout) else None) or asset.backup_timeout or 30,
        "last_sync": ox_rec.last_sync if ox_rec else None
    }

    # 5. Histórico dos últimos diagnósticos
    diags = db.query(NetworkDiagnostic).filter(NetworkDiagnostic.asset_id == asset.id).order_by(NetworkDiagnostic.tested_at.desc()).all()
    diagnostics_map = {}
    for d in diags:
        if d.test_type not in diagnostics_map:
            diagnostics_map[d.test_type] = {
                "id": d.id,
                "test_type": d.test_type,
                "status": d.status,
                "latency_ms": d.latency_ms,
                "target_host": d.target_host,
                "target_port": d.target_port,
                "message": d.message,
                "tested_at": d.tested_at
            }

    # 6. Cálculo de divergências
    differences = []
    if zabbix_data["is_synced"]:
        if zabbix_data["ip_address"] != ipersoft_data["ip_address"]:
            differences.append({
                "field": "IP Zabbix",
                "ipersoft": ipersoft_data["ip_address"],
                "platform": zabbix_data["ip_address"],
                "target": "zabbix"
            })
        if zabbix_data["snmp_community"] != ipersoft_data["snmp_community"]:
            differences.append({
                "field": "Community SNMP",
                "ipersoft": ipersoft_data["snmp_community"],
                "platform": zabbix_data["snmp_community"],
                "target": "zabbix"
            })
    else:
        differences.append({
            "field": "Cadastro Zabbix",
            "ipersoft": "Presente",
            "platform": "Não sincronizado",
            "target": "zabbix"
        })

    if not guacamole_data["ignore_guacamole"]:
        if guacamole_data["is_synced"]:
            if guacamole_data["hostname"] != ipersoft_data["ip_address"]:
                differences.append({
                    "field": "IP / Host Guacamole",
                    "ipersoft": ipersoft_data["ip_address"],
                    "platform": guacamole_data["hostname"],
                    "target": "guacamole"
                })
            if guacamole_data["protocol"] != ipersoft_data["remote_protocol"]:
                differences.append({
                    "field": "Protocolo Remoto",
                    "ipersoft": ipersoft_data["remote_protocol"],
                    "platform": guacamole_data["protocol"],
                    "target": "guacamole"
                })
            if str(guacamole_data.get("port") or "").strip() != str(ipersoft_data.get("remote_port") or "").strip():
                differences.append({
                    "field": "Porta Remota (Guacamole)",
                    "ipersoft": ipersoft_data.get("remote_port"),
                    "platform": guacamole_data.get("port"),
                    "target": "guacamole"
                })
        else:
            differences.append({
                "field": "Conexão Guacamole",
                "ipersoft": "Presente",
                "platform": "Não sincronizado",
                "target": "guacamole"
            })

    return {
        "ipersoft": ipersoft_data,
        "zabbix": zabbix_data,
        "guacamole": guacamole_data,
        "oxidized": oxidized_data,
        "diagnostics": diagnostics_map,
        "differences": differences
    }


@router.post("/{asset_id}/sync-zabbix")
async def sync_asset_to_zabbix(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Atualiza ou cria o cadastro deste ativo diretamente no Zabbix Server.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg or not cfg.url:
        raise HTTPException(status_code=400, detail="Zabbix não configurado nas integrações.")

    c_group = asset.client_group or (asset.host_groups[0] if (asset.host_groups and len(asset.host_groups) > 0) else None)
    host_data = {
        "hostid": asset.zabbix.hostid if asset.zabbix else asset.external_id,
        "name": asset.name,
        "hostname": asset.hostname,
        "client_group": c_group,
        "ip_address": asset.ip_address,
        "dns": asset.dns,
        "port": (asset.zabbix.port if asset.zabbix else None) or asset.port or "10050",
        "snmp_community": (asset.zabbix.snmp_community if asset.zabbix else None) or asset.snmp_community or "ipermonitor",
        "status": asset.status
    }

    try:
        result = await ZabbixService.push_host_to_zabbix(
            url=cfg.url,
            host_data=host_data,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )

        # Atualizar registro local
        if not asset.zabbix:
            asset.zabbix = AssetZabbix(
                asset_id=asset.id,
                hostid=result.get("hostid"),
                port=host_data["port"],
                snmp_community=host_data["snmp_community"],
                host_groups=[c_group] if c_group else [],
                status=asset.status,
                last_sync=func.now()
            )
            db.add(asset.zabbix)
        else:
            asset.zabbix.hostid = result.get("hostid")
            asset.zabbix.port = host_data["port"]
            asset.zabbix.snmp_community = host_data["snmp_community"]
            if c_group:
                cur_grps = list(asset.zabbix.host_groups or [])
                if c_group not in cur_grps:
                    asset.zabbix.host_groups = [c_group] + cur_grps
            asset.zabbix.last_sync = func.now()

        if c_group:
            cur_ast_grps = list(asset.host_groups or [])
            if c_group not in cur_ast_grps:
                asset.host_groups = [c_group] + cur_ast_grps

        asset.external_id = result.get("hostid")
        db.commit()
        db.refresh(asset)

        return {
            "success": True,
            "message": result.get("message", "Sincronizado com Zabbix com sucesso."),
            "zabbix": result
        }
    except Exception as exc:
        logger.error(f"Erro ao sincronizar ativo {asset.id} com Zabbix: {exc}")
        raise HTTPException(status_code=400, detail=f"Falha na sincronização com Zabbix: {str(exc)}")


@router.post("/{asset_id}/sync-guacamole")
async def sync_asset_to_guacamole(
    asset_id: int,
    payload: Optional[Dict[str, Any]] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Atualiza ou cria a conexão remota deste ativo no Apache Guacamole dentro da pasta da empresa cliente.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    # Se o usuário está sincronizando o Guacamole explicitamente, reativa a integração
    raw_info = dict(asset.raw_data or {})
    if raw_info.get("ignore_guacamole"):
        raw_info["ignore_guacamole"] = False
        asset.raw_data = raw_info
        db.commit()

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    if not cfg or not cfg.url or not cfg.username or not cfg.password:
        raise HTTPException(status_code=400, detail="Guacamole não configurado nas integrações.")

    primary_guac = asset.guacamole[0] if asset.guacamole and len(asset.guacamole) > 0 else None

    # Se foram passados dados adicionais de formulário na requisição, aplica-os localmente
    if payload:
        if payload.get("remote_port") or payload.get("guacamole_port"):
            p_val = str(payload.get("remote_port") or payload.get("guacamole_port")).strip()
            if primary_guac:
                primary_guac.port = p_val
        if payload.get("remote_protocol") or payload.get("guacamole_protocol"):
            proto_val = str(payload.get("remote_protocol") or payload.get("guacamole_protocol")).strip().lower()
            asset.guacamole_protocol = proto_val
            if primary_guac:
                primary_guac.protocol = proto_val
        if payload.get("remote_username") or payload.get("guacamole_username"):
            u_val = str(payload.get("remote_username") or payload.get("guacamole_username")).strip()
            if primary_guac:
                primary_guac.username = u_val
        if payload.get("remote_password") or payload.get("guacamole_password"):
            pw_val = payload.get("remote_password") or payload.get("guacamole_password")
            if primary_guac and pw_val:
                primary_guac.password = pw_val
        db.commit()

    protocol = (primary_guac.protocol if primary_guac else asset.guacamole_protocol) or "ssh"
    default_port = "22" if protocol == "ssh" else ("23" if protocol == "telnet" else "3389")
    port = (primary_guac.port if primary_guac and primary_guac.port else default_port)

    # Identifier se já existir no Guacamole
    raw_id = primary_guac.connection_id if primary_guac else asset.guacamole_connection_id
    identifier = raw_id if (raw_id and not str(raw_id).startswith("local-")) else None

    c_group = asset.client_group or (asset.host_groups[0] if (asset.host_groups and len(asset.host_groups) > 0) else None)
    conn_name = asset.name or (primary_guac.connection_name if primary_guac else "Novo Equipamento")
    conn_data = {
        "identifier": identifier,
        "name": conn_name,
        "protocol": protocol,
        "hostname": asset.ip_address or asset.hostname,
        "port": str(port).strip(),
        "client_group": c_group,
        "username": primary_guac.username if primary_guac else None,
        "password": primary_guac.password if primary_guac else None
    }

    try:
        result = await GuacamoleService.push_connection_to_guacamole(
            url=cfg.url,
            username=cfg.username,
            password=cfg.password,
            conn_data=conn_data
        )

        client_id = result.get("client_id")
        identifier_id = result.get("identifier")

        asset.guacamole_connection_id = client_id
        asset.guacamole_protocol = protocol

        if not primary_guac:
            new_g = AssetGuacamole(
                asset_id=asset.id,
                connection_id=client_id,
                connection_name=conn_name,
                protocol=protocol,
                port=port,
                hostname=conn_data["hostname"],
                username=conn_data["username"],
                password=conn_data["password"],
                last_sync=func.now()
            )
            db.add(new_g)
        else:
            primary_guac.connection_id = client_id
            primary_guac.connection_name = conn_name
            primary_guac.protocol = protocol
            primary_guac.port = port
            primary_guac.hostname = conn_data["hostname"]
            primary_guac.last_sync = func.now()

        db.commit()
        db.refresh(asset)

        if asset.backup_enabled:
            await notify_oxidized_reload_if_active(db, f"sincronização de acesso remoto no ativo {asset.id} ({asset.name})")

        return {
            "success": True,
            "message": result.get("message", "Sincronizado com Guacamole com sucesso."),
            "guacamole": result
        }
    except Exception as exc:
        logger.error(f"Erro ao sincronizar ativo {asset.id} com Guacamole: {exc}")
        raise HTTPException(status_code=400, detail=f"Falha na sincronização com Guacamole: {str(exc)}")


@router.delete("/{asset_id}/guacamole")
async def remove_asset_from_guacamole(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Remove a conexão remota do ativo no Apache Guacamole e limpa os vínculos locais.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    deleted_identifiers = await remove_asset_guacamole_connections(asset, db)

    msg = f"Conexão do Guacamole removida com sucesso para o equipamento '{asset.name}'."
    if deleted_identifiers:
        msg += f" (Conexões deletadas no Apache Guacamole: {', '.join(deleted_identifiers)})"

    return {
        "success": True,
        "message": msg,
        "deleted_identifiers": deleted_identifiers
    }


@router.post("/{asset_id}/sync-all")
async def sync_asset_to_all(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Sincroniza o ativo simultaneamente com o Zabbix e com o Guacamole (se não for ignorado).
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    results = {}
    errors = []

    # Zabbix Sync
    try:
        zbx_res = await sync_asset_to_zabbix(asset_id, current_user, db)
        results["zabbix"] = zbx_res
    except Exception as e:
        detail = getattr(e, "detail", str(e))
        errors.append(f"Zabbix: {detail}")

    # Guacamole Sync (verifica se deve ignorar)
    is_guac_ignored = bool((asset.raw_data or {}).get("ignore_guacamole", False))
    if not is_guac_ignored:
        try:
            guac_res = await sync_asset_to_guacamole(asset_id, current_user, db)
            results["guacamole"] = guac_res
        except Exception as e:
            detail = getattr(e, "detail", str(e))
            errors.append(f"Guacamole: {detail}")
    else:
        # Se está desativado no Guacamole, garante remoção de conexões residuais no Guacamole Server
        deleted_guac = await remove_asset_guacamole_connections(asset, db)
        results["guacamole"] = {
            "skipped": True,
            "deleted_connections": deleted_guac,
            "message": "Equipamento desativado no Guacamole. Conexão removida/verificada no Apache Guacamole."
        }

    if errors and len(errors) == (1 if is_guac_ignored else 2):
        raise HTTPException(status_code=400, detail="; ".join(errors))

    message = "Sincronização concluída com sucesso!"
    if errors:
        message = f"Sincronização parcial realizada. Avisos: {'; '.join(errors)}"

    return {
        "success": True,
        "message": message,
        "results": results,
        "warnings": errors if errors else None
    }


# =========================================================================
# ENDPOINTS DE DETALHES SOB DEMANDA (LAZY LOADING) E MONITORAMENTO CENTRAL
# =========================================================================

def _get_zabbix_config(db: Session) -> IntegrationConfig:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg or not cfg.url:
        raise HTTPException(status_code=400, detail="Zabbix Server não configurado no IperSoft.")
    return cfg

def _get_guacamole_config(db: Session) -> IntegrationConfig:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    if not cfg or not cfg.url or not cfg.username:
        raise HTTPException(status_code=400, detail="Apache Guacamole não configurado no IperSoft.")
    return cfg

def _get_oxidized_config(db: Session) -> IntegrationConfig:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    if not cfg or not cfg.url:
        raise HTTPException(status_code=400, detail="Oxidized não configurado no IperSoft.")
    return cfg


@router.get("/{asset_id}/zabbix/details")
async def get_asset_zabbix_details(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Busca informações cadastrais completas do host diretamente da API do Zabbix Server.
    (Lazy Loading: invocado apenas ao expandir a Linha 2).
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    hostid = None
    if asset.zabbix and asset.zabbix.hostid:
        hostid = asset.zabbix.hostid
    elif asset.external_id and asset.source == "zabbix":
        hostid = asset.external_id

    cfg = _get_zabbix_config(db)

    # Se não temos hostid, tenta buscar pelo hostname no Zabbix
    if not hostid:
        try:
            auth_token = cfg.token or await ZabbixService.authenticate_user(cfg.url, cfg.username, cfg.password)
            z_hosts = await ZabbixService.call_api(
                cfg.url,
                "host.get",
                {"filter": {"host": [asset.hostname or asset.name]}, "output": ["hostid"]},
                auth=auth_token
            )
            if z_hosts:
                hostid = str(z_hosts[0]["hostid"])
        except Exception:
            pass

    if not hostid:
        raise HTTPException(
            status_code=404,
            detail=f"Host '{asset.name}' não possui cadastro sincronizado no Zabbix Server."
        )

    try:
        details = await ZabbixService.fetch_host_details(
            cfg.url,
            hostid,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return details
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Erro ao consultar Zabbix: {exc}"
        )


@router.get("/{asset_id}/zabbix/problems")
async def get_asset_zabbix_problems(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna os alarmes/triggers ativos (PROBLEM) do host no Zabbix.
    (Lazy Loading: invocado ao expandir a Linha 5).
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    hostid = asset.zabbix.hostid if (asset.zabbix and asset.zabbix.hostid) else asset.external_id
    if not hostid:
        return []

    cfg = _get_zabbix_config(db)
    try:
        problems = await ZabbixService.fetch_host_problems(
            cfg.url,
            hostid,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return problems
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao buscar alarmes no Zabbix: {exc}")


@router.get("/{asset_id}/zabbix/items")
async def get_asset_zabbix_items(
    asset_id: int,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna a lista de itens monitorados do host no Zabbix Server.
    (Lazy Loading: invocado ao expandir a Linha 5).
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    hostid = asset.zabbix.hostid if (asset.zabbix and asset.zabbix.hostid) else asset.external_id
    if not hostid:
        return []

    cfg = _get_zabbix_config(db)
    try:
        items = await ZabbixService.fetch_host_items(
            cfg.url,
            hostid,
            search=search,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return items
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao buscar itens no Zabbix: {exc}")


@router.get("/{asset_id}/zabbix/items/{itemid}/history")
async def get_asset_zabbix_item_history(
    asset_id: int,
    itemid: str,
    period: str = "1h",
    value_type: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retorna os pontos históricos de um item do Zabbix para plotagem de gráfico ou visualização de timeline.
    Periodos: '1h', '6h', '24h', '7d'.
    """
    period_seconds = {
        "1h": 3600,
        "6h": 21600,
        "24h": 86400,
        "7d": 604800
    }.get(period.lower(), 3600)

    time_from = int(time.time()) - period_seconds
    limit = 300 if period in ("24h", "7d") else 150

    cfg = _get_zabbix_config(db)
    try:
        history = await ZabbixService.fetch_item_history(
            cfg.url,
            itemid=itemid,
            value_type=value_type,
            time_from=time_from,
            limit=limit,
            token=cfg.token,
            username=cfg.username,
            password=cfg.password
        )
        return {
            "itemid": itemid,
            "period": period,
            "value_type": value_type,
            "total_points": len(history),
            "history": history
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao buscar histórico do item no Zabbix: {exc}")


@router.get("/{asset_id}/guacamole/details")
async def get_asset_guacamole_details(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Busca os dados cadastrais da conexão remota diretamente no Apache Guacamole.
    (Lazy Loading: invocado ao expandir a Linha 3).
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    cid = asset.guacamole_connection_id
    if not cid and asset.guacamole:
        for g in asset.guacamole:
            if g.connection_id and not str(g.connection_id).startswith("local-"):
                cid = str(g.connection_id)
                break

    if cid and str(cid).startswith("local-"):
        cid = None

    cfg = _get_guacamole_config(db)

    # Se não temos cid definitivo, tenta localizar conexão compatível ao vivo no Guacamole
    if not cid:
        try:
            live_conns = await GuacamoleService.fetch_connections_with_parameters(
                url=cfg.url,
                username=cfg.username,
                password=cfg.password
            )
            target_ip = (asset.ip_address or "").strip().lower()
            target_name = (asset.name or "").strip().lower()
            target_host = (asset.hostname or "").strip().lower()

            for c in live_conns:
                c_id = str(c.get("identifier") or "")
                c_client_id = str(c.get("client_id") or "")
                c_name = (c.get("name") or "").strip().lower()
                c_host = (c.get("hostname") or "").strip().lower()

                if (target_ip and c_host == target_ip) or \
                   (target_host and c_host == target_host) or \
                   (target_name and (c_name == target_name or target_name in c_name or c_name in target_name)):
                    cid = c.get("client_id") or c_id
                    primary_guac = asset.guacamole[0] if asset.guacamole and len(asset.guacamole) > 0 else None
                    if not primary_guac:
                        primary_guac = AssetGuacamole(
                            asset_id=asset.id,
                            connection_id=cid,
                            connection_name=c.get("name") or asset.name,
                            protocol=c.get("protocol") or "ssh",
                            port=str(c.get("port") or "22"),
                            hostname=c.get("hostname") or target_ip,
                            username=c.get("username")
                        )
                        db.add(primary_guac)
                    else:
                        primary_guac.connection_id = cid
                    asset.guacamole_connection_id = cid
                    db.commit()
                    db.refresh(asset)
                    break
        except Exception as e:
            logger.warning(f"Aviso ao buscar conexão compatível no Guacamole: {e}")

    if not cid:
        raise HTTPException(status_code=404, detail="Nenhuma conexão cadastrada no Guacamole para este ativo.")

    try:
        details = await GuacamoleService.fetch_connection_details(
            cfg.url,
            cfg.username,
            cfg.password,
            cid
        )
        # Atualiza timestamp de last_sync no banco
        if asset.guacamole and len(asset.guacamole) > 0:
            asset.guacamole[0].last_sync = datetime.now(timezone.utc)
            db.commit()
        return details
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao consultar Guacamole: {exc}")


@router.get("/{asset_id}/guacamole/launch-url")
async def get_asset_guacamole_launch_url(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Gera token de autenticação temporário no Guacamole e devolve a URL pronta
    com login automático (SSO) sem solicitar senha.
    (Lazy Loading: invocado ao expandir a Linha 6 ou clicar em Acessar Remotamente).
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    cid = asset.guacamole_connection_id
    if not cid and asset.guacamole:
        for g in asset.guacamole:
            if g.connection_id:
                cid = g.connection_id
                break

    if not cid:
        raise HTTPException(status_code=404, detail="Nenhuma conexão configurada no Guacamole para este ativo.")

    cfg = _get_guacamole_config(db)
    try:
        launch_data = await GuacamoleService.generate_launch_url(
            cfg.url,
            cfg.username,
            cfg.password,
            cid
        )
        return launch_data
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao gerar sessão no Guacamole: {exc}")


@router.get("/{asset_id}/oxidized/details")
async def get_asset_oxidized_details(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Busca o status detalhado e dados atualizados do nó no Oxidized.
    (Lazy Loading: invocado ao expandir a Linha 4).
    Também persiste os dados no banco local para manter a listagem atualizada.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    node_name = asset.oxidized.node_name if (asset.oxidized and asset.oxidized.node_name) else asset.name
    cfg = _get_oxidized_config(db)

    try:
        details = await OxidizedService.fetch_node_details(
            cfg.url,
            node_name=node_name,
            node_ip=asset.ip_address,
            node_hostname=asset.hostname,
            username=cfg.username,
            password=cfg.password
        )

        # Atualiza ou cria o registro AssetOxidized com os dados mais recentes do Oxidized
        ox_rec = db.query(AssetOxidized).filter(AssetOxidized.asset_id == asset.id).first()
        dt_val = parse_oxidized_datetime(details.get("last_backup"))
        tt_val = None
        if details.get("time_taken") is not None:
            try:
                tt_val = float(details["time_taken"])
            except (ValueError, TypeError):
                pass

        if not ox_rec:
            ox_rec = AssetOxidized(
                asset_id=asset.id,
                node_name=details.get("name") or node_name,
                model=details.get("model") or asset.backup_model or "RouterOS",
                group=details.get("group") or asset.client_group or "default",
                status=details.get("status") or "unknown",
                last_backup=dt_val,
                backup_time_taken=tt_val,
                timeout=asset.backup_timeout or 30,
                vars=details.get("raw", {}).get("vars", {}),
                last_sync=func.now()
            )
            db.add(ox_rec)
        else:
            ox_rec.node_name = details.get("name") or node_name
            ox_rec.model = details.get("model") or ox_rec.model
            ox_rec.group = details.get("group") or ox_rec.group
            ox_rec.status = details.get("status") or ox_rec.status
            if dt_val:
                ox_rec.last_backup = dt_val
            ox_rec.backup_time_taken = tt_val
            ox_rec.timeout = asset.backup_timeout or 30
            ox_rec.last_sync = func.now()

        asset.backup_model = details.get("model") or asset.backup_model
        asset.backup_enabled = True
        db.commit()

        details["timeout"] = asset.backup_timeout or 30
        return details
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erro ao consultar Oxidized: {exc}")

