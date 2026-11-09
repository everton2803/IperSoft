import os
import re
import ipaddress
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Set, Tuple

import pymysql
from pymysql.cursors import DictCursor
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.asset import Asset
from app.models.ip_scanner import IPPrefix, DiscoveredIP, IPScannerProbe

logger = logging.getLogger("PhpIpamSync")

# Aliases de client_group do IperSoft para o nome da section no phpIPAM
SECTION_ALIASES = {
    "oestenet": "oestenets",
    "everton": "iper",
    "zabbix servers": "iper",
}

IGNORED_CLIENT_GROUPS = {
    "",
    "discovered hosts",
    "templates",
}

# Tokens técnicos removidos na normalização para parear nomes entre IperSoft e phpIPAM
VENDOR_TOKENS = {
    "mk", "mikrotik", "hw", "huawei", "fh", "fiberhome", "fiber",
    "dm", "datacom", "l2", "l3", "pe", "core"
}


def _get_phpipam_connection():
    """
    Conecta ao MariaDB do phpIPAM.
    Tenta primeiro o IP privado WireGuard (10.10.2.2:3306, acessível do brdrive)
    e faz fallback para o relay em 163.176.247.93:443.
    """
    primary_host = os.getenv("PHPIPAM_DB_HOST", "10.10.2.2")
    primary_port = int(os.getenv("PHPIPAM_DB_PORT", "3306"))
    fallback_host = os.getenv("PHPIPAM_DB_FALLBACK_HOST", "163.176.247.93")
    fallback_port = int(os.getenv("PHPIPAM_DB_FALLBACK_PORT", "443"))
    user = os.getenv("PHPIPAM_DB_USER", "phpipam")
    password = os.getenv("PHPIPAM_DB_PASS", "phpipampass")
    database = os.getenv("PHPIPAM_DB_NAME", "phpipam")

    last_err = None
    for host, port in [(primary_host, primary_port), (fallback_host, fallback_port)]:
        try:
            conn = pymysql.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                database=database,
                charset="utf8mb4",
                cursorclass=DictCursor,
                connect_timeout=4,
                read_timeout=15,
                write_timeout=15,
                autocommit=False,
            )
            return conn
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"Não foi possível conectar ao banco do phpIPAM: {last_err}")


def _ip_to_int(ip_str: Optional[str]) -> Optional[int]:
    if not ip_str:
        return None
    try:
        return int(ipaddress.IPv4Address(ip_str.strip()))
    except Exception:
        return None


def _normalize_section_name(client_group: Optional[str]) -> str:
    raw = (client_group or "").strip().lower()
    if raw in IGNORED_CLIENT_GROUPS:
        return ""
    return SECTION_ALIASES.get(raw, raw)


def _infer_device_type_id(asset: Asset) -> int:
    """
    Mapeia um Asset do IperSoft para o `tid` da tabela `deviceTypes` do phpIPAM:
      1: switch l2
      2: router
     10: servidor
     12: olt
     14: vmware
     15: idrac
     16: vm linux
     17: vm windows
     18: ilo
     19: pop-protect
     20: switch l3
    """
    text = f"{asset.name or ''} {asset.hostname or ''} {asset.snmp_hostname or ''} {asset.os_profile or ''}".lower()

    if "pop-protect" in text or "pop protect" in text or "volt" in text:
        return 19
    if "idrac" in text:
        return 15
    if "ilo" in text or re.search(r"\bilo\b", text):
        return 18
    if "esxi" in text or "vcenter" in text or "vmware" in text:
        return 14
    if "olt" in text or "fiberhome" in text or "gpon" in text:
        return 12
    if "sw l3" in text or "switch l3" in text or "s6730" in text:
        return 20
    if re.search(r"\b(sw|switch)\b", text):
        return 1
    if any(k in text for k in ["router", "bgp", "bng", "cgnat", "ccr", "ne8000", "rb_", "rb-", "mikrotik", "junos", "acos"]):
        return 2
    if "windows" in text or "rdp" in (asset.guacamole_protocol or "").lower():
        return 17
    if "vm" in text or "linux" in text or "proxy" in text or "oracle" in text or "brdrive" in text:
        return 16
    return 10


def _format_phpipam_device_hostname(asset: Asset, section_name: str) -> str:
    """
    Formata o nome canônico do equipamento no padrão do phpIPAM:
    Ex: 'athila: router mk capinzal' -> 'athila - router capinzal'
    """
    raw = (asset.name or asset.hostname or "").strip()
    # Substituir ':' ou '_' por espaço
    cleaned = raw.replace(":", " ").replace("_", " ")
    tokens = [t for t in re.split(r"[\s\-]+", cleaned) if t]

    client_prefix = section_name.lower()
    if client_prefix == "oestenets":
        client_prefix = "oestenet"

    # Remove o prefixo do cliente do início caso já esteja presente
    if tokens and tokens[0].lower() in (section_name.lower(), client_prefix):
        tokens = tokens[1:]

    # Remove siglas de fabricante redundantes (mk, hw, fh, dm) mantendo o nome limpo
    filtered_tokens = []
    for t in tokens:
        tl = t.lower()
        if tl in ("mk", "hw", "fh", "dm"):
            continue
        filtered_tokens.append(tl)

    if not filtered_tokens:
        filtered_tokens = [t.lower() for t in tokens] or [asset.hostname.lower()]

    body = " ".join(filtered_tokens)
    return f"{client_prefix} - {body}"


def _normalize_match_key(name: str) -> str:
    """
    Gera chave normalizada para casar 'atm: router mk interno' com 'atm - router interno'.
    """
    s = (name or "").lower().replace(":", " ").replace("_", " ").replace("-", " ")
    s = s.replace("oestenets", "oestenet")
    tokens = [t for t in s.split() if t and t not in VENDOR_TOKENS]
    return " ".join(tokens)


def sync_ipersoft_to_phpipam(
    db: Session,
    prefix_id: Optional[int] = None,
    client_group: Optional[str] = None
) -> Dict[str, Any]:
    """
    Sincroniza informações do IperSoft para o phpIPAM:
      1. Seções (sections)
      2. Equipamentos (devices) e tipos (deviceTypes) + múltiplas seções automáticas
      3. Prefixos / Sub-redes (subnets) com masterSubnetId e scanAgent
      4. IPs descobertos (ipaddresses) com vínculo ao equipamento (switch = device.id)
    """
    # Primeiro garante que todos os IPs descobertos no IperSoft estejam vinculados aos Assets pelo IP ou snmp_hostname
    from app.services.diagnostics import sync_discovered_ips_with_assets
    sync_discovered_ips_with_assets(db)
    db.commit()

    conn = _get_phpipam_connection()
    stats = {
        "sections_created": 0,
        "devices_created": 0,
        "devices_updated": 0,
        "subnets_created": 0,
        "subnets_updated": 0,
        "ips_created": 0,
        "ips_updated": 0,
        "ips_linked_to_devices": 0,
    }

    try:
        with conn.cursor() as cur:
            # ------------------------------------------------------------------
            # 1. CARREGAR E GARANTIR SEÇÕES (sections) E SCAN AGENTS
            # ------------------------------------------------------------------
            cur.execute("SELECT id, name FROM sections")
            section_map: Dict[str, int] = {
                (row["name"] or "").strip().lower(): int(row["id"])
                for row in cur.fetchall()
            }

            cur.execute("SELECT id, code FROM scanAgents")
            agent_code_map: Dict[str, int] = {
                (row["code"] or "").strip(): int(row["id"])
                for row in cur.fetchall()
                if row.get("code")
            }

            probes = db.query(IPScannerProbe).all()
            probe_by_id = {p.id: p for p in probes}
            probe_by_client = {
                (p.client_group or "").strip().lower(): p
                for p in probes
                if p.client_group
            }

            # Coletar todos os client_groups relevantes de Assets e IPPrefixes
            all_assets = (
                db.query(Asset)
                .filter(Asset.status.in_(["active", "monitored"]))
                .order_by(Asset.id)
                .all()
            )
            prefixes_query = db.query(IPPrefix)
            if prefix_id:
                prefixes_query = prefixes_query.filter(IPPrefix.id == prefix_id)
            elif client_group and client_group.lower() != "todos":
                prefixes_query = prefixes_query.filter(IPPrefix.client_group == client_group.lower())
            target_prefixes = prefixes_query.all()
            all_prefixes = db.query(IPPrefix).all()

            needed_sections: Set[str] = set()
            for a in all_assets:
                sec = _normalize_section_name(a.client_group)
                if sec:
                    needed_sections.add(sec)
            for p in all_prefixes:
                sec = _normalize_section_name(p.client_group)
                if sec:
                    needed_sections.add(sec)

            for sec_name in sorted(needed_sections):
                if sec_name not in section_map:
                    cur.execute(
                        """
                        INSERT INTO sections (name, description, masterSection, permissions, strictMode, subnetOrdering, showVLAN, showVRF, showSupernetOnly, showSubnet)
                        VALUES (%s, %s, 0, '[]', 1, 'default', 1, 1, 1, 1)
                        """,
                        (sec_name, f"Cliente {sec_name.upper()} (IperSoft)")
                    )
                    section_map[sec_name] = int(cur.lastrowid)
                    stats["sections_created"] += 1

            # Descobrir em quais seções cada Asset possui IPs descobertos (para popular devices.sections)
            asset_extra_sections: Dict[int, Set[int]] = {}
            all_discovered_with_asset = (
                db.query(DiscoveredIP, IPPrefix)
                .join(IPPrefix, DiscoveredIP.prefix_id == IPPrefix.id)
                .filter(DiscoveredIP.asset_id.isnot(None))
                .all()
            )
            for d_ip, d_pref in all_discovered_with_asset:
                sec_name = _normalize_section_name(d_pref.client_group)
                sec_id = section_map.get(sec_name)
                if sec_id and d_ip.asset_id:
                    asset_extra_sections.setdefault(d_ip.asset_id, set()).add(sec_id)

            # ------------------------------------------------------------------
            # 2. SINCRONIZAR EQUIPAMENTOS (assets -> phpipam.devices)
            # ------------------------------------------------------------------
            cur.execute("SELECT id, hostname, ip_addr, type, description, sections, snmp_community, snmp_version FROM devices")
            existing_devices = cur.fetchall()
            device_by_id: Dict[int, Dict[str, Any]] = {int(d["id"]): d for d in existing_devices}
            device_by_ip: Dict[str, Dict[str, Any]] = {
                (d["ip_addr"] or "").strip(): d
                for d in existing_devices
                if d.get("ip_addr") and str(d["ip_addr"]).strip()
            }
            device_by_norm_name: Dict[str, Dict[str, Any]] = {
                _normalize_match_key(d["hostname"] or ""): d
                for d in existing_devices
                if d.get("hostname")
            }

            # Também mapear IPs que já possuem `switch` associado em `ipaddresses` no phpIPAM
            cur.execute(
                "SELECT INET_NTOA(ip_addr) AS ip_str, switch FROM ipaddresses WHERE switch IS NOT NULL AND switch != 0"
            )
            ip_to_existing_switch: Dict[str, int] = {}
            for row in cur.fetchall():
                ip_s = (row.get("ip_str") or "").strip()
                sw_id = int(row["switch"])
                if ip_s and sw_id in device_by_id:
                    ip_to_existing_switch[ip_s] = sw_id

            asset_to_device_id: Dict[int, int] = {}
            claimed_device_ids: Set[int] = set()

            for asset in all_assets:
                sec_name = _normalize_section_name(asset.client_group)
                if not sec_name or sec_name not in section_map:
                    continue
                ip_str = (asset.ip_address or "").strip()
                if ip_str == "127.0.0.1":
                    continue

                raw_data = dict(asset.raw_data or {})
                saved_dev_id = raw_data.get("phpipam_device_id")

                matched_dev = None
                if saved_dev_id and int(saved_dev_id) in device_by_id and int(saved_dev_id) not in claimed_device_ids:
                    matched_dev = device_by_id[int(saved_dev_id)]
                else:
                    norm_candidates = [
                        _normalize_match_key(asset.name or ""),
                        _normalize_match_key(f"{sec_name} {asset.name or ''}"),
                        _normalize_match_key(_format_phpipam_device_hostname(asset, sec_name)),
                    ]
                    for nk in norm_candidates:
                        cand = device_by_norm_name.get(nk) if nk else None
                        if cand and int(cand["id"]) not in claimed_device_ids:
                            matched_dev = cand
                            break

                    if not matched_dev and ip_str:
                        if ip_str in device_by_ip and int(device_by_ip[ip_str]["id"]) not in claimed_device_ids:
                            matched_dev = device_by_ip[ip_str]
                        elif ip_str in ip_to_existing_switch and ip_to_existing_switch[ip_str] not in claimed_device_ids:
                            matched_dev = device_by_id.get(ip_to_existing_switch[ip_str])

                # Calcular lista de seções do device (seção nativa + seções onde tem IPs descobertos)
                native_sec_id = section_map[sec_name]
                sec_ids: Set[int] = {native_sec_id}
                if asset.id in asset_extra_sections:
                    sec_ids.update(asset_extra_sections[asset.id])

                dev_type = _infer_device_type_id(asset)
                snmp_comm = (
                    (asset.zabbix.snmp_community if asset.zabbix and asset.zabbix.snmp_community else None)
                    or asset.snmp_community
                    or "ipermonitor"
                )
                descr_parts = []
                if asset.snmp_hostname:
                    descr_parts.append(f"sysName: {asset.snmp_hostname}")
                if asset.os_profile and asset.os_profile != "generic_ssh":
                    descr_parts.append(f"OS: {asset.os_profile}")
                dev_descr = " | ".join(descr_parts)[:250] if descr_parts else None

                if matched_dev:
                    dev_id = int(matched_dev["id"])
                    # Preservar seções que já estavam configuradas no device no phpIPAM
                    existing_secs_raw = (matched_dev.get("sections") or "").strip()
                    for part in existing_secs_raw.split(";"):
                        if part.strip().isdigit():
                            sec_ids.add(int(part.strip()))
                    sections_str = ";".join(str(sid) for sid in sorted(sec_ids))

                    new_ip_addr = matched_dev.get("ip_addr") or (ip_str if _ip_to_int(ip_str) else None)
                    new_descr = matched_dev.get("description") or dev_descr
                    new_type = matched_dev.get("type") or dev_type

                    if (
                        sections_str != existing_secs_raw
                        or new_ip_addr != matched_dev.get("ip_addr")
                        or new_descr != matched_dev.get("description")
                        or matched_dev.get("snmp_community") != snmp_comm
                    ):
                        cur.execute(
                            """
                            UPDATE devices
                            SET ip_addr = %s,
                                type = %s,
                                description = %s,
                                sections = %s,
                                snmp_community = %s,
                                snmp_version = '2'
                            WHERE id = %s
                            """,
                            (new_ip_addr, new_type, new_descr, sections_str, snmp_comm, dev_id)
                        )
                        stats["devices_updated"] += 1
                else:
                    sections_str = ";".join(str(sid) for sid in sorted(sec_ids))
                    canonical_hostname = _format_phpipam_device_hostname(asset, sec_name)
                    valid_ip = ip_str if _ip_to_int(ip_str) else None
                    cur.execute(
                        """
                        INSERT INTO devices (hostname, ip_addr, type, description, sections, snmp_community, snmp_version, snmp_port, snmp_timeout)
                        VALUES (%s, %s, %s, %s, %s, %s, '2', 161, 1000)
                        """,
                        (canonical_hostname, valid_ip, dev_type, dev_descr, sections_str, snmp_comm)
                    )
                    dev_id = int(cur.lastrowid)
                    new_dev_row = {
                        "id": dev_id,
                        "hostname": canonical_hostname,
                        "ip_addr": valid_ip,
                        "type": dev_type,
                        "description": dev_descr,
                        "sections": sections_str,
                        "snmp_community": snmp_comm,
                    }
                    device_by_id[dev_id] = new_dev_row
                    if valid_ip:
                        device_by_ip[valid_ip] = new_dev_row
                    device_by_norm_name[_normalize_match_key(canonical_hostname)] = new_dev_row
                    stats["devices_created"] += 1

                asset_to_device_id[asset.id] = dev_id
                claimed_device_ids.add(dev_id)
                if raw_data.get("phpipam_device_id") != dev_id:
                    raw_data["phpipam_device_id"] = dev_id
                    asset.raw_data = raw_data
                    flag_modified(asset, "raw_data")

            db.commit()

            # ------------------------------------------------------------------
            # 3. SINCRONIZAR SUB-REDES / PREFIXOS (ip_prefixes -> phpipam.subnets)
            # ------------------------------------------------------------------
            cur.execute(
                "SELECT id, subnet, mask, sectionId, description, masterSubnetId, pingSubnet, discoverSubnet, scanAgent, isFolder FROM subnets WHERE isFolder = 0"
            )
            existing_subnets = cur.fetchall()

            # Indexar sub-redes por (sectionId, subnet_int, mask_int)
            subnet_lookup: Dict[Tuple[int, int, int], Dict[str, Any]] = {}
            subnets_by_section: Dict[int, List[Tuple[ipaddress.IPv4Network, Dict[str, Any]]]] = {}

            for s_row in existing_subnets:
                try:
                    sec_id = int(s_row["sectionId"])
                    sub_int = int(s_row["subnet"])
                    mask_int = int(s_row["mask"])
                    subnet_lookup[(sec_id, sub_int, mask_int)] = s_row
                    net_obj = ipaddress.IPv4Network(f"{ipaddress.IPv4Address(sub_int)}/{mask_int}", strict=False)
                    subnets_by_section.setdefault(sec_id, []).append((net_obj, s_row))
                except Exception:
                    continue

            prefix_to_subnet_id: Dict[int, int] = {}

            for pref in target_prefixes:
                sec_name = _normalize_section_name(pref.client_group)
                if not sec_name or sec_name not in section_map:
                    continue
                sec_id = section_map[sec_name]

                try:
                    net = ipaddress.IPv4Network(pref.prefix.strip(), strict=False)
                except Exception:
                    continue

                sub_int = int(net.network_address)
                mask_int = int(net.prefixlen)

                # Resolver scanAgent apropriado para o prefixo
                probe = None
                if pref.probe_id and pref.probe_id in probe_by_id:
                    probe = probe_by_id[pref.probe_id]
                elif (pref.client_group or "").strip().lower() in probe_by_client:
                    probe = probe_by_client[(pref.client_group or "").strip().lower()]

                scan_agent_id = 1  # Default localhost
                if probe and probe.phpipam_agent_code and probe.phpipam_agent_code in agent_code_map:
                    scan_agent_id = agent_code_map[probe.phpipam_agent_code]

                key = (sec_id, sub_int, mask_int)
                if key in subnet_lookup:
                    s_row = subnet_lookup[key]
                    subnet_id = int(s_row["id"])
                    new_desc = pref.description if (pref.description and not s_row.get("description")) else s_row.get("description")
                    if (
                        int(s_row.get("pingSubnet") or 0) != 1
                        or int(s_row.get("discoverSubnet") or 0) != 1
                        or int(s_row.get("scanAgent") or 0) != scan_agent_id
                        or new_desc != s_row.get("description")
                    ):
                        cur.execute(
                            """
                            UPDATE subnets
                            SET description = %s,
                                pingSubnet = 1,
                                discoverSubnet = 1,
                                scanAgent = %s
                            WHERE id = %s
                            """,
                            (new_desc, scan_agent_id, subnet_id)
                        )
                        stats["subnets_updated"] += 1
                else:
                    # Procurar super-rede pai (masterSubnetId) mais específica na mesma seção
                    master_id = 0
                    best_parent_prefixlen = -1
                    for parent_net, parent_row in subnets_by_section.get(sec_id, []):
                        if parent_net.prefixlen < net.prefixlen and net.subnet_of(parent_net):
                            if parent_net.prefixlen > best_parent_prefixlen:
                                best_parent_prefixlen = parent_net.prefixlen
                                master_id = int(parent_row["id"])

                    cur.execute(
                        """
                        INSERT INTO subnets (
                            subnet, mask, sectionId, description, masterSubnetId,
                            permissions, pingSubnet, discoverSubnet, scanAgent, isFolder, state
                        )
                        VALUES (%s, %s, %s, %s, %s, '{"3":"1","2":"2"}', 1, 1, %s, 0, 2)
                        """,
                        (
                            str(sub_int),
                            str(mask_int),
                            sec_id,
                            pref.description or f"Prefixo {pref.prefix}",
                            master_id,
                            scan_agent_id,
                        )
                    )
                    subnet_id = int(cur.lastrowid)
                    new_s_row = {
                        "id": subnet_id,
                        "subnet": str(sub_int),
                        "mask": str(mask_int),
                        "sectionId": sec_id,
                        "description": pref.description or f"Prefixo {pref.prefix}",
                        "masterSubnetId": master_id,
                        "pingSubnet": 1,
                        "discoverSubnet": 1,
                        "scanAgent": scan_agent_id,
                    }
                    subnet_lookup[key] = new_s_row
                    subnets_by_section.setdefault(sec_id, []).append((net, new_s_row))
                    stats["subnets_created"] += 1

                prefix_to_subnet_id[pref.id] = subnet_id

            # ------------------------------------------------------------------
            # 4. SINCRONIZAR IPS DESCOBERTOS E VINCULAR AOS EQUIPAMENTOS (switch)
            # ------------------------------------------------------------------
            for pref in target_prefixes:
                subnet_id = prefix_to_subnet_id.get(pref.id)
                if not subnet_id:
                    continue

                cur.execute(
                    "SELECT id, ip_addr, hostname, description, state, switch, lastSeen FROM ipaddresses WHERE subnetId = %s",
                    (subnet_id,)
                )
                existing_ips: Dict[int, Dict[str, Any]] = {
                    int(row["ip_addr"]): row for row in cur.fetchall() if str(row.get("ip_addr", "")).isdigit()
                }

                for d_ip in pref.discovered_ips:
                    ip_int = _ip_to_int(d_ip.ip_address)
                    if not ip_int:
                        continue

                    dev_id = asset_to_device_id.get(d_ip.asset_id) if d_ip.asset_id else None
                    matched_asset = d_ip.asset_rel if d_ip.asset_id else None

                    hostname_val = (
                        d_ip.hostname
                        or (matched_asset.snmp_hostname if matched_asset and matched_asset.snmp_hostname else None)
                        or (matched_asset.hostname if matched_asset else None)
                    )
                    auto_descr = (
                        d_ip.description
                        or (matched_asset.name if matched_asset else None)
                        or "-- IperSoft Scanner --"
                    )[:64]

                    seen_str = (d_ip.last_seen_at or datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S")

                    if ip_int in existing_ips:
                        ex_row = existing_ips[ip_int]
                        ex_desc = (ex_row.get("description") or "").strip()
                        # Preserva descrição manual caso já exista e não seja autodiscovered
                        if not ex_desc or ex_desc in ("-- autodiscovered --", "-- IperSoft Scanner --"):
                            final_desc = auto_descr
                        else:
                            final_desc = ex_desc[:64]

                        final_host = hostname_val or ex_row.get("hostname")
                        final_switch = dev_id or ex_row.get("switch")

                        cur.execute(
                            """
                            UPDATE ipaddresses
                            SET hostname = %s,
                                description = %s,
                                state = 2,
                                switch = %s,
                                lastSeen = %s
                            WHERE id = %s
                            """,
                            (final_host, final_desc, final_switch, seen_str, int(ex_row["id"]))
                        )
                        stats["ips_updated"] += 1
                        if final_switch:
                            stats["ips_linked_to_devices"] += 1
                    else:
                        cur.execute(
                            """
                            INSERT INTO ipaddresses (
                                subnetId, ip_addr, is_gateway, description, hostname,
                                state, switch, lastSeen
                            )
                            VALUES (%s, %s, 0, %s, %s, 2, %s, %s)
                            """,
                            (
                                subnet_id,
                                str(ip_int),
                                auto_descr,
                                hostname_val,
                                dev_id,
                                seen_str,
                            )
                        )
                        stats["ips_created"] += 1
                        if dev_id:
                            stats["ips_linked_to_devices"] += 1

            # ------------------------------------------------------------------
            # 5. VINCULAR AUTOMATICAMENTE IPS JÁ EXISTENTES NO PHPIPAM AOS ASSETS
            #    (Mesmo em sub-redes que foram populadas pelo phpipam-agent!)
            # ------------------------------------------------------------------
            for asset in all_assets:
                dev_id = asset_to_device_id.get(asset.id)
                ip_int = _ip_to_int(asset.ip_address)
                if not dev_id or not ip_int:
                    continue

                cur.execute(
                    "SELECT id, hostname, description, switch FROM ipaddresses WHERE ip_addr = %s",
                    (str(ip_int),)
                )
                for row in cur.fetchall():
                    curr_sw = row.get("switch")
                    curr_desc = (row.get("description") or "").strip()
                    curr_host = row.get("hostname")
                    new_host = curr_host or asset.snmp_hostname or asset.hostname
                    new_desc = (
                        asset.name[:64]
                        if (not curr_desc or curr_desc == "-- autodiscovered --")
                        else curr_desc
                    )
                    if curr_sw != dev_id or curr_host != new_host or curr_desc != new_desc:
                        cur.execute(
                            """
                            UPDATE ipaddresses
                            SET switch = %s,
                                hostname = %s,
                                description = %s
                            WHERE id = %s
                            """,
                            (dev_id, new_host, new_desc, int(row["id"]))
                        )
                        stats["ips_linked_to_devices"] += 1

        conn.commit()
        return stats
    except Exception as e:
        conn.rollback()
        logger.error(f"Erro ao sincronizar com phpIPAM: {e}")
        raise
    finally:
        conn.close()
