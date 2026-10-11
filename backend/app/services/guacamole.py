import httpx
import asyncio
import base64
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

class GuacamoleService:
    @staticmethod
    def extract_raw_identifier(identifier: Optional[str]) -> Optional[str]:
        """
        Extrai o identificador numérico/original de uma conexão no Guacamole.
        Se receber um client_id base64 (ex: MTIzAGMAcG9zdGdyZXNxbA== -> '123\0c\0postgresql'),
        decodifica e retorna apenas '123'. Caso contrário, retorna o próprio identificador.
        """
        if not identifier:
            return None
        raw = str(identifier).strip()
        if not raw or raw.startswith("local-"):
            return None
        try:
            decoded = base64.b64decode(raw).decode("utf-8")
            if "\x00" in decoded:
                parts = decoded.split("\x00")
                if parts and parts[0]:
                    return parts[0]
        except Exception:
            pass
        return raw

    @staticmethod
    def normalize_url(url: str) -> str:
        clean_url = url.strip().rstrip('/')
        # Se não contém /guacamole e não termina com /api, anexa /guacamole
        if not clean_url.endswith('/guacamole') and '/guacamole/' not in clean_url and not clean_url.endswith('/api'):
            clean_url = f"{clean_url}/guacamole"
        return clean_url

    @classmethod
    async def authenticate(cls, url: str, username: str, password: str) -> Dict[str, Any]:
        base_url = cls.normalize_url(url)
        token_endpoint = f"{base_url}/api/tokens"

        async with httpx.AsyncClient(timeout=12.0, verify=False) as client:
            try:
                # Guacamole espera application/x-www-form-urlencoded
                response = await client.post(
                    token_endpoint,
                    data={"username": username, "password": password}
                )
            except httpx.RequestError as exc:
                raise ValueError(f"Não foi possível conectar ao Apache Guacamole em {base_url}: {exc}")

        if response.status_code == 403 or response.status_code == 401:
            raise ValueError("Usuário ou senha incorretos no Apache Guacamole.")
        elif response.status_code != 200:
            raise ValueError(f"Erro na API do Guacamole (HTTP {response.status_code}): {response.text}")

        data = response.json()
        auth_token = data.get("authToken")
        if not auth_token:
            raise ValueError("Autenticação no Guacamole falhou: token não recebido.")

        # Determinar dataSource (normalmente 'postgresql' ou 'mysql')
        available_ds = data.get("availableDataSources", [])
        datasource = None
        for ds in available_ds:
            if ds and ds.lower() != "caching":
                datasource = ds
                break
        if not datasource and available_ds:
            datasource = available_ds[0]
        if not datasource:
            datasource = "postgresql"

        return {
            "token": auth_token,
            "dataSource": datasource,
            "username": data.get("username") or username,
            "base_url": base_url
        }

    @classmethod
    async def test_connection(cls, url: str, username: str, password: str) -> Dict[str, Any]:
        auth_info = await cls.authenticate(url, username, password)
        token = auth_info["token"]
        datasource = auth_info["dataSource"]
        base_url = auth_info["base_url"]

        # Buscar conexões existentes para validar permissão de leitura
        conn_url = f"{base_url}/api/session/data/{datasource}/connections"
        async with httpx.AsyncClient(timeout=12.0, verify=False) as client:
            headers = {"Guacamole-Token": token}
            res = await client.get(conn_url, headers=headers)
            res.raise_for_status()
            connections = res.json() or {}

        total_conn = len(connections)
        return {
            "success": True,
            "dataSource": datasource,
            "total_connections": total_conn,
            "message": f"Conectado com sucesso ao Guacamole (DataSource: {datasource}). {total_conn} conexão(ões) encontrada(s)."
        }

    @classmethod
    async def fetch_connections_with_parameters(cls, url: str, username: str, password: str) -> List[Dict[str, Any]]:
        auth_info = await cls.authenticate(url, username, password)
        token = auth_info["token"]
        datasource = auth_info["dataSource"]
        base_url = auth_info["base_url"]

        conn_url = f"{base_url}/api/session/data/{datasource}/connections"
        headers = {"Guacamole-Token": token}

        async with httpx.AsyncClient(timeout=20.0, verify=False) as client:
            res = await client.get(conn_url, headers=headers)
            res.raise_for_status()
            raw_connections = res.json() or {}

            # Buscar mapa de grupos de conexão (pastas) para identificar a empresa
            groups_map = {}
            try:
                grp_res = await client.get(f"{base_url}/api/session/data/{datasource}/connectionGroups", headers=headers)
                if grp_res.status_code == 200:
                    raw_grps = grp_res.json() or {}
                    grp_items = list(raw_grps.values()) if isinstance(raw_grps, dict) else raw_grps
                    for g in grp_items:
                        g_id = str(g.get("identifier"))
                        g_name = g.get("name")
                        if g_id and g_name:
                            groups_map[g_id] = g_name
            except Exception:
                pass

            # Se vier dict de conexões indexado por identifier
            items = list(raw_connections.values()) if isinstance(raw_connections, dict) else raw_connections

            def get_default_port(proto: str) -> str:
                p = (proto or "ssh").lower()
                if p == "rdp":
                    return "3389"
                elif p == "telnet":
                    return "23"
                elif p == "vnc":
                    return "5900"
                return "22"

            # Função assíncrona para buscar parâmetros individuais se necessário
            async def get_params(item):
                identifier = str(item.get("identifier"))
                parent_id = str(item.get("parentIdentifier") or "ROOT")
                folder_name = groups_map.get(parent_id) if parent_id != "ROOT" else None

                # Padrão oficial do Apache Guacamole web client: base64(f"{identifier}\0c\0{datasource}")
                encoded_client_id = base64.b64encode(f"{identifier}\x00c\x00{datasource}".encode("utf-8")).decode("utf-8")
                proto = item.get("protocol") or "ssh"
                default_port = get_default_port(proto)

                existing_params = item.get("parameters") or {}
                if existing_params.get("hostname") or existing_params.get("host"):
                    return {
                        "identifier": identifier,
                        "client_id": encoded_client_id,
                        "datasource": datasource,
                        "name": item.get("name"),
                        "protocol": proto,
                        "hostname": existing_params.get("hostname") or existing_params.get("host"),
                        "port": str(existing_params.get("port") or default_port).strip(),
                        "username": existing_params.get("username") or None,
                        "password": existing_params.get("password") or None,
                        "parent_identifier": parent_id,
                        "client_group": folder_name,
                        "raw_params": existing_params
                    }

                # Se parameters veio vazio, consulta /connections/{id}/parameters
                param_url = f"{base_url}/api/session/data/{datasource}/connections/{identifier}/parameters"
                try:
                    p_res = await client.get(param_url, headers=headers)
                    if p_res.status_code == 200:
                        params_data = p_res.json() or {}
                        return {
                            "identifier": identifier,
                            "client_id": encoded_client_id,
                            "datasource": datasource,
                            "name": item.get("name"),
                            "protocol": proto,
                            "hostname": params_data.get("hostname") or params_data.get("host"),
                            "port": str(params_data.get("port") or default_port).strip(),
                            "username": params_data.get("username") or None,
                            "password": params_data.get("password") or None,
                            "parent_identifier": parent_id,
                            "client_group": folder_name,
                            "raw_params": params_data
                        }
                except Exception:
                    pass

                return {
                    "identifier": identifier,
                    "client_id": encoded_client_id,
                    "datasource": datasource,
                    "name": item.get("name"),
                    "protocol": proto,
                    "hostname": None,
                    "port": default_port,
                    "username": None,
                    "password": None,
                    "parent_identifier": parent_id,
                    "client_group": folder_name,
                    "raw_params": {}
                }

            # Executa com concorrência moderada
            tasks = [get_params(it) for it in items]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            valid_results = [r for r in results if isinstance(r, dict)]

            return valid_results

    @classmethod
    async def push_connection_to_guacamole(
        cls,
        url: str,
        username: str,
        password: str,
        conn_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Cria ou atualiza uma conexão remota (SSH, Telnet, RDP) no Apache Guacamole.
        """
        auth_info = await cls.authenticate(url, username, password)
        token = auth_info["token"]
        datasource = auth_info["dataSource"]
        base_url = auth_info["base_url"]

        raw_identifier = cls.extract_raw_identifier(conn_data.get("identifier"))
        name = conn_data.get("name") or "Novo Equipamento"
        protocol = (conn_data.get("protocol") or "ssh").lower()
        hostname = conn_data.get("hostname") or conn_data.get("ip_address")
        port = str(conn_data.get("port") or ("22" if protocol == "ssh" else ("23" if protocol == "telnet" else "3389"))).strip()
        guac_user = conn_data.get("username")
        guac_pass = conn_data.get("password")

        # Parâmetros de protocolo suportados pelo Guacamole
        parameters = {
            "hostname": hostname,
            "port": port
        }
        if guac_user:
            parameters["username"] = guac_user
        if guac_pass:
            parameters["password"] = guac_pass

        # Parâmetros adicionais específicos por protocolo
        if protocol == "rdp":
            parameters["ignore-cert"] = "true"
            parameters["security"] = "any"
        elif protocol == "ssh":
            parameters["font-size"] = "13"
            parameters["color-scheme"] = "gray-black"

        headers = {
            "Guacamole-Token": token,
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            target_identifier = None

            # 1. Se temos o identificador bruto, verifica se a conexão existe no Guacamole
            if raw_identifier:
                try:
                    chk_res = await client.get(
                        f"{base_url}/api/session/data/{datasource}/connections/{raw_identifier}",
                        headers=headers
                    )
                    if chk_res.status_code == 200:
                        target_identifier = raw_identifier
                except Exception:
                    pass

            # Se não tínhamos identifier ou o que tínhamos não existe mais (404), busca pelo nome exato
            if not target_identifier:
                try:
                    list_res = await client.get(
                        f"{base_url}/api/session/data/{datasource}/connections",
                        headers=headers
                    )
                    if list_res.status_code == 200:
                        all_conns = list_res.json() or {}
                        items = list(all_conns.values()) if isinstance(all_conns, dict) else all_conns
                        for it in items:
                            if it.get("name", "").strip().lower() == name.strip().lower():
                                target_identifier = str(it.get("identifier"))
                                break
                except Exception:
                    pass

            # Obter ou criar pasta / connection group no Guacamole correspondente à empresa cliente
            client_group = (conn_data.get("client_group") or conn_data.get("folder_name") or "").strip()
            target_parent = "ROOT"

            if client_group:
                try:
                    grp_res = await client.get(f"{base_url}/api/session/data/{datasource}/connectionGroups", headers=headers)
                    if grp_res.status_code == 200:
                        all_groups = grp_res.json() or {}
                        items = list(all_groups.values()) if isinstance(all_groups, dict) else all_groups
                        for g in items:
                            if g.get("name", "").strip().lower() == client_group.lower():
                                target_parent = str(g.get("identifier"))
                                break

                    # Se a pasta da empresa não existir no Guacamole, cria a pasta organizacional
                    if target_parent == "ROOT":
                        new_grp_payload = {
                            "name": client_group,
                            "type": "ORGANIZATIONAL",
                            "parentIdentifier": "ROOT",
                            "attributes": {}
                        }
                        create_grp_res = await client.post(
                            f"{base_url}/api/session/data/{datasource}/connectionGroups",
                            json=new_grp_payload,
                            headers=headers
                        )
                        if create_grp_res.status_code in (200, 201):
                            created_grp = create_grp_res.json()
                            target_parent = str(created_grp.get("identifier"))
                except Exception as grp_err:
                    logger.warning(f"Erro ao verificar/criar connection group '{client_group}' no Guacamole: {grp_err}")

            payload = {
                "name": name,
                "protocol": protocol,
                "parentIdentifier": target_parent,
                "parameters": parameters,
                "attributes": {}
            }

            if target_identifier:
                # 2. Atualizar conexão existente via PUT
                current_parent = "ROOT"
                try:
                    curr_res = await client.get(f"{base_url}/api/session/data/{datasource}/connections/{target_identifier}", headers=headers)
                    if curr_res.status_code == 200:
                        curr_data = curr_res.json()
                        current_parent = curr_data.get("parentIdentifier") or "ROOT"
                except Exception:
                    pass

                # Preserva parâmetros existentes (como password e layout de terminal) caso não tenham sido informados
                try:
                    p_res = await client.get(f"{base_url}/api/session/data/{datasource}/connections/{target_identifier}/parameters", headers=headers)
                    if p_res.status_code == 200:
                        existing_p = p_res.json() or {}
                        if not guac_pass and existing_p.get("password"):
                            parameters["password"] = existing_p["password"]
                        if not guac_user and existing_p.get("username"):
                            parameters["username"] = existing_p["username"]
                        for k, v in existing_p.items():
                            if k not in parameters and v is not None:
                                parameters[k] = v
                except Exception as p_err:
                    logger.warning(f"Aviso ao consultar parâmetros existentes no Guacamole: {p_err}")

                # Garante que a porta alvo e o hostname informados prevaleçam
                parameters["port"] = str(port).strip()
                if hostname:
                    parameters["hostname"] = hostname

                payload["parameters"] = parameters
                # Se foi especificado um grupo/pasta alvo diferente de ROOT, move para ela
                payload["parentIdentifier"] = target_parent if target_parent != "ROOT" else current_parent
                put_url = f"{base_url}/api/session/data/{datasource}/connections/{target_identifier}"
                res = await client.put(put_url, json=payload, headers=headers)

                # Se retornar 404 (conexão foi excluída ou ID não existe), reseta para criar uma nova via POST
                if res.status_code == 404:
                    target_identifier = None
                elif res.status_code not in (200, 204):
                    raise ValueError(f"Falha ao atualizar conexão no Guacamole (HTTP {res.status_code}): {res.text}")
                else:
                    encoded_client_id = base64.b64encode(f"{target_identifier}\x00c\x00{datasource}".encode("utf-8")).decode("utf-8")
                    return {
                        "action": "updated",
                        "identifier": str(target_identifier),
                        "client_id": encoded_client_id,
                        "name": name,
                        "protocol": protocol,
                        "hostname": hostname,
                        "port": port,
                        "client_group": client_group or None,
                        "parent_identifier": payload["parentIdentifier"],
                        "message": f"Conexão '{name}' ({protocol.upper()}) atualizada no Guacamole" + (f" na pasta '{client_group}'." if client_group else ".")
                    }

            if not target_identifier:
                # 3. Criar nova conexão via POST
                post_url = f"{base_url}/api/session/data/{datasource}/connections"
                res = await client.post(post_url, json=payload, headers=headers)
                if res.status_code not in (200, 201):
                    raise ValueError(f"Falha ao criar conexão no Guacamole (HTTP {res.status_code}): {res.text}")

                new_data = res.json()
                new_identifier = str(new_data.get("identifier"))
                encoded_client_id = base64.b64encode(f"{new_identifier}\x00c\x00{datasource}".encode("utf-8")).decode("utf-8")
                return {
                    "action": "created",
                    "identifier": new_identifier,
                    "client_id": encoded_client_id,
                    "name": name,
                    "protocol": protocol,
                    "hostname": hostname,
                    "port": port,
                    "client_group": client_group or None,
                    "parent_identifier": payload["parentIdentifier"],
                    "message": f"Conexão '{name}' ({protocol.upper()}) criada com sucesso no Guacamole" + (f" na pasta '{client_group}'." if client_group else ".")
                }

    @classmethod
    async def delete_connection_from_guacamole(
        cls,
        url: str,
        username: str,
        password: str,
        identifier: str
    ) -> bool:
        """
        Remove uma conexão existente no Apache Guacamole via DELETE /connections/{identifier}.
        """
        raw_identifier = cls.extract_raw_identifier(identifier)
        if not raw_identifier:
            return True

        auth_info = await cls.authenticate(url, username, password)
        token = auth_info["token"]
        datasource = auth_info["dataSource"]
        base_url = auth_info["base_url"]

        headers = {
            "Guacamole-Token": token
        }

        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            del_url = f"{base_url}/api/session/data/{datasource}/connections/{raw_identifier}"
            res = await client.delete(del_url, headers=headers)
            if res.status_code not in (200, 204, 404):
                raise ValueError(f"Falha ao excluir conexão no Guacamole (HTTP {res.status_code}): {res.text}")
            return True

    @classmethod
    async def fetch_connection_details(
        cls,
        url: str,
        username: str,
        password: str,
        identifier: str
    ) -> Dict[str, Any]:
        """
        Retorna informações cadastrais completas de uma conexão no Apache Guacamole:
        pasta/grupo, IP, porta, protocolo, usuário, existência de senha e parâmetros.
        """
        raw_identifier = cls.extract_raw_identifier(identifier)
        if not raw_identifier:
            raise ValueError("Identificador da conexão no Guacamole inválido ou ausente.")

        auth_info = await cls.authenticate(url, username, password)
        token = auth_info["token"]
        datasource = auth_info["dataSource"]
        base_url = auth_info["base_url"]

        headers = {"Guacamole-Token": token}

        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            # 1. Buscar conexão
            conn_res = await client.get(
                f"{base_url}/api/session/data/{datasource}/connections/{raw_identifier}",
                headers=headers
            )
            if conn_res.status_code == 404:
                raise ValueError(f"Conexão '{identifier}' não foi encontrada no Guacamole.")
            conn_res.raise_for_status()
            conn_data = conn_res.json()

            # 2. Buscar parâmetros
            params_res = await client.get(
                f"{base_url}/api/session/data/{datasource}/connections/{raw_identifier}/parameters",
                headers=headers
            )
            params = params_res.json() if params_res.status_code == 200 else {}

            # 3. Buscar nome da pasta/grupo
            parent_id = str(conn_data.get("parentIdentifier") or "")
            folder_name = "Raiz (ROOT)"
            if parent_id and parent_id != "ROOT":
                try:
                    grp_res = await client.get(
                        f"{base_url}/api/session/data/{datasource}/connectionGroups/{parent_id}",
                        headers=headers
                    )
                    if grp_res.status_code == 200:
                        folder_name = grp_res.json().get("name") or folder_name
                except Exception:
                    pass

        protocol = conn_data.get("protocol") or "ssh"
        target_ip = params.get("hostname") or ""
        target_port = params.get("port") or ("3389" if protocol == "rdp" else ("23" if protocol == "telnet" else "22"))
        user = params.get("username")
        has_pass = bool(params.get("password"))
        pass_val = params.get("password") if has_pass else None

        # Gerar client_id codificado em base64 se necessário
        encoded_id = conn_data.get("identifier")
        try:
            raw_b64 = f"{raw_identifier}\0c\0{datasource}"
            encoded_id = base64.b64encode(raw_b64.encode("utf-8")).decode("utf-8")
        except Exception:
            pass

        return {
            "identifier": raw_identifier,
            "client_id": encoded_id,
            "name": conn_data.get("name"),
            "parentIdentifier": parent_id,
            "folder_name": folder_name,
            "protocol": protocol,
            "hostname": target_ip,
            "port": target_port,
            "username": user,
            "has_password": has_pass,
            "password": pass_val,
            "parameters": params
        }

    @classmethod
    async def generate_launch_url(
        cls,
        url: str,
        username: str,
        password: str,
        identifier: str
    ) -> Dict[str, Any]:
        """
        Autentica no Guacamole, gera um authToken temporário e monta a URL pronta
        com o parâmetro '?token=' para login automático (SSO) sem exibir a tela de login.
        """
        raw_identifier = cls.extract_raw_identifier(identifier)
        if not raw_identifier:
            raise ValueError("Identificador da conexão no Guacamole inválido.")

        auth_info = await cls.authenticate(url, username, password)
        token = auth_info["token"]
        datasource = auth_info["dataSource"]
        base_url = auth_info["base_url"]

        # Client ID formato base64 esperado pelo hash routing do Guacamole (/client/{id})
        try:
            raw_b64 = f"{raw_identifier}\0c\0{datasource}"
            client_id = base64.b64encode(raw_b64.encode("utf-8")).decode("utf-8")
        except Exception:
            client_id = identifier

        # Monta a URL parametrizada com o token
        # O Guacamole consome ?token=<auth_token> tanto na query raiz quanto no hash
        launch_url = f"{base_url}/?token={token}#/client/{client_id}"

        return {
            "launch_url": launch_url,
            "token": token,
            "client_id": client_id,
            "base_url": base_url,
            "identifier": raw_identifier
        }

