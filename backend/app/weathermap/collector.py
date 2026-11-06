import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional, List, Set
from sqlalchemy.orm import Session

from app.models.asset import AssetZabbix
from app.models.integration import IntegrationConfig
from app.models.weathermap import WeathermapMap, WeathermapLink, WeathermapNode
from app.services.zabbix import ZabbixService

logger = logging.getLogger(__name__)

STALE_SECONDS = 15 * 60


@dataclass
class LinkState:
    in_bps: Optional[float]
    out_bps: Optional[float]
    pct: Optional[float]
    status: str  # 'ok' | 'no_data' | 'stale' | 'down'
    ts: datetime


@dataclass
class CollectionResult:
    link_states: Dict[int, LinkState]
    node_severities: Dict[int, int]
    collected_at: datetime


def _normalize_bps(item: Optional[ dict ]) -> tuple[Optional[float], int]:
    """Extrai (valor_em_bps, lastclock) de um item retornado pelo Zabbix."""
    if not item:
        return None, 0
    if str(item.get("status", "0")) != "0" or str(item.get("state", "0")) == "1":
        return None, 0
    raw_clock = int(item.get("lastclock") or 0)
    if raw_clock <= 0:
        return None, 0
    raw_val = item.get("lastvalue")
    if raw_val is None or raw_val == "":
        return None, 0
    try:
        val = float(raw_val)
    except (ValueError, TypeError):
        return None, 0

    units = (item.get("units") or "").strip()
    if units in ("B", "Bps", "B/s", "Bytes", "bytes/s"):
        val *= 8.0
    return max(0.0, val), raw_clock


async def _get_zabbix_credentials(db: Session) -> tuple[str, str]:
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
    if not cfg or not cfg.url:
        raise RuntimeError("Configuração do Zabbix não encontrada em IntegrationConfig.")
    token = (cfg.token or "").strip()
    if not token and cfg.username and cfg.password:
        token = await ZabbixService.authenticate_user(cfg.url, cfg.username, cfg.password)
    if not token:
        raise RuntimeError("Token/credenciais do Zabbix ausentes em IntegrationConfig.")
    return cfg.url, token


async def collect_weathermap_state(
    db: Session,
    map_id: Optional[int] = None,
) -> CollectionResult:
    """Coleta em lote (item.get + trigger.get) o estado atual dos links e severidade dos nós."""
    now = datetime.now(timezone.utc)
    now_epoch = int(now.timestamp())

    q = db.query(WeathermapMap).filter(WeathermapMap.is_active == True)
    if map_id is not None:
        q = q.filter(WeathermapMap.id == map_id)
    maps: List[WeathermapMap] = q.all()

    all_links: List[WeathermapLink] = []
    all_nodes: List[WeathermapNode] = []
    for m in maps:
        all_links.extend(m.links)
        all_nodes.extend(m.nodes)

    itemids: Set[str] = set()
    for lnk in all_links:
        for iid in (lnk.itemid_in, lnk.itemid_out, lnk.itemid_status):
            if iid and str(iid).strip() and str(iid).strip() != "0":
                itemids.add(str(iid).strip())

    url, token = await _get_zabbix_credentials(db)

    items_by_id: Dict[str, dict] = {}
    itemid_list = sorted(itemids)
    batch_size = 500
    for i in range(0, len(itemid_list), batch_size):
        chunk = itemid_list[i : i + batch_size]
        raw_items = await ZabbixService.call_api(
            url,
            "item.get",
            {
                "itemids": chunk,
                "output": ["itemid", "hostid", "key_", "lastvalue", "lastclock", "units", "state", "status"],
            },
            auth=token,
        )
        if isinstance(raw_items, list):
            for it in raw_items:
                items_by_id[str(it.get("itemid"))] = it

    link_states: Dict[int, LinkState] = {}
    for lnk in all_links:
        it_in = items_by_id.get(str(lnk.itemid_in)) if lnk.itemid_in else None
        it_out = items_by_id.get(str(lnk.itemid_out)) if lnk.itemid_out else None
        it_st = items_by_id.get(str(lnk.itemid_status)) if lnk.itemid_status else None

        in_bps, clk_in = _normalize_bps(it_in)
        out_bps, clk_out = _normalize_bps(it_out)
        max_clk = max(clk_in, clk_out)

        is_down = False
        if it_st and str(it_st.get("lastclock") or "0") != "0":
            try:
                if int(float(it_st.get("lastvalue") or 1)) == 2:
                    is_down = True
            except (ValueError, TypeError):
                pass

        if is_down:
            status = "down"
            pct = 0.0
        elif in_bps is None and out_bps is None:
            status = "no_data"
            pct = None
        else:
            status = "stale" if (max_clk > 0 and (now_epoch - max_clk) > STALE_SECONDS) else "ok"
            cap = max(1, int(lnk.capacity_bps or 1_000_000_000))
            peak = max(in_bps or 0.0, out_bps or 0.0)
            pct = (peak / cap) * 100.0

        sample_ts = datetime.fromtimestamp(max_clk, tz=timezone.utc) if max_clk > 0 else now
        link_states[lnk.id] = LinkState(
            in_bps=in_bps,
            out_bps=out_bps,
            pct=pct,
            status=status,
            ts=sample_ts,
        )

    # Coleta de severidade de alarmes ativos por hostid para os nós
    asset_ids = {nd.asset_id for nd in all_nodes if nd.asset_id and not nd.zabbix_hostid}
    asset_hostid_map: Dict[int, str] = {}
    if asset_ids:
        rows = (
            db.query(AssetZabbix.asset_id, AssetZabbix.hostid)
            .filter(AssetZabbix.asset_id.in_(asset_ids), AssetZabbix.hostid.isnot(None))
            .all()
        )
        asset_hostid_map = {aid: str(hid) for aid, hid in rows if hid}

    hostid_to_nodes: Dict[str, List[int]] = {}
    for nd in all_nodes:
        hid = nd.zabbix_hostid or (asset_hostid_map.get(nd.asset_id) if nd.asset_id else None)
        if hid:
            hostid_to_nodes.setdefault(str(hid), []).append(nd.id)

    node_severities: Dict[int, int] = {nd.id: 0 for nd in all_nodes}
    if hostid_to_nodes:
        try:
            raw_triggers = await ZabbixService.call_api(
                url,
                "trigger.get",
                {
                    "hostids": list(hostid_to_nodes.keys()),
                    "only_true": True,
                    "monitored": True,
                    "active": True,
                    "skipDependent": True,
                    "filter": {"value": 1},
                    "output": ["triggerid", "priority"],
                    "selectHosts": ["hostid"],
                },
                auth=token,
            )
            if isinstance(raw_triggers, list):
                for trig in raw_triggers:
                    prio = int(trig.get("priority") or 0)
                    for h in trig.get("hosts") or []:
                        hid = str(h.get("hostid") or "")
                        for nid in hostid_to_nodes.get(hid, []):
                            if prio > node_severities.get(nid, 0):
                                node_severities[nid] = prio
        except Exception as exc:
            logger.warning("Falha ao consultar triggers ativos para nós do Weathermap: %s", exc)

    return CollectionResult(
        link_states=link_states,
        node_severities=node_severities,
        collected_at=now,
    )
