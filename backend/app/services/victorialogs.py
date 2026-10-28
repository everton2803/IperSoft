import httpx
import json
import logging
import asyncio
import re
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

SEVERITY_MAP = {
    0: ("emerg", "Emergência"),
    1: ("alert", "Alerta"),
    2: ("crit", "Crítico"),
    3: ("err", "Erro"),
    4: ("warning", "Aviso"),
    5: ("notice", "Notificação"),
    6: ("info", "Informação"),
    7: ("debug", "Debug")
}

class VictoriaLogsService:
    @staticmethod
    def normalize_url(url: str) -> str:
        return url.strip().rstrip('/')

    @classmethod
    async def test_connection(cls, url: str) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                # 1. Checa endpoint /health
                health_res = await client.get(f"{base_url}/health")
                if health_res.status_code != 200:
                    return {
                        "success": False,
                        "message": f"VictoriaLogs respondeu com HTTP {health_res.status_code} no healthcheck."
                    }

                # 2. Testa query de contagem
                query_res = await client.get(
                    f"{base_url}/select/logsql/query",
                    params={"query": "_time:5m | count()"}
                )
                if query_res.status_code == 200:
                    data = {}
                    try:
                        data = json.loads(query_res.text.strip())
                    except Exception:
                        pass
                    count_val = data.get("count(*)") or data.get("count()") or "0"
                    return {
                        "success": True,
                        "message": f"Conexão com VictoriaLogs OK! Coletados {count_val} logs nos últimos 5 minutos.",
                        "logs_last_5m": count_val
                    }
                else:
                    return {
                        "success": False,
                        "message": f"Erro ao executar LogsQL: HTTP {query_res.status_code}"
                    }
            except Exception as e:
                return {
                    "success": False,
                    "message": f"Falha de conexão com VictoriaLogs ({base_url}): {str(e)}"
                }

    @classmethod
    async def get_stats(cls, url: str) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        async with httpx.AsyncClient(timeout=10.0) as client:
            stats = {"total_1h": 0, "total_24h": 0, "status": "offline"}
            try:
                res_1h = await client.get(
                    f"{base_url}/select/logsql/query",
                    params={"query": "_time:1h | count()"}
                )
                if res_1h.status_code == 200:
                    d = json.loads(res_1h.text.strip())
                    stats["total_1h"] = int(d.get("count(*)") or d.get("count()") or 0)
                    stats["status"] = "online"

                res_24h = await client.get(
                    f"{base_url}/select/logsql/query",
                    params={"query": "_time:24h | count()"}
                )
                if res_24h.status_code == 200:
                    d = json.loads(res_24h.text.strip())
                    stats["total_24h"] = int(d.get("count(*)") or d.get("count()") or 0)
            except Exception as e:
                logger.error(f"Erro ao obter estatísticas do VictoriaLogs: {e}")
            return stats

    @classmethod
    async def query_logs(
        cls,
        url: str,
        ip: Optional[str] = None,
        hostname: Optional[str] = None,
        search: Optional[str] = None,
        time_range: str = "5m",
        limit: int = 250,
        level: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        base_url = cls.normalize_url(url)
        if not ip and not hostname:
            return []

        # Constrói o filtro de origem (IP e/ou Hostname)
        origin_filters = []
        if ip:
            clean_ip = ip.strip()
            origin_filters.append(f'remote_ip:"{clean_ip}"')
        if hostname:
            clean_host = hostname.strip()
            origin_filters.append(f'hostname:"{clean_host}"')

        origin_clause = " OR ".join(origin_filters)
        if len(origin_filters) > 1:
            origin_clause = f"({origin_clause})"

        # Filtro de tempo
        valid_ranges = {"5m", "15m", "30m", "1h", "6h", "12h", "24h", "2d", "7d", "30d"}
        clean_range = time_range if time_range in valid_ranges else "5m"
        query_parts = [origin_clause, f"_time:{clean_range}"]

        # Filtro de texto multi-termo (Estilo Bitwarden/Raindrop: tokens por espaço, case-insensitive substring)
        if search and search.strip():
            tokens = [t.replace('"', '').replace('\\', '').strip() for t in search.strip().split() if t.strip()]
            for token in tokens:
                query_parts.append(f'_msg:~"(?i){token}"')

        # Filtro de severidade/nível opcional
        if level and level.strip():
            lvl = level.strip().lower()
            if lvl in ("crit", "critical", "err", "error"):
                query_parts.append('(level:critical OR level:crit OR level:err OR level:error OR severity:0 OR severity:1 OR severity:2 OR severity:3)')
            elif lvl in ("warn", "warning"):
                query_parts.append('(level:warn OR level:warning OR severity:4)')
            elif lvl in ("info", "notice"):
                query_parts.append('(level:info OR level:notice OR severity:5 OR severity:6)')

        base_query = " AND ".join(query_parts)
        # Ordena decrescente por tempo e aplica limite (até 5.000 entradas)
        final_query = f"{base_query} | sort by (_time) desc | limit {min(limit, 5000)}"

        logs: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(
                    f"{base_url}/select/logsql/query",
                    params={"query": final_query}
                )
                if resp.status_code != 200:
                    logger.error(f"Erro na query VictoriaLogs: {resp.status_code} - {resp.text}")
                    return []

                raw_text = resp.text.strip()
                if not raw_text:
                    return []

                for line in raw_text.split("\n"):
                    if not line.strip():
                        continue
                    try:
                        entry = json.loads(line)
                        raw_sev = entry.get("severity")
                        sev_int = None
                        try:
                            if raw_sev is not None:
                                sev_int = int(raw_sev)
                        except (ValueError, TypeError):
                            sev_int = None

                        raw_level = (entry.get("level") or "").lower()
                        if not raw_level and sev_int is not None:
                            raw_level = SEVERITY_MAP.get(sev_int, ("info", "Info"))[0]

                        logs.append({
                            "timestamp": entry.get("_time"),
                            "message": entry.get("_msg") or "",
                            "level": raw_level or "info",
                            "severity": sev_int,
                            "facility": entry.get("facility_keyword") or entry.get("facility") or "",
                            "hostname": entry.get("hostname") or "",
                            "remote_ip": entry.get("remote_ip") or ""
                        })
                    except Exception as err:
                        logger.warning(f"Erro ao decodificar linha do VictoriaLogs: {err}")
            except Exception as exc:
                logger.error(f"Falha ao consultar VictoriaLogs: {exc}")

        return logs

    @staticmethod
    def extract_device_timestamp(msg: str, arrival_dt: datetime) -> Optional[datetime]:
        if not msg:
            return None

        # 1. ISO 8601 / RFC 5424 (ex: 2024-10-28T08:30:00 or 2026-10-28 08:30:00)
        iso_match = re.search(r'(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?)', msg)
        if iso_match:
            val = iso_match.group(1).replace('T', ' ')
            try:
                parsed = datetime.fromisoformat(val)
                if not parsed.tzinfo:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return parsed
            except Exception:
                pass

        # 2. MikroTik (ex: oct/28/2026 08:30:00 or oct/28 08:30:00)
        mtk_match = re.search(r'([a-zA-Z]{3})/(\d{1,2})(?:/(\d{4}))?[\s](\d{2}:\d{2}:\d{2})', msg)
        if mtk_match:
            mon, day, yr, tm = mtk_match.groups()
            yr = yr or str(arrival_dt.year)
            try:
                parsed = datetime.strptime(f'{mon}/{day}/{yr} {tm}', '%b/%d/%Y %H:%M:%S')
                return parsed.replace(tzinfo=timezone.utc)
            except Exception:
                pass

        # 3. RFC 3164 (ex: Oct 28 08:30:00 or Oct  5 08:30:00)
        bsd_match = re.search(r'([a-zA-Z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})', msg)
        if bsd_match:
            mon, day, tm = bsd_match.groups()
            try:
                parsed = datetime.strptime(f'{mon} {day} {arrival_dt.year} {tm}', '%b %d %Y %H:%M:%S')
                return parsed.replace(tzinfo=timezone.utc)
            except Exception:
                pass

        return None

    @staticmethod
    def format_drift_human(drift_seconds: int) -> str:
        abs_s = abs(drift_seconds)
        direction = "adiantado" if drift_seconds > 0 else "atrasado"

        # Verifica desvio padrão de fuso horário (~1h, ~2h, ~3h, ~4h)
        for tz_hours in [1, 2, 3, 4, 5]:
            tz_sec = tz_hours * 3600
            if abs(abs_s - tz_sec) <= 180:
                return f"Divergência de fuso horário (~{tz_hours}h {direction}) - provável timezone incorreto"

        if abs_s >= 86400 * 365:
            years = round(abs_s / (86400 * 365.25), 1)
            return f"Relógio {direction} em ~{years} ano{'s' if years > 1 else ''}"
        elif abs_s >= 86400 * 30:
            months = round(abs_s / (86400 * 30))
            return f"Relógio {direction} em ~{months} m{'eses' if months > 1 else 'ês'}"
        elif abs_s >= 86400:
            days = round(abs_s / 86400)
            return f"Relógio {direction} em ~{days} dia{'s' if days > 1 else ''}"
        elif abs_s >= 3600:
            hours = abs_s // 3600
            mins = (abs_s % 3600) // 60
            return f"Relógio {direction} em {hours}h {mins}min"
        else:
            mins = abs_s // 60
            return f"Relógio {direction} em {mins} minuto{'s' if mins > 1 else ''}"

    @staticmethod
    def format_relative_time(seconds: float) -> str:
        s = max(0, int(seconds))
        if s < 60:
            return "há poucos segundos"
        elif s < 3600:
            m = s // 60
            return f"há {m} min"
        elif s < 86400:
            h = s // 3600
            return f"há {h} hora{'s' if h > 1 else ''}"
        else:
            d = s // 86400
            return f"há {d} dia{'s' if d > 1 else ''}"

    @classmethod
    async def check_device_log_health(
        cls,
        url: str,
        ip: Optional[str] = None,
        hostname: Optional[str] = None
    ) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        if not ip and not hostname:
            return {
                "status": "no_logs",
                "has_logs": False,
                "message": "Nenhum IP ou Hostname informado para consulta."
            }

        origin_filters = []
        if ip:
            origin_filters.append(f'remote_ip:"{ip.strip()}"')
        if hostname:
            origin_filters.append(f'hostname:"{hostname.strip()}"')

        origin_clause = " OR ".join(origin_filters)
        if len(origin_filters) > 1:
            origin_clause = f"({origin_clause})"

        async with httpx.AsyncClient(timeout=8.0) as client:
            last_log_query = f"{origin_clause} | sort by (_time) desc | limit 1"
            count_24h_query = f"{origin_clause} AND _time:24h | count()"

            last_log_resp, count_resp = await asyncio.gather(
                client.get(f"{base_url}/select/logsql/query", params={"query": last_log_query}),
                client.get(f"{base_url}/select/logsql/query", params={"query": count_24h_query}),
                return_exceptions=True
            )

            count_24h = 0
            if not isinstance(count_resp, Exception) and count_resp.status_code == 200:
                try:
                    c_data = json.loads(count_resp.text.strip())
                    count_24h = int(c_data.get("count(*)") or c_data.get("count()") or 0)
                except Exception:
                    pass

            if isinstance(last_log_resp, Exception) or last_log_resp.status_code != 200 or not last_log_resp.text.strip():
                return {
                    "status": "no_logs",
                    "has_logs": False,
                    "last_log_at": None,
                    "last_log_relative": "Nenhum log registrado",
                    "logs_count_24h": count_24h,
                    "clock_skew_detected": False,
                    "clock_drift_seconds": None,
                    "clock_drift_human": None,
                    "message": "Nenhum log recebido deste equipamento no VictoriaLogs."
                }

            lines = [l for l in last_log_resp.text.strip().split("\n") if l.strip()]
            if not lines:
                return {
                    "status": "no_logs",
                    "has_logs": False,
                    "last_log_at": None,
                    "last_log_relative": "Nenhum log registrado",
                    "logs_count_24h": count_24h,
                    "clock_skew_detected": False,
                    "clock_drift_seconds": None,
                    "clock_drift_human": None,
                    "message": "Nenhum log recebido deste equipamento no VictoriaLogs."
                }

            last_entry = json.loads(lines[0])
            arrival_iso = last_entry.get("_time")
            msg_text = last_entry.get("_msg") or ""

            arrival_dt = None
            if arrival_iso:
                try:
                    clean_iso = arrival_iso.replace("Z", "+00:00")
                    arrival_dt = datetime.fromisoformat(clean_iso)
                except Exception:
                    pass

            now_utc = datetime.now(timezone.utc)
            seconds_since_last = (now_utc - arrival_dt).total_seconds() if arrival_dt else 999999

            if seconds_since_last <= 900: # até 15 minutos
                stream_status = "active"
            elif seconds_since_last <= 86400: # até 24 horas
                stream_status = "idle"
            else:
                stream_status = "inactive"

            device_dt = cls.extract_device_timestamp(msg_text, arrival_dt or now_utc)
            clock_skew = False
            drift_seconds = None
            drift_human = None

            if device_dt and arrival_dt:
                drift_seconds = int((device_dt - arrival_dt).total_seconds())
                abs_drift = abs(drift_seconds)
                if abs_drift > 300: # Mais de 5 minutos de diferença
                    clock_skew = True
                    drift_human = cls.format_drift_human(drift_seconds)
                else:
                    drift_human = "Sincronizado (< 5 min)"

            return {
                "status": stream_status,
                "has_logs": True,
                "last_log_at": arrival_iso,
                "last_log_relative": cls.format_relative_time(seconds_since_last),
                "logs_count_24h": count_24h,
                "clock_skew_detected": clock_skew,
                "clock_drift_seconds": drift_seconds,
                "clock_drift_human": drift_human,
                "device_timestamp": device_dt.isoformat() if device_dt else None,
                "arrival_timestamp": arrival_iso,
                "last_message_sample": msg_text[:180] + ("..." if len(msg_text) > 180 else ""),
                "facility": last_entry.get("facility_keyword") or last_entry.get("facility"),
                "level": last_entry.get("level") or "info"
            }

    @classmethod
    async def get_all_devices_activity(cls, url: str) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        active_now = set()
        counts_24h = {}

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res_15m, res_24h = await asyncio.gather(
                    client.get(f"{base_url}/select/logsql/query", params={"query": "* AND _time:15m | stats by (remote_ip) count() logs | limit 2000"}),
                    client.get(f"{base_url}/select/logsql/query", params={"query": "* AND _time:24h | stats by (remote_ip) count() logs | limit 2000"}),
                    return_exceptions=True
                )

                if not isinstance(res_15m, Exception) and res_15m.status_code == 200:
                    for line in res_15m.text.strip().split("\n"):
                        if line.strip():
                            try:
                                d = json.loads(line)
                                ip = d.get("remote_ip")
                                if ip:
                                    active_now.add(ip)
                            except Exception:
                                pass

                if not isinstance(res_24h, Exception) and res_24h.status_code == 200:
                    for line in res_24h.text.strip().split("\n"):
                        if line.strip():
                            try:
                                d = json.loads(line)
                                ip = d.get("remote_ip")
                                cnt = int(d.get("logs") or 0)
                                if ip:
                                    counts_24h[ip] = cnt
                            except Exception:
                                pass
            except Exception as e:
                logger.error(f"Erro ao consultar atividade global do VictoriaLogs: {e}")

        return {
            "active_now_ips": list(active_now),
            "counts_24h": counts_24h
        }
