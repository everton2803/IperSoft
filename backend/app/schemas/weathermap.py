from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class WeathermapNodeOut(BaseModel):
    id: int
    map_id: int
    asset_id: Optional[int] = None
    asset_name: Optional[str] = None
    asset_hostname: Optional[str] = None
    key: str
    label: str
    x: int
    y: int
    icon: str = "router"
    label_pos: str = "S"
    zabbix_hostid: Optional[str] = None

    class Config:
        from_attributes = True


class WeathermapLinkOut(BaseModel):
    id: int
    map_id: int
    node_a_id: int
    node_b_id: int
    node_a_key: Optional[str] = None
    node_b_key: Optional[str] = None
    label: Optional[str] = None
    zabbix_host: Optional[str] = None
    itemid_in: Optional[str] = None
    itemid_out: Optional[str] = None
    itemid_status: Optional[str] = None
    capacity_bps: int = 1_000_000_000
    via_points: List[List[int]] = Field(default_factory=list)
    offset_a: Optional[str] = None
    offset_b: Optional[str] = None
    width: Optional[int] = None
    label_pos_pct: int = 50

    class Config:
        from_attributes = True


class WeathermapMapSummary(BaseModel):
    id: int
    name: str
    client_group: Optional[str] = None
    width: int
    height: int
    theme: str
    background: Optional[str] = None
    public_token: str
    public_url_png: str
    public_url_svg: str
    public_url_html: Optional[str] = None
    legacy_name: Optional[str] = None
    legacy_enabled: bool = False
    legacy_url_png: Optional[str] = None
    legacy_url_html: Optional[str] = None
    source: str
    is_active: bool
    node_count: int = 0
    link_count: int = 0
    last_render_at: Optional[datetime] = None
    last_render_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class WeathermapMapFull(WeathermapMapSummary):
    scale: List[Dict[str, Any]] = Field(default_factory=list)
    nodes: List[WeathermapNodeOut] = Field(default_factory=list)
    links: List[WeathermapLinkOut] = Field(default_factory=list)


class WeathermapMapCreate(BaseModel):
    name: str
    client_group: Optional[str] = None
    width: int = 1500
    height: int = 1000
    theme: str = "light"
    background: Optional[str] = None
    legacy_name: Optional[str] = None


class WeathermapNodeSave(BaseModel):
    id: Optional[int] = None
    temp_id: Optional[str] = None
    asset_id: Optional[int] = None
    key: str
    label: str
    x: int
    y: int
    icon: str = "router"
    label_pos: str = "S"
    zabbix_hostid: Optional[str] = None


class WeathermapLinkSave(BaseModel):
    id: Optional[int] = None
    node_a_id: Optional[int] = None
    node_b_id: Optional[int] = None
    node_a_ref: Optional[str] = None
    node_b_ref: Optional[str] = None
    label: Optional[str] = None
    zabbix_host: Optional[str] = None
    itemid_in: Optional[str] = None
    itemid_out: Optional[str] = None
    itemid_status: Optional[str] = None
    capacity_bps: int = 1_000_000_000
    via_points: List[List[int]] = Field(default_factory=list)
    offset_a: Optional[str] = None
    offset_b: Optional[str] = None
    width: Optional[int] = None
    label_pos_pct: int = 50


class WeathermapMapSave(BaseModel):
    name: str
    client_group: Optional[str] = None
    width: int = 1500
    height: int = 1000
    theme: str = "light"
    background: Optional[str] = None
    scale: Optional[List[Dict[str, Any]]] = None
    legacy_name: Optional[str] = None
    legacy_enabled: bool = False
    is_active: bool = True
    nodes: List[WeathermapNodeSave] = Field(default_factory=list)
    links: List[WeathermapLinkSave] = Field(default_factory=list)


class LegacyConfFileItem(BaseModel):
    filename: str
    content: str


class LegacyConfImportRequest(BaseModel):
    files: List[LegacyConfFileItem]
