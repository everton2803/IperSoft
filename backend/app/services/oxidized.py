import httpx
import urllib.parse
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from app.models.asset import Asset, AssetOxidized


def parse_oxidized_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    # Ex: "2026-10-10 15:02:56 UTC"
    clean = dt_str.replace(" UTC", "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(clean, fmt)
        except ValueError:
            pass
    return None


class OxidizedService:
    @staticmethod
    def normalize_url(url: str) -> str:
        return url.strip().rstrip('/')

    @classmethod
    def _build_client_kwargs(cls, username: Optional[str] = None, password: Optional[str] = None) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "timeout": 20.0,
            "verify": False,
            "follow_redirects": True
        }
        if username and password:
            kwargs["auth"] = (username, password)
        return kwargs

    @classmethod
    async def test_connection(
        cls, 
        url: str, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        endpoint = f"{base_url}/nodes.json"
        kwargs = cls._build_client_kwargs(username, password)

        async with httpx.AsyncClient(**kwargs) as client:
            try:
                response = await client.get(endpoint)
                if response.status_code != 200:
                    raise ValueError(f"HTTP {response.status_code} retornado pelo Oxidized ({response.text[:100]})")
                nodes = response.json()
                if not isinstance(nodes, list):
                    raise ValueError("Formato de resposta inesperado do Oxidized: esperada lista de nós.")
                
                return {
                    "success": True,
                    "total_nodes": len(nodes),
                    "message": f"Conexão com Oxidized estabelecida com sucesso. {len(nodes)} dispositivos encontrados."
                }
            except httpx.RequestError as exc:
                raise ValueError(f"Falha de conexão com Oxidized em {base_url}: {exc}")
            except Exception as exc:
                raise ValueError(f"Erro ao testar conexão com Oxidized: {exc}")

    @classmethod
    async def fetch_nodes(
        cls, 
        url: str, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        base_url = cls.normalize_url(url)
        endpoint = f"{base_url}/nodes.json"
        kwargs = cls._build_client_kwargs(username, password)

        async with httpx.AsyncClient(**kwargs) as client:
            try:
                response = await client.get(endpoint)
                response.raise_for_status()
                data = response.json()
                return data if isinstance(data, list) else []
            except Exception as exc:
                raise ValueError(f"Erro ao consultar lista de nós no Oxidized: {exc}")

    @classmethod
    async def fetch_node_config(
        cls, 
        url: str, 
        node_name: str, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> str:
        base_url = cls.normalize_url(url)
        encoded_name = urllib.parse.quote(node_name)
        endpoint = f"{base_url}/node/fetch/{encoded_name}"
        kwargs = cls._build_client_kwargs(username, password)

        async with httpx.AsyncClient(**kwargs) as client:
            try:
                response = await client.get(endpoint)
                if response.status_code == 404:
                    raise ValueError(f"Configuração do nó '{node_name}' não encontrada no Oxidized.")
                response.raise_for_status()
                return response.text
            except Exception as exc:
                raise ValueError(f"Erro ao obter configuração de '{node_name}': {exc}")

    @classmethod
    async def trigger_backup(
        cls, 
        url: str, 
        node_name: str, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        encoded_name = urllib.parse.quote(node_name)
        endpoint = f"{base_url}/node/next/{encoded_name}"
        kwargs = cls._build_client_kwargs(username, password)

        async with httpx.AsyncClient(**kwargs) as client:
            try:
                response = await client.get(endpoint)
                # Oxidized retorna 303 Redirect ou 200 ao enfileirar o nó
                if response.status_code in (200, 302, 303):
                    return {
                        "success": True,
                        "message": f"Backup do dispositivo '{node_name}' colocado no topo da fila de execução do Oxidized!"
                    }
                raise ValueError(f"HTTP {response.status_code} ao solicitar backup de '{node_name}'")
            except Exception as exc:
                raise ValueError(f"Erro ao disparar backup para '{node_name}': {exc}")

    @classmethod
    async def sync_nodes_with_database(
        cls, 
        db: Session, 
        url: str, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        nodes = await cls.fetch_nodes(url, username, password)
        assets = db.query(Asset).all()

        # Índices rápidos por IP e por Nome normalizado
        asset_by_ip = {}
        asset_by_name = {}
        for a in assets:
            if a.ip_address and a.ip_address.strip() and a.ip_address.strip() != "-":
                asset_by_ip[a.ip_address.strip()] = a
            if a.name and a.name.strip():
                asset_by_name[a.name.strip().lower()] = a
            if a.hostname and a.hostname.strip():
                asset_by_name[a.hostname.strip().lower()] = a

        matched_count = 0
        unmatched_nodes = []

        for node in nodes:
            node_name = node.get("name") or node.get("full_name") or ""
            node_ip = (node.get("ip") or "").strip()
            node_model = node.get("model") or "RouterOS"
            node_group = node.get("group") or "default"
            node_status = node.get("status") or (node.get("last", {}).get("status") if isinstance(node.get("last"), dict) else None) or "unknown"
            
            # Data do último backup
            dt_raw = node.get("time") or (node.get("last", {}).get("end") if isinstance(node.get("last"), dict) else None)
            parsed_dt = parse_oxidized_datetime(dt_raw)
            
            # Tempo gasto
            time_taken = None
            if isinstance(node.get("last"), dict) and "time" in node["last"]:
                try:
                    time_taken = float(node["last"]["time"])
                except (ValueError, TypeError):
                    pass

            node_vars = node.get("vars") if isinstance(node.get("vars"), dict) else {}

            target_asset = asset_by_ip.get(node_ip)
            if not target_asset and node_name:
                target_asset = asset_by_name.get(node_name.strip().lower())

            if target_asset:
                matched_count += 1
                ox_record = db.query(AssetOxidized).filter(AssetOxidized.asset_id == target_asset.id).first()
                if not ox_record:
                    ox_record = AssetOxidized(
                        asset_id=target_asset.id,
                        node_name=node_name,
                        model=node_model,
                        group=node_group,
                        status=node_status,
                        last_backup=parsed_dt,
                        backup_time_taken=time_taken,
                        vars=node_vars,
                        last_sync=func.now()
                    )
                    db.add(ox_record)
                else:
                    ox_record.node_name = node_name
                    ox_record.model = node_model
                    ox_record.group = node_group
                    ox_record.status = node_status
                    if parsed_dt:
                        ox_record.last_backup = parsed_dt
                    ox_record.backup_time_taken = time_taken
                    ox_record.vars = node_vars
                    ox_record.last_sync = func.now()

                target_asset.backup_model = node_model
                target_asset.backup_enabled = True
            else:
                unmatched_nodes.append({
                    "name": node_name,
                    "ip": node_ip,
                    "model": node_model
                })

        db.commit()

        return {
            "total_nodes": len(nodes),
            "matched_count": matched_count,
            "unmatched_count": len(unmatched_nodes),
            "unmatched_nodes": unmatched_nodes[:20]
        }

    @classmethod
    def get_source_nodes(cls, db: Session) -> List[Dict[str, Any]]:
        """Gera lista de nós para o Oxidized consumir dinamicamente via source: http."""
        assets = db.query(Asset).filter(
            Asset.backup_enabled == True,
            Asset.ip_address.isnot(None),
            Asset.ip_address != "-",
            Asset.ip_address != ""
        ).all()

        source_list = []
        for a in assets:
            ip = a.ip_address.strip()
            group = a.client_group or "default"
            model = a.backup_model or "RouterOS"
            
            source_list.append(node_entry)

        return source_list

    @classmethod
    async def fetch_node_details(
        cls,
        url: str,
        node_name: str,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        """Busca dados detalhados atualizados de um nó específico no Oxidized."""
        base_url = cls.normalize_url(url)
        encoded_name = urllib.parse.quote(node_name)
        endpoint = f"{base_url}/node/show/{encoded_name}.json"
        kwargs = cls._build_client_kwargs(username, password)

        async with httpx.AsyncClient(**kwargs) as client:
            try:
                res = await client.get(endpoint)
                if res.status_code == 200:
                    data = res.json()
                    last_obj = data.get("last") or {}
                    dt_raw = data.get("time") or last_obj.get("end")
                    return {
                        "name": data.get("name") or node_name,
                        "model": data.get("model") or "RouterOS",
                        "group": data.get("group") or "default",
                        "ip": data.get("ip"),
                        "status": data.get("status") or last_obj.get("status") or "unknown",
                        "last_backup": dt_raw,
                        "time_taken": last_obj.get("time"),
                        "raw": data
                    }
            except Exception:
                pass

        # Fallback para buscar na lista geral de nós
        nodes = await cls.fetch_nodes(url, username, password)
        for n in nodes:
            n_name = n.get("name") or n.get("full_name") or ""
            if n_name.lower() == node_name.lower():
                last_obj = n.get("last") or {}
                dt_raw = n.get("time") or last_obj.get("end")
                return {
                    "name": n_name,
                    "model": n.get("model") or "RouterOS",
                    "group": n.get("group") or "default",
                    "ip": n.get("ip"),
                    "status": n.get("status") or last_obj.get("status") or "unknown",
                    "last_backup": dt_raw,
                    "time_taken": last_obj.get("time"),
                    "raw": n
                }

        raise ValueError(f"Nó '{node_name}' não encontrado no Oxidized.")

