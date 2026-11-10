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
      - Blocos `vsi <name>` (VPLS: `vsi-id <id>`, `peer <ip>`)
      - Blocos `interface Vlanif<id>` (`description ...`, `ip address ...`, `mpls l2vc ...`, `l2 binding vsi ...`)
      - Subinterfaces `interface <Port>.<subid>` (`dot1q termination vid`, `vlan-type dot1q`, `qinq termination`, `qinq stacking`, `user-vlan ... qinq`, `l2 binding vsi`, `mpls l2vc`)
      - Portas físicas/Eth-Trunk com `port default vlan`, `port vlan-stacking`
    """
    vlans: Dict[int, Dict[str, Any]] = {}
    vsi_map: Dict[str, Dict[str, Any]] = {}

    current_vid: Optional[int] = None

    current_vsi_name: Optional[str] = None
    current_vsi_id: Optional[int] = None
    current_vsi_desc: Optional[str] = None
    current_vsi_peers: List[str] = []

    current_iface: Optional[str] = None
    iface_vid: Optional[int] = None
    iface_extra_vids: Set[int] = set()
    iface_desc: Optional[str] = None
    iface_ips: List[Tuple[str, Optional[str]]] = []
    iface_tunnels: List[Tuple[str, str]] = []

    def _ensure_vlan(vid: int) -> Dict[str, Any]:
        return vlans.setdefault(vid, {
            "vlan_id": vid,
            "names": [],
            "interfaces": set(),
            "ips": set(),
            "subnets": set(),
        })

    def _flush_vsi():
        nonlocal current_vsi_name, current_vsi_id, current_vsi_desc, current_vsi_peers
        if current_vsi_name:
            vid = current_vsi_id
            if not vid:
                m_vn = re.match(r"^vlan[\-_]?(\d{1,4})$", current_vsi_name, flags=re.IGNORECASE)
                if m_vn:
                    vid = int(m_vn.group(1))
            vsi_map[current_vsi_name] = {
                "vsi_id": vid,
                "desc": current_vsi_desc,
                "peers": list(current_vsi_peers),
            }
            if vid and (1 <= vid <= 4094):
                entry = _ensure_vlan(vid)
                label = _clean_vlan_name(current_vsi_desc or current_vsi_name, vid)
                vpls_name = label if "vpls" in label.lower() else f"{label} (VPLS)"
                if vpls_name not in entry["names"]:
                    entry["names"].append(vpls_name)
                peer_suffix = f"->{','.join(current_vsi_peers[:2])}" if current_vsi_peers else ""
                entry["interfaces"].add(f"VPLS:{current_vsi_name}{peer_suffix}")
        current_vsi_name = None
        current_vsi_id = None
        current_vsi_desc = None
        current_vsi_peers = []

    def _flush_iface():
        nonlocal current_iface, iface_vid, iface_extra_vids, iface_desc, iface_ips, iface_tunnels
        if current_iface:
            # Se a interface tem binding VSI e ainda não tem iface_vid, tentar inferir pelo sufixo da subinterface ou pelo vsi-id
            if not iface_vid and "." in current_iface:
                sub_part = current_iface.split(".", 1)[1]
                if sub_part.isdigit():
                    sub_num = int(sub_part)
                    if 1 <= sub_num <= 4094:
                        iface_vid = sub_num
            if not iface_vid and iface_tunnels:
                for t_type, t_name in iface_tunnels:
                    if t_type == "VPLS" and t_name in vsi_map and vsi_map[t_name].get("vsi_id"):
                        v_id = vsi_map[t_name]["vsi_id"]
                        if 1 <= v_id <= 4094:
                            iface_vid = v_id
                            break

            all_iface_vids: Set[int] = set()
            if iface_vid and (1 <= iface_vid <= 4094):
                all_iface_vids.add(iface_vid)
            for ev in iface_extra_vids:
                if 1 <= ev <= 4094 and ev != 1:
                    all_iface_vids.add(ev)

            base_if = current_iface.split(".")[0]
            if_label = base_if if not base_if.lower().startswith("vlanif") else current_iface

            for vid in sorted(all_iface_vids):
                entry = _ensure_vlan(vid)
                entry["interfaces"].add(if_label)
                for t_type, t_label in iface_tunnels:
                    entry["interfaces"].add(f"{t_type}:{t_label}")

                if iface_desc:
                    clean_d = _clean_vlan_name(iface_desc, vid)
                    if iface_tunnels:
                        t_types = "/".join(sorted({t[0] for t in iface_tunnels}))
                        tagged_name = f"{clean_d} ({t_types})" if t_types.lower() not in clean_d.lower() else clean_d
                        if tagged_name not in entry["names"]:
                            entry["names"].append(tagged_name)
                    elif clean_d not in entry["names"]:
                        entry["names"].append(clean_d)
                elif iface_tunnels:
                    for t_type, t_label in iface_tunnels:
                        clean_t = _clean_vlan_name(t_label.split("(")[0].split("->")[0], vid)
                        tagged_name = f"{clean_t} ({t_type})"
                        if tagged_name not in entry["names"]:
                            entry["names"].append(tagged_name)

                # Sub-redes L3 pertencem ao VID principal da interface L3
                if vid == iface_vid:
                    for ip_c, net_c in iface_ips:
                        entry["ips"].add(ip_c)
                        if net_c:
                            entry["subnets"].add(net_c)

        current_iface = None
        iface_vid = None
        iface_extra_vids = set()
        iface_desc = None
        iface_ips = []
        iface_tunnels = []

    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#") or s.startswith("!"):
            if s in ("#", "!"):
                _flush_vsi()
                _flush_iface()
                current_vid = None
            continue

        # Bloco `vsi <name> [static|auto]` (VPLS Huawei)
        m_vsi = re.match(r"^vsi\s+(\S+)(?:\s+\S+)?$", s, flags=re.IGNORECASE)
        if m_vsi and current_iface is None:
            _flush_vsi()
            _flush_iface()
            current_vid = None
            current_vsi_name = m_vsi.group(1).strip()
            continue

        # Bloco `vlan <id>`
        m_vlan = re.match(r"^vlan\s+(\d{1,4})$", s, flags=re.IGNORECASE)
        if m_vlan and current_iface is None:
            _flush_vsi()
            _flush_iface()
            vid = int(m_vlan.group(1))
            if 1 <= vid <= 4094 and vid != 1:
                current_vid = vid
                _ensure_vlan(vid)
            else:
                current_vid = None
            continue

        # Bloco `interface ...`
        m_if = re.match(r"^interface\s+(\S+)", s, flags=re.IGNORECASE)
        if m_if:
            _flush_vsi()
            _flush_iface()
            current_vid = None
            current_iface = m_if.group(1)
            m_vif = re.match(r"^Vlanif(\d{1,4})$", current_iface, flags=re.IGNORECASE)
            if m_vif:
                iface_vid = int(m_vif.group(1))
            continue

        if current_vsi_name is not None:
            m_vsi_id = re.match(r"^vsi-id\s+(\d+)\b", s, flags=re.IGNORECASE)
            if m_vsi_id:
                current_vsi_id = int(m_vsi_id.group(1))
                continue
            m_vsi_desc = re.match(r"^description\s+(.+)$", s, flags=re.IGNORECASE)
            if m_vsi_desc:
                current_vsi_desc = m_vsi_desc.group(1).strip()
                continue
            m_vsi_peer = re.match(r"^peer\s+(\d+\.\d+\.\d+\.\d+)\b", s, flags=re.IGNORECASE)
            if m_vsi_peer:
                current_vsi_peers.append(m_vsi_peer.group(1))
                continue
            continue

        if current_vid is not None:
            m_desc = re.match(r"^(?:description|name)\s+(.+)$", s, flags=re.IGNORECASE)
            if m_desc:
                clean_n = _clean_vlan_name(m_desc.group(1), current_vid)
                if clean_n not in vlans[current_vid]["names"]:
                    vlans[current_vid]["names"].append(clean_n)
            continue

        if current_iface is not None:
            m_desc = re.match(r"^description\s+(.+)$", s, flags=re.IGNORECASE)
            if m_desc:
                iface_desc = m_desc.group(1).strip()
                continue

            # dot1q termination vid <id> / vlan-type dot1q <id>
            m_dot1q = re.match(
                r"^(?:dot1q\s+termination\s+vid|vlan-type\s+dot1q)\s+(\d{1,4})\b",
                s,
                flags=re.IGNORECASE,
            )
            if m_dot1q:
                iface_vid = int(m_dot1q.group(1))
                continue

            # qinq termination pe-vid <pe_vid> [ce-vid <ce_spec>]
            m_qinq_term = re.match(
                r"^qinq\s+termination\s+pe-vid\s+(\d{1,4})(?:\s+ce-vid\s+(.+))?$",
                s,
                flags=re.IGNORECASE,
            )
            if m_qinq_term:
                iface_vid = int(m_qinq_term.group(1))
                if m_qinq_term.group(2):
                    iface_extra_vids.update(_expand_vlan_spec(m_qinq_term.group(2), max_range_span=64))
                continue

            # qinq stacking vid <spec> pe-vid <pe_vid>
            m_qinq_stack = re.match(
                r"^qinq\s+stacking\s+vid\s+(.+?)\s+pe-vid\s+(\d{1,4})\b",
                s,
                flags=re.IGNORECASE,
            )
            if m_qinq_stack:
                pe_v = int(m_qinq_stack.group(2))
                iface_vid = iface_vid or pe_v
                iface_extra_vids.add(pe_v)
                iface_extra_vids.update(_expand_vlan_spec(m_qinq_stack.group(1), max_range_span=64))
                continue

            # port vlan-stacking vlan <spec> stack-vlan <svlan>
            m_pstack = re.match(
                r"^port\s+vlan-stacking\s+vlan\s+(.+?)\s+stack-vlan\s+(\d{1,4})\b",
                s,
                flags=re.IGNORECASE,
            )
            if m_pstack:
                svlan = int(m_pstack.group(2))
                iface_extra_vids.add(svlan)
                iface_extra_vids.update(_expand_vlan_spec(m_pstack.group(1), max_range_span=64))
                continue

            # port default vlan <vid> (ex: dot1q-tunnel / access)
            m_pdef = re.match(r"^port\s+default\s+vlan\s+(\d{1,4})\b", s, flags=re.IGNORECASE)
            if m_pdef:
                d_vid = int(m_pdef.group(1))
                if d_vid != 1:
                    iface_extra_vids.add(d_vid)
                continue

            # user-vlan <start> [<end>] [qinq <svlan>] (BNG Huawei NE8000)
            m_uvlan = re.match(
                r"^user-vlan\s+(\d{1,4})(?:\s+(\d{1,4}))?(?:\s+qinq\s+(\d{1,4}))?\b",
                s,
                flags=re.IGNORECASE,
            )
            if m_uvlan:
                u_start = int(m_uvlan.group(1))
                u_end = int(m_uvlan.group(2)) if m_uvlan.group(2) else u_start
                u_qinq = int(m_uvlan.group(3)) if m_uvlan.group(3) else None
                if u_qinq and (1 <= u_qinq <= 4094):
                    iface_vid = iface_vid or u_qinq
                    iface_extra_vids.add(u_qinq)
                if 1 <= u_start <= u_end <= 4094 and (u_end - u_start) <= 64:
                    iface_extra_vids.update(range(u_start, u_end + 1))
                continue

            # l2 binding vsi <vsi_name> (VPLS binding)
            m_bind_vsi = re.match(r"^l2\s+binding\s+vsi\s+(\S+)", s, flags=re.IGNORECASE)
            if m_bind_vsi:
                v_name = m_bind_vsi.group(1).strip()
                iface_tunnels.append(("VPLS", v_name))
                continue

            # mpls l2vc <peer_ip> <vc_id> ... (VPWS Martini L2VC)
            m_l2vc = re.match(r"^mpls\s+l2vc\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\b", s, flags=re.IGNORECASE)
            if m_l2vc:
                peer_ip = m_l2vc.group(1)
                vc_id = int(m_l2vc.group(2))
                if 1 <= vc_id <= 4094:
                    iface_extra_vids.add(vc_id)
                iface_tunnels.append(("VPWS", f"l2vc->{peer_ip}(vc:{vc_id})"))
                continue

            m_ip = re.match(r"^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+|\d{1,2})\b", s, flags=re.IGNORECASE)
            if m_ip:
                ip_c, net_c = _ip_mask_to_cidr(m_ip.group(1), m_ip.group(2))
                if ip_c:
                    iface_ips.append((ip_c, net_c))

    _flush_vsi()
    _flush_iface()
    return vlans


def parse_datacom_vlans(text: str) -> Dict[int, Dict[str, Any]]:
    """
    Extrai VLANs de configurações Datacom DmOS (OLTs e Switches):
      - Blocos `dot1q` -> `vlan <spec>` -> `name <name>` / `interface <iface>`
      - Blocos `interface l3 <name>` -> `lower-layer-if vlan <id>` -> `ipv4 address <cidr>`
      - Blocos `mpls l2vpn` -> `vpws-group <grp>` / `vpls-group <grp>` -> `vpn <name>`
        (`pw-type vlan <id>`, `pw-id <id>`, `bridge-domain` -> `dot1q <spec>`, `access-interface` -> `dot1q <spec>`)
    """
    vlans: Dict[int, Dict[str, Any]] = {}
    in_dot1q = False
    current_vids: List[int] = []

    in_l3 = False
    l3_name: Optional[str] = None
    l3_vid: Optional[int] = None
    l3_desc: Optional[str] = None
    l3_ips: List[Tuple[str, Optional[str]]] = []

    in_l2vpn = False
    l2vpn_type: Optional[str] = None  # "VPWS" | "VPLS"
    l2vpn_group: Optional[str] = None
    l2vpn_vpn: Optional[str] = None
    l2vpn_vids: Set[int] = set()
    l2vpn_pwid: Optional[int] = None
    l2vpn_neighbors: List[str] = []
    l2vpn_interfaces: Set[str] = set()

    def _ensure_vlan(vid: int) -> Dict[str, Any]:
        return vlans.setdefault(vid, {
            "vlan_id": vid,
            "names": [],
            "interfaces": set(),
            "ips": set(),
            "subnets": set(),
        })

    def _flush_l3():
        nonlocal in_l3, l3_name, l3_vid, l3_desc, l3_ips
        if in_l3 and l3_vid and (1 <= l3_vid <= 4094):
            entry = _ensure_vlan(l3_vid)
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

    def _flush_l2vpn_vpn():
        nonlocal l2vpn_vpn, l2vpn_vids, l2vpn_pwid, l2vpn_neighbors, l2vpn_interfaces
        if l2vpn_vpn and l2vpn_type:
            # Se o túnel usa pw-type ethernet sem cláusula dot1q explícita, mas o pw-id está na faixa de VLAN (1..4094),
            # usa o pw-id como VLAN ID (ex: pw-id 900, pw-id 3501).
            target_vids = set(v for v in l2vpn_vids if 1 <= v <= 4094 and v != 1)
            if not target_vids and l2vpn_pwid and (1 <= l2vpn_pwid <= 4094) and l2vpn_pwid != 1:
                target_vids.add(l2vpn_pwid)

            if target_vids:
                grp = l2vpn_group or ""
                vpn = l2vpn_vpn
                if grp and grp.lower() != vpn.lower() and vpn.lower() in ("ipv4", "ipv6", "bgp", "olt", "pppoe", "pppoes"):
                    raw_label = f"{grp}-{vpn}"
                elif grp and grp.lower() != vpn.lower() and not vpn.lower().startswith("int-"):
                    raw_label = f"{grp}-{vpn}"
                else:
                    # Remover prefixo 'int-15512-' quando houver nome descritivo após
                    m_int = re.match(r"^int-\d+-(.+)$", vpn, flags=re.IGNORECASE)
                    raw_label = m_int.group(1) if m_int else vpn

                pw_tag = f"(pw:{l2vpn_pwid})" if l2vpn_pwid else ""
                tunnel_if = f"{l2vpn_type}:{grp}/{vpn}{pw_tag}" if grp else f"{l2vpn_type}:{vpn}{pw_tag}"

                for vid in sorted(target_vids):
                    entry = _ensure_vlan(vid)
                    clean_lbl = _clean_vlan_name(raw_label, vid)
                    tunnel_name = f"{clean_lbl} ({l2vpn_type})"
                    if tunnel_name not in entry["names"]:
                        entry["names"].append(tunnel_name)
                    entry["interfaces"].add(tunnel_if)
                    for ac_if in sorted(l2vpn_interfaces):
                        entry["interfaces"].add(ac_if)

        l2vpn_vpn = None
        l2vpn_vids = set()
        l2vpn_pwid = None
        l2vpn_neighbors = []
        l2vpn_interfaces = set()

    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue

        if s == "dot1q":
            _flush_l3()
            _flush_l2vpn_vpn()
            in_l2vpn = False
            in_dot1q = True
            current_vids = []
            continue

        m_l3 = re.match(r"^interface\s+l3\s+(\S+)", s, flags=re.IGNORECASE)
        if m_l3:
            _flush_l3()
            _flush_l2vpn_vpn()
            in_l2vpn = False
            in_dot1q = False
            current_vids = []
            in_l3 = True
            l3_name = m_l3.group(1)
            continue

        if s.lower() == "mpls l2vpn":
            _flush_l3()
            _flush_l2vpn_vpn()
            in_dot1q = False
            in_l3 = False
            current_vids = []
            in_l2vpn = True
            l2vpn_type = None
            l2vpn_group = None
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
                    _ensure_vlan(vid)
                continue

            if current_vids:
                m_name = re.match(r"^name\s+(.+)$", s, flags=re.IGNORECASE)
                if m_name:
                    vname = m_name.group(1).strip()
                    for vid in current_vids:
                        clean_n = _clean_vlan_name(vname, vid)
                        if clean_n not in vlans[vid]["names"]:
                            vlans[vid]["names"].append(clean_n)
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

        elif in_l2vpn:
            if not raw.startswith(" ") and s != "!":
                _flush_l2vpn_vpn()
                in_l2vpn = False
                l2vpn_type = None
                l2vpn_group = None
                continue

            m_grp = re.match(r"^(vpws|vpls)-group\s+(\S+)", s, flags=re.IGNORECASE)
            if m_grp:
                _flush_l2vpn_vpn()
                l2vpn_type = m_grp.group(1).upper()
                l2vpn_group = m_grp.group(2).strip()
                continue

            m_vpn = re.match(r"^vpn\s+(\S+)", s, flags=re.IGNORECASE)
            if m_vpn:
                _flush_l2vpn_vpn()
                l2vpn_vpn = m_vpn.group(1).strip()
                continue

            if l2vpn_vpn:
                m_pw_vlan = re.match(r"^pw-type\s+vlan\s+(\d{1,4})\b", s, flags=re.IGNORECASE)
                if m_pw_vlan:
                    l2vpn_vids.add(int(m_pw_vlan.group(1)))
                    continue

                m_pwid = re.match(r"^pw-id\s+(\d+)\b", s, flags=re.IGNORECASE)
                if m_pwid:
                    l2vpn_pwid = int(m_pwid.group(1))
                    continue

                m_neigh = re.match(r"^neighbor\s+(\d+\.\d+\.\d+\.\d+)\b", s, flags=re.IGNORECASE)
                if m_neigh:
                    l2vpn_neighbors.append(m_neigh.group(1))
                    continue

                m_ac = re.match(r"^access-interface\s+(\S+)", s, flags=re.IGNORECASE)
                if m_ac:
                    l2vpn_interfaces.add(m_ac.group(1).strip())
                    continue

                m_d1q = re.match(r"^dot1q\s+([0-9,\-\s]+)$", s, flags=re.IGNORECASE)
                if m_d1q:
                    l2vpn_vids.update(_expand_vlan_spec(m_d1q.group(1), max_range_span=64))
                    continue

    _flush_l3()
    _flush_l2vpn_vpn()
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
    if "dot1q" in text and ("interface l3" in text or "vpws-group" in text or "vpls-group" in text or "switchport" in text):
        return parse_datacom_vlans(text)
    if "vpws-group" in text or "vpls-group" in text:
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
                sorted_ifs = sorted(
                    vinfo.get("interfaces", set()),
                    key=lambda x: (0 if x.startswith(("VPLS:", "VPWS:")) else 1, x)
                )
                agg["devices"].append({
                    "asset_id": asset.id,
                    "asset_name": asset.name,
                    "hostname": asset.snmp_hostname or asset.hostname,
                    "ip_address": asset.ip_address,
                    "model": model,
                    "local_name": local_name,
                    "interfaces": sorted_ifs,
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
            if not re.match(rf"^(?:vlan\s*)?0*{vid}(?:\s*\((?:VPLS|VPWS)\))?$", n.strip(), flags=re.IGNORECASE)
        ]
        base_name = descriptive_names[0] if descriptive_names else (data["names"][0] if data["names"] else f"VLAN {vid}")

        # Verificar se a VLAN possui vínculo com túnel VPLS ou VPWS em algum equipamento
        tunnel_types: Set[str] = set()
        for d in data["devices"]:
            for iface in d.get("interfaces", []):
                if iface.startswith("VPLS:"):
                    tunnel_types.add("VPLS")
                elif iface.startswith("VPWS:"):
                    tunnel_types.add("VPWS")
        if tunnel_types:
            t_badge = "/".join(sorted(tunnel_types))
            if "vpls" not in base_name.lower() and "vpws" not in base_name.lower():
                base_name = f"{base_name} ({t_badge})"

        canonical_name = base_name[:200]

        dev_summaries = []
        for d in data["devices"]:
            if_str = f" ({', '.join(d['interfaces'][:4])})" if d.get("interfaces") else ""
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
