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

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "guacamole").first()
    if not cfg or not cfg.url or not cfg.username or not cfg.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configuração do Guacamole incompleta. Salve a URL, usuário e senha primeiro."
        )

    try:
        guac_conns = await GuacamoleService.fetch_connections_with_parameters(
            cfg.url, 
            cfg.username, 
            cfg.password
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao consultar o Apache Guacamole: {exc}"
        )

    matched_count = 0
    created_new_count = 0
    matched_details = []

    # Carregar todos os ativos da base
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

        client_id = conn.get("client_id") or identifier
        clean_ip = target_ip.split(":")[0].strip() if ":" in target_ip else target_ip

        matched_asset = None

        # 1. Tentar match exato por IP ou hostname
        if clean_ip:
            for a in all_assets:
                if a.ip_address and a.ip_address.strip() in (target_ip, clean_ip):
                    matched_asset = a
                    break
                elif a.dns and a.dns.strip() in (target_ip, clean_ip):
                    matched_asset = a
                    break

        # 2. Se não achou por IP, tentar pelo nome ou hostname técnico
        if not matched_asset and conn_name:
            for a in all_assets:
                if a.name.lower() == conn_name.lower() or a.hostname.lower() == conn_name.lower():
                    matched_asset = a
                    break

        if matched_asset:
            # Vincula ao ativo existente
            matched_asset.guacamole_connection_id = client_id
            matched_asset.guacamole_protocol = protocol

            # Atualiza ou cria na tabela modular asset_guacamole
            guac_entry = db.query(AssetGuacamole).filter(
                AssetGuacamole.asset_id == matched_asset.id,
                AssetGuacamole.connection_id == client_id
            ).first()

            if not guac_entry:
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
                guac_entry.connection_name = conn_name or guac_entry.connection_name
                guac_entry.protocol = protocol
                guac_entry.port = port
                guac_entry.hostname = clean_ip or target_ip
                guac_entry.username = guac_user
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
            # Cadastra novo Ativo no IperSoft vindo exclusivamente do Guacamole
            new_name = conn_name if conn_name else (clean_ip if clean_ip else f"Guac-{identifier}")
            new_hostname = clean_ip if clean_ip else new_name

            new_asset = Asset(
                name=new_name,
                hostname=new_hostname,
                ip_address=clean_ip if clean_ip else None,
                port=port,
                source="guacamole",
                status="active",
                guacamole_connection_id=client_id,
                guacamole_protocol=protocol
            )
            db.add(new_asset)
            db.flush() # obtém new_asset.id

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
