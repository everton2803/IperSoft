import httpx
from typing import Optional, Dict, Any, List

class ZabbixService:
    @staticmethod
    def normalize_url(url: str) -> str:
        clean_url = url.strip().rstrip('/')
        if not clean_url.endswith('api_jsonrpc.php'):
            clean_url = f"{clean_url}/api_jsonrpc.php"
        return clean_url

    @classmethod
    async def call_api(
        cls, 
        url: str, 
        method: str, 
        params: Optional[Dict[str, Any]] = None, 
        auth: Optional[str] = None
    ) -> Any:
        endpoint = cls.normalize_url(url)
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": 1
        }
        if auth:
            payload["auth"] = auth

        headers = {
            "Content-Type": "application/json-rpc"
        }
        if auth:
            headers["Authorization"] = f"Bearer {auth}"

        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            try:
                response = await client.post(endpoint, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
            except httpx.RequestError as exc:
                raise ValueError(f"Não foi possível conectar ao Zabbix em {endpoint}: {exc}")
            except Exception as exc:
                raise ValueError(f"Erro na comunicação com Zabbix: {exc}")

        if "error" in data:
            err = data["error"]
            msg = err.get("data") or err.get("message") or "Erro desconhecido na API do Zabbix"
            raise ValueError(f"Zabbix API Error: {msg}")

        return data.get("result")

    @classmethod
    async def get_version(cls, url: str) -> str:
        return await cls.call_api(url, "apiinfo.version")

    @classmethod
    async def authenticate_user(cls, url: str, username: str, password: str) -> str:
        res = await cls.call_api(url, "user.login", {"username": username, "password": password})
        if not res:
            res = await cls.call_api(url, "user.login", {"user": username, "password": password})
        return res

    @classmethod
    async def update_host_status(
        cls, 
        url: str, 
        hostid: str, 
        status_code: int,
        token: Optional[str] = None, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> bool:
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("É necessário fornecer autenticação com o Zabbix.")

        await cls.call_api(
            url, 
            "host.update", 
            {"hostid": str(hostid), "status": int(status_code)}, 
            auth=auth_token
        )
        return True

    @classmethod
    async def fetch_hosts(
        cls, 
        url: str, 
        token: Optional[str] = None, 
        username: Optional[str] = None, 
        password: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("É necessário fornecer um API Token ou Usuário e Senha.")

        # Tentar obter macros globais do Zabbix (ex: {$SNMP_COMMUNITY} => ipermonitor)
        global_macros = {
            "{$SNMP_COMMUNITY}": "ipermonitor"
        }
        try:
            raw_global = await cls.call_api(
                url, 
                "usermacro.get", 
                {"globalmacro": True, "output": ["macro", "value"]}, 
                auth=auth_token
            )
            for gm in raw_global or []:
                m_name = gm.get("macro", "").strip()
                m_val = gm.get("value", "").strip()
                if m_name and m_val:
                    global_macros[m_name] = m_val
        except Exception:
            pass

        params = {
            "output": ["hostid", "host", "name", "status", "description"],
            "selectHostGroups": ["groupid", "name"],
            "selectInterfaces": ["interfaceid", "ip", "dns", "useip", "port", "type", "main", "details"],
            "selectParentTemplates": ["templateid", "name"],
            "selectMacros": ["macro", "value"]
        }

        raw_hosts = await cls.call_api(url, "host.get", params=params, auth=auth_token)
        parsed_hosts = []

        for h in raw_hosts or []:
            host_tech = h.get("host", "")
            host_visible = h.get("name") or host_tech
            status_str = "monitored" if str(h.get("status")) == "0" else "unmonitored"

            groups = [g.get("name") for g in h.get("hostgroups", []) if g.get("name")]
            templates = [t.get("name") for t in h.get("parentTemplates", []) if t.get("name")]

            # Interfaces
            interfaces = h.get("interfaces", [])
            primary_iface = None
            snmp_iface = None

            for iface in interfaces:
                if str(iface.get("main")) == "1":
                    primary_iface = iface
                if str(iface.get("type")) == "2": # SNMP interface
                    snmp_iface = iface

            if not primary_iface and interfaces:
                primary_iface = interfaces[0]

            ip_address = primary_iface.get("ip") if primary_iface else None
            dns = primary_iface.get("dns") if primary_iface else None
            port = primary_iface.get("port") if primary_iface else "10050"

            # SNMP Community resolution
            snmp_comm = None
            target_iface = snmp_iface or primary_iface
            if target_iface and target_iface.get("details"):
                details = target_iface.get("details")
                if isinstance(details, dict):
                    snmp_comm = details.get("community")

            # Se não achou na interface, verifica macros do próprio host
            if not snmp_comm:
                for m in h.get("macros", []):
                    m_macro = m.get("macro", "").upper()
                    if "COMMUNITY" in m_macro:
                        snmp_comm = m.get("value")
                        break

            # Resolução e Padronização: se a community for {$SNMP_COMMUNITY}, resolve para ipermonitor
            if snmp_comm:
                snmp_comm = snmp_comm.strip()
                if snmp_comm in global_macros:
                    snmp_comm = global_macros[snmp_comm]
                elif snmp_comm == "{$SNMP_COMMUNITY}":
                    snmp_comm = "ipermonitor"
            elif snmp_iface:
                # Se tem interface SNMP mas sem community explícita, usa o default resolvido
                snmp_comm = global_macros.get("{$SNMP_COMMUNITY}", "ipermonitor")

            parsed_hosts.append({
                "hostid": str(h.get("hostid")),
                "external_id": str(h.get("hostid")),
                "name": host_visible,
                "hostname": host_tech,
                "ip_address": ip_address,
                "dns": dns,
                "port": port,
                "snmp_community": snmp_comm,
                "host_groups": groups,
                "templates": templates,
                "status": status_str,
                "source": "zabbix",
                "raw_data": h
            })

        return parsed_hosts

    @classmethod
    async def push_host_to_zabbix(
        cls,
        url: str,
        host_data: Dict[str, Any],
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Sincroniza os dados do IperSoft diretamente para o Zabbix Server.
        Atualiza o host existente ou cria um novo caso ainda não exista.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        hostid = host_data.get("hostid")
        name = host_data.get("name") or host_data.get("hostname")
        hostname = host_data.get("hostname") or name
        ip = host_data.get("ip_address") or "127.0.0.1"
        dns = host_data.get("dns") or ""
        port = host_data.get("port") or "10050"
        snmp_comm = host_data.get("snmp_community") or "ipermonitor"
        status_raw = str(host_data.get("status") or "monitored").lower()
        status_val = 0 if status_raw in ("monitored", "active", "0") else 1

        # 1. Se não temos hostid, tenta buscar pelo hostname ou name técnico
        if not hostid:
            existing_hosts = await cls.call_api(
                url,
                "host.get",
                {"filter": {"host": [hostname]}, "output": ["hostid", "host", "name"]},
                auth=auth_token
            )
            if existing_hosts:
                hostid = str(existing_hosts[0]["hostid"])

        # Obter ou criar o grupo de hosts correspondente à empresa cliente
        client_group = (host_data.get("client_group") or "").strip()
        group_id = None
        if client_group:
            try:
                all_groups = await cls.call_api(url, "hostgroup.get", {"output": ["groupid", "name"]}, auth=auth_token)
                for g in (all_groups or []):
                    if g.get("name", "").strip().lower() == client_group.lower():
                        group_id = str(g["groupid"])
                        break

                if not group_id:
                    new_grp = await cls.call_api(url, "hostgroup.create", {"name": client_group}, auth=auth_token)
                    if new_grp and new_grp.get("groupids"):
                        group_id = str(new_grp["groupids"][0])
            except Exception as grp_err:
                logger.warning(f"Erro ao verificar/criar host group '{client_group}' no Zabbix: {grp_err}")

        if hostid:
            # 2. Host existe: atualizar host básico
            update_params = {
                "hostid": str(hostid),
                "host": hostname,
                "name": name,
                "status": status_val
            }
            if group_id:
                update_params["groups"] = [{"groupid": group_id}]

            await cls.call_api(url, "host.update", update_params, auth=auth_token)

            # Buscar interfaces existentes do host
            existing_ifaces = await cls.call_api(
                url,
                "hostinterface.get",
                {"hostids": str(hostid), "output": ["interfaceid", "ip", "dns", "port", "type", "main"]},
                auth=auth_token
            )

            primary_iface = None
            if existing_ifaces:
                for iface in existing_ifaces:
                    if str(iface.get("main")) == "1":
                        primary_iface = iface
                        break
                if not primary_iface:
                    primary_iface = existing_ifaces[0]

            if primary_iface:
                # Atualiza interface existente
                iface_type = int(primary_iface.get("type", 1))
                iface_port = port if iface_type == 1 else "161"
                iface_update = {
                    "interfaceid": primary_iface["interfaceid"],
                    "ip": ip,
                    "dns": dns,
                    "port": iface_port
                }
                if iface_type == 2:  # SNMP
                    iface_update["details"] = {
                        "version": 2,
                        "bulk": 1,
                        "community": snmp_comm
                    }
                await cls.call_api(url, "hostinterface.update", iface_update, auth=auth_token)
            else:
                # Cria interface se nenhuma foi encontrada
                new_iface = {
                    "hostid": str(hostid),
                    "dns": dns,
                    "ip": ip,
                    "main": 1,
                    "port": port,
                    "type": 1,
                    "useip": 1
                }
                await cls.call_api(url, "hostinterface.create", new_iface, auth=auth_token)

            return {
                "action": "updated",
                "hostid": str(hostid),
                "name": name,
                "hostname": hostname,
                "client_group": client_group or None,
                "groupid": group_id,
                "message": f"Host '{name}' (ID {hostid}) atualizado no Zabbix" + (f" no grupo '{client_group}'." if client_group else ".")
            }

        else:
            # 3. Host não existe: criar novo host no Zabbix
            if not group_id:
                groups_res = await cls.call_api(url, "hostgroup.get", {"output": ["groupid", "name"], "limit": 1}, auth=auth_token)
                if not groups_res:
                    # Cria um grupo se não existir nenhum
                    new_grp = await cls.call_api(url, "hostgroup.create", {"name": "IperSoft Discovered"}, auth=auth_token)
                    group_id = str(new_grp["groupids"][0])
                else:
                    group_id = str(groups_res[0]["groupid"])

            create_params = {
                "host": hostname,
                "name": name,
                "status": status_val,
                "groups": [{"groupid": group_id}],
                "interfaces": [{
                    "type": 1,
                    "main": 1,
                    "useip": 1,
                    "ip": ip,
                    "dns": dns,
                    "port": port
                }]
            }

            res = await cls.call_api(url, "host.create", create_params, auth=auth_token)
            new_hostid = str(res["hostids"][0])
            return {
                "action": "created",
                "hostid": new_hostid,
                "name": name,
                "hostname": hostname,
                "client_group": client_group or None,
                "groupid": group_id,
                "message": f"Host '{name}' criado no Zabbix com ID {new_hostid}" + (f" no grupo '{client_group}'." if client_group else ".")
            }

    @classmethod
    async def fetch_host_details(
        cls,
        url: str,
        hostid: str,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retorna informações cadastrais completas de um host no Zabbix:
        nome técnico, nome visível, templates associados, host groups, interfaces e status.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        params = {
            "hostids": [str(hostid)],
            "output": ["hostid", "host", "name", "status", "description"],
            "selectHostGroups": ["groupid", "name"],
            "selectParentTemplates": ["templateid", "name"],
            "selectInterfaces": ["interfaceid", "ip", "dns", "port", "type", "main", "details"],
            "selectMacros": ["macro", "value"]
        }

        hosts = await cls.call_api(url, "host.get", params=params, auth=auth_token)
        if not hosts:
            raise ValueError(f"Host com ID {hostid} não encontrado no Zabbix.")

        h = hosts[0]
        templates = [t.get("name") for t in h.get("parentTemplates", []) if t.get("name")]
        groups = [g.get("name") for g in h.get("hostgroups", []) if g.get("name")]

        interfaces = []
        snmp_community = None
        for iface in h.get("interfaces", []):
            details = iface.get("details") or {}
            comm = details.get("community") if isinstance(details, dict) else None
            if comm:
                snmp_community = comm
            interfaces.append({
                "interfaceid": iface.get("interfaceid"),
                "ip": iface.get("ip"),
                "dns": iface.get("dns"),
                "port": iface.get("port"),
                "type": iface.get("type"), # 1 = Agente, 2 = SNMP
                "is_main": str(iface.get("main")) == "1",
                "community": comm
            })

        if not snmp_community:
            for m in h.get("macros", []):
                if "COMMUNITY" in m.get("macro", "").upper():
                    snmp_community = m.get("value")
                    break

        return {
            "hostid": str(h.get("hostid")),
            "host": h.get("host"),
            "name": h.get("name") or h.get("host"),
            "status": "monitored" if str(h.get("status")) == "0" else "unmonitored",
            "status_code": int(h.get("status", 0)),
            "templates": templates,
            "host_groups": groups,
            "interfaces": interfaces,
            "snmp_community": snmp_community or "ipermonitor",
            "raw_data": h
        }

    @classmethod
    async def fetch_host_problems(
        cls,
        url: str,
        hostid: str,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Consulta todos os alarmes/triggers ativos (em estado de PROBLEM) para o host informado.
        Inclui severidade, horário de disparo, tags e os itens monitorados envolvidos.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        # Consultar triggers com valor 1 (estado ativo de problema)
        # expandDescription e expandComment garantem a resolução de macros pelo Zabbix Server
        params = {
            "hostids": [str(hostid)],
            "filter": {"value": 1},
            "monitored": 1,
            "active": 1,
            "skipDependent": 1,
            "output": ["triggerid", "description", "priority", "value", "lastchange", "comments"],
            "expandDescription": 1,
            "expandComment": 1,
            "selectLastEvent": ["eventid", "acknowledged", "clock", "value", "name"],
            "selectItems": ["itemid", "name", "key_", "value_type", "units", "lastvalue", "lastclock"],
            "selectTags": "extend",
            "sortfield": "priority",
            "sortorder": "DESC"
        }

        raw_triggers = await cls.call_api(url, "trigger.get", params=params, auth=auth_token)
        problems = []

        severity_map = {
            "0": {"label": "Não Classificado", "level": "not_classified", "color": "#9e9e9e"},
            "1": {"label": "Informação", "level": "info", "color": "#2196f3"},
            "2": {"label": "Aviso", "level": "warning", "color": "#ff9800"},
            "3": {"label": "Médio", "level": "average", "color": "#f57c00"},
            "4": {"label": "Alto", "level": "high", "color": "#e53935"},
            "5": {"label": "Desastre", "level": "disaster", "color": "#b71c1c"}
        }

        for trig in raw_triggers or []:
            if str(trig.get("value")) != "1":
                continue

            last_event = trig.get("lastEvent") or {}
            # Se o último evento for de recuperação (valor 0), não é problema ativo
            if str(last_event.get("value")) == "0":
                continue

            p_val = str(trig.get("priority", "0"))
            sev = severity_map.get(p_val, severity_map["0"])

            eventid = str(last_event.get("eventid")) if last_event.get("eventid") else None
            acknowledged = str(last_event.get("acknowledged")) == "1"

            items = []
            for it in trig.get("items", []):
                items.append({
                    "itemid": str(it.get("itemid")),
                    "name": it.get("name"),
                    "key": it.get("key_"),
                    "value_type": int(it.get("value_type", 0)),
                    "units": it.get("units") or "",
                    "lastvalue": it.get("lastvalue"),
                    "lastclock": it.get("lastclock")
                })

            # Prioriza o nome expandido do evento disparado, com fallback na descrição expandida da trigger
            event_name = (last_event.get("name") or "").strip()
            trigger_desc = (trig.get("description") or "").strip()
            resolved_description = event_name if event_name else trigger_desc

            problems.append({
                "triggerid": str(trig.get("triggerid")),
                "description": resolved_description,
                "comments": trig.get("comments"),
                "priority": int(p_val),
                "severity_label": sev["label"],
                "severity_level": sev["level"],
                "severity_color": sev["color"],
                "lastchange": trig.get("lastchange"),
                "eventid": eventid,
                "acknowledged": acknowledged,
                "tags": trig.get("tags") or [],
                "items": items
            })

        return problems

    @classmethod
    async def fetch_all_problems(
        cls,
        url: str,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        limit: int = 500
    ) -> List[Dict[str, Any]]:
        """
        Consulta todos os alarmes/triggers ativos em estado de problema (PROBLEM)
        no servidor Zabbix, retornando hosts associados, itens, severidade e status de reconhecimento.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        params = {
            "filter": {"value": 1},
            "monitored": 1,
            "active": 1,
            "skipDependent": 1,
            "output": ["triggerid", "description", "priority", "value", "lastchange", "comments"],
            "expandDescription": 1,
            "expandComment": 1,
            "selectLastEvent": ["eventid", "acknowledged", "clock", "value", "name"],
            "selectHosts": ["hostid", "host", "name"],
            "selectItems": ["itemid", "name", "key_", "value_type", "units", "lastvalue", "lastclock"],
            "selectTags": "extend",
            "sortfield": "priority",
            "sortorder": "DESC",
            "limit": limit
        }

        raw_triggers = await cls.call_api(url, "trigger.get", params=params, auth=auth_token)
        problems = []

        severity_map = {
            "0": {"label": "Não Classificado", "level": "not_classified", "color": "#9e9e9e"},
            "1": {"label": "Informação", "level": "info", "color": "#2196f3"},
            "2": {"label": "Aviso", "level": "warning", "color": "#ff9800"},
            "3": {"label": "Médio", "level": "average", "color": "#f57c00"},
            "4": {"label": "Alto", "level": "high", "color": "#e53935"},
            "5": {"label": "Desastre", "level": "disaster", "color": "#b71c1c"}
        }

        for trig in raw_triggers or []:
            if str(trig.get("value")) != "1":
                continue

            last_event = trig.get("lastEvent") or {}
            # Se o último evento for de normalização (valor 0), ignora
            if str(last_event.get("value")) == "0":
                continue

            p_val = str(trig.get("priority", "0"))
            sev = severity_map.get(p_val, severity_map["0"])

            eventid = str(last_event.get("eventid")) if last_event.get("eventid") else None
            acknowledged = str(last_event.get("acknowledged")) == "1"

            hosts = []
            for h in trig.get("hosts", []):
                hosts.append({
                    "hostid": str(h.get("hostid")),
                    "host": h.get("host"),
                    "name": h.get("name") or h.get("host")
                })

            items = []
            for it in trig.get("items", []):
                items.append({
                    "itemid": str(it.get("itemid")),
                    "name": it.get("name"),
                    "key": it.get("key_"),
                    "value_type": int(it.get("value_type", 0)),
                    "units": it.get("units") or "",
                    "lastvalue": it.get("lastvalue"),
                    "lastclock": it.get("lastclock")
                })

            # Prioriza o nome expandido do evento disparado, com fallback na descrição expandida da trigger
            event_name = (last_event.get("name") or "").strip()
            trigger_desc = (trig.get("description") or "").strip()
            resolved_description = event_name if event_name else trigger_desc

            problems.append({
                "triggerid": str(trig.get("triggerid")),
                "description": resolved_description,
                "comments": trig.get("comments"),
                "priority": int(p_val),
                "severity_label": sev["label"],
                "severity_level": sev["level"],
                "severity_color": sev["color"],
                "lastchange": trig.get("lastchange"),
                "eventid": eventid,
                "acknowledged": acknowledged,
                "hosts": hosts,
                "items": items,
                "tags": trig.get("tags") or []
            })

        return problems

    @classmethod
    async def acknowledge_event(
        cls,
        url: str,
        eventid: Optional[str] = None,
        triggerid: Optional[str] = None,
        acknowledged: bool = True,
        message: Optional[str] = None,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Reconhece ou remove o reconhecimento de um evento/trigger no Zabbix.
        Se o eventid fornecido já foi normalizado ou for inválido, busca automaticamente
        o problema ativo associado ao triggerid via problem.get.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        if acknowledged:
            action = 6 # 2 (ack) + 4 (message)
            msg_text = message or "Alarme reconhecido via IperSoft"
        else:
            action = 20 # 16 (unack) + 4 (message)
            msg_text = message or "Reconhecimento de alarme desmarcado via IperSoft"

        target_eventid = eventid

        # Se não tiver eventid ou se for buscar pelo trigger
        if not target_eventid and triggerid:
            problems = await cls.call_api(
                url,
                "problem.get",
                {"objectids": [str(triggerid)], "output": ["eventid", "acknowledged"]},
                auth=auth_token
            )
            if problems:
                target_eventid = str(problems[0]["eventid"])

        if not target_eventid:
            raise ValueError("Nenhum evento ativo encontrado para esta trigger no Zabbix.")

        params = {
            "eventids": [str(target_eventid)],
            "action": action,
            "message": msg_text
        }

        try:
            res = await cls.call_api(url, "event.acknowledge", params=params, auth=auth_token)
            return {
                "success": True,
                "eventid": str(target_eventid),
                "acknowledged": acknowledged,
                "result": res
            }
        except Exception as exc:
            err_msg = str(exc)
            if ("No permissions" in err_msg or "does not exist" in err_msg) and triggerid:
                # Tenta verificar se há outro problema ativo para este triggerid
                problems = await cls.call_api(
                    url,
                    "problem.get",
                    {"objectids": [str(triggerid)], "output": ["eventid", "acknowledged"]},
                    auth=auth_token
                )
                if problems and str(problems[0]["eventid"]) != str(target_eventid):
                    new_eid = str(problems[0]["eventid"])
                    params["eventids"] = [new_eid]
                    res = await cls.call_api(url, "event.acknowledge", params=params, auth=auth_token)
                    return {
                        "success": True,
                        "eventid": new_eid,
                        "acknowledged": acknowledged,
                        "result": res
                    }
                else:
                    raise ValueError(
                        "Este alarme já foi normalizado ou resolvido no Zabbix e não aceita mais alteração de reconhecimento."
                    )
            raise exc

    @classmethod
    async def fetch_host_items(
        cls,
        url: str,
        hostid: str,
        search: Optional[str] = None,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Retorna a lista de itens de monitoramento ativos do host.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        params = {
            "hostids": [str(hostid)],
            "monitored": 1,
            "output": ["itemid", "name", "key_", "value_type", "units", "lastvalue", "lastclock", "status"],
            "sortfield": "name",
            "sortorder": "ASC",
            "limit": 300
        }
        if search:
            params["search"] = {"name": search}

        raw_items = await cls.call_api(url, "item.get", params=params, auth=auth_token)
        items = []

        type_names = {
            0: "numeric_float",
            1: "character",
            2: "log",
            3: "numeric_unsigned",
            4: "text"
        }

        for it in raw_items or []:
            v_type = int(it.get("value_type", 0))
            is_numeric = v_type in (0, 3)

            items.append({
                "itemid": str(it.get("itemid")),
                "name": it.get("name"),
                "key": it.get("key_"),
                "value_type": v_type,
                "type_name": type_names.get(v_type, "unknown"),
                "is_numeric": is_numeric,
                "units": it.get("units") or "",
                "lastvalue": it.get("lastvalue"),
                "lastclock": it.get("lastclock")
            })

        return items

    @classmethod
    async def fetch_item_history(
        cls,
        url: str,
        itemid: str,
        value_type: int = 0,
        time_from: Optional[int] = None,
        limit: int = 150,
        token: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Busca os dados históricos de um item específico do Zabbix (history.get).
        Para itens numéricos ou de texto/log.
        """
        auth_token = token
        if not auth_token and username and password:
            auth_token = await cls.authenticate_user(url, username, password)

        if not auth_token:
            raise ValueError("Autenticação com o Zabbix não configurada.")

        params = {
            "itemids": [str(itemid)],
            "history": int(value_type),
            "sortfield": "clock",
            "sortorder": "DESC",
            "limit": limit
        }
        if time_from:
            params["time_from"] = int(time_from)

        raw_history = await cls.call_api(url, "history.get", params=params, auth=auth_token)
        history = []

        for h in raw_history or []:
            history.append({
                "clock": int(h.get("clock", 0)),
                "value": h.get("value")
            })

        # Retorna em ordem cronológica crescente (do mais antigo para o mais recente) para gráficos
        history.reverse()
        return history

