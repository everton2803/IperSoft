import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional, List, Any

from app.database import get_db
from app.models.user import User
from app.models.integration import IntegrationConfig
from app.models.asset import Asset, AssetGuacamole
from app.routers.auth import get_current_user
from app.services.guacamole import GuacamoleService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/guacamole", tags=["Integração Guacamole"])

class GuacamoleConfigRequest(BaseModel):
    url: str
    username: str
    password: Optional[str] = None

class GuacamoleConfigResponse(BaseModel):
    url: str
    username: str
    has_password: bool
    is_active: bool
    last_sync: Optional[Any] = None

class GuacamoleTestRequest(BaseModel):
    url: str
    username: str
    password: Optional[str] = None


@router.get("/config", response_model=Optional[GuacamoleConfigResponse])
def get_guacamole_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    if not cfg:
        return None
    return {
        "url": cfg.url,
        "username": cfg.username or "",
        "has_password": bool(cfg.password),
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }


@router.post("/config", response_model=GuacamoleConfigResponse)
def save_guacamole_config(
    req: GuacamoleConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem configurar integrações."
        )

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    if not cfg:
        cfg = IntegrationConfig(name="guacamole", url=req.url.strip(), username=req.username.strip())
        db.add(cfg)

    cfg.url = req.url.strip()
    cfg.username = req.username.strip()
    if req.password:
        cfg.password = req.password

    cfg.is_active = True
    db.commit()
    db.refresh(cfg)

    return {
        "url": cfg.url,
        "username": cfg.username,
        "has_password": bool(cfg.password),
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }


@router.post("/test")
async def test_guacamole_connection(
    req: GuacamoleTestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    url = req.url
    username = req.username
    password = req.password

    # Se a senha não foi informada, tenta pegar a salva
    if not password:
        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
        if cfg and cfg.password:
            password = cfg.password

    if not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informe a senha de administrador do Guacamole."
        )

    try:
        result = await GuacamoleService.test_connection(url, username, password)
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )


async def sync_guacamole_connections_with_db(db: Session) -> dict:
    """
    Importa e vincula conexões existentes no Apache Guacamole para o banco de dados do IperSoft.
    Não altera nem exclui nada no Apache Guacamole.
    Pode ser invocada manualmente via endpoint REST ou pelo agendador horário (1h).
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    if not cfg or not cfg.url or not cfg.username or not cfg.password:
        raise ValueError("Configuração do Guacamole incompleta. Salve a URL, usuário e senha primeiro.")

    guac_conns = await GuacamoleService.fetch_connections_with_parameters(
        cfg.url,
        cfg.username,
        cfg.password
    )

    matched_count = 0
    created_new_count = 0
    matched_details = []

    all_assets = db.query(Asset).all()

    for conn in guac_conns:
        target_ip = (conn.get("hostname") or "").strip()
        conn_name = (conn.get("name") or "").strip()
        identifier = str(conn.get("identifier"))
        protocol = conn.get("protocol") or "ssh"
        default_port = "3389" if protocol == "rdp" else ("23" if protocol == "telnet" else ("5900" if protocol == "vnc" else "22"))
        port = str(conn.get("port") or default_port).strip()
        guac_user = conn.get("username")
        guac_pass = conn.get("password")
        folder_group = (conn.get("client_group") or "").strip() or None

        client_id = conn.get("client_id") or identifier
        clean_ip = target_ip.split(":")[0].strip() if ":" in target_ip else target_ip

        matched_asset = None

        # 1. Prioridade: Match por connection_id já vinculado
        for a in all_assets:
            if a.guacamole_connection_id and str(a.guacamole_connection_id) in (client_id, identifier):
                matched_asset = a
                break
            if a.guacamole and any(str(g.connection_id) in (client_id, identifier) for g in a.guacamole):
                matched_asset = a
                break

        # 2. Match exato pelo nome ou hostname técnico
        if not matched_asset and conn_name:
            for a in all_assets:
                if (a.name and a.name.lower() == conn_name.lower()) or \
                   (a.hostname and a.hostname.lower() == conn_name.lower()):
                    matched_asset = a
                    break

        # 3. Match por IP ou DNS (quando válido)
        if not matched_asset and clean_ip and clean_ip not in ("-", "127.0.0.1", "0.0.0.0", "localhost"):
            for a in all_assets:
                if a.ip_address and a.ip_address.strip() in (target_ip, clean_ip):
                    matched_asset = a
                    break
                elif a.dns and a.dns.strip() in (target_ip, clean_ip):
                    matched_asset = a
                    break

        if matched_asset:
            # Se o ativo estiver marcado como ignorado no Guacamole pelo operador, respeitar localmente sem alterar o Guacamole Server
            if (matched_asset.raw_data or {}).get("ignore_guacamole"):
                continue

            # Vincula ao ativo existente
            matched_asset.guacamole_connection_id = client_id
            matched_asset.guacamole_protocol = protocol
            if folder_group and not matched_asset.client_group:
                matched_asset.client_group = folder_group
            if clean_ip and (not matched_asset.ip_address or matched_asset.ip_address == "-"):
                matched_asset.ip_address = clean_ip
            if matched_asset.source == "zabbix":
                matched_asset.source = "unified"

            # Atualiza ou cria na tabela modular asset_guacamole (removendo eventuais duplicatas)
            guac_entries = db.query(AssetGuacamole).filter(
                AssetGuacamole.asset_id == matched_asset.id
            ).order_by(AssetGuacamole.id.asc()).all()

            if not guac_entries:
                guac_entry = AssetGuacamole(
                    asset_id=matched_asset.id,
                    connection_id=client_id,
                    connection_name=conn_name or matched_asset.name,
                    protocol=protocol,
                    port=port,
                    hostname=clean_ip or target_ip,
                    username=guac_user,
                    password=guac_pass,
                    last_sync=func.now()
                )
                db.add(guac_entry)
            else:
                guac_entry = guac_entries[0]
                for dup_g in guac_entries[1:]:
                    db.delete(dup_g)

                guac_entry.connection_id = client_id
                guac_entry.connection_name = conn_name or guac_entry.connection_name
                guac_entry.protocol = protocol
                # Preserva porta customizada local se no Guacamole ainda estiver a porta padrão
                if not guac_entry.port or guac_entry.port in ("22", "23", "3389", "5900") or port != default_port:
                    guac_entry.port = port
                guac_entry.hostname = clean_ip or target_ip
                if guac_user is not None:
                    guac_entry.username = guac_user
                if guac_pass:
                    guac_entry.password = guac_pass
                guac_entry.last_sync = func.now()

            matched_count += 1
            matched_details.append({
                "action": "matched",
                "asset_id": matched_asset.id,
                "asset_name": matched_asset.name,
                "ip": matched_asset.ip_address or clean_ip or "-",
                "guacamole_id": identifier,
                "client_id": client_id,
                "guacamole_name": conn_name,
                "protocol": protocol,
                "username": guac_user,
                "has_password": bool(guac_pass)
            })
        else:
            # Cadastra novo Ativo no IperSoft vindo do Guacamole
            new_name = conn_name if conn_name else (clean_ip if clean_ip else f"Guac-{identifier}")
            new_hostname = clean_ip if clean_ip else new_name

            new_asset = Asset(
                name=new_name,
                hostname=new_hostname,
                ip_address=clean_ip if clean_ip else None,
                client_group=folder_group,
                host_groups=[folder_group] if folder_group else [],
                port=port,
                source="guacamole",
                status="monitored",
                guacamole_connection_id=client_id,
                guacamole_protocol=protocol
            )
            db.add(new_asset)
            db.flush()

            guac_entry = AssetGuacamole(
                asset_id=new_asset.id,
                connection_id=client_id,
                connection_name=conn_name or new_name,
                protocol=protocol,
                port=port,
                hostname=clean_ip or target_ip,
                username=guac_user,
                password=guac_pass,
                last_sync=func.now()
            )
            db.add(guac_entry)
            all_assets.append(new_asset)

            created_new_count += 1
            matched_details.append({
                "action": "created",
                "asset_id": new_asset.id,
                "asset_name": new_asset.name,
                "ip": new_asset.ip_address or "-",
                "guacamole_id": identifier,
                "client_id": client_id,
                "guacamole_name": conn_name,
                "protocol": protocol,
                "username": guac_user,
                "has_password": bool(guac_pass)
            })

    cfg.last_sync = func.now()
    db.commit()

    return {
        "success": True,
        "total_guacamole": len(guac_conns),
        "matched": matched_count,
        "created_new": created_new_count,
        "total_synced": matched_count + created_new_count,
        "message": f"{matched_count} conexões vinculadas a ativos existentes e {created_new_count} novos equipamentos importados do Guacamole com sucesso.",
        "matched_details": matched_details
    }


@router.post("/match")
async def match_existing_guacamole_connections(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem executar o vínculo de conexões."
        )

    try:
        return await sync_guacamole_connections_with_db(db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao consultar o Apache Guacamole: {exc}"
        )
