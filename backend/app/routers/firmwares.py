from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any, List

from app.database import get_db
from app.models.integration import IntegrationConfig
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.firmwares import FirmwaresService

router = APIRouter(prefix="/firmwares", tags=["Servidor de Firmwares"])

class FirmwaresConfigRequest(BaseModel):
    url: str
    public_url: Optional[str] = "https://firmware.iper.net.br"
    is_active: Optional[bool] = True

class FirmwaresTestRequest(BaseModel):
    url: Optional[str] = None
    public_url: Optional[str] = None

class CommandGenerateRequest(BaseModel):
    filename: str
    relative_path: str
    os_profile: Optional[str] = None
    backup_model: Optional[str] = None
    http_base_url: Optional[str] = None

def get_or_create_config(db: Session) -> IntegrationConfig:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "firmwares").first()
    if not cfg:
        cfg = IntegrationConfig(
            name="firmwares",
            url="http://10.10.1.2:8089",
            public_url="https://firmware.iper.net.br",
            is_active=True
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg

@router.get("/config")
def get_firmwares_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = get_or_create_config(db)
    return {
        "id": cfg.id,
        "name": cfg.name,
        "url": cfg.url,
        "public_url": cfg.public_url or "https://firmware.iper.net.br",
        "is_active": cfg.is_active,
        "last_sync": cfg.last_sync
    }

@router.post("/config")
def save_firmwares_config(
    req: FirmwaresConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem configurar integrações."
        )

    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "firmwares").first()
    if not cfg:
        cfg = IntegrationConfig(
            name="firmwares",
            url=req.url,
            public_url=req.public_url,
            is_active=req.is_active
        )
        db.add(cfg)
    else:
        cfg.url = req.url
        cfg.public_url = req.public_url
        cfg.is_active = req.is_active

    db.commit()
    db.refresh(cfg)

    return {
        "message": "Configurações do Servidor de Firmwares salvas com sucesso.",
        "config": {
            "id": cfg.id,
            "name": cfg.name,
            "url": cfg.url,
            "public_url": cfg.public_url,
            "is_active": cfg.is_active
        }
    }

@router.post("/test")
async def test_firmwares_connection(
    req: FirmwaresTestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = get_or_create_config(db)
    test_http = req.url or cfg.url or "http://10.10.1.2:8089"
    test_web = req.public_url or cfg.public_url or "https://firmware.iper.net.br"

    svc = FirmwaresService(http_url=test_http, web_url=test_web)
    result = await svc.test_connectivity(test_http, test_web)

    if result.get("is_connected"):
        from datetime import datetime, timezone
        cfg.last_sync = datetime.now(timezone.utc)
        db.commit()

    return result

@router.get("/files")
async def list_firmware_files(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = get_or_create_config(db)
    svc = FirmwaresService(
        http_url=cfg.url or "http://10.10.1.2:8089",
        web_url=cfg.public_url or "https://firmware.iper.net.br"
    )
    return await svc.list_firmwares(download_base=cfg.url)

@router.post("/command")
def get_upgrade_command(
    req: CommandGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cfg = get_or_create_config(db)
    base_url = req.http_base_url or cfg.url or "http://10.10.1.2:8089"
    return FirmwaresService.generate_commands(
        relative_path=req.relative_path,
        filename=req.filename,
        http_base_url=base_url,
        os_profile=req.os_profile,
        backup_model=req.backup_model
    )
