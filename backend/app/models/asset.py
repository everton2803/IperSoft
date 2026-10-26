from typing import Optional
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base

class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), index=True, nullable=False) # Nome Canônico / Visível
    hostname = Column(String(150), index=True, nullable=False) # Hostname técnico
    ip_address = Column(String(64), index=True, nullable=True) # IP principal
    dns = Column(String(150), nullable=True) # DNS
    status = Column(String(30), default="active", nullable=False) # 'active' / 'inactive'
    source = Column(String(50), default="unified", index=True, nullable=False) # 'zabbix', 'guacamole', 'manual'
    
    # Colunas de compatibilidade mantidas no banco
    client_group = Column(String(100), index=True, nullable=True) # Nome da empresa/grupo cliente
    port = Column(String(20), nullable=True, default="10050")
    snmp_community = Column(String(100), nullable=True)
    host_groups = Column(JSON, default=list, nullable=False)
    templates = Column(JSON, default=list, nullable=False)
    external_id = Column(String(50), index=True, nullable=True)
    guacamole_connection_id = Column(String(150), index=True, nullable=True)
    guacamole_protocol = Column(String(50), nullable=True)
    backup_model = Column(String(50), default="RouterOS", nullable=True) # Modelo no Oxidized (RouterOS, Cisco, etc.)
    backup_enabled = Column(Boolean, default=True, nullable=False) # Se participa do backup do Oxidized
    backup_timeout = Column(Integer, default=30, nullable=True) # Timeout em segundos para o Oxidized ler a config (padrão 30s)
    raw_data = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relacionamentos modulares
    zabbix = relationship("AssetZabbix", uselist=False, back_populates="asset", cascade="all, delete-orphan", lazy="joined")
    guacamole = relationship("AssetGuacamole", back_populates="asset", cascade="all, delete-orphan", lazy="joined")
    oxidized = relationship("AssetOxidized", uselist=False, back_populates="asset", cascade="all, delete-orphan", lazy="joined")
    diagnostics = relationship("NetworkDiagnostic", back_populates="asset", cascade="all, delete-orphan")

    @property
    def ignore_guacamole(self) -> bool:
        return bool((self.raw_data or {}).get("ignore_guacamole", False))

    @property
    def guacamole_port(self) -> Optional[str]:
        if self.guacamole and len(self.guacamole) > 0:
            return self.guacamole[0].port
        return None

    def __repr__(self):
        return f"<Asset {self.name} ({self.ip_address}) - {self.source}>"


class AssetZabbix(Base):
    __tablename__ = "asset_zabbix"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    hostid = Column(String(50), index=True, nullable=True)
    host = Column(String(150), nullable=True) # Nome técnico do host no Zabbix
    name = Column(String(150), nullable=True) # Nome visível do host no Zabbix
    port = Column(String(20), default="10050", nullable=True)
    snmp_community = Column(String(100), default="ipermonitor", nullable=True)
    host_groups = Column(JSON, default=list, nullable=False)
    templates = Column(JSON, default=list, nullable=False)
    status = Column(String(30), default="monitored", nullable=False) # 'monitored' | 'unmonitored'
    last_sync = Column(DateTime(timezone=True), nullable=True)

    # Diagnósticos rápidos de monitoramento
    icmp_status = Column(String(20), nullable=True) # 'ok', 'failed', 'timeout'
    icmp_latency_ms = Column(Float, nullable=True)
    snmp_status = Column(String(20), nullable=True) # 'ok', 'failed', 'timeout'
    snmp_message = Column(Text, nullable=True)
    last_diagnostics = Column(DateTime(timezone=True), nullable=True)

    asset = relationship("Asset", back_populates="zabbix")

    def __repr__(self):
        return f"<AssetZabbix asset_id={self.asset_id} hostid={self.hostid}>"


class AssetGuacamole(Base):
    __tablename__ = "asset_guacamole"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    connection_id = Column(String(150), index=True, nullable=False) # base64 encoded client_id ou identifier
    connection_name = Column(String(150), nullable=True) # Nome amigável no Guacamole
    protocol = Column(String(30), default="ssh", nullable=False) # ssh, telnet, rdp, etc.
    port = Column(String(20), default="22", nullable=True)
    hostname = Column(String(150), nullable=True) # IP ou hostname cadastrado no Guacamole
    username = Column(String(100), nullable=True) # Usuário de acesso remoto (SSH, Telnet, RDP)
    password = Column(String(255), nullable=True) # Senha de acesso remoto
    parameters = Column(JSON, default=dict, nullable=True)
    last_sync = Column(DateTime(timezone=True), nullable=True)

    # Diagnósticos rápidos de acesso remoto
    tcp_status = Column(String(20), nullable=True) # 'ok', 'failed', 'timeout'
    tcp_latency_ms = Column(Float, nullable=True)
    tcp_message = Column(Text, nullable=True)
    last_diagnostics = Column(DateTime(timezone=True), nullable=True)

    asset = relationship("Asset", back_populates="guacamole")

    def __repr__(self):
        return f"<AssetGuacamole asset_id={self.asset_id} conn={self.connection_id} ({self.protocol})>"


class NetworkDiagnostic(Base):
    __tablename__ = "network_diagnostics"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    test_type = Column(String(20), index=True, nullable=False) # 'icmp', 'snmp', 'ssh', 'telnet', 'rdp'
    status = Column(String(20), index=True, nullable=False) # 'ok', 'failed', 'timeout'
    latency_ms = Column(Float, nullable=True)
    target_host = Column(String(100), nullable=False)
    target_port = Column(String(20), nullable=True)
    message = Column(Text, nullable=True)
    tested_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asset = relationship("Asset", back_populates="diagnostics")

    def __repr__(self):
        return f"<NetworkDiagnostic asset_id={self.asset_id} type={self.test_type} status={self.status}>"


class AssetOxidized(Base):
    __tablename__ = "asset_oxidized"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    node_name = Column(String(150), index=True, nullable=False) # Nome do nó no Oxidized
    model = Column(String(50), default="RouterOS", nullable=True) # RouterOS, Cisco, etc.
    group = Column(String(100), default="default", nullable=True)
    status = Column(String(30), nullable=True) # 'success', 'fail', 'no_connection', 'never'
    last_backup = Column(DateTime(timezone=True), nullable=True)
    backup_time_taken = Column(Float, nullable=True)
    timeout = Column(Integer, default=30, nullable=True) # Timeout customizado do nó
    vars = Column(JSON, default=dict, nullable=True)
    last_sync = Column(DateTime(timezone=True), nullable=True)

    asset = relationship("Asset", back_populates="oxidized")

    def __repr__(self):
        return f"<AssetOxidized asset_id={self.asset_id} node={self.node_name} status={self.status}>"

