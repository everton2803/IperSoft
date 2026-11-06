import re
import secrets
import logging
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.weathermap import WeathermapMap, WeathermapNode, WeathermapLink
from app.services.zabbix import ZabbixService
from app.weathermap.collector import _get_zabbix_credentials
from app.weathermap.scale import DEFAULT_SCALE, parse_bandwidth

logger = logging.getLogger(__name__)


def _parse_sysmap_link_label(label: Optional[str]) -> Tuple[int, Optional[str]]:
    """Extrai (capacity_bps, offset) do label de um link de sysmap do Zabbix."""
    default_bw = 10_000_000_000
    if not label:
        return default_bw, None
    lines = [ln.strip() for ln in str(label).splitlines() if ln.strip()]
    bw = parse_bandwidth(lines[0], default_bw) if lines else default_bw
    offset = None
    if len(lines) >= 2:
        m = re.fullmatch(r":?((?:NE|SE|NW|SW|N|S|E|W|C)\d+)", lines[1], re.IGNORECASE)
        if m:
            offset = m.group(1).upper()
    return bw, offset


def _classify_in_out_items(items: List[dict]) -> Tuple[Optional[str], Optional[str]]:
    """Classifica uma lista de itens Zabbix em (itemid_in, itemid_out) pela key_ ou name."""
    item_in: Optional[str] = None
    item_out: Optional[str] = None

    for it in items:
        iid = str(it.get("itemid") or "")
        key_ = (it.get("key_") or "").lower()
        name = (it.get("name") or "").lower()
        if not iid:
            continue
        is_in = (
            "net.if.in" in key_
            or "ifhcin" in key_
            or "ifin" in key_
            or "received" in name
            or "recebidos" in name
            or "incoming" in name
            or "download" in name
        )
        is_out = (
            "net.if.out" in key_
            or "ifhcout" in key_
            or "ifout" in key_
            or "sent" in name
            or "enviados" in name
            or "outgoing" in name
            or "upload" in name
        )
        if is_in and not item_in:
            item_in = iid
        elif is_out and not item_out:
            item_out = iid

    # Fallback posicional caso as keys sejam customizadas
    if not item_in and items:
        item_in = str(items[0].get("itemid"))
    if not item_out and len(items) >= 2:
        for it in items:
            iid = str(it.get("itemid"))
            if iid != item_in:
                item_out = iid
                break
    return item_in, item_out


async def import_zabbix_sysmap(db: Session, sysmapid: str) -> WeathermapMap:
    """Importa um sysmap do Zabbix (map.get) criando ou atualizando um WeathermapMap."""
    url, token = await _get_zabbix_credentials(db)
    raw_maps = await ZabbixService.call_api(
        url,
        "map.get",
        {
            "sysmapids": [str(sysmapid)],
            "output": "extend",
            "selectSelements": "extend",
            "selectLinks": "extend",
        },
        auth=token,
    )
    if not raw_maps or not isinstance(raw_maps, list):
        raise ValueError(f"Mapa Zabbix sysmapid={sysmapid} não encontrado.")

    zmap = raw_maps[0]
    map_name = (zmap.get("name") or f"zabbix-{sysmapid}").strip()
    width = int(zmap.get("width") or 1500)
    height = int(zmap.get("height") or 1000)
    source_tag = f"zabbix:{sysmapid}"

    # Indexar Assets por zabbix.hostid e hostname
    all_assets: List[Asset] = db.query(Asset).all()
    asset_by_hostid: Dict[str, Asset] = {}
    asset_by_name: Dict[str, Asset] = {}
    for a in all_assets:
        if a.zabbix and a.zabbix.hostid:
            asset_by_hostid[str(a.zabbix.hostid)] = a
        for cand in (a.hostname, a.name, a.zabbix.host if a.zabbix else None):
            if cand:
                asset_by_name[cand.strip().lower()] = a

    selements = zmap.get("selements") or []
    links_raw = zmap.get("links") or []

    # Buscar informações de hosts referenciados que talvez não estejam no cache
    ref_hostids = set()
    for sel in selements:
        if str(sel.get("elementtype")) == "0":
            for el in sel.get("elements") or []:
                if el.get("hostid"):
                    ref_hostids.add(str(el["hostid"]))

    zbx_hosts_map: Dict[str, dict] = {}
    if ref_hostids:
        h_list = await ZabbixService.call_api(
            url,
            "host.get",
            {"hostids": list(ref_hostids), "output": ["hostid", "host", "name"]},
            auth=token,
        )
        if isinstance(h_list, list):
            for h in h_list:
                zbx_hosts_map[str(h.get("hostid"))] = h

    # Buscar triggers de todos os links
    trigger_ids = set()
    for lnk in links_raw:
        for lt in lnk.get("linktriggers") or []:
            if lt.get("triggerid"):
                trigger_ids.add(str(lt["triggerid"]))

    trig_to_itemids: Dict[str, List[str]] = {}
    trig_to_host: Dict[str, str] = {}
    all_itemids = set()
    if trigger_ids:
        t_list = await ZabbixService.call_api(
            url,
            "trigger.get",
            {
                "triggerids": list(trigger_ids),
                "output": ["triggerid", "description"],
                "selectFunctions": "extend",
                "selectHosts": ["hostid", "host"],
            },
            auth=token,
        )
        if isinstance(t_list, list):
            for t in t_list:
                tid = str(t.get("triggerid"))
                f_iids = [str(f.get("itemid")) for f in (t.get("functions") or []) if f.get("itemid")]
                trig_to_itemids[tid] = f_iids
                all_itemids.update(f_iids)
                hosts_arr = t.get("hosts") or []
                if hosts_arr and hosts_arr[0].get("host"):
                    trig_to_host[tid] = str(hosts_arr[0]["host"])

    items_by_id: Dict[str, dict] = {}
    if all_itemids:
        i_list = await ZabbixService.call_api(
            url,
            "item.get",
            {"itemids": list(all_itemids), "output": ["itemid", "hostid", "key_", "name"]},
            auth=token,
        )
        if isinstance(i_list, list):
            for it in i_list:
                items_by_id[str(it.get("itemid"))] = it

    wm_map = db.query(WeathermapMap).filter(WeathermapMap.source == source_tag).first()
    if not wm_map:
        wm_map = WeathermapMap(
            name=map_name,
            width=width,
            height=height,
            theme="light",
            scale=DEFAULT_SCALE,
            public_token=secrets.token_urlsafe(24),
            legacy_enabled=False,
            source=source_tag,
            is_active=True,
        )
        db.add(wm_map)
        db.flush()
    else:
        wm_map.name = map_name
        wm_map.width = width
        wm_map.height = height
        db.query(WeathermapLink).filter(WeathermapLink.map_id == wm_map.id).delete()
        db.query(WeathermapNode).filter(WeathermapNode.map_id == wm_map.id).delete()
        db.flush()

    selement_to_node: Dict[str, WeathermapNode] = {}
    used_keys = set()
    group_counts: Dict[str, int] = {}

    for sel in selements:
        sel_id = str(sel.get("selementid"))
        el_type = str(sel.get("elementtype"))
        raw_label = (sel.get("label") or "").strip()
        x = int(float(sel.get("x") or 0)) + 20
        y = int(float(sel.get("y") or 0)) + 20

        hostid: Optional[str] = None
        matched_asset: Optional[Asset] = None
        if el_type == "0":
            els = sel.get("elements") or []
            if els and els[0].get("hostid"):
                hostid = str(els[0]["hostid"])
                matched_asset = asset_by_hostid.get(hostid)

        zhost = zbx_hosts_map.get(hostid) if hostid else None
        host_tech = (
            (matched_asset.hostname if matched_asset else None)
            or (zhost.get("host") if zhost else None)
            or raw_label
            or f"node-{sel_id}"
        )
        host_vis = (
            (matched_asset.name if matched_asset else None)
            or (zhost.get("name") if zhost else None)
            or host_tech
        )

        label = raw_label
        if not label or "{HOST.NAME}" in label or "{HOST.HOST}" in label:
            label = host_tech
        label = label.splitlines()[0].strip() or host_vis

        if not matched_asset:
            matched_asset = asset_by_name.get(label.lower()) or asset_by_name.get(host_tech.lower())

        if matched_asset and matched_asset.client_group:
            grp = matched_asset.client_group.strip().lower()
            group_counts[grp] = group_counts.get(grp, 0) + 1

        base_key = label
        key = base_key
        seq = 1
        while key in used_keys:
            seq += 1
            key = f"{base_key}_{seq}"
        used_keys.add(key)

        icon = "cloud" if el_type == "4" else "router"
        low_lbl = key.lower()
        if "sw" in low_lbl or "switch" in low_lbl:
            icon = "switch"
        elif "olt" in low_lbl:
            icon = "olt"
        elif "srv" in low_lbl or "server" in low_lbl:
            icon = "server"

        nd = WeathermapNode(
            map_id=wm_map.id,
            asset_id=matched_asset.id if matched_asset else None,
            key=key,
            label=label,
            x=x,
            y=y,
            icon=icon,
            label_pos="S",
            zabbix_hostid=hostid or (matched_asset.zabbix.hostid if (matched_asset and matched_asset.zabbix) else None),
        )
        db.add(nd)
        selement_to_node[sel_id] = nd

    db.flush()

    if group_counts and not wm_map.client_group:
        wm_map.client_group = max(group_counts.items(), key=lambda kv: kv[1])[0]

    for lnk in links_raw:
        na = selement_to_node.get(str(lnk.get("selementid1")))
        nb = selement_to_node.get(str(lnk.get("selementid2")))
        if not na or not nb:
            continue

        bw_bps, offset = _parse_sysmap_link_label(lnk.get("label"))
        iids_ordered: List[str] = []
        z_host: Optional[str] = None
        for lt in lnk.get("linktriggers") or []:
            tid = str(lt.get("triggerid") or "")
            if tid in trig_to_host and not z_host:
                z_host = trig_to_host[tid]
            for iid in trig_to_itemids.get(tid, []):
                if iid not in iids_ordered:
                    iids_ordered.append(iid)

        resolved_items = [items_by_id[iid] for iid in iids_ordered if iid in items_by_id]
        item_in, item_out = _classify_in_out_items(resolved_items)

        db.add(
            WeathermapLink(
                map_id=wm_map.id,
                node_a_id=na.id,
                node_b_id=nb.id,
                label=f"{na.key}-{nb.key}",
                zabbix_host=z_host or na.key,
                itemid_in=item_in,
                itemid_out=item_out,
                capacity_bps=bw_bps,
                via_points=[],
                offset_a=offset,
                offset_b=offset,
            )
        )

    db.commit()
    db.refresh(wm_map)
    return wm_map
