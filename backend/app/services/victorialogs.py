import httpx
import json
import logging
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
