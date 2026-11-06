import os
import re
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.asset import Asset, AssetZabbix
from app.models.user import User
from app.models.weathermap import WeathermapMap, WeathermapNode, WeathermapLink, WeathermapSample
from app.routers.auth import get_current_user
from app.schemas.weathermap import (
    LegacyConfImportRequest,
    WeathermapLinkOut,
    WeathermapMapCreate,
    WeathermapMapFull,
    WeathermapMapSave,
    WeathermapMapSummary,
    WeathermapNodeOut,
)
from app.services.zabbix import ZabbixService
from app.weathermap.collector import LinkState, _get_zabbix_credentials
from app.weathermap.import_legacy import import_legacy_conf_to_db
from app.weathermap.import_zabbix import import_zabbix_sysmap
from app.weathermap.publisher import reconcile_render_dir
from app.weathermap.renderer import render_svg
from app.weathermap.scale import DEFAULT_SCALE, parse_bandwidth
from app.weathermap.worker import DEFAULT_RENDER_DIR, render_and_publish_single_map

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weathermap", tags=["Weathermap"])

PUBLIC_BASE_URL = os.environ.get("WEATHERMAP_PUBLIC_BASE_URL", "https://weathermap.iper.net.br")


def _require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas administradores podem modificar mapas do Weathermap.",
        )
    return user


def _build_map_summary(m: WeathermapMap) -> WeathermapMapSummary:
    base = PUBLIC_BASE_URL.rstrip("/")
    tok = m.public_token
    legacy_url = f"{base}/{m.legacy_name}.png" if (m.legacy_name and m.legacy_enabled) else None
    legacy_html = f"{base}/{m.legacy_name}.html" if (m.legacy_name and m.legacy_enabled) else None
    return WeathermapMapSummary(
        id=m.id,
        name=m.name,
        client_group=m.client_group,
        width=m.width,
        height=m.height,
        theme=m.theme,
        background=m.background,
        public_token=tok,
        public_url_png=f"{base}/m/{tok}.png",
        public_url_svg=f"{base}/m/{tok}.svg",
        public_url_html=f"{base}/m/{tok}.html",
        legacy_name=m.legacy_name,
        legacy_enabled=bool(m.legacy_enabled),
        legacy_url_png=legacy_url,
        legacy_url_html=legacy_html,
        source=m.source,
        is_active=bool(m.is_active),
        node_count=len(m.nodes),
        link_count=len(m.links),
        last_render_at=m.last_render_at,
        last_render_error=m.last_render_error,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _build_map_full(db: Session, m: WeathermapMap) -> WeathermapMapFull:
    summary = _build_map_summary(m)
    asset_ids = {n.asset_id for n in m.nodes if n.asset_id}
    assets_by_id: Dict[int, Asset] = {}
    if asset_ids:
        for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all():
            assets_by_id[a.id] = a

    nodes_by_id: Dict[int, WeathermapNode] = {n.id: n for n in m.nodes}
    nodes_out: List[WeathermapNodeOut] = []
    for n in m.nodes:
        a = assets_by_id.get(n.asset_id) if n.asset_id else None
        nodes_out.append(
            WeathermapNodeOut(
                id=n.id,
                map_id=n.map_id,
                asset_id=n.asset_id,
                asset_name=a.name if a else None,
                asset_hostname=a.hostname if a else None,
                key=n.key,
                label=n.label,
                x=n.x,
                y=n.y,
                icon=n.icon,
                label_pos=n.label_pos,
                zabbix_hostid=n.zabbix_hostid or (a.zabbix.hostid if (a and a.zabbix) else None),
            )
        )

    links_out: List[WeathermapLinkOut] = []
    for lnk in m.links:
        na = nodes_by_id.get(lnk.node_a_id)
        nb = nodes_by_id.get(lnk.node_b_id)
        links_out.append(
            WeathermapLinkOut(
                id=lnk.id,
                map_id=lnk.map_id,
                node_a_id=lnk.node_a_id,
                node_b_id=lnk.node_b_id,
                node_a_key=na.key if na else None,
                node_b_key=nb.key if nb else None,
                label=lnk.label,
                zabbix_host=lnk.zabbix_host,
                itemid_in=lnk.itemid_in,
                itemid_out=lnk.itemid_out,
                itemid_status=lnk.itemid_status,
                capacity_bps=lnk.capacity_bps,
                via_points=lnk.via_points or [],
                offset_a=lnk.offset_a,
                offset_b=lnk.offset_b,
                width=lnk.width,
                label_pos_pct=lnk.label_pos_pct if lnk.label_pos_pct is not None else 50,
            )
        )

    return WeathermapMapFull(
        **summary.model_dump(),
        scale=m.scale if m.scale else DEFAULT_SCALE,
        nodes=nodes_out,
        links=links_out,
    )


def _latest_link_states_from_db(db: Session, links: List[WeathermapLink]) -> Dict[int, LinkState]:
    if not links:
        return {}
    link_ids = [lnk.id for lnk in links]
    subq = (
        db.query(
            WeathermapSample.link_id,
            func.max(WeathermapSample.id).label("max_id"),
        )
        .filter(WeathermapSample.link_id.in_(link_ids))
        .group_by(WeathermapSample.link_id)
        .subquery()
    )
    samples = (
        db.query(WeathermapSample)
        .join(subq, WeathermapSample.id == subq.c.max_id)
        .all()
    )
    sample_by_link: Dict[int, WeathermapSample] = {s.link_id: s for s in samples}
    states: Dict[int, LinkState] = {}
    now = datetime.now(timezone.utc)

    for lnk in links:
        s = sample_by_link.get(lnk.id)
        if not s:
            states[lnk.id] = LinkState(in_bps=None, out_bps=None, pct=None, status="no_data", ts=now)
            continue
        cap = max(1, int(lnk.capacity_bps or 1_000_000_000))
        if s.status == "down":
            pct = 0.0
        elif s.in_bps is None and s.out_bps is None:
            pct = None
        else:
            pct = (max(s.in_bps or 0.0, s.out_bps or 0.0) / cap) * 100.0
        states[lnk.id] = LinkState(
            in_bps=s.in_bps,
            out_bps=s.out_bps,
            pct=pct,
            status=s.status,
            ts=s.ts,
        )
    return states


@router.get("/maps", response_model=List[WeathermapMapSummary])
def list_maps(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    maps = db.query(WeathermapMap).order_by(WeathermapMap.name.asc()).all()
    return [_build_map_summary(m) for m in maps]


@router.post("/maps", response_model=WeathermapMapFull, status_code=status.HTTP_201_CREATED)
async def create_map(
    req: WeathermapMapCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_require_admin),
):
    if req.legacy_name:
        exists = db.query(WeathermapMap).filter(WeathermapMap.legacy_name == req.legacy_name.strip()).first()
        if exists:
            raise HTTPException(status_code=400, detail=f"Já existe um mapa com legacy_name '{req.legacy_name}'.")

    wm_map = WeathermapMap(
        name=req.name.strip(),
        client_group=req.client_group.strip() if req.client_group else None,
        width=max(400, req.width),
        height=max(300, req.height),
        theme=req.theme if req.theme in ("light", "dark") else "light",
        background=req.background,
        scale=DEFAULT_SCALE,
        public_token=secrets.token_urlsafe(24),
        legacy_name=req.legacy_name.strip() if req.legacy_name else None,
        legacy_enabled=False,
        source="manual",
        is_active=True,
    )
    db.add(wm_map)
    db.commit()
    db.refresh(wm_map)

    try:
        await render_and_publish_single_map(db, wm_map, render_dir=DEFAULT_RENDER_DIR)
    except Exception as exc:
        logger.warning("Aviso ao renderizar mapa recém-criado %s: %s", wm_map.id, exc)

    return _build_map_full(db, wm_map)


@router.get("/maps/{map_id}", response_model=WeathermapMapFull)
def get_map_detail(
    map_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")
    return _build_map_full(db, m)


@router.put("/maps/{map_id}", response_model=WeathermapMapFull)
async def save_map(
    map_id: int,
    req: WeathermapMapSave,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_require_admin),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")

    if req.legacy_name:
        dup = (
            db.query(WeathermapMap)
            .filter(WeathermapMap.legacy_name == req.legacy_name.strip(), WeathermapMap.id != map_id)
            .first()
        )
        if dup:
            raise HTTPException(status_code=400, detail=f"Já existe outro mapa com legacy_name '{req.legacy_name}'.")

    m.name = req.name.strip()
    m.client_group = req.client_group.strip() if req.client_group else None
    m.width = max(400, req.width)
    m.height = max(300, req.height)
    m.theme = req.theme if req.theme in ("light", "dark") else "light"
    m.background = req.background
    if req.scale:
        m.scale = req.scale
    m.legacy_name = req.legacy_name.strip() if req.legacy_name else None
    m.legacy_enabled = bool(req.legacy_enabled)
    m.is_active = bool(req.is_active)

    # Sincronizar nós (preservando IDs existentes e criando novos)
    existing_nodes: Dict[int, WeathermapNode] = {n.id: n for n in m.nodes}
    kept_node_ids = set()
    ref_to_node: Dict[str, WeathermapNode] = {}
    used_keys = set()

    for idx, nin in enumerate(req.nodes):
        base_key = (nin.key or nin.label or f"node_{idx + 1}").strip()
        ukey = base_key
        seq = 1
        while ukey in used_keys:
            seq += 1
            ukey = f"{base_key}_{seq}"
        used_keys.add(ukey)

        if nin.id and nin.id in existing_nodes:
            nd = existing_nodes[nin.id]
            nd.asset_id = nin.asset_id
            nd.key = ukey
            nd.label = nin.label.strip() or ukey
            nd.x = int(nin.x)
            nd.y = int(nin.y)
            nd.icon = nin.icon or "router"
            nd.label_pos = (nin.label_pos or "S").upper()
            nd.zabbix_hostid = nin.zabbix_hostid
            kept_node_ids.add(nd.id)
        else:
            nd = WeathermapNode(
                map_id=m.id,
                asset_id=nin.asset_id,
                key=ukey,
                label=nin.label.strip() or ukey,
                x=int(nin.x),
                y=int(nin.y),
                icon=nin.icon or "router",
                label_pos=(nin.label_pos or "S").upper(),
                zabbix_hostid=nin.zabbix_hostid,
            )
            db.add(nd)
            db.flush()
            kept_node_ids.add(nd.id)

        ref_to_node[str(nd.id)] = nd
        ref_to_node[nd.key] = nd
        if nin.key:
            ref_to_node[nin.key] = nd
        if nin.temp_id:
            ref_to_node[str(nin.temp_id)] = nd

    # Remover nós excluídos
    for old_id, old_nd in list(existing_nodes.items()):
        if old_id not in kept_node_ids:
            db.delete(old_nd)
    db.flush()

    # Sincronizar links (preservando IDs existentes para manter histórico WeathermapSample)
    existing_links: Dict[int, WeathermapLink] = {l.id: l for l in m.links}
    kept_link_ids = set()

    for lin in req.links:
        na = (
            existing_nodes.get(lin.node_a_id)
            if (lin.node_a_id and lin.node_a_id in kept_node_ids)
            else ref_to_node.get(str(lin.node_a_ref or lin.node_a_id or ""))
        )
        nb = (
            existing_nodes.get(lin.node_b_id)
            if (lin.node_b_id and lin.node_b_id in kept_node_ids)
            else ref_to_node.get(str(lin.node_b_ref or lin.node_b_id or ""))
        )
        if not na or not nb or na.map_id != m.id or nb.map_id != m.id:
            raise HTTPException(
                status_code=400,
                detail=f"Link inválido: nós de origem/destino não pertencem ao mapa {m.id}.",
            )

        if lin.id and lin.id in existing_links:
            lnk = existing_links[lin.id]
            lnk.node_a_id = na.id
            lnk.node_b_id = nb.id
            lnk.label = lin.label or f"{na.label}-{nb.label}"
            lnk.zabbix_host = lin.zabbix_host
            lnk.itemid_in = lin.itemid_in or None
            lnk.itemid_out = lin.itemid_out or None
            lnk.itemid_status = lin.itemid_status or None
            lnk.capacity_bps = max(1, int(lin.capacity_bps or 1_000_000_000))
            lnk.via_points = lin.via_points or []
            lnk.offset_a = lin.offset_a or None
            lnk.offset_b = lin.offset_b or None
            lnk.width = lin.width
            lnk.label_pos_pct = max(10, min(90, int(lin.label_pos_pct if lin.label_pos_pct is not None else 50)))
            kept_link_ids.add(lnk.id)
        else:
            lnk = WeathermapLink(
                map_id=m.id,
                node_a_id=na.id,
                node_b_id=nb.id,
                label=lin.label or f"{na.label}-{nb.label}",
                zabbix_host=lin.zabbix_host,
                itemid_in=lin.itemid_in or None,
                itemid_out=lin.itemid_out or None,
                itemid_status=lin.itemid_status or None,
                capacity_bps=max(1, int(lin.capacity_bps or 1_000_000_000)),
                via_points=lin.via_points or [],
                offset_a=lin.offset_a or None,
                offset_b=lin.offset_b or None,
                width=lin.width,
                label_pos_pct=max(10, min(90, int(lin.label_pos_pct if lin.label_pos_pct is not None else 50))),
            )
            db.add(lnk)
            db.flush()
            kept_link_ids.add(lnk.id)

    for old_lid, old_lnk in list(existing_links.items()):
        if old_lid not in kept_link_ids:
            db.delete(old_lnk)

    db.commit()
    db.refresh(m)

    try:
        await render_and_publish_single_map(db, m, render_dir=DEFAULT_RENDER_DIR)
        active_maps = db.query(WeathermapMap).filter(WeathermapMap.is_active == True).all()
        reconcile_render_dir(DEFAULT_RENDER_DIR, active_maps)
    except Exception as exc:
        logger.warning("Aviso ao republicar mapa %s após salvar: %s", m.id, exc)

    return _build_map_full(db, m)


@router.delete("/maps/{map_id}")
def delete_map(
    map_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_require_admin),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")
    db.delete(m)
    db.commit()

    active_maps = db.query(WeathermapMap).filter(WeathermapMap.is_active == True).all()
    reconcile_render_dir(DEFAULT_RENDER_DIR, active_maps)
    return {"status": "deleted", "id": map_id}


@router.post("/maps/{map_id}/rotate-token", response_model=WeathermapMapSummary)
async def rotate_map_token(
    map_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_require_admin),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")

    m.public_token = secrets.token_urlsafe(24)
    db.commit()
    db.refresh(m)

    try:
        await render_and_publish_single_map(db, m, render_dir=DEFAULT_RENDER_DIR)
        active_maps = db.query(WeathermapMap).filter(WeathermapMap.is_active == True).all()
        reconcile_render_dir(DEFAULT_RENDER_DIR, active_maps)
    except Exception as exc:
        logger.warning("Aviso ao republicar mapa após rotação de token: %s", exc)

    return _build_map_summary(m)


@router.post("/maps/{map_id}/refresh", response_model=WeathermapMapSummary)
async def refresh_map_now(
    map_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")

    await render_and_publish_single_map(db, m, render_dir=DEFAULT_RENDER_DIR)
    db.refresh(m)
    return _build_map_summary(m)


@router.get("/maps/{map_id}/render.svg")
def render_interactive_svg(
    map_id: int,
    theme: Optional[str] = Query(None, description="Override opcional de tema: light | dark"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")

    states = _latest_link_states_from_db(db, m.links)
    orig_theme = m.theme
    try:
        if theme in ("light", "dark"):
            m.theme = theme
        svg_str = render_svg(
            m,
            m.nodes,
            m.links,
            states,
            node_severities={},
            interactive=True,
            rendered_at=m.last_render_at,
        )
    finally:
        m.theme = orig_theme

    return Response(content=svg_str, media_type="image/svg+xml")


@router.get("/maps/{map_id}/state")
def get_map_state(
    map_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = db.query(WeathermapMap).filter(WeathermapMap.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapa não encontrado.")

    states = _latest_link_states_from_db(db, m.links)
    links_payload = {}
    for lnk in m.links:
        st = states.get(lnk.id)
        links_payload[str(lnk.id)] = {
            "id": lnk.id,
            "label": lnk.label,
            "capacity_bps": lnk.capacity_bps,
            "in_bps": st.in_bps if st else None,
            "out_bps": st.out_bps if st else None,
            "pct": round(st.pct, 2) if (st and st.pct is not None) else None,
            "status": st.status if st else "no_data",
            "ts": st.ts.isoformat() if (st and st.ts) else None,
        }

    nodes_payload = {
        str(n.id): {
            "id": n.id,
            "key": n.key,
            "label": n.label,
            "asset_id": n.asset_id,
        }
        for n in m.nodes
    }

    return {
        "map_id": m.id,
        "last_render_at": m.last_render_at.isoformat() if m.last_render_at else None,
        "links": links_payload,
        "nodes": nodes_payload,
    }


def _percentile(sorted_vals: List[float], p: float) -> Optional[float]:
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, max(0, int(round((p / 100.0) * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


@router.get("/links/{link_id}/history")
async def get_link_history(
    link_id: int,
    hours: int = Query(24, ge=1, le=720),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lnk = db.query(WeathermapLink).filter(WeathermapLink.id == link_id).first()
    if not lnk:
        raise HTTPException(status_code=404, detail="Link não encontrado.")

    # Para 24h: 48 amostras em intervalos de 30 minutos (1800s)
    num_buckets = 48
    bucket_sec = max(60, int((hours * 3600) // num_buckets))
    now_ts = int(datetime.now(timezone.utc).timestamp())
    current_slot = (now_ts // bucket_sec) * bucket_sec
    slot_clocks = [current_slot - (num_buckets - 1 - i) * bucket_sec for i in range(num_buckets)]
    cutoff_ts = slot_clocks[0]
    cutoff_dt = datetime.fromtimestamp(cutoff_ts, tz=timezone.utc)

    buckets: Dict[int, Dict[str, List[float]]] = {
        clk: {"in_vals": [], "out_vals": []} for clk in slot_clocks
    }

    samples = (
        db.query(WeathermapSample)
        .filter(WeathermapSample.link_id == link_id, WeathermapSample.ts >= cutoff_dt)
        .order_by(WeathermapSample.ts.asc())
        .all()
    )

    earliest_local_ts: Optional[int] = None
    for s in samples:
        s_ts = int(s.ts.timestamp())
        if earliest_local_ts is None or s_ts < earliest_local_ts:
            earliest_local_ts = s_ts
        b_clk = (s_ts // bucket_sec) * bucket_sec
        if b_clk not in buckets:
            b_clk = min(slot_clocks, key=lambda c: abs(c - s_ts))
        if s.in_bps is not None:
            buckets[b_clk]["in_vals"].append(float(s.in_bps))
        if s.out_bps is not None:
            buckets[b_clk]["out_vals"].append(float(s.out_bps))

    # Complementar janela de 24h no Zabbix caso o banco local ainda não cubra as 24h completas
    need_zabbix_backfill = (
        earliest_local_ts is None or (earliest_local_ts - cutoff_ts) > bucket_sec * 2
    )
    if need_zabbix_backfill and (lnk.itemid_in or lnk.itemid_out):
        try:
            url, token = await _get_zabbix_credentials(db)
            iids = [str(i) for i in (lnk.itemid_in, lnk.itemid_out) if i and str(i) != "0"]
            if iids:
                t_till = earliest_local_ts if earliest_local_ts is not None else now_ts
                raw_hist = await ZabbixService.call_api(
                    url,
                    "history.get",
                    {
                        "itemids": iids,
                        "history": 3,
                        "time_from": cutoff_ts,
                        "time_till": t_till,
                        "sortfield": "clock",
                        "sortorder": "ASC",
                        "limit": 3500,
                    },
                    auth=token,
                )
                if not isinstance(raw_hist, list) or not raw_hist:
                    raw_hist = await ZabbixService.call_api(
                        url,
                        "trend.get",
                        {
                            "itemids": iids,
                            "time_from": cutoff_ts,
                            "time_till": t_till,
                            "output": ["itemid", "clock", "value_avg"],
                        },
                        auth=token,
                    )
                if isinstance(raw_hist, list):
                    for h in raw_hist:
                        clk = int(h.get("clock") or 0)
                        raw_v = h.get("value") if "value" in h else h.get("value_avg")
                        if raw_v is None:
                            continue
                        val = float(raw_v)
                        b_clk = (clk // bucket_sec) * bucket_sec
                        if b_clk not in buckets:
                            b_clk = min(slot_clocks, key=lambda c: abs(c - clk))
                        if str(h.get("itemid")) == str(lnk.itemid_in):
                            buckets[b_clk]["in_vals"].append(val)
                        elif str(h.get("itemid")) == str(lnk.itemid_out):
                            buckets[b_clk]["out_vals"].append(val)
        except Exception as exc:
            logger.debug("Fallback history.get/trend.get para link %s falhou: %s", link_id, exc)

    has_any_data = any(b["in_vals"] or b["out_vals"] for b in buckets.values())
    points: List[Dict[str, Any]] = []
    if has_any_data:
        for clk in slot_clocks:
            b = buckets[clk]
            avg_in = (sum(b["in_vals"]) / len(b["in_vals"])) if b["in_vals"] else None
            avg_out = (sum(b["out_vals"]) / len(b["out_vals"])) if b["out_vals"] else None
            points.append(
                {
                    "ts": datetime.fromtimestamp(clk, tz=timezone.utc).isoformat(),
                    "in_bps": round(avg_in, 2) if avg_in is not None else None,
                    "out_bps": round(avg_out, 2) if avg_out is not None else None,
                    "status": "ok" if (avg_in is not None or avg_out is not None) else "no_data",
                }
            )

    in_vals = sorted(float(p["in_bps"]) for p in points if p.get("in_bps") is not None)
    out_vals = sorted(float(p["out_bps"]) for p in points if p.get("out_bps") is not None)

    return {
        "link_id": lnk.id,
        "label": lnk.label,
        "capacity_bps": lnk.capacity_bps,
        "hours": hours,
        "sample_count": len(points),
        "interval_minutes": bucket_sec // 60,
        "stats": {
            "peak_in_bps": in_vals[-1] if in_vals else None,
            "peak_out_bps": out_vals[-1] if out_vals else None,
            "p95_in_bps": _percentile(in_vals, 95.0),
            "p95_out_bps": _percentile(out_vals, 95.0),
        },
        "points": points,
    }


@router.get("/zabbix/hosts")
async def list_zabbix_hosts_for_editor(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    url, token = await _get_zabbix_credentials(db)
    params: Dict[str, Any] = {
        "output": ["hostid", "host", "name", "status"],
        "filter": {"status": "0"},
    }
    if search and search.strip():
        params["search"] = {"host": search.strip(), "name": search.strip()}
        params["searchByAny"] = True

    raw_hosts = await ZabbixService.call_api(url, "host.get", params, auth=token)
    if not isinstance(raw_hosts, list):
        return []

    az_rows = db.query(AssetZabbix).all()
    az_by_hostid: Dict[str, AssetZabbix] = {str(az.hostid): az for az in az_rows if az.hostid}

    result = []
    for h in raw_hosts:
        hid = str(h.get("hostid"))
        az = az_by_hostid.get(hid)
        asset = az.asset if az else None
        result.append(
            {
                "hostid": hid,
                "host": h.get("host"),
                "name": h.get("name"),
                "asset_id": asset.id if asset else None,
                "client_group": asset.client_group if asset else None,
            }
        )

    result.sort(key=lambda x: (0 if x["asset_id"] else 1, (x["name"] or x["host"] or "").lower()))
    return result


def _extract_ifname(key_: str, name: str) -> Optional[str]:
    # 1. Padrão Interface <ifname>: Bits received / Bits Recebidos / Bits sent / Bits Enviados / Speed / Status
    m = re.match(
        r"^Interface\s+(.+?):\s+(Bits received|Bits Recebidos|Bits sent|Bits Enviados|Inbound|Outbound|Operational status|Status|Speed|Velocidade|Incoming|Outgoing)",
        name,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip()

    # 2. Padrão net.if.in[ifHCInOctets.<idx>] ou net.if.in["ether1"]
    m2 = re.match(
        r"^(?:net\.if\.(?:in|out|status|speed)|if(?:HC)?(?:In|Out)Octets|ifOperStatus|ifHighSpeed)\[([^\]]+)\]",
        key_,
    )
    if m2:
        raw_inside = m2.group(1).strip().strip('"').strip("'")
        raw_inside = re.sub(r"^(?:if(?:HC)?(?:In|Out)Octets|ifOperStatus|ifHighSpeed|ifSpeed)\.", "ifIndex.", raw_inside)
        return raw_inside
    return None


@router.get("/zabbix/hosts/{hostid}/interfaces")
async def list_zabbix_host_interfaces(
    hostid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    url, token = await _get_zabbix_credentials(db)
    raw_items = await ZabbixService.call_api(
        url,
        "item.get",
        {
            "hostids": [str(hostid)],
            "output": ["itemid", "name", "key_", "lastvalue", "units", "status", "state"],
            "filter": {"status": "0"},
        },
        auth=token,
    )
    if not isinstance(raw_items, list):
        return []

    ifaces: Dict[str, Dict[str, Any]] = {}
    for it in raw_items:
        iid = str(it.get("itemid"))
        name = (it.get("name") or "").strip()
        key_ = (it.get("key_") or "").strip()
        low_name = name.lower()
        low_key = key_.lower()

        ifname = _extract_ifname(key_, name)
        if not ifname:
            continue

        entry = ifaces.setdefault(
            ifname,
            {
                "ifname": ifname,
                "itemid_in": None,
                "itemid_out": None,
                "itemid_status": None,
                "speed_bps": None,
                "in_bps": None,
                "out_bps": None,
            },
        )

        raw_val = it.get("lastvalue")
        try:
            fval = float(raw_val) if raw_val is not None and raw_val != "" else None
        except (ValueError, TypeError):
            fval = None

        if (
            "bits received" in low_name
            or "bits recebidos" in low_name
            or "incoming" in low_name
            or low_key.startswith("net.if.in")
            or "ifhcin" in low_key
            or "ifin" in low_key
        ):
            entry["itemid_in"] = iid
            entry["in_bps"] = fval
        elif (
            "bits sent" in low_name
            or "bits enviados" in low_name
            or "outgoing" in low_name
            or low_key.startswith("net.if.out")
            or "ifhcout" in low_key
            or "ifout" in low_key
        ):
            entry["itemid_out"] = iid
            entry["out_bps"] = fval
        elif (
            "operational status" in low_name
            or low_name.endswith(": status")
            or low_key.startswith("net.if.status")
            or "ifoperstatus" in low_key
        ):
            entry["itemid_status"] = iid
        elif (
            low_name.endswith(": speed")
            or low_name.endswith(": velocidade")
            or low_key.startswith("net.if.speed")
            or "ifhighspeed" in low_key
        ):
            if fval and fval > 0:
                entry["speed_bps"] = int(fval) if fval >= 1_000_000 else int(fval * 1_000_000)

    out_list = [
        v for v in ifaces.values() if v["itemid_in"] or v["itemid_out"]
    ]
    out_list.sort(
        key=lambda x: (
            -max(x.get("in_bps") or 0.0, x.get("out_bps") or 0.0),
            x["ifname"].lower(),
        )
    )
    return out_list


@router.get("/zabbix/maps")
async def list_zabbix_sysmaps(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    url, token = await _get_zabbix_credentials(db)
    raw = await ZabbixService.call_api(
        url,
        "map.get",
        {"output": ["sysmapid", "name", "width", "height"]},
        auth=token,
    )
    if not isinstance(raw, list):
        return []
    return sorted(raw, key=lambda m: (m.get("name") or "").lower())


@router.post("/import/legacy", response_model=List[WeathermapMapSummary])
async def import_legacy_configs_endpoint(
    req: LegacyConfImportRequest,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_require_admin),
):
    imported: List[WeathermapMapSummary] = []
    for fitem in req.files:
        base = os.path.splitext(os.path.basename(fitem.filename))[0].strip()
        if not base:
            continue
        wm_map = import_legacy_conf_to_db(db, fitem.content, legacy_name=base)
        try:
            await render_and_publish_single_map(db, wm_map, render_dir=DEFAULT_RENDER_DIR)
        except Exception as exc:
            logger.warning("Aviso ao renderizar mapa importado %s: %s", wm_map.name, exc)
        imported.append(_build_map_summary(wm_map))
    return imported


@router.post("/import/zabbix/{sysmapid}", response_model=WeathermapMapFull)
async def import_zabbix_sysmap_endpoint(
    sysmapid: str,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_require_admin),
):
    try:
        wm_map = await import_zabbix_sysmap(db, sysmapid)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao importar sysmap do Zabbix: {exc}")

    try:
        await render_and_publish_single_map(db, wm_map, render_dir=DEFAULT_RENDER_DIR)
    except Exception as exc:
        logger.warning("Aviso ao renderizar sysmap importado %s: %s", wm_map.name, exc)

    return _build_map_full(db, wm_map)
