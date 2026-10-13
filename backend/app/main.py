from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from app.config import settings
from app.database import engine, SessionLocal, Base
from app.models import User, IntegrationConfig, Asset
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.zabbix import router as zabbix_router
from app.routers.assets import router as assets_router
from app.utils.security import hash_password

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create tables
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Tabelas do banco de dados verificadas/criadas com sucesso.")
    
    # Auto-seed initial admin if no users exist
    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count == 0:
            initial_admin = User(
                username="admin",
                email="admin@ipersoft.com.br",
                full_name="Administrador do Sistema",
                hashed_password=hash_password("admin123"),
                role="admin",
                is_active=True
            )
            db.add(initial_admin)
            db.commit()
            logger.info("Conta de administrador inicial criada: admin / admin123")
    except Exception as seed_err:
        logger.warning(f"Erro ao verificar seed de usuário: {seed_err}")
    finally:
        db.close()
except Exception as e:
    logger.warning(f"Aviso ao inicializar tabelas na inicialização: {e}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    description="Sistema Integrado de Gestão de Ativos de Redes"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers.guacamole import router as guacamole_router
from app.routers.diagnostics import router as diagnostics_router
from app.routers.oxidized import router as oxidized_router
from app.services.diagnostics import run_all_diagnostics_batch
from app.services.oxidized import OxidizedService
import asyncio

# Routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(zabbix_router, prefix="/api/v1")
app.include_router(assets_router, prefix="/api/v1")
app.include_router(guacamole_router, prefix="/api/v1")
app.include_router(diagnostics_router, prefix="/api/v1")
app.include_router(oxidized_router, prefix="/api/v1")

async def hourly_diagnostics_scheduler():
    """Rotina agendada para testar conectividade de rede e sincronizar status do Oxidized a cada 1 hora (3600s)."""
    logger.info("Agendador de diagnósticos e status ativo (intervalo: 1h).")
    # Pequena pausa no boot para garantir que banco e APIs estejam prontos
    await asyncio.sleep(20)
    while True:
        try:
            logger.info("Iniciando ciclo automático de diagnósticos de rede (1h)...")
            await run_all_diagnostics_batch()
        except Exception as e:
            logger.error(f"Erro no ciclo do agendador horário de diagnósticos: {e}")

        try:
            db_ox = SessionLocal()
            ox_cfg = db_ox.query(IntegrationConfig).filter(
                IntegrationConfig.name == "oxidized",
                IntegrationConfig.is_active == True
            ).first()
            if ox_cfg and ox_cfg.url:
                logger.info("Iniciando ciclo automático de sincronização do Oxidized (1h)...")
                await OxidizedService.sync_nodes_with_database(db_ox, ox_cfg.url, ox_cfg.username, ox_cfg.password)
            db_ox.close()
        except Exception as ox_err:
            logger.error(f"Erro no ciclo do agendador horário do Oxidized: {ox_err}")

        await asyncio.sleep(3600)

@app.on_event("startup")
async def startup_scheduler():
    asyncio.create_task(hourly_diagnostics_scheduler())

@app.get("/")
def root():
    return {
        "sistema": settings.PROJECT_NAME,
        "versao": settings.PROJECT_VERSION,
        "status": "online"
    }

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "IperSoft API"}
