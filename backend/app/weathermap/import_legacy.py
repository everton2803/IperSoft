import os
import re
import sys
import secrets
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine, Base
from app.models.asset import Asset
from app.models.weathermap import WeathermapMap, WeathermapNode, WeathermapLink
from app.weathermap.scale import DEFAULT_SCALE, parse_bandwidth

logger = logging.getLogger(__name__)


@dataclass
class ParsedLegacyNode:
    key: str
    label: str
    x: int
    y: int
    icon: str = "router"
    label_pos: str = "S"


@dataclass
class ParsedLegacyLink:
    key: str
    node_a_key: str
    node_b_key: str
    offset_a: Optional[str] = None
    offset_b: Optional[str] = None
    zabbix_host: Optional[str] = None
    itemid_in: Optional[str] = None
    itemid_out: Optional[str] = None
    capacity_bps: int = 10_000_000_000
    via_points: List[List[int]] = field(default_factory=list)
    width: Optional[int] = None


@dataclass
class ParsedLegacyMap:
    legacy_name: str
    title: str
    width: int = 1500
    height: int = 1000
    nodes: List[ParsedLegacyNode] = field(default_factory=list)
    links: List[ParsedLegacyLink] = field(default_factory=list)


def _infer_icon(icon_path: Optional[str]) -> str:
    if not icon_path:
        return "router"
    s = icon_path.lower()
    if "cloud" in s:
        return "cloud"
    if "switch-l3" in s:
        return "switch_l3"
    if "switch" in s:
        return "switch"
    if "volt" in s:
        return "ups"
    if "olt" in s:
        return "olt"
    if "storage" in s or "database" in s:
        return "storage"
    if "server" in s:
        return "server"
    if "radio" in s:
        return "radio"
    if "house" in s:
        return "pop"
    return "router"


def _split_node_ref(token: str) -> Tuple[str, Optional[str]]:
    """Separa 'node_key:n40' em ('node_key', 'N40')."""
    m = re.match(r"^(.+?):((?:NE|SE|NW|SW|N|S|E|W|C)\d*)$", token.strip(), re.IGNORECASE)
    if m:
        return m.group(1), m.group(2).upper()
    return token.strip(), None


def parse_legacy_conf_text(content: str, legacy_name: str) -> ParsedLegacyMap:
    """
    Faz o parse de um arquivo .conf do PHP Weathermap sem ler linhas SET (segredos).
    Aplica padrões de NODE DEFAULT e LINK DEFAULT aos blocos subsequentes.
    """
    parsed = ParsedLegacyMap(legacy_name=legacy_name, title=legacy_name)

    default_label_pos = "S"
    default_bw_bps = 10_000_000_000

    current_type: Optional[str] = None  # 'NODE' | 'LINK' | 'NODE_DEFAULT' | 'LINK_DEFAULT'
    cur_node: Optional[ParsedLegacyNode] = None
    cur_link: Optional[ParsedLegacyLink] = None

    def flush_current():
        nonlocal cur_node, cur_link
        if cur_node is not None:
            parsed.nodes.append(cur_node)
            cur_node = None
        if cur_link is not None:
            if cur_link.node_a_key and cur_link.node_b_key:
                parsed.links.append(cur_link)
            cur_link = None

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split(None, 1)
        cmd = parts[0].upper()
        arg = parts[1].strip() if len(parts) > 1 else ""

        # Ignorar estritamente linhas SET (podem conter senhas/tokens legados)
        if cmd == "SET":
            continue

        if cmd == "WIDTH" and current_type is None:
            try:
                parsed.width = int(float(arg))
            except ValueError:
                pass
            continue

        if cmd == "HEIGHT" and current_type is None:
            try:
                parsed.height = int(float(arg))
            except ValueError:
                pass
            continue

        if cmd == "TITLE" and current_type is None:
            if arg:
                parsed.title = arg
            continue

        if cmd == "NODE":
            flush_current()
            if arg.upper() == "DEFAULT":
                current_type = "NODE_DEFAULT"
            else:
                current_type = "NODE"
                cur_node = ParsedLegacyNode(
                    key=arg,
                    label=arg,
                    x=0,
                    y=0,
                    icon="router",
                    label_pos=default_label_pos,
                )
            continue

        if cmd == "LINK":
            flush_current()
            if arg.upper() == "DEFAULT":
                current_type = "LINK_DEFAULT"
            else:
                current_type = "LINK"
                cur_link = ParsedLegacyLink(
                    key=arg,
                    node_a_key="",
                    node_b_key="",
                    capacity_bps=default_bw_bps,
                )
            continue

        # Atributos dentro de NODE DEFAULT / NODE
        if current_type == "NODE_DEFAULT":
            if cmd == "LABELOFFSET" and arg:
                default_label_pos = arg.upper()
        elif current_type == "NODE" and cur_node is not None:
            if cmd == "LABEL" and arg:
                cur_node.label = arg
            elif cmd == "LABELOFFSET" and arg:
                cur_node.label_pos = arg.upper()
            elif cmd == "ICON" and arg:
                cur_node.icon = _infer_icon(arg)
            elif cmd == "POSITION" and arg:
                coords = arg.split()
                if len(coords) >= 2:
                    try:
                        cur_node.x = int(float(coords[0]))
                        cur_node.y = int(float(coords[1]))
                    except ValueError:
                        pass

        # Atributos dentro de LINK DEFAULT / LINK
        elif current_type == "LINK_DEFAULT":
            if cmd == "BANDWIDTH" and arg:
                default_bw_bps = parse_bandwidth(arg, default_bw_bps)
        elif current_type == "LINK" and cur_link is not None:
            if cmd == "NODES" and arg:
                tokens = arg.split()
                if len(tokens) >= 2:
                    na, off_a = _split_node_ref(tokens[0])
                    nb, off_b = _split_node_ref(tokens[1])
                    cur_link.node_a_key = na
                    cur_link.node_b_key = nb
                    cur_link.offset_a = off_a
                    cur_link.offset_b = off_b
            elif cmd == "BANDWIDTH" and arg:
                cur_link.capacity_bps = parse_bandwidth(arg, default_bw_bps)
            elif cmd == "TARGET" and arg:
                # Formato esperado: zabbix:itemid:<host>:<itemid_in>:<itemid_out>
                m = re.match(r"^zabbix:itemid:([^:]+):([^:]+):([^:\s]+)", arg.strip(), re.IGNORECASE)
                if m:
                    host, i_in, i_out = m.group(1), m.group(2), m.group(3)
                    cur_link.zabbix_host = host
                    cur_link.itemid_in = None if i_in == "0" else i_in
                    cur_link.itemid_out = None if i_out == "0" else i_out
            elif cmd == "VIA" and arg:
                vparts = arg.split()
                if len(vparts) >= 2:
                    try:
                        cur_link.via_points.append([int(float(vparts[0])), int(float(vparts[1]))])
                    except ValueError:
                        pass

    flush_current()
    return parsed


def _norm_slug(s: str) -> str:
    return re.sub(r"[\s_]+", "-", s.strip().lower())


def _token_set(s: str) -> set[str]:
    return {t for t in re.split(r"[\s_\-:./]+", s.strip().lower()) if t}


def import_legacy_conf_to_db(db: Session, content: str, legacy_name: str) -> WeathermapMap:
    """Importa/atualiza de forma idempotente um mapa .conf legado no banco de dados."""
    parsed = parse_legacy_conf_text(content, legacy_name=legacy_name)

    # Indexar Assets existentes por hostname, name e zabbix.host (case-insensitive + slug)
    all_assets: List[Asset] = db.query(Asset).all()
    asset_lookup: Dict[str, Asset] = {}
    group_assets: List[Tuple[set[str], Asset]] = []
    inferred_group: Optional[str] = None

    for a in all_assets:
        if a.client_group and a.client_group.strip().lower() == legacy_name.lower():
            inferred_group = a.client_group.strip().lower()
        for candidate in (
            a.hostname,
            a.name,
            a.zabbix.host if a.zabbix else None,
            a.zabbix.name if a.zabbix else None,
        ):
            if candidate:
                c_low = candidate.strip().lower()
                asset_lookup[c_low] = a
                asset_lookup[_norm_slug(c_low)] = a
        if a.client_group and a.client_group.strip().lower() == legacy_name.lower():
            toks = _token_set(a.hostname or "") | _token_set(a.name or "")
            group_assets.append((toks, a))

    def match_asset_for_node(key: str, label: str) -> Optional[Asset]:
        for cand in (
            key,
            label,
            f"{legacy_name}-{key}",
            f"{legacy_name}-{label}",
        ):
            c_low = cand.strip().lower()
            if c_low in asset_lookup:
                return asset_lookup[c_low]
            slug = _norm_slug(c_low)
            if slug in asset_lookup:
                return asset_lookup[slug]

        # Fallback por subconjunto de tokens dentro do mesmo client_group (ex: atm-router-bgp -> atm_router_mk_bgp)
        node_toks = _token_set(f"{legacy_name}-{key}")
        if len(node_toks) >= 3 and group_assets:
            best: Optional[Asset] = None
            best_len = 999
            for atoks, a in group_assets:
                if node_toks.issubset(atoks) and len(atoks) < best_len:
                    best = a
                    best_len = len(atoks)
            if best is not None:
                return best
        return None

    wm_map = db.query(WeathermapMap).filter(WeathermapMap.legacy_name == legacy_name).first()
    if not wm_map:
        wm_map = WeathermapMap(
            name=parsed.title,
            legacy_name=legacy_name,
            width=parsed.width,
            height=parsed.height,
            theme="light",
            scale=DEFAULT_SCALE,
            public_token=secrets.token_urlsafe(24),
            legacy_enabled=False,
            source="legacy_conf",
            is_active=True,
        )
        db.add(wm_map)
        db.flush()
    else:
        wm_map.name = parsed.title
        wm_map.width = parsed.width
        wm_map.height = parsed.height
        wm_map.source = "legacy_conf"
        db.query(WeathermapLink).filter(WeathermapLink.map_id == wm_map.id).delete()
        db.query(WeathermapNode).filter(WeathermapNode.map_id == wm_map.id).delete()
        db.flush()

    node_by_key: Dict[str, WeathermapNode] = {}
    group_counts: Dict[str, int] = {}

    for pnode in parsed.nodes:
        matched_asset = match_asset_for_node(pnode.key, pnode.label)
        asset_id = matched_asset.id if matched_asset else None
        zbx_hostid = (
            matched_asset.zabbix.hostid
            if (matched_asset and matched_asset.zabbix and matched_asset.zabbix.hostid)
            else None
        )
        if matched_asset and matched_asset.client_group:
            grp = matched_asset.client_group.strip().lower()
            group_counts[grp] = group_counts.get(grp, 0) + 1

        nd = WeathermapNode(
            map_id=wm_map.id,
            asset_id=asset_id,
            key=pnode.key,
            label=pnode.label,
            x=pnode.x,
            y=pnode.y,
            icon=pnode.icon,
            label_pos=pnode.label_pos,
            zabbix_hostid=zbx_hostid,
        )
        db.add(nd)
        node_by_key[pnode.key] = nd

    db.flush()

    if group_counts:
        wm_map.client_group = max(group_counts.items(), key=lambda kv: kv[1])[0]
    elif inferred_group and not wm_map.client_group:
        wm_map.client_group = inferred_group

    for plink in parsed.links:
        na = node_by_key.get(plink.node_a_key)
        nb = node_by_key.get(plink.node_b_key)
        if not na or not nb:
            logger.warning(
                "Mapa %s: ignorando link %s (nós %s -> %s não encontrados)",
                legacy_name,
                plink.key,
                plink.node_a_key,
                plink.node_b_key,
            )
            continue
        lnk = WeathermapLink(
            map_id=wm_map.id,
            node_a_id=na.id,
            node_b_id=nb.id,
            label=plink.key,
            zabbix_host=plink.zabbix_host,
            itemid_in=plink.itemid_in,
            itemid_out=plink.itemid_out,
            capacity_bps=plink.capacity_bps,
            via_points=plink.via_points,
            offset_a=plink.offset_a,
            offset_b=plink.offset_b,
            width=plink.width,
        )
        db.add(lnk)

    db.commit()
    db.refresh(wm_map)
    return wm_map


def main(argv: Optional[List[str]] = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("Uso: python -m app.weathermap.import_legacy <arquivo1.conf> [arquivo2.conf ...]")
        return 1

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for path in args:
            if not os.path.isfile(path):
                print(f"[AVISO] Arquivo não encontrado: {path}")
                continue
            base = os.path.splitext(os.path.basename(path))[0]
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            wm_map = import_legacy_conf_to_db(db, content, legacy_name=base)
            matched = sum(1 for n in wm_map.nodes if n.asset_id is not None)
            print(
                f"[OK] Mapa '{wm_map.name}' (legacy={wm_map.legacy_name}, group={wm_map.client_group}): "
                f"{len(wm_map.nodes)} nós ({matched} vinculados a Assets), {len(wm_map.links)} links."
            )
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
