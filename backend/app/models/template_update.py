from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base

class ZabbixTemplateUpdate(Base):
    __tablename__ = "zabbix_template_updates"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(String(50), unique=True, index=True, nullable=False)
    uuid = Column(String(64), index=True, nullable=True)
    name = Column(String(150), nullable=False)
    vendor_name = Column(String(50), default="Zabbix")
    local_version = Column(String(50), nullable=True)
    remote_version = Column(String(50), nullable=True)
    has_update = Column(Boolean, default=False)
    hosts_count = Column(Integer, default=0)
    file_path = Column(String(255), nullable=True)
    remote_commit_sha = Column(String(64), nullable=True)
    remote_commit_date = Column(String(50), nullable=True)
    remote_commit_msg = Column(String(500), nullable=True)
    remote_commit_url = Column(String(255), nullable=True)
    last_checked_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<ZabbixTemplateUpdate {self.name} (local: {self.local_version}, remote: {self.remote_version})>"
