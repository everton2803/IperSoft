import asyncio
import re
import time
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import SessionLocal
from app.models.asset import Asset, AssetZabbix, AssetGuacamole, NetworkDiagnostic

logger = logging.getLogger(__name__)

# Global diagnostic run state for UI monitoring
diagnostic_state = {
    "is_running": False,
    "current_progress": 0,
    "total_assets": 0,
    "last_run_started": None,
    "last_run_finished": None,
    "last_error": None,
}

async def test_icmp(ip: str, timeout: float = 2.0) -> Dict[str, Any]:
    """
    Executa teste de ping ICMP via comando nativo do Linux.
    Retorna status ('ok', 'failed', 'timeout') e latência em ms.
    """
    if not ip or ip == "0.0.0.0":
        return {"status": "failed", "latency_ms": None, "message": "IP não configurado"}
    
    cmd = ["ping", "-c", "1", "-W", str(int(max(1, timeout))), ip]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        out_text = stdout.decode('utf-8', errors='ignore')
        
        if proc.returncode == 0:
            match = re.search(r'time=([0-9.]+)\s*ms', out_text)
            latency = float(match.group(1)) if match else 0.0
            return {
                "status": "ok",
                "latency_ms": round(latency, 2),
                "message": f"Resposta ICMP em {latency:.2f} ms"
            }
        else:
            if "100% packet loss" in out_text:
                return {
                    "status": "timeout",
                    "latency_ms": None,
                    "message": "Tempo limite esgotado (100% perda de pacotes)"
                }
            return {
                "status": "failed",
                "latency_ms": None,
                "message": out_text.strip() or "Falha de comunicação ICMP"
            }
    except Exception as e:
        return {
            "status": "failed",
            "latency_ms": None,
            "message": f"Erro na execução do ping: {str(e)}"
        }

async def test_snmp(ip: str, community: str = "ipermonitor", port: int = 161, timeout: float = 2.0) -> Dict[str, Any]:
    """
    Executa consulta SNMP v2c (sysName.0 / sysDescr.0) via snmpget.
    Retorna status ('ok', 'failed', 'timeout') e mensagem descritiva.
    """
    if not ip or ip == "0.0.0.0":
        return {"status": "failed", "latency_ms": None, "message": "IP não configurado"}

    comm = community or "ipermonitor"
    target = f"{ip}:{port}"
    cmd = ["snmpget", "-v2c", "-c", comm, "-t", str(int(max(1, timeout))), "-r", "0", target, "1.3.6.1.2.1.1.5.0"]
    
    start_t = time.perf_counter()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        latency = round((time.perf_counter() - start_t) * 1000, 2)
        out_text = stdout.decode('utf-8', errors='ignore').strip()
        err_text = stderr.decode('utf-8', errors='ignore').strip()

        if proc.returncode == 0:
            val = out_text.split("=", 1)[-1].strip() if "=" in out_text else out_text
            return {
                "status": "ok",
                "latency_ms": latency,
                "message": f"SNMP OK: {val}"
            }
        else:
            combined_err = f"{out_text} {err_text}".strip()
            if "Timeout: No Response" in combined_err or "No Response" in combined_err:
                return {
                    "status": "timeout",
                    "latency_ms": None,
                    "message": f"Sem resposta SNMP ({comm} @ {target})"
                }
            return {
                "status": "failed",
                "latency_ms": None,
                "message": combined_err or f"Erro SNMP v2c ({comm})"
            }
    except Exception as e:
        return {
            "status": "failed",
            "latency_ms": None,
            "message": f"Erro ao executar snmpget: {str(e)}"
        }

async def test_tcp(ip: str, port: int, timeout: float = 2.5) -> Dict[str, Any]:
    """
    Executa teste de conexão TCP em socket assíncrono para SSH, Telnet, RDP.
    Retorna status ('ok', 'failed', 'timeout'), latência em ms e mensagem.
    """
    if not ip or not port:
        return {"status": "failed", "latency_ms": None, "message": "Host ou porta inválidos"}

    start_t = time.perf_counter()
    try:
        conn = asyncio.open_connection(ip, int(port))
        reader, writer = await asyncio.wait_for(conn, timeout=timeout)
        latency = round((time.perf_counter() - start_t) * 1000, 2)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return {
            "status": "ok",
            "latency_ms": latency,
            "message": f"Porta TCP {port} aberta (handshake em {latency} ms)"
        }
    except asyncio.TimeoutError:
        return {
            "status": "timeout",
            "latency_ms": None,
            "message": f"Timeout após {timeout}s conectando na porta TCP {port}"
        }
    except ConnectionRefusedError:
        return {
            "status": "failed",
            "latency_ms": None,
            "message": f"Porta {port} fechada (Connection refused)"
        }
    except OSError as os_err:
        return {
            "status": "failed",
            "latency_ms": None,
            "message": f"Erro de rede: {str(os_err)}"
        }
    except Exception as e:
        return {
            "status": "failed",
            "latency_ms": None,
            "message": f"Falha de conexão: {str(e)}"
        }

def _is_snmp_applicable_by_default(asset: Asset) -> bool:
    """
    Determina se o teste SNMP v2c (porta 161) é aplicável por padrão quando
    o operador não definiu explicitamente 'snmp' em enabled_tests.
    Se o host no Zabbix possui apenas interface Zabbix Agent (porta 10050, type=1)
    sem interface SNMP (type=2), não deve testar SNMP 161 por padrão.
    """
    if not asset.zabbix:
        return False
    raw_ifaces = (asset.raw_data or {}).get("interfaces") or []
    if raw_ifaces:
        has_snmp_iface = any(str(i.get("type")) == "2" or str(i.get("port")) == "161" for i in raw_ifaces)
        if not has_snmp_iface:
            return False
    z_port = str(asset.zabbix.port or asset.port or "")
    if z_port == "10050" and not raw_ifaces:
        return False
    return True


def _upsert_diag_in_session(db: Session, asset_id: int, test_type: str, status: str, latency: Optional[float], target_host: str, target_port: Optional[str], message: str):
    """
    Atualiza ou insere o registro atual de diagnóstico na tabela network_diagnostics,
    removendo registros órfãos de portas ou protocolos antigos do mesmo ativo.
    """
    remote_types = ["ssh", "telnet", "rdp", "vnc"]
    if test_type in remote_types:
        existing_list = db.query(NetworkDiagnostic).filter(
            NetworkDiagnostic.asset_id == asset_id,
            NetworkDiagnostic.test_type.in_(remote_types)
        ).order_by(NetworkDiagnostic.id.asc()).all()
    else:
        existing_list = db.query(NetworkDiagnostic).filter(
            NetworkDiagnostic.asset_id == asset_id,
            NetworkDiagnostic.test_type == test_type
        ).order_by(NetworkDiagnostic.id.asc()).all()

    now = datetime.now(timezone.utc)
    if existing_list:
        primary = existing_list[0]
        primary.test_type = test_type
        primary.status = status
        primary.latency_ms = latency
        primary.target_host = target_host
        primary.target_port = target_port
        primary.message = message
        primary.tested_at = now
        # Remove duplicatas ou registros presos de portas/protocolos anteriores
        for stale in existing_list[1:]:
            db.delete(stale)
    else:
        diag = NetworkDiagnostic(
            asset_id=asset_id,
            test_type=test_type,
            status=status,
            latency_ms=latency,
            target_host=target_host,
            target_port=target_port,
            message=message,
            tested_at=now
        )
        db.add(diag)

async def run_diagnostics_for_asset(
    db: Session, 
    asset: Asset,
    include_icmp: bool = True,
    include_snmp: bool = True,
    include_remote: bool = True
) -> Dict[str, Any]:
    """
    Executa testes para um único ativo usando a sessão do DB fornecida,
    respeitando os testes que estão habilitados para este ativo.
    """
    now = datetime.now(timezone.utc)
    target_ip = asset.ip_address or asset.hostname
    ignore_guac = bool((asset.raw_data or {}).get("ignore_guacamole"))
    results = {}

    # 1. ICMP Ping Test
    if include_icmp and target_ip:
        icmp_res = await test_icmp(target_ip, timeout=2.0)
        results["icmp"] = icmp_res
        _upsert_diag_in_session(
            db, asset.id, "icmp", icmp_res["status"],
            icmp_res["latency_ms"], target_ip, None, icmp_res["message"]
        )
        if asset.zabbix:
            asset.zabbix.icmp_status = icmp_res["status"]
            asset.zabbix.icmp_latency_ms = icmp_res["latency_ms"]
            asset.zabbix.last_diagnostics = now
    else:
        db.query(NetworkDiagnostic).filter(
            NetworkDiagnostic.asset_id == asset.id,
            NetworkDiagnostic.test_type == "icmp"
        ).delete(synchronize_session=False)
        if asset.zabbix:
            asset.zabbix.icmp_status = "disabled"
        results["icmp"] = {"status": "disabled", "message": "Teste desativado pelo usuário"}

    # 2. SNMP Test
    if include_snmp and asset.zabbix and target_ip:
        comm = asset.zabbix.snmp_community or asset.snmp_community or "ipermonitor"
        snmp_port = 161
        snmp_res = await test_snmp(target_ip, community=comm, port=snmp_port, timeout=2.0)
        results["snmp"] = snmp_res
        _upsert_diag_in_session(
            db, asset.id, "snmp", snmp_res["status"],
            snmp_res["latency_ms"], target_ip, str(snmp_port), snmp_res["message"]
        )
        asset.zabbix.snmp_status = snmp_res["status"]
        asset.zabbix.snmp_message = snmp_res["message"]
        asset.zabbix.last_diagnostics = now
    else:
        db.query(NetworkDiagnostic).filter(
            NetworkDiagnostic.asset_id == asset.id,
            NetworkDiagnostic.test_type == "snmp"
        ).delete(synchronize_session=False)
        if asset.zabbix:
            asset.zabbix.snmp_status = "disabled"
            asset.zabbix.snmp_message = "Teste SNMP desativado"
        results["snmp"] = {"status": "disabled", "message": "Teste desativado pelo usuário"}

    # 3. Guacamole Protocols (SSH, Telnet, RDP)
    if include_remote and not ignore_guac:
        results["guacamole"] = []
        if asset.guacamole and len(asset.guacamole) > 0:
            # Testa a conexão principal configurada no ativo
            g_conn = asset.guacamole[0]
            g_host = g_conn.hostname or target_ip
            proto = (g_conn.protocol or "ssh").lower()
            default_port = 22 if proto == "ssh" else (23 if proto == "telnet" else 3389)
            port_val = int(g_conn.port) if g_conn.port and str(g_conn.port).isdigit() else default_port

            tcp_res = await test_tcp(g_host, port_val, timeout=2.5)
            results["guacamole"].append({
                "connection_id": g_conn.connection_id,
                "protocol": proto,
                "port": port_val,
                **tcp_res
            })

            _upsert_diag_in_session(
                db, asset.id, proto, tcp_res["status"],
                tcp_res["latency_ms"], g_host, str(port_val), tcp_res["message"]
            )
            for g_c in asset.guacamole:
                g_c.tcp_status = tcp_res["status"]
                g_c.tcp_latency_ms = tcp_res["latency_ms"]
                g_c.tcp_message = tcp_res["message"]
                g_c.last_diagnostics = now
        elif target_ip and asset.guacamole_connection_id:
            proto = (asset.guacamole_protocol or "ssh").lower()
            default_port = 22 if proto == "ssh" else (23 if proto == "telnet" else 3389)
            tcp_res = await test_tcp(target_ip, default_port, timeout=2.5)
            results["guacamole"].append({
                "connection_id": "local",
                "protocol": proto,
                "port": default_port,
                **tcp_res
            })
            _upsert_diag_in_session(
                db, asset.id, proto, tcp_res["status"],
                tcp_res["latency_ms"], target_ip, str(default_port), tcp_res["message"]
            )
        else:
            db.query(NetworkDiagnostic).filter(
                NetworkDiagnostic.asset_id == asset.id,
                NetworkDiagnostic.test_type.in_(["ssh", "telnet", "rdp", "vnc"])
            ).delete(synchronize_session=False)
    else:
        db.query(NetworkDiagnostic).filter(
            NetworkDiagnostic.asset_id == asset.id,
            NetworkDiagnostic.test_type.in_(["ssh", "telnet", "rdp", "vnc"])
        ).delete(synchronize_session=False)
        if asset.guacamole:
            for g_conn in asset.guacamole:
                g_conn.tcp_status = "disabled"
        results["guacamole"] = [{"status": "disabled", "message": "Teste de acesso remoto desativado"}]

    db.commit()
    return results

async def run_all_diagnostics_batch():
    """
    Varredura concorrente otimizada de todos os ativos do banco:
    1. Carrega plano de testes em memória (1 consulta rápida ao DB)
    2. Executa testes I/O assíncronos em paralelo com semáforo
    3. Atualiza banco em bloco e expurga diagnósticos órfãos/desabilitados
    """
    global diagnostic_state
    if diagnostic_state["is_running"]:
        logger.info("Varredura de diagnósticos já está em execução.")
        return {"status": "already_running"}

    diagnostic_state["is_running"] = True
    diagnostic_state["current_progress"] = 0
    diagnostic_state["last_run_started"] = datetime.now(timezone.utc).isoformat()
    diagnostic_state["last_error"] = None

    # Etapa 1: Snapshot em memória dos alvos
    db = SessionLocal()
    targets = []
    try:
        assets = db.query(Asset).filter(Asset.status.in_(["active", "monitored"])).all()
        for a in assets:
            target_ip = a.ip_address or a.hostname
            raw = a.raw_data or {}
            saved_tests = raw.get("enabled_tests") or {}
            ignore_guac = bool(raw.get("ignore_guacamole"))

            inc_icmp = saved_tests.get("icmp", True)
            if "snmp" in saved_tests:
                inc_snmp = bool(saved_tests["snmp"])
            else:
                inc_snmp = _is_snmp_applicable_by_default(a)
            inc_remote = saved_tests.get("remote", True) and not ignore_guac

            item = {
                "asset_id": a.id,
                "name": a.name,
                "target_ip": target_ip,
                "include_icmp": inc_icmp,
                "include_snmp": inc_snmp,
                "include_remote": inc_remote,
                "has_zabbix": a.zabbix is not None and a.zabbix.status != "unmonitored",
                "snmp_community": (a.zabbix.snmp_community if a.zabbix else None) or a.snmp_community or "ipermonitor",
                "guacamole_conns": []
            }
            if a.guacamole and not ignore_guac:
                # Usa a conexão primária do ativo para evitar testes duplicados no mesmo host
                g = a.guacamole[0]
                proto = (g.protocol or "ssh").lower()
                def_port = 22 if proto == "ssh" else (23 if proto == "telnet" else 3389)
                p_val = int(g.port) if g.port and str(g.port).isdigit() else def_port
                item["guacamole_conns"].append({
                    "id": g.id,
                    "connection_id": g.connection_id,
                    "hostname": g.hostname or target_ip,
                    "protocol": proto,
                    "port": p_val
                })
            targets.append(item)
    finally:
        db.close()

    diagnostic_state["total_assets"] = len(targets)
    logger.info(f"Iniciando testes de rede para {len(targets)} ativos em paralelo...")

    # Etapa 2: Execução assíncrona com semáforo de 30 conexões paralelas
    semaphore = asyncio.Semaphore(30)
    all_results = []

    async def execute_target(target):
        async with semaphore:
            ip = target["target_ip"]
            target_res = {
                "asset_id": target["asset_id"],
                "target_ip": ip,
                "include_icmp": target["include_icmp"],
                "include_snmp": target["include_snmp"] and target["has_zabbix"],
                "include_remote": target["include_remote"] and len(target["guacamole_conns"]) > 0,
                "icmp": None,
                "snmp": None,
                "guac": []
            }

            # ICMP
            if target_res["include_icmp"] and ip:
                target_res["icmp"] = await test_icmp(ip, timeout=2.0)

            # SNMP
            if target_res["include_snmp"] and ip:
                target_res["snmp"] = await test_snmp(
                    ip, community=target["snmp_community"], port=161, timeout=2.0
                )

            # Guacamole
            if target_res["include_remote"]:
                for g in target["guacamole_conns"]:
                    res_tcp = await test_tcp(g["hostname"], g["port"], timeout=2.5)
                    target_res["guac"].append({
                        "guac_id": g["id"],
                        "protocol": g["protocol"],
                        "port": g["port"],
                        "host": g["hostname"],
                        **res_tcp
                    })

            diagnostic_state["current_progress"] += 1
            return target_res

    try:
        tasks = [execute_target(t) for t in targets]
        all_results = await asyncio.gather(*tasks)

        # Etapa 3: Persistir resultados no banco com uma única sessão rápida
        now = datetime.now(timezone.utc)
        db_save = SessionLocal()
        try:
            asset_ids = [r["asset_id"] for r in all_results]
            # Remove diagnósticos de ativos que estão inativos/desmonitorados
            if asset_ids:
                db_save.query(NetworkDiagnostic).filter(
                    ~NetworkDiagnostic.asset_id.in_(asset_ids)
                ).delete(synchronize_session=False)

            db_assets = {a.id: a for a in db_save.query(Asset).filter(Asset.id.in_(asset_ids)).all()}

            for r in all_results:
                aid = r["asset_id"]
                asset = db_assets.get(aid)
                if not asset:
                    continue

                # Salvar ou Limpar ICMP
                if r["icmp"]:
                    _upsert_diag_in_session(
                        db_save, aid, "icmp", r["icmp"]["status"],
                        r["icmp"]["latency_ms"], r["target_ip"], None, r["icmp"]["message"]
                    )
                    if asset.zabbix:
                        asset.zabbix.icmp_status = r["icmp"]["status"]
                        asset.zabbix.icmp_latency_ms = r["icmp"]["latency_ms"]
                        asset.zabbix.last_diagnostics = now
                else:
                    db_save.query(NetworkDiagnostic).filter(
                        NetworkDiagnostic.asset_id == aid,
                        NetworkDiagnostic.test_type == "icmp"
                    ).delete(synchronize_session=False)
                    if asset.zabbix:
                        asset.zabbix.icmp_status = "disabled"

                # Salvar ou Limpar SNMP
                if r["snmp"] and asset.zabbix:
                    _upsert_diag_in_session(
                        db_save, aid, "snmp", r["snmp"]["status"],
                        r["snmp"]["latency_ms"], r["target_ip"], "161", r["snmp"]["message"]
                    )
                    asset.zabbix.snmp_status = r["snmp"]["status"]
                    asset.zabbix.snmp_message = r["snmp"]["message"]
                    asset.zabbix.last_diagnostics = now
                else:
                    db_save.query(NetworkDiagnostic).filter(
                        NetworkDiagnostic.asset_id == aid,
                        NetworkDiagnostic.test_type == "snmp"
                    ).delete(synchronize_session=False)
                    if asset.zabbix:
                        asset.zabbix.snmp_status = "disabled"
                        asset.zabbix.snmp_message = "Teste SNMP desativado"

                # Salvar ou Limpar Guacamole TCP
                if r["guac"] and asset.guacamole:
                    for g_res in r["guac"]:
                        _upsert_diag_in_session(
                            db_save, aid, g_res["protocol"], g_res["status"],
                            g_res["latency_ms"], g_res["host"], str(g_res["port"]), g_res["message"]
                        )
                        for g_obj in asset.guacamole:
                            g_obj.tcp_status = g_res["status"]
                            g_obj.tcp_latency_ms = g_res["latency_ms"]
                            g_obj.tcp_message = g_res["message"]
                            g_obj.last_diagnostics = now
                else:
                    db_save.query(NetworkDiagnostic).filter(
                        NetworkDiagnostic.asset_id == aid,
                        NetworkDiagnostic.test_type.in_(["ssh", "telnet", "rdp", "vnc"])
                    ).delete(synchronize_session=False)
                    if asset.guacamole:
                        for g_obj in asset.guacamole:
                            g_obj.tcp_status = "disabled"

            db_save.commit()
            logger.info("Resultados de diagnósticos salvos no banco com sucesso.")
        except Exception as save_err:
            db_save.rollback()
            logger.error(f"Erro ao salvar diagnósticos no banco: {save_err}")
            raise save_err
        finally:
            db_save.close()

        diagnostic_state["last_run_finished"] = datetime.now(timezone.utc).isoformat()
        return {"status": "success", "total_tested": len(all_results)}
    except Exception as e:
        logger.error(f"Erro global na varredura de diagnósticos: {e}")
        diagnostic_state["last_error"] = str(e)
        return {"status": "error", "message": str(e)}
    finally:
        diagnostic_state["is_running"] = False
