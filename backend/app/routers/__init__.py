from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.zabbix import router as zabbix_router
from app.routers.assets import router as assets_router
from app.routers.guacamole import router as guacamole_router

__all__ = ["auth_router", "users_router", "zabbix_router", "assets_router", "guacamole_router"]
