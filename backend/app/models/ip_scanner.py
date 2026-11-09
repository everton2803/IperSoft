from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class IPScannerProbe(Base):
    __tablename__ = "ip_scanner_probes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)  # Ex: "Probe Central (brdrive)" ou "VM Zabbix Proxy - Inforline"
    url = Column(String(255), nullable=False)  # Ex: "http://scanner:8005" ou "http://172.16.10.22:8005"
    client_group = Column(String(100), nullable=True, index=True)  # Cliente padrão atendido por este probe
    phpipam_agent_code = Column(String(100), nullable=True)  # Key opcional do phpipam-agent correspondente
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    prefixes = relationship("IPPrefix", back_populates="probe_rel")


class IPCommunity(Base):
    __tablename__ = "ip_communities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)  # Ex: "Comunidade Provedor Principal"
    community = Column(String(100), nullable=False)  # Ex: "ipermonitor"
    version = Column(String(10), default="2c")  # "2c" ou "3"
    port = Column(Integer, default=161)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    prefixes = relationship("IPPrefix", back_populates="community_rel")


class IPPrefix(Base):
    __tablename__ = "ip_prefixes"

    id = Column(Integer, primary_key=True, index=True)
    prefix = Column(String(50), nullable=False, unique=True, index=True)  # Ex: "10.90.10.0/24"
    client_group = Column(String(100), nullable=False, index=True)  # Ex: "atm", "athila", "bkup"
    description = Column(String(200), nullable=True)
    community_id = Column(Integer, ForeignKey("ip_communities.id", ondelete="SET NULL"), nullable=True)
    community_ids = Column(JSON, default=list, nullable=True)  # Lista de IDs de comunidades associadas ao prefixo
    probe_id = Column(Integer, ForeignKey("ip_scanner_probes.id", ondelete="SET NULL"), nullable=True)
    
    last_scan_at = Column(DateTime(timezone=True), nullable=True)
    total_hosts_found = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    community_rel = relationship("IPCommunity", back_populates="prefixes")
    probe_rel = relationship("IPScannerProbe", back_populates="prefixes")
    discovered_ips = relationship("DiscoveredIP", back_populates="prefix_rel", cascade="all, delete-orphan")


class DiscoveredIP(Base):
    __tablename__ = "discovered_ips"

    id = Column(Integer, primary_key=True, index=True)
    prefix_id = Column(Integer, ForeignKey("ip_prefixes.id", ondelete="CASCADE"), nullable=False, index=True)
    ip_address = Column(String(50), nullable=False, index=True)
    
    icmp_alive = Column(Boolean, default=False)
    snmp_alive = Column(Boolean, default=False)
    status = Column(String(30), default="inactive")  # "snmp_and_icmp", "icmp_only", "snmp_only", "inactive"
    
    hostname = Column(String(150), nullable=True, index=True)
    description = Column(String(255), nullable=True)
    community = Column(String(100), nullable=True)
    rtt_ms = Column(Float, nullable=True)
    
    # Vínculo automático com a tabela assets do IperSoft
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True)
    
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    prefix_rel = relationship("IPPrefix", back_populates="discovered_ips")
    asset_rel = relationship("Asset")
