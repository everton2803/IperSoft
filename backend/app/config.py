from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "IperSoft - Gestão de Ativos de Rede"
    PROJECT_VERSION: str = "1.0.0"
    
    # Database
    DATABASE_URL: str = "postgresql+psycopg2://ipersoft_user:ipersoft_secret@db:5432/ipersoft_db"
    
    # JWT
    SECRET_KEY: str = "ipersoft_super_secret_jwt_key_2026_network_assets"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # CORS
    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "*"
    ]

    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
