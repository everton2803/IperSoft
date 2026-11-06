from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Boolean,
    DateTime,
    JSON,
    ForeignKey,
    Float,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class WeathermapMap(Base):
    __tablename__ = "weathermap_maps"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    client_group = Column(String(100), index=True, nullable=True)
    width = Column(Integer, default=1500, nullable=False)
    height = Column(Integer, default=1000, nullable=False)
    theme = Column(String(20), default="light", nullable=False)
    background = Column(String(255), nullable=True)
    scale = Column(JSON, nullable=False, default=list)
    public_token = Column(String(64), unique=True, index=True, nullable=False)
    legacy_name = Column(String(64), unique=True, nullable=True)
    legacy_enabled = Column(Boolean, default=False, nullable=False)
    source = Column(String(50), default="manual", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_render_at = Column(DateTime(timezone=True), nullable=True)
    last_render_error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    nodes = relationship(
        "WeathermapNode",
        back_populates="map",
        cascade="all, delete-orphan",
        order_by="WeathermapNode.id",
    )
    links = relationship(
        "WeathermapLink",
        back_populates="map",
        cascade="all, delete-orphan",
        order_by="WeathermapLink.id",
    )


class WeathermapNode(Base):
    __tablename__ = "weathermap_nodes"

    id = Column(Integer, primary_key=True, index=True)
    map_id = Column(Integer, ForeignKey("weathermap_maps.id", ondelete="CASCADE"), index=True, nullable=False)
    asset_id = Column(Integer, ForeignKey("assets.id", ondelete="SET NULL"), index=True, nullable=True)
    key = Column(String(100), nullable=False)
    label = Column(String(150), nullable=False)
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    icon = Column(String(30), default="router", nullable=False)
    label_pos = Column(String(10), default="S", nullable=False)
    zabbix_hostid = Column(String(50), nullable=True)

    map = relationship("WeathermapMap", back_populates="nodes")
    asset = relationship("Asset")

    __table_args__ = (UniqueConstraint("map_id", "key", name="uq_wm_node_map_key"),)


class WeathermapLink(Base):
    __tablename__ = "weathermap_links"

    id = Column(Integer, primary_key=True, index=True)
    map_id = Column(Integer, ForeignKey("weathermap_maps.id", ondelete="CASCADE"), index=True, nullable=False)
    node_a_id = Column(Integer, ForeignKey("weathermap_nodes.id", ondelete="CASCADE"), nullable=False)
    node_b_id = Column(Integer, ForeignKey("weathermap_nodes.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(150), nullable=True)
    zabbix_host = Column(String(150), nullable=True)
    itemid_in = Column(String(50), nullable=True)
    itemid_out = Column(String(50), nullable=True)
    itemid_status = Column(String(50), nullable=True)
    capacity_bps = Column(BigInteger, nullable=False, default=1_000_000_000)
    via_points = Column(JSON, default=list, nullable=False)
    offset_a = Column(String(10), nullable=True)
    offset_b = Column(String(10), nullable=True)
    width = Column(Integer, nullable=True)
    label_pos_pct = Column(Integer, nullable=False, default=50)

    map = relationship("WeathermapMap", back_populates="links")
    node_a = relationship("WeathermapNode", foreign_keys=[node_a_id])
    node_b = relationship("WeathermapNode", foreign_keys=[node_b_id])


class WeathermapSample(Base):
    __tablename__ = "weathermap_samples"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    link_id = Column(Integer, ForeignKey("weathermap_links.id", ondelete="CASCADE"), index=True, nullable=False)
    ts = Column(DateTime(timezone=True), index=True, nullable=False)
    in_bps = Column(Float, nullable=True)
    out_bps = Column(Float, nullable=True)
    status = Column(String(20), nullable=False, default="ok")

    __table_args__ = (Index("ix_wm_sample_link_ts", "link_id", "ts"),)
