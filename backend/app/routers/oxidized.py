from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional, List, Any, Dict

from app.database import get_db
from app.models.user import User
from app.models.integration import IntegrationConfig
from app.models.asset import Asset, AssetOxidized
from app.routers.auth import get_current_user
from app.services.oxidized import OxidizedService

router = APIRouter(prefix="/integrations/oxidized", tags=["Integração Oxidized"])


class OxidizedConfigRequest(BaseModel):
    url: str
    username: Optional[str] = None
    password: Optional[str] = None


class OxidizedConfigResponse(BaseModel):
    url: str
    username: str
    has_password: bool
    is_active: bool
    last_sync: Optional[Any] = None


class OxidizedTestRequest(BaseModel):
    url: str
    username: Optional[str] = None
    password: Optional[str] = None


@router.get("/config", response_model=Optional[OxidizedConfigResponse])
def get_oxidized_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    if not cfg:
        return None
    return {
        "url": cfg.url,
        "username": cfg.username or "",
        "has_password": bool(cfg.password),
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }


@router.post("/config", response_model=OxidizedConfigResponse)
def save_oxidized_config(
    req: OxidizedConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem configurar integrações."
        )

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    if not cfg:
        cfg = IntegrationConfig(name="oxidized", is_active=True)
        db.add(cfg)

    cfg.url = req.url.strip()
    cfg.username = req.username or ""
    if req.password is not None and req.password != "":
        cfg.password = req.password

    db.commit()
    db.refresh(cfg)

    return {
        "url": cfg.url,
        "username": cfg.username or "",
        "has_password": bool(cfg.password),
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }


@router.post("/test")
async def test_oxidized_connection(
    req: OxidizedTestRequest,
    current_user: User = Depends(get_current_user)
):
    try:
        res = await OxidizedService.test_connection(req.url, req.username, req.password)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sync")
async def sync_oxidized_nodes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem sincronizar nós do Oxidized."
        )

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    if not cfg or not cfg.url:
        raise HTTPException(status_code=400, detail="Oxidized não configurado.")

    try:
        result = await OxidizedService.sync_nodes_with_database(
            db=db,
            url=cfg.url,
            username=cfg.username,
            password=cfg.password
        )
        cfg.last_sync = func.now()
        db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro na sincronização: {e}")


from fastapi.responses import PlainTextResponse


@router.get("/nodes")
def get_source_nodes(db: Session = Depends(get_db)):
    """Endpoint público consumido pelo Oxidized via `source: http` para descobrir nós em JSON."""
    return OxidizedService.get_source_nodes(db)


@router.get("/router.db", response_class=PlainTextResponse)
def get_source_router_db(db: Session = Depends(get_db)):
    """Endpoint compatível com router.db do Oxidized (name:model:ip:proto:port:user:pwd)."""
    return OxidizedService.get_source_csv(db)


@router.get("/assets/{asset_id}/config")
async def get_asset_oxidized_config(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    if not cfg or not cfg.url:
        raise HTTPException(status_code=400, detail="Integração Oxidized não configurada.")

    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    # Busca o nome do nó no vínculo ou tenta usar o nome do ativo
    node_name = asset.oxidized.node_name if asset.oxidized else asset.name
    try:
        config_text = await OxidizedService.fetch_node_config(
            url=cfg.url,
            node_name=node_name,
            username=cfg.username,
            password=cfg.password
        )
        return {
            "asset_id": asset.id,
            "node_name": node_name,
            "config": config_text
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao obter configuração: {e}")


@router.post("/assets/{asset_id}/backup")
async def trigger_asset_backup(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    if not cfg or not cfg.url:
        raise HTTPException(status_code=400, detail="Integração Oxidized não configurada.")

    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo não encontrado.")

    node_name = asset.oxidized.node_name if asset.oxidized else asset.name
    try:
        res = await OxidizedService.trigger_backup(
            url=cfg.url,
            node_name=node_name,
            username=cfg.username,
            password=cfg.password
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao disparar backup: {e}")
