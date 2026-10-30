import asyncio
import re
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

async def detect_os_via_snmp(
    ip: str, 
    community: str = "ipermonitor", 
    port: int = 161, 
    timeout: float = 2.0
) -> Optional[Dict[str, Any]]:
    """
    Tenta detectar o Sistema Operacional e Modelo de Equipamento via SNMP v2c (sysDescr.0).
    Para MikroTik, consulta também mtxrLicVersion.0 para distinguir v6 de v7.
    """
    if not ip or ip == "0.0.0.0":
        return None

    comm = community or "ipermonitor"
    target = f"{ip}:{port}"
    
    # 1. Consulta sysDescr.0 (1.3.6.1.2.1.1.1.0)
    cmd = [
        "snmpget", "-v2c", "-c", comm, 
        "-t", str(int(max(1, timeout))), 
        "-r", "0", target, "1.3.6.1.2.1.1.1.0"
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout + 1.0)
        out_text = stdout.decode("utf-8", errors="ignore").strip()
        
        if proc.returncode != 0 or not out_text:
            return None

        # Extrai o valor retornado
        descr = out_text.split("=", 1)[-1].strip()
        # Remove prefixo tipo STRING: se houver
        if descr.startswith("STRING:"):
            descr = descr[len("STRING:"):].strip().strip('"')

        descr_lower = descr.lower()

        # A. MikroTik RouterOS
        if "routeros" in descr_lower or "mikrotik" in descr_lower:
            # Tenta consultar OID mtxrLicVersion (1.3.6.1.4.1.14988.1.1.4.4.0)
            ros_ver = None
            try:
                cmd_v = [
                    "snmpget", "-v2c", "-c", comm, 
                    "-t", "1", "-r", "0", target, "1.3.6.1.4.1.14988.1.1.4.4.0"
                ]
                proc_v = await asyncio.create_subprocess_exec(
                    *cmd_v,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout_v, _ = await asyncio.wait_for(proc_v.communicate(), timeout=2.0)
                if proc_v.returncode == 0:
                    v_raw = stdout_v.decode("utf-8", errors="ignore").split("=", 1)[-1].strip()
                    if v_raw.startswith("STRING:"):
                        ros_ver = v_raw[len("STRING:"):].strip().strip('"')
            except Exception:
                pass

            if not ros_ver:
                match_v = re.search(r'v?([67])\.[0-9.]+', descr)
                if match_v:
                    major = match_v.group(1)
                    ros_ver = match_v.group(0)
                else:
                    major = "7"  # Padrão moderno se não especificado
            else:
                major = "6" if ros_ver.startswith("6.") else "7"

            profile = "mikrotik_v7" if major == "7" else "mikrotik_v6"
            ver_label = f" (v{ros_ver})" if ros_ver else ""
            return {
                "success": True,
                "method": "snmp",
                "os_profile": profile,
                "os_name": f"MikroTik RouterOS v{major}{ver_label}",
                "backup_model": "RouterOS",
                "raw_description": descr
            }

        # B. Datacom DmOS
        if "dmos" in descr_lower or "datacom" in descr_lower or "dm4" in descr_lower or "dm3" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "datacom_dmos",
                "os_name": "Datacom DmOS",
                "backup_model": "datacom",
                "raw_description": descr
            }

        # C. Huawei VRP
        if "huawei" in descr_lower or "vrp" in descr_lower or "versatile routing platform" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "huawei_vrp",
                "os_name": "Huawei VRP",
                "backup_model": "vrp",
                "raw_description": descr
            }

        # D. A10 Networks ACOS
        if "acos" in descr_lower or "a10 networks" in descr_lower or "thunder" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "a10_acos",
                "os_name": "A10 Networks (ACOS)",
                "backup_model": "acos",
                "raw_description": descr
            }

        # E. Cisco IOS / IOS-XE
        if "cisco" in descr_lower or "ios" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "cisco_ios",
                "os_name": "Cisco IOS / IOS-XE",
                "backup_model": "ios",
                "raw_description": descr
            }

        # F. Fiberhome OLT
        if "fiberhome" in descr_lower or "an5516" in descr_lower or "an6000" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "fiberhome_olt",
                "os_name": "Fiberhome OLT",
                "backup_model": "fiberhome",
                "raw_description": descr
            }

        # G. Fortinet FortiOS
        if "fortinet" in descr_lower or "fortios" in descr_lower or "fortigate" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "fortios",
                "os_name": "Fortinet FortiOS",
                "backup_model": "fortios",
                "raw_description": descr
            }

        # H. EdgeCore / EdgeOS
        if "edgecore" in descr_lower or "edgeos" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "edgecos",
                "os_name": "EdgeCore / EdgeOS",
                "backup_model": "edgecos",
                "raw_description": descr
            }

        # I. Juniper JunOS
        if "juniper" in descr_lower or "junos" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "junos",
                "os_name": "Juniper JunOS",
                "backup_model": "junos",
                "raw_description": descr
            }

        # J. Linux Server / VM
        if "linux" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "linux_bash",
                "os_name": "Linux (Servidor / VM)",
                "backup_model": "linux",
                "raw_description": descr
            }

        # K. Windows
        if "windows" in descr_lower:
            return {
                "success": True,
                "method": "snmp",
                "os_profile": "windows",
                "os_name": "Windows (Servidor / Desktop)",
                "backup_model": "windows",
                "raw_description": descr
            }

        # Reconhecimento genérico com a descrição
        return {
            "success": True,
            "method": "snmp",
            "os_profile": "generic_ssh",
            "os_name": f"Dispositivo SNMP ({descr[:30]}...)",
            "backup_model": "generic",
            "raw_description": descr
        }

    except Exception as e:
        logger.debug(f"Aviso SNMP detection para {ip}: {e}")
        return None


async def detect_os_via_ssh(
    ip: str,
    port: int = 22,
    username: Optional[str] = None,
    password: Optional[str] = None,
    timeout: float = 3.0
) -> Optional[Dict[str, Any]]:
    """
    Fallback: Conecta via SSH para identificar o SO quando o SNMP não estiver disponível.
    """
    if not ip or not username:
        return None

    try:
        import asyncssh
    except ImportError:
        logger.warning("asyncssh não instalado para detecção SSH.")
        return None

    try:
        conn = await asyncio.wait_for(
            asyncssh.connect(
                host=ip,
                port=port or 22,
                username=username,
                password=password or "",
                known_hosts=None,
                client_keys=None
            ),
            timeout=timeout
        )
    except Exception as err:
        logger.debug(f"Falha de conexão SSH para {ip}:{port}: {err}")
        return None

    try:
        async with conn:
            # 1. Tenta identificar se é Linux (uname -s)
            try:
                res = await asyncio.wait_for(conn.run("uname -s", check=False), timeout=2.0)
                out = (res.stdout or "").strip()
                if "Linux" in out:
                    # Tenta ler /etc/os-release para nome amigável
                    try:
                        res_distro = await asyncio.wait_for(conn.run("cat /etc/os-release", check=False), timeout=2.0)
                        distro_out = res_distro.stdout or ""
                        pretty_match = re.search(r'PRETTY_NAME="([^"]+)"', distro_out)
                        label = pretty_match.group(1) if pretty_match else "Linux Server"
                    except Exception:
                        label = "Linux Server"

                    return {
                        "success": True,
                        "method": "ssh",
                        "os_profile": "linux_bash",
                        "os_name": label,
                        "backup_model": "linux",
                        "raw_description": f"Linux ({out})"
                    }
            except Exception:
                pass

            # 2. Tenta comando MikroTik RouterOS (/system resource print)
            try:
                res_mk = await asyncio.wait_for(conn.run("/system resource print", check=False), timeout=2.0)
                out_mk = (res_mk.stdout or "").strip()
                if "version:" in out_mk or "uptime:" in out_mk:
                    v_match = re.search(r'version:\s*([0-9.]+)', out_mk)
                    ver_str = v_match.group(1) if v_match else ""
                    major = "6" if ver_str.startswith("6.") else "7"
                    return {
                        "success": True,
                        "method": "ssh",
                        "os_profile": f"mikrotik_v{major}",
                        "os_name": f"MikroTik RouterOS v{major}" + (f" (v{ver_str})" if ver_str else ""),
                        "backup_model": "RouterOS",
                        "raw_description": out_mk[:150]
                    }
            except Exception:
                pass

            # 3. Tenta show version (Cisco / Datacom / A10 / Huawei)
            try:
                res_sw = await asyncio.wait_for(conn.run("show version", check=False), timeout=2.5)
                out_sw = (res_sw.stdout or "").strip().lower()

                if "acos" in out_sw or "a10" in out_sw:
                    return {
                        "success": True,
                        "method": "ssh",
                        "os_profile": "a10_acos",
                        "os_name": "A10 Networks (ACOS)",
                        "backup_model": "acos",
                        "raw_description": out_sw[:150]
                    }
                if "dmos" in out_sw or "datacom" in out_sw:
                    return {
                        "success": True,
                        "method": "ssh",
                        "os_profile": "datacom_dmos",
                        "os_name": "Datacom DmOS",
                        "backup_model": "datacom",
                        "raw_description": out_sw[:150]
                    }
                if "cisco" in out_sw or "ios" in out_sw:
                    return {
                        "success": True,
                        "method": "ssh",
                        "os_profile": "cisco_ios",
                        "os_name": "Cisco IOS / IOS-XE",
                        "backup_model": "ios",
                        "raw_description": out_sw[:150]
                    }
                if "vrp" in out_sw or "huawei" in out_sw:
                    return {
                        "success": True,
                        "method": "ssh",
                        "os_profile": "huawei_vrp",
                        "os_name": "Huawei VRP",
                        "backup_model": "vrp",
                        "raw_description": out_sw[:150]
                    }
            except Exception:
                pass

            # Se conectou com sucesso via SSH mas nenhum comando acima bateu
            return {
                "success": True,
                "method": "ssh",
                "os_profile": "generic_ssh",
                "os_name": "Dispositivo SSH Genérico",
                "backup_model": "RouterOS",
                "raw_description": "Conexão SSH estabelecida com sucesso"
            }

    except Exception as e:
        logger.debug(f"Erro ao interagir via SSH com {ip}: {e}")
        return None


async def detect_device_os(
    ip: str,
    snmp_community: str = "ipermonitor",
    snmp_port: int = 161,
    ssh_user: Optional[str] = None,
    ssh_password: Optional[str] = None,
    ssh_port: int = 22,
    timeout: float = 2.0
) -> Dict[str, Any]:
    """
    Orquestrador Inteligente:
    1. Tenta SNMP primeiro (rápido, 1 pacote UDP, sem riscos de senha).
    2. Fallback para SSH se SNMP falhar e houver credenciais.
    """
    if not ip or ip.strip() == "0.0.0.0":
        return {
            "success": False,
            "message": "Endereço IP não informado ou inválido."
        }

    # 1. Tentativa via SNMP
    snmp_res = await detect_os_via_snmp(
        ip=ip.strip(),
        community=snmp_community or "ipermonitor",
        port=snmp_port or 161,
        timeout=timeout
    )
    if snmp_res and snmp_res.get("success"):
        return snmp_res

    # 2. Fallback via SSH
    if ssh_user and ssh_user.strip():
        ssh_res = await detect_os_via_ssh(
            ip=ip.strip(),
            port=ssh_port or 22,
            username=ssh_user.strip(),
            password=ssh_password or "",
            timeout=timeout + 1.0
        )
        if ssh_res and ssh_res.get("success"):
            return ssh_res

    # 3. Nenhuma detecção foi conclusiva
    return {
        "success": False,
        "message": "Não foi possível identificar o SO. Verifique se o SNMP v2c está habilitado ou configure as credenciais SSH."
    }
