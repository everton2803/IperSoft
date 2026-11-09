import re
import ipaddress
import logging
import urllib.parse
from datetime import datetime
from typing import Dict, Any, List, Optional, Set, Tuple

import httpx
from sqlalchemy.orm import Session

from app.models.asset import Asset, AssetOxidized
from app.models.integration import IntegrationConfig
from app.models.ip_scanner import DiscoveredVLAN
from app.services.oxidized import OxidizedService

logger = logging.getLogger("OxidizedVlanExtractor")


def _expand_vlan_spec(spec: str, max_range_span: int = 128) -> List[int]:
    """
    Expande especificações de VLAN como '10', '99,200', '1101-1108' ou '150 to 151'.
    Limita ranges gigantes (ex: 1-4094) para não poluir com todas as VLANs possíveis.
    """
    if not spec:
        return []
    s = spec.replace(" to ", "-").strip()
    result: List[int] = []
    for part in re.split(r"[,\s]+", s):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            bounds = part.split("-", 1)
            if bounds[0].isdigit() and bounds[1].isdigit():
                start, end = int(bounds[0]), int(bounds[1])
                if 1 <= start <= end <= 4094 and (end - start) <= max_range_span:
                    result.extend(range(start, end + 1))
        elif part.isdigit():
            vid = int(part)
            if 1 <= vid <= 4094:
                result.append(vid)
    return result


def _ip_mask_to_cidr(ip_str: str, mask_or_len: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Retorna (ip_with_prefix, network_cidr), ex: ('10.0.80.13/30', '10.0.80.12/30').
    Aceita '10.0.80.13/30' ou ('10.0.80.13', '255.255.255.252') ou ('10.0.80.13', '30').
    """
    try:
        if "/" in ip_str:
            iface = ipaddress.IPv4Interface(ip_str.strip())
        elif mask_or_len:
            iface = ipaddress.IPv4Interface(f"{ip_str.strip()}/{mask_or_len.strip()}")
        else:
            return None, None
        # Ignorar /32 de loopback como sub-rede de VLAN
        net_cidr = str(iface.network) if iface.network.prefixlen < 32 else None
        return str(iface), net_cidr
    except Exception:
        return None, None


def _clean_vlan_name(raw_name: str, vlan_id: int) -> str:
    """
    Limpa nomes de VLAN redundantes (ex: 'vlan100-gerencia-olt-fiber' -> 'gerencia-olt-fiber',
    ou mantém 'vlan100' caso não tenha sufixo descritivo).
    """
    name = (raw_name or "").strip().strip('"').strip("'")
    if not name:
        return f"VLAN {vlan_id}"
    # Remover prefixo 'vlan100-' ou 'vlan-100-' ou 'vlan_100_' quando houver descrição após
    m = re.match(rf"^vlan[\-_]?0*{vlan_id}[\-_\s:]+(.+)$", name, flags=re.IGNORECASE)
    if m and m.group(1).strip():
        return m.group(1).strip()
    return name


def _unfold_routeros_lines(text: str) -> List[str]:
    """Junta linhas quebradas com '\\' no final em exports do MikroTik RouterOS."""
    lines: List[str] = []
    buf = ""
    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r")
        if line.endswith("\\"):
            buf += line[:-1].rstrip() + " "
        else:
            if buf:
                lines.append(buf + line.lstrip())
                buf = ""
            else:
                lines.append(line)
    if buf:
        lines.append(buf)
    return lines


def _parse_routeros_kv(line: str) -> Dict[str, str]:
    """Extrai pares key=value ou key="value with spaces" de uma linha `add ...` do RouterOS."""
    kv: Dict[str, str] = {}
    for m in re.finditer(r'([a-zA-Z0-9\-]+)=("([^"]*)"|(\S+))', line):
        key = m.group(1).lower()
        val = m.group(3) if m.group(3) is not None else m.group(4)
        kv[key] = val
    return kv


def parse_routeros_vlans(text: str) -> Dict[int, Dict[str, Any]]:
    """
    Extrai VLANs de configurações MikroTik RouterOS:
      - /interface vlan
      - /interface bridge vlan
      - /ip address (cruzando com o nome da interface VLAN)
    """
    lines = _unfold_routeros_lines(text)
    section = ""
    vlans: Dict[int, Dict[str, Any]] = {}
    ifname_to_vid: Dict[str, int] = {}

    for raw in lines:
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("/"):
            section = s.lower()
            continue

        if section.startswith("/interface vlan") and s.startswith("add "):
            kv = _parse_routeros_kv(s)
            if kv.get("disabled", "no").lower() == "yes":
                continue
            vid_str = kv.get("vlan-id", "")
            if not vid_str.isdigit():
                continue
            vid = int(vid_str)
            if not (1 <= vid <= 4094):
                continue

            if_name = kv.get("name", f"vlan{vid}")
            parent_if = kv.get("interface", "")
            comment = kv.get("comment", "")

            ifname_to_vid[if_name] = vid
            entry = vlans.setdefault(vid, {
                "vlan_id": vid,
                "names": [],
                "interfaces": set(),
                "ips": set(),
                "subnets": set(),
            })
            if comment:
                entry["names"].append(_clean_vlan_name(comment, vid))
            if if_name:
                entry["names"].append(_clean_vlan_name(if_name, vid))
            if parent_if:
                entry["interfaces"].add(parent_if)

        elif section.startswith("/interface bridge vlan") and s.startswith("add "):
            kv = _parse_routeros_kv(s)
            if kv.get("disabled", "no").lower() == "yes":
                continue
            vids = _expand_vlan_spec(kv.get("vlan-ids", ""), max_range_span=64)
            comment = kv.get("comment", "")
            ports = [p for p in (kv.get("tagged", "") + "," + kv.get("untagged", "")).split(",") if p.strip()]
            for vid in vids:
                entry = vlans.setdefault(vid, {
                    "vlan_id": vid,
                    "names": [],
                    "interfaces": set(),
                    "ips": set(),
                    "subnets": set(),
                })
                if comment:
                    entry["names"].append(_clean_vlan_name(comment, vid))
                for p in ports[:6]:
                    entry["interfaces"].add(p.strip())

        elif section.startswith("/ip address") and s.startswith("add "):
            kv = _parse_routeros_kv(s)
            if kv.get("disabled", "no").lower() == "yes":
                continue
            addr = kv.get("address", "")
            iface = kv.get("interface", "")
            if not addr or not iface:
                continue

            vid = ifname_to_vid.get(iface)
            if not vid:
                m = re.match(r"^vlan[\-_]?(\d{1,4})\b", iface, flags=re.IGNORECASE)
                if m:
                    vid = int(m.group(1))
            if vid and 1 <= vid <= 4094:
                ip_cidr, net_cidr = _ip_mask_to_cidr(addr)
                entry = vlans.setdefault(vid, {
                    "vlan_id": vid,
                    "names": [],
                    "interfaces": set(),
                    "ips": set(),
                    "subnets": set(),
                })
                if ip_cidr:
                    entry["ips"].add(ip_cidr)
                if net_cidr:
                    entry["subnets"].add(net_cidr)

    return vlans


def parse_vrp_vlans(text: str) -> Dict[int, Dict[str, Any]]:
    """
    Extrai VLANs de configurações Huawei VRP (Switches S57xx/S67xx e roteadores NE8000):
      - Blocos `vlan <id>` (`description ...`, `name ...`)
      - Blocos `interface Vlanif<id>` (`description ...`, `ip address ...`)
      - Subinterfaces `interface <Port>.<subid>` (`dot1q termination vid <id>`, `vlan-type dot1q <id>`, `ip address ...`)
    """
    vlans: Dict[int, Dict[str, Any]] = {}
    current_vid: Optional[int] = None
    current_iface: Optional[str] = None
    iface_vid: Optional[int] = None
    iface_desc: Optional[str] = None
    iface_ips: List[Tuple[str, Optional[str]]] = []

    def _flush_iface():
        nonlocal current_iface, iface_vid, iface_desc, iface_ips
        if current_iface and iface_vid and (1 <= iface_vid <= 4094):
            entry = vlans.setdefault(iface_vid, {
                "vlan_id": iface_vid,
                "names": [],
                "interfaces": set(),
                "ips": set(),
                "subnets": set(),
            })
            base_if = current_iface.split(".")[0]
            if not base_if.lower().startswith("vlanif"):
                entry["interfaces"].add(base_if)
            else:
                entry["interfaces"].add(current_iface)
            if iface_desc:
                entry["names"].append(_clean_vlan_name(iface_desc, iface_vid))
            for ip_c, net_c in iface_ips:
                entry["ips"].add(ip_c)
                if net_c:
                    entry["subnets"].add(net_c)
        current_iface = None
        iface_vid = None
        iface_desc = None
        iface_ips = []

    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#") or s.startswith("!"):
            if s in ("#", "!"):
                _flush_iface()
                current_vid = None
            continue

        # Bloco `vlan <id>`
        m_vlan = re.match(r"^vlan\s+(\d{1,4})$", s, flags=re.IGNORECASE)
        if m_vlan:
            _flush_iface()
            vid = int(m_vlan.group(1))
            if 1 <= vid <= 4094 and vid != 1:
                current_vid = vid
                vlans.setdefault(vid, {
                    "vlan_id": vid,
                    "names": [],
                    "interfaces": set(),
                    "ips": set(),
                    "subnets": set(),
                })
            else:
                current_vid = None
            continue

        # Bloco `interface ...`
        m_if = re.match(r"^interface\s+(\S+)", s, flags=re.IGNORECASE)
        if m_if:
            _flush_iface()
            current_vid = None
            current_iface = m_if.group(1)
            m_vif = re.match(r"^Vlanif(\d{1,4})$", current_iface, flags=re.IGNORECASE)
            if m_vif:
                iface_vid = int(m_vif.group(1))
            continue

        if current_vid is not None:
            m_desc = re.match(r"^(?:description|name)\s+(.+)$", s, flags=re.IGNORECASE)
            if m_desc:
                vlans[current_vid]["names"].append(_clean_vlan_name(m_desc.group(1), current_vid))
            continue

        if current_iface is not None:
            m_desc = re.match(r"^description\s+(.+)$", s, flags=re.IGNORECASE)
            if m_desc:
                iface_desc = m_desc.group(1).strip()
                continue

            m_dot1q = re.match(
                r"^(?:dot1q\s+termination\s+vid|vlan-type\s+dot1q|qinq\s+termination\s+pe-vid)\s+(\d{1,4})\b",
                s,
                flags=re.IGNORECASE,
            )
            if m_dot1q:
                iface_vid = int(m_dot1q.group(1))
                continue

            m_ip = re.match(r"^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+|\d{1,2})\b", s, flags=re.IGNORECASE)
            if m_ip:
                ip_c, net_c = _ip_mask_to_cidr(m_ip.group(1), m_ip.group(2))
                if ip_c:
                    iface_ips.append((ip_c, net_c))

    _flush_iface()
    return vlans


def parse_datacom_vlans(text: str) -> Dict[int, Dict[str, Any]]:
    """
    Extrai VLANs de configurações Datacom DmOS (OLTs e Switches):
      - Blocos `dot1q` -> `vlan <spec>` -> `name <name>` / `interface <iface>`
      - Blocos `interface l3 <name>` -> `lower-layer-if vlan <id>` -> `ipv4 address <cidr>`
    """
    vlans: Dict[int, Dict[str, Any]] = {}
    in_dot1q = False
    current_vids: List[int] = []
    in_l3 = False
    l3_name: Optional[str] = None
    l3_vid: Optional[int] = None
    l3_desc: Optional[str] = None
    l3_ips: List[Tuple[str, Optional[str]]] = []

    def _flush_l3():
        nonlocal in_l3, l3_name, l3_vid, l3_desc, l3_ips
        if in_l3 and l3_vid and (1 <= l3_vid <= 4094):
            entry = vlans.setdefault(l3_vid, {
                "vlan_id": l3_vid,
                "names": [],
                "interfaces": set(),
                "ips": set(),
                "subnets": set(),
            })
            if l3_desc:
                entry["names"].append(_clean_vlan_name(l3_desc, l3_vid))
            elif l3_name:
                entry["names"].append(_clean_vlan_name(l3_name, l3_vid))
            if l3_name:
                entry["interfaces"].add(f"l3:{l3_name}")
            for ip_c, net_c in l3_ips:
                entry["ips"].add(ip_c)
                if net_c:
                    entry["subnets"].add(net_c)
        in_l3 = False
        l3_name = None
        l3_vid = None
        l3_desc = None
        l3_ips = []

    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue

        if s == "dot1q":
            _flush_l3()
            in_dot1q = True
            current_vids = []
            continue

        m_l3 = re.match(r"^interface\s+l3\s+(\S+)", s, flags=re.IGNORECASE)
        if m_l3:
            _flush_l3()
            in_dot1q = False
            current_vids = []
            in_l3 = True
            l3_name = m_l3.group(1)
            continue

        if in_dot1q:
            # Se encontrar outro comando raiz fora de dot1q
            if not raw.startswith(" ") and s != "!":
                in_dot1q = False
                current_vids = []
                continue

            m_v = re.match(r"^vlan\s+([0-9,\-\s]+)$", s, flags=re.IGNORECASE)
            if m_v:
                current_vids = [v for v in _expand_vlan_spec(m_v.group(1), max_range_span=64) if v != 1]
                for vid in current_vids:
                    vlans.setdefault(vid, {
                        "vlan_id": vid,
                        "names": [],
                        "interfaces": set(),
                        "ips": set(),
                        "subnets": set(),
                    })
                continue

            if current_vids:
                m_name = re.match(r"^name\s+(.+)$", s, flags=re.IGNORECASE)
                if m_name:
                    vname = m_name.group(1).strip()
                    for vid in current_vids:
                        vlans[vid]["names"].append(_clean_vlan_name(vname, vid))
                    continue

                m_if = re.match(r"^interface\s+(.+)$", s, flags=re.IGNORECASE)
                if m_if:
                    ifname = m_if.group(1).strip()
                    for vid in current_vids:
                        vlans[vid]["interfaces"].add(ifname)
                    continue

        elif in_l3:
            if not raw.startswith(" ") and s != "!":
                _flush_l3()
                continue
            m_ll = re.match(r"^lower-layer-if\s+vlan\s+(\d{1,4})\b", s, flags=re.IGNORECASE)
            if m_ll:
                l3_vid = int(m_ll.group(1))
                continue
            m_desc = re.match(r"^description\s+(.+)$", s, flags=re.IGNORECASE)
            if m_desc:
                l3_desc = m_desc.group(1).strip()
                continue
            m_ip = re.match(r"^ipv4\s+address\s+(\d+\.\d+\.\d+\.\d+/\d{1,2})\b", s, flags=re.IGNORECASE)
            if m_ip:
                ip_c, net_c = _ip_mask_to_cidr(m_ip.group(1))
                if ip_c:
                    l3_ips.append((ip_c, net_c))

    _flush_l3()
    return vlans


def parse_junos_vlans(text: str) -> Dict[int, Dict[str, Any]]:
    """
    Extrai VLANs de configurações Juniper JunOS (`unit <N> { vlan-id <id>; family inet { address ...; } }`).
    """
    vlans: Dict[int, Dict[str, Any]] = {}
    current_unit: Optional[str] = None
    unit_vid: Optional[int] = None
    unit_desc: Optional[str] = None
    unit_ips: List[Tuple[str, Optional[str]]] = []

    def _flush_unit():
        nonlocal current_unit, unit_vid, unit_desc, unit_ips
        if unit_vid and (1 <= unit_vid <= 4094):
            entry = vlans.setdefault(unit_vid, {
                "vlan_id": unit_vid,
                "names": [],
                "interfaces": set(),
                "ips": set(),
                "subnets": set(),
            })
            if unit_desc:
                entry["names"].append(_clean_vlan_name(unit_desc, unit_vid))
            if current_unit:
                entry["interfaces"].add(f"unit {current_unit}")
            for ip_c, net_c in unit_ips:
                entry["ips"].add(ip_c)
                if net_c:
                    entry["subnets"].add(net_c)
        current_unit = None
        unit_vid = None
        unit_desc = None
        unit_ips = []

    for raw in text.splitlines():
        s = raw.strip()
        m_u = re.match(r"^unit\s+(\d+)\s*\{", s)
        if m_u:
            _flush_unit()
            current_unit = m_u.group(1)
            continue

        if current_unit is not None:
            m_vid = re.match(r"^vlan-id\s+(\d{1,4});", s)
            if m_vid:
                unit_vid = int(m_vid.group(1))
                continue
            m_desc = re.match(r'^description\s+"?([^";]+)"?;', s)
            if m_desc:
                unit_desc = m_desc.group(1).strip()
                continue
            m_addr = re.match(r"^address\s+(\d+\.\d+\.\d+\.\d+/\d{1,2});", s)
            if m_addr:
                ip_c, net_c = _ip_mask_to_cidr(m_addr.group(1))
                if ip_c:
                    unit_ips.append((ip_c, net_c))

    _flush_unit()
    return vlans


def parse_device_config_vlans(model: str, text: str) -> Dict[int, Dict[str, Any]]:
    m = (model or "").strip().lower()
    if "routeros" in m or "mikrotik" in m:
        return parse_routeros_vlans(text)
    if "vrp" in m or "huawei" in m:
        return parse_vrp_vlans(text)
    if "datacom" in m or "dmos" in m:
        return parse_datacom_vlans(text)
    if "junos" in m or "juniper" in m:
        return parse_junos_vlans(text)
    # Fallback heurístico
    if "/interface vlan" in text:
        return parse_routeros_vlans(text)
    if "dot1q" in text and "interface l3" in text:
        return parse_datacom_vlans(text)
    return parse_vrp_vlans(text)


async def extract_vlans_from_oxidized(
    db: Session,
    client_group: Optional[str] = None
) -> Dict[str, Any]:
    """
    Varre os backups dos equipamentos no Oxidized, extrai todas as VLANs, interfaces e sub-redes L3,
    e grava/atualiza a tabela `discovered_vlans` no banco do IperSoft.
    """
    cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "oxidized").first()
    ox_url = (cfg.url if cfg and cfg.url else "http://172.17.0.1:8888").strip().rstrip("/")
    ox_user = cfg.username if cfg else None
    ox_pass = cfg.password if cfg else None

    # Buscar lista ao vivo de nós do Oxidized para obter `full_name` (group/name)
    live_nodes = await OxidizedService.fetch_nodes(ox_url, ox_user, ox_pass)
    live_by_name: Dict[str, Dict[str, Any]] = {}
    live_by_ip: Dict[str, Dict[str, Any]] = {}
    for ln in live_nodes:
        if (ln.get("status") or "").lower() != "success":
            continue
        n_name = (ln.get("name") or "").strip().lower()
        n_ip = (ln.get("ip") or "").strip()
        if n_name:
            live_by_name[n_name] = ln
        if n_ip:
            live_by_ip[n_ip] = ln

    query = db.query(Asset).join(AssetOxidized, Asset.id == AssetOxidized.asset_id)
    if client_group and client_group.lower() != "todos":
        query = query.filter(Asset.client_group.ilike(client_group.strip()))

    assets_with_ox = query.all()

    # Agrupamento: (client_group_norm, vlan_id) -> dados agregados
    aggregated: Dict[Tuple[str, int], Dict[str, Any]] = {}
    scanned_devices = 0
    devices_with_vlans = 0

    kwargs = OxidizedService._build_client_kwargs(ox_user, ox_pass)
    async with httpx.AsyncClient(**kwargs) as client:
        for asset in assets_with_ox:
            cg = (asset.client_group or "").strip().lower()
            if not cg or cg in ("discovered hosts", "templates"):
                continue
            if cg == "oestenets":
                cg = "oestenet"

            ox = asset.oxidized
            if not ox:
                continue

            # Encontrar o nó correspondente no Oxidized
            ln = (
                live_by_name.get((ox.node_name or "").strip().lower())
                or live_by_name.get((asset.name or "").strip().lower())
                or live_by_ip.get((asset.ip_address or "").strip())
            )
            if not ln and (ox.status or "").lower() != "success":
                continue

            full_name = (ln.get("full_name") if ln else None) or f"{ox.group}/{ox.node_name}"
            model = (ln.get("model") if ln else None) or ox.model or asset.backup_model or "RouterOS"

            # Baixar configuração do Oxidized
            candidates = []
            if full_name and "/" in full_name:
                candidates.append("/".join(urllib.parse.quote(p) for p in full_name.split("/")))
            if ox.group and ox.group != "default":
                candidates.append(f"{urllib.parse.quote(ox.group)}/{urllib.parse.quote(ox.node_name)}")
            candidates.append(urllib.parse.quote(ox.node_name))

            config_text = None
            for cand in candidates:
                try:
                    resp = await client.get(f"{ox_url}/node/fetch/{cand}")
                    if resp.status_code == 200 and not resp.text.strip().lower().startswith("unable to find "):
                        config_text = resp.text
                        break
                except Exception:
                    continue

            if not config_text:
                continue

            scanned_devices += 1
            parsed_vlans = parse_device_config_vlans(model, config_text)
            if not parsed_vlans:
                continue

            devices_with_vlans += 1
            for vid, vinfo in parsed_vlans.items():
                key = (cg, vid)
                agg = aggregated.setdefault(key, {
                    "client_group": cg,
                    "vlan_id": vid,
                    "names": [],
                    "subnets": set(),
                    "devices": [],
                })
                for nm in vinfo.get("names", []):
                    if nm and nm not in agg["names"]:
                        agg["names"].append(nm)
                for sub in vinfo.get("subnets", set()):
                    agg["subnets"].add(sub)

                local_name = vinfo["names"][0] if vinfo.get("names") else f"VLAN {vid}"
                agg["devices"].append({
                    "asset_id": asset.id,
                    "asset_name": asset.name,
                    "hostname": asset.snmp_hostname or asset.hostname,
                    "ip_address": asset.ip_address,
                    "model": model,
                    "local_name": local_name,
                    "interfaces": sorted(vinfo.get("interfaces", set())),
                    "ips": sorted(vinfo.get("ips", set())),
                })

    # Persistir em `discovered_vlans`
    existing_query = db.query(DiscoveredVLAN)
    if client_group and client_group.lower() != "todos":
        cg_norm = client_group.strip().lower()
        if cg_norm == "oestenets":
            cg_norm = "oestenet"
        existing_query = existing_query.filter(DiscoveredVLAN.client_group == cg_norm)

    existing_map: Dict[Tuple[str, int], DiscoveredVLAN] = {
        (v.client_group, v.vlan_id): v for v in existing_query.all()
    }

    now = datetime.utcnow()
    created_count = 0
    updated_count = 0

    for (cg, vid), data in sorted(aggregated.items()):
        # Escolher o melhor nome (preferir nomes descritivos que não sejam apenas 'VLAN <id>' ou 'vlan<id>')
        descriptive_names = [
            n for n in data["names"]
            if not re.match(rf"^(?:vlan\s*)?0*{vid}$", n.strip(), flags=re.IGNORECASE)
        ]
        canonical_name = (descriptive_names[0] if descriptive_names else (data["names"][0] if data["names"] else f"VLAN {vid}"))[:200]

        dev_summaries = []
        for d in data["devices"]:
            if_str = f" ({', '.join(d['interfaces'][:3])})" if d.get("interfaces") else ""
            ip_str = f" [{', '.join(d['ips'])}]" if d.get("ips") else ""
            dev_summaries.append(f"{d['asset_name']}{if_str}{ip_str}")
        description = f"Equipamentos ({len(data['devices'])}): " + "; ".join(dev_summaries)

        subnets_list = sorted(data["subnets"])

        if (cg, vid) in existing_map:
            v_obj = existing_map[(cg, vid)]
            v_obj.name = canonical_name
            v_obj.description = description
            v_obj.subnets = subnets_list
            v_obj.devices = data["devices"]
            v_obj.last_extracted_at = now
            updated_count += 1
        else:
            v_obj = DiscoveredVLAN(
                client_group=cg,
                vlan_id=vid,
                name=canonical_name,
                description=description,
                subnets=subnets_list,
                devices=data["devices"],
                last_extracted_at=now,
            )
            db.add(v_obj)
            created_count += 1

    db.commit()

    return {
        "scanned_devices": scanned_devices,
        "devices_with_vlans": devices_with_vlans,
        "total_vlans_extracted": len(aggregated),
        "vlans_created": created_count,
        "vlans_updated": updated_count,
    }
