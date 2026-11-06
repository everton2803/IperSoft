import os
import json
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import httpx
from sqlalchemy.orm import Session

from app.models.integration import IntegrationConfig
from app.models.template_update import ZabbixTemplateUpdate
from app.services.zabbix import ZabbixService

logger = logging.getLogger(__name__)

INDEX_FILE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "zabbix_official_templates.json")

class ZabbixTemplateService:
    _index_cache: Optional[Dict[str, Any]] = None

    @classmethod
    def get_official_index(cls) -> Dict[str, Any]:
        """Carrega o índice mapeado de UUID para dados do template oficial."""
        if cls._index_cache is None:
            if os.path.exists(INDEX_FILE_PATH):
                try:
                    with open(INDEX_FILE_PATH, "r", encoding="utf-8") as f:
                        cls._index_cache = json.load(f)
                except Exception as e:
                    logger.error(f"Erro ao carregar índice de templates: {e}")
                    cls._index_cache = {}
            else:
                logger.warning(f"Arquivo de índice não encontrado em: {INDEX_FILE_PATH}")
                cls._index_cache = {}
        return cls._index_cache

    @classmethod
    async def fetch_github_commit_info(cls, file_path: str, branch: str = "release/7.0") -> Dict[str, Any]:
        """Consulta o commit mais recente do template na API pública do GitHub."""
        url = f"https://api.github.com/repos/zabbix/zabbix/commits?path={file_path}&sha={branch}&per_page=1"
        headers = {"User-Agent": "IperSoft-ZabbixMonitor"}
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.get(url, headers=headers)
                if res.status_code == 200:
                    data = res.json()
                    if data and isinstance(data, list) and len(data) > 0:
                        commit = data[0]
                        sha = commit.get("sha", "")[:8]
                        commit_details = commit.get("commit", {})
                        committer = commit_details.get("committer", {}) or commit_details.get("author", {})
                        date_str = committer.get("date", "")
                        msg = commit_details.get("message", "").split("\n")[0]
                        html_url = commit.get("html_url", "")
                        return {
                            "sha": sha,
                            "date": date_str,
                            "message": msg,
                            "url": html_url
                        }
                elif res.status_code == 403:
                    logger.warning("Limite de requisições da API do GitHub atingido (Rate Limit).")
        except Exception as e:
            logger.warning(f"Não foi possível buscar commit do GitHub para {file_path}: {e}")
        return {}

    @classmethod
    def is_version_newer(cls, remote_ver: Optional[str], local_ver: Optional[str]) -> bool:
        """Compara versões no formato '7.0-X'."""
        if not remote_ver:
            return False
        if not local_ver:
            return True
        try:
            # Exemplo: '7.0-5' -> 5
            r_num = int(remote_ver.split("-")[-1])
            l_num = int(local_ver.split("-")[-1])
            return r_num > l_num
        except Exception:
            return remote_ver != local_ver

    @classmethod
    async def check_template_updates(cls, db: Session, force_github: bool = False) -> List[ZabbixTemplateUpdate]:
        """
        Consulta os templates em uso no Zabbix Central, cruza com o catálogo
        oficial do Zabbix 7.0 e atualiza a tabela zabbix_template_updates.
        """
        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
        if not cfg or not cfg.is_active or not cfg.url:
            logger.warning("Integração do Zabbix não configurada ou inativa.")
            return []

        auth_token = cfg.token or (
            await ZabbixService.authenticate_user(cfg.url, cfg.username, cfg.password)
            if cfg.username and cfg.password else None
        )
        if not auth_token:
            logger.error("Sem credenciais para autenticar na API do Zabbix.")
            return []

        # 1. Buscar templates no Zabbix que possuem hosts associados
        params = {
            "output": ["templateid", "uuid", "name", "vendor_name", "vendor_version"],
            "selectHosts": ["hostid"]
        }
        res = await ZabbixService.call_api(cfg.url, "template.get", params=params, auth=auth_token)
        all_templates = res if isinstance(res, list) else []

        # Filtrar templates em uso com hosts > 0
        used_templates = [t for t in all_templates if len(t.get("hosts", [])) > 0]
        official_index = cls.get_official_index()

        results: List[ZabbixTemplateUpdate] = []

        for tmpl in used_templates:
            template_id = str(tmpl.get("templateid"))
            uuid = tmpl.get("uuid") or ""
            name = tmpl.get("name")
            local_vendor = tmpl.get("vendor_name") or ""
            local_ver = tmpl.get("vendor_version") or ""
            hosts_count = len(tmpl.get("hosts", []))

            # Ignora templates customizados que começam com 'IPER '
            if name.startswith("IPER ") and not local_vendor.lower() == "zabbix":
                continue

            # Buscar no catálogo oficial por UUID ou por Nome
            official_data = official_index.get(uuid)
            if not official_data:
                # Fallback por nome
                for u, d in official_index.items():
                    if d.get("name") == name or d.get("template") == name:
                        official_data = d
                        uuid = u
                        break

            # Se não é template oficial da Zabbix SIA, pula
            if not official_data and local_vendor.lower() != "zabbix":
                continue

            remote_ver = official_data.get("version") if official_data else None
            file_path = official_data.get("file_path") if official_data else None

            has_update = cls.is_version_newer(remote_ver, local_ver)

            # Buscar registro existente no banco
            record = db.query(ZabbixTemplateUpdate).filter(ZabbixTemplateUpdate.template_id == template_id).first()
            if not record:
                record = ZabbixTemplateUpdate(
                    template_id=template_id,
                    uuid=uuid,
                    name=name,
                    vendor_name="Zabbix",
                    local_version=local_ver,
                    remote_version=remote_ver,
                    has_update=has_update,
                    hosts_count=hosts_count,
                    file_path=file_path
                )
                db.add(record)
            else:
                record.uuid = uuid
                record.name = name
                record.local_version = local_ver
                record.remote_version = remote_ver
                record.has_update = has_update
                record.hosts_count = hosts_count
                record.file_path = file_path

            # Buscar dados de commit no GitHub caso haja atualização ou force_github
            if file_path and (has_update or force_github or not record.remote_commit_sha):
                commit_info = await cls.fetch_github_commit_info(file_path)
                if commit_info:
                    record.remote_commit_sha = commit_info.get("sha")
                    record.remote_commit_date = commit_info.get("date")
                    record.remote_commit_msg = commit_info.get("message")
                    record.remote_commit_url = commit_info.get("url")

            results.append(record)

        db.commit()
        for r in results:
            db.refresh(r)

        return results

    @classmethod
    async def import_template_from_github(cls, db: Session, template_id: str, branch: str = "release/7.0") -> Dict[str, Any]:
        """
        Baixa o YAML oficial do repositório Zabbix no GitHub e importa
        diretamente no Zabbix Central usando configuration.import.
        """
        record = db.query(ZabbixTemplateUpdate).filter(ZabbixTemplateUpdate.template_id == template_id).first()
        if not record or not record.file_path:
            raise ValueError(f"Template com ID {template_id} não encontrado ou sem arquivo correspondente no catálogo.")

        cfg = db.query(IntegrationConfig).filter(IntegrationConfig.name == "zabbix").first()
        if not cfg or not cfg.is_active or not cfg.url:
            raise ValueError("Integração do Zabbix inativa ou não configurada.")

        auth_token = cfg.token or (
            await ZabbixService.authenticate_user(cfg.url, cfg.username, cfg.password)
            if cfg.username and cfg.password else None
        )
        if not auth_token:
            raise ValueError("Falha na autenticação com a API do Zabbix.")

        # 1. Baixar o arquivo YAML bruto do GitHub
        raw_url = f"https://raw.githubusercontent.com/zabbix/zabbix/{branch}/{record.file_path}"
        logger.info(f"Baixando YAML atualizado do GitHub: {raw_url}")
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(raw_url)
            if resp.status_code != 200:
                raise ValueError(f"Erro ao baixar YAML do GitHub (HTTP {resp.status_code}): {raw_url}")
            yaml_content = resp.text

        # 2. Executar configuration.import na API do Zabbix Central
        import_params = {
            "format": "yaml",
            "source": yaml_content,
            "rules": {
                "templates": {"createMissing": True, "updateExisting": True},
                "template_groups": {"createMissing": True, "updateExisting": True},
                "items": {"createMissing": True, "updateExisting": True},
                "triggers": {"createMissing": True, "updateExisting": True},
                "discoveryRules": {"createMissing": True, "updateExisting": True},
                "httptests": {"createMissing": True, "updateExisting": True}
            }
        }

        logger.info(f"Importando template '{record.name}' no Zabbix Central...")
        import_res = await ZabbixService.call_api(
            cfg.url,
            "configuration.import",
            params=import_params,
            auth=auth_token
        )

        # 3. Atualizar o registro local no banco
        record.local_version = record.remote_version
        record.has_update = False
        db.commit()
        db.refresh(record)

        return {
            "success": True,
            "template_id": template_id,
            "name": record.name,
            "new_version": record.local_version,
            "import_result": import_res
        }
