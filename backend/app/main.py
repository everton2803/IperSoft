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

from sqlalchemy import text

# Create tables and ensure incremental columns
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Tabelas do banco de dados verificadas/criadas com sucesso.")

    # Migrações incrementais seguras (DDL idempotente)
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS backup_timeout INTEGER DEFAULT 30;"))
        conn.execute(text("UPDATE assets SET backup_timeout = 30 WHERE backup_timeout IS NULL;"))
        conn.execute(text("ALTER TABLE asset_oxidized ADD COLUMN IF NOT EXISTS timeout INTEGER DEFAULT 30;"))
        conn.commit()
    logger.info("Migrações de colunas de backup_timeout verificadas com sucesso.")
    
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

from app.routers.guacamole import router as guacamole_router, sync_guacamole_connections_with_db
from app.routers.zabbix import sync_zabbix_hosts_with_db
from app.routers.diagnostics import router as diagnostics_router
from app.routers.oxidized import router as oxidized_router
from app.routers.victorialogs import router as victorialogs_router
from app.services.diagnostics import run_all_diagnostics_batch
import asyncio

# Routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(zabbix_router, prefix="/api/v1")
app.include_router(assets_router, prefix="/api/v1")
app.include_router(guacamole_router, prefix="/api/v1")
app.include_router(diagnostics_router, prefix="/api/v1")
app.include_router(oxidized_router, prefix="/api/v1")
app.include_router(victorialogs_router, prefix="/api/v1")

async def hourly_diagnostics_scheduler():
    """Rotina agendada (1h) para importar cadastros do Zabbix e Guacamole e executar diagnósticos de rede."""
    logger.info("Agendador de importação (Zabbix/Guacamole) e diagnósticos de rede ativo (intervalo: 1h).")
    # Pequena pausa no boot para garantir que banco e APIs estejam prontos
    await asyncio.sleep(20)
    while True:
        # 1. Importação periódica de hosts do Zabbix Server -> IperSoft
        db_zbx = SessionLocal()
        try:
            zbx_cfg = db_zbx.query(IntegrationConfig).filter(
                IntegrationConfig.name == "zabbix",
                IntegrationConfig.is_active == True
            ).first()
            if zbx_cfg and zbx_cfg.url:
                logger.info("Iniciando ciclo automático de importação de hosts do Zabbix (1h)...")
                zbx_res = await sync_zabbix_hosts_with_db(db_zbx)
                logger.info(f"Importação Zabbix (1h): {zbx_res.get('message')}")
        except Exception as zbx_err:
            logger.error(f"Erro no ciclo horário de importação do Zabbix: {zbx_err}")
        finally:
            db_zbx.close()

        # 2. Importação periódica de conexões do Apache Guacamole -> IperSoft
        db_guac = SessionLocal()
        try:
            guac_cfg = db_guac.query(IntegrationConfig).filter(
                IntegrationConfig.name == "guacamole",
                IntegrationConfig.is_active == True
            ).first()
            if guac_cfg and guac_cfg.url and guac_cfg.username and guac_cfg.password:
                logger.info("Iniciando ciclo automático de importação de conexões do Guacamole (1h)...")
                guac_res = await sync_guacamole_connections_with_db(db_guac)
                logger.info(f"Importação Guacamole (1h): {guac_res.get('message')}")
        except Exception as guac_err:
            logger.error(f"Erro no ciclo horário de importação do Guacamole: {guac_err}")
        finally:
            db_guac.close()

        # 3. Diagnósticos de conectividade de rede (ICMP / SNMP / TCP)
        try:
            logger.info("Iniciando ciclo automático de diagnósticos de rede (1h)...")
            await run_all_diagnostics_batch()
        except Exception as e:
            logger.error(f"Erro no ciclo do agendador horário de diagnósticos: {e}")

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
