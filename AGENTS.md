# IperSoft — Guia de Orientação do Projeto e Arquitetura

Este documento serve como a fonte de verdade (Ground Truth) para agentes de inteligência artificial (como o Antigravity / Gemini) e desenvolvedores que trabalham no **IperSoft**. Ele descreve o propósito do sistema, arquitetura, modelo de dados, integrações externas, fluxos de frontend e backend, e as regras/decisões técnicas adotadas.

---

## 1. Visão Geral do Sistema

O **IperSoft** é uma plataforma centralizada de **Gestão e Monitoramento de Ativos de Redes e Telecom** (switches, roteadores, OLTs, servidores). Seu objetivo central é unificar em uma única interface amigável:
1. **Cadastro e Inventário Canônico** de equipamentos de rede (IP, DNS, grupo/cliente, credenciais).
2. **Monitoramento Zabbix**: Sincronização de hosts, hostgroups, templates, alarmes/triggers ativos em tempo real e gráficos de histórico de itens (métricas).
3. **Acesso Remoto Apache Guacamole**: Gerenciamento de conexões (SSH, Telnet, RDP), suporte a portas customizadas (ex: 2200, 22, 23, 3389), organização em pastas/grupos e abertura de sessão remota integrada com autenticação unificada.
4. **Backup de Configurações Oxidized**: Acompanhamento de backups automáticos de configs (RouterOS, Cisco, Huawei, etc.), status do último backup e histórico.
5. **Diagnósticos Nativos de Rede**: Testes de conectividade assíncronos sob demanda e agendados (ICMP Ping, teste SNMP v2c, testes TCP de portas de gerência).

---

## 2. Estrutura do Repositório & Controle de Versão

- **Repositório GitHub**: [https://github.com/everton2803/IperSoft](https://github.com/everton2803/IperSoft)
- **Origem Remota Git**: `git@github.com:everton2803/IperSoft.git` (SSH)
- **Branch Principal**: `main`
- **Autenticação**: Chave SSH Ed25519 (`~/.ssh/id_ed25519`) vinculada à conta GitHub `everton2803`.
- **Segurança de Credenciais**: O arquivo `.gitignore` bloqueia estritamente `.env`, pastas de dependências (`node_modules`), builds (`dist`) e caches do Python.

```
/home/everton/IperSoft/
├── .gitignore                 # Exclusões do Git (.env, node_modules, caches)
├── .env                       # Variáveis de ambiente gerais (DB, JWT, portas)
├── docker-compose.yml         # Orquestração dos 3 containers (db, backend, frontend)
├── backend/
│   ├── Dockerfile             # Python 3.11-slim
│   ├── requirements.txt       # FastAPI, Uvicorn, SQLAlchemy, Psycopg2, HTTPX, Pydantic, etc.
│   └── app/
│       ├── main.py            # Inicialização FastAPI, CORS, rotas e agendador horário de testes
│       ├── config.py          # Pydantic BaseSettings (.env)
│       ├── database.py        # SQLAlchemy engine e SessionLocal
│       ├── models/            # Modelos ORM (Asset, AssetZabbix, AssetGuacamole, AssetOxidized, etc.)
│       ├── routers/           # Endpoints REST (auth, users, assets, zabbix, guacamole, oxidized, diagnostics)
│       ├── schemas/           # Schemas Pydantic para validação de payload
│       ├── services/          # Clientes das APIs externas (Zabbix, Guacamole, Oxidized) e diagnósticos
│       └── utils/             # Hashing de senhas, JWT tokens, etc.
└── frontend/
    ├── Dockerfile             # Node.js alpine / Vite dev server
    ├── package.json           # React 18, Lucide React, Axios
    ├── vite.config.js         # Proxy / roteamento local Vite
    └── src/
        ├── App.jsx            # Roteamento e orquestração de views (assets, alarmes, integrações, login)
        ├── App.css            # Design system completo em dark mode, variáveis CSS e micro-animações
        ├── components/
        │   ├── AssetsList.jsx          # Tabela/cards de ativos, filtros, busca e badges de integração
        │   ├── AssetDetailView.jsx     # Visualizador em accordions independentes (as 6 linhas)
        │   ├── IntegrationsView.jsx    # Configuração e testes de Zabbix, Guacamole e Oxidized
        │   ├── ZabbixAlarmsView.jsx    # Central global de alarmes Zabbix (Tela Principal do IperSoft)
        │   ├── AlarmsView.jsx          # Central de diagnósticos e alarmes nativos do IperSoft (ICMP/SNMP/TCP)
        │   ├── UserManagementModal.jsx # Gestão de usuários e permissões
        │   └── Navbar.jsx              # Barra de navegação e status
        └── services/api.js             # Chamadas HTTP ao backend via Axios
```

---

## 3. Ambiente Docker e Portas

| Serviço | Container | Imagem / Base | Portas Mapeadas | Descrição |
|---|---|---|---|---|
| **db** | `ipersoft_postgres` | `postgres:16-alpine` | `5432:5432` | Banco de dados relacional |
| **backend** | `ipersoft_backend` | FastAPI / Python 3.11 | `8000:8000` | API REST (`/api/v1`) |
| **frontend** | `ipersoft_frontend` | React + Vite | `5173:5173`, `3000:5173`, `80:5173` | Interface Web SPA |

---

## 4. Banco de Dados e Modelos (SQLAlchemy)

### 4.1. `Asset` (`assets`)
Modelo principal do inventário:
- `id`: Chave primária.
- `name`: Nome canônico / visível.
- `hostname`: Hostname técnico do host.
- `ip_address`: Endereço IP primário.
- `status`: `active` ou `inactive`.
- `source`: Origem (`unified`, `zabbix`, `guacamole`, `manual`).
- `client_group`: Agrupamento de cliente / provedor / região.
- `backup_model`: Modelo para backup no Oxidized (ex: `RouterOS`, `Cisco`).
- `backup_enabled`: Booleano se deve ser feito backup.
- `backup_timeout`: Tempo limite em segundos para o Oxidized efetuar a leitura completa das configurações (padrão 30s). Configurável por equipamento para atender dispositivos lentos ou com configurações extensas.
- `raw_data`: JSON flexível com metadados adicionais (ex: `ignore_guacamole`).
- **Relacionamentos**:
  - `zabbix` -> `AssetZabbix` (1:1 com cascade delete).
  - `guacamole` -> `AssetGuacamole` (1:N com cascade delete).
  - `oxidized` -> `AssetOxidized` (1:1 com cascade delete).
  - `diagnostics` -> `NetworkDiagnostic` (1:N com cascade delete).

### 4.2. `AssetZabbix` (`asset_zabbix`)
- `hostid`: ID do host no Zabbix.
- `host`: Hostname técnico cadastrado no Zabbix Server (ex: `sw-dist-01` ou IP).
- `name`: Nome visível cadastrado no Zabbix Server (ex: `SW-DIST-01 - Borda`).
- `port`: Porta do agente/snmp (padrão 10050 ou 161).
- `snmp_community`: Community SNMP (padrão `ipermonitor`).
- `host_groups`: JSON list com IDs ou nomes dos grupos no Zabbix.
- `templates`: JSON list com IDs ou nomes dos templates associados.
- `status`: `monitored` / `unmonitored`.
- `last_sync`: Timestamp da última sincronização.
- Diagnósticos rápidos de monitoramento em cache: `icmp_status`, `icmp_latency_ms`, `snmp_status`, `snmp_message`.

### 4.3. `AssetGuacamole` (`asset_guacamole`)
- `connection_id`: Identificador da conexão no Guacamole (decodificado ou bruto).
- `connection_name`: Nome da conexão no Guacamole.
- `protocol`: `ssh`, `telnet`, `rdp`, etc.
- `port`: Porta de acesso remoto (ex: `22`, `2200`, `23`, `3389`).
- `hostname`: Hostname ou IP cadastrado no Guacamole.
- `username`: Usuário remoto cadastrado.
- `password`: Senha remota armazenada (se houver).
- `parameters`: JSON com todos os parâmetros do Guacamole (`font-size`, `color-scheme`, etc.).
- Diagnósticos de porta em cache: `tcp_status`, `tcp_latency_ms`, `tcp_message`.

### 4.4. `AssetOxidized` (`asset_oxidized`)
- `node_name`: Nome do nó no Oxidized.
- `model`: Modelo de equipamento (`RouterOS`, `IOS`, etc.).
- `group`: Grupo de nós (`default`, `core`, etc.).
- `status`: Status do último backup (`success`, `fail`, `no_connection`, `never`).
- `last_backup`: Timestamp do último backup executado.
- `backup_time_taken`: Tempo gasto no último backup em segundos.

### 4.5. `NetworkDiagnostic` (`network_diagnostics`)
Histórico completo de testes de conectividade:
- `test_type`: `icmp`, `snmp`, `ssh`, `telnet`, `rdp`.
- `status`: `ok`, `failed`, `timeout`.
- `latency_ms`: Tempo de resposta em ms.
- `target_host` & `target_port`.
- `tested_at`: Data e hora do teste.

### 4.6. `IntegrationConfig` (`integration_configs`)
Configuração de conexão para cada uma das integrações (`zabbix`, `guacamole`, `oxidized`):
- `name`: Nome identificador.
- `url`: URL base da API.
- `token`: Token de API (Bearer / Zabbix API token / Guacamole token).
- `username` & `password`: Credenciais para autenticação automatizada.
- `is_active`: Flag ativando ou desativando a integração no sistema.

---

## 5. Serviços e Lógicas de Negócio Backend

### 5.0. Parsing e Vinculação Unificada entre Plataformas (Strict IP Matching)
- **Chave Canônica de Rede (Endereço IP)**: A vinculação e parsing de dispositivos entre o IperSoft, Zabbix Server, Apache Guacamole e Oxidized é realizada **estritamente pelo Endereço IP primário (`ip_address`)** como Prioridade 1.
- **Hierarquia de Correspondência**:
  1. **Prioridade 1 (Endereço IP)**: O IperSoft consulta o IP do host/conexão/nó na ferramenta externa e associa diretamente ao ativo que possui o mesmo IP cadastrado.
  2. **Prioridade 2 (ID de Integração)**: `hostid` (Zabbix) ou `connection_id` (Guacamole), caso o IP tenha sofrido alteração.
  3. **Fallback nominal (Somente quando não houver IP)**: Se o registro não possuir IP cadastrado, é feito fallback por correspondência exata de nome.
- **Desacoplamento Completo dos Campos de Nome**:
  - **IperSoft (Card 1)**: Possui unicamente o campo **Nome do Equipamento** (`name`), sem exigir nem exibir hostname técnico duplicado.
  - **Zabbix Server (Card 2)**: Possui campos independentes para **Host Técnico no Zabbix** (`zabbix_host`) e **Nome Visível no Zabbix** (`zabbix_name`).
  - **Apache Guacamole (Card 3)**: Possui campo dedicado para o **Nome da Conexão no Guacamole** (`guacamole_connection_name`).
  - **Oxidized Daemon (Card 4)**: Consome e espelha **estritamente o Nome do Equipamento no IperSoft** (`asset.name`), assegurando consistência nas árvores Git de backup sem discrepâncias.

### 5.1. `GuacamoleService` (`app/services/guacamole.py`)
- **Autenticação**: Post em `/api/tokens` enviando `username` e `password`. Detecta o `dataSource` ativo (`postgresql` ou `mysql`).
- **Identifier Decodificado**: Guacamole usa identificadores base64 (ex: `MTIzAGMAcG9zdGdyZXNxbA==`). A função `extract_raw_identifier` extrai com segurança a ID numérica real antes de chamar endpoints de atualização.
- **Acesso Remoto SSO e Resolução de URL Pública (`public_url`)**:
  - Para abertura de sessão remota (tanto no **Terminal Embutido via iframe** quanto no botão **Abrir em Nova Aba**), o sistema utiliza estritamente a URL externa HTTPS (`https://guacamoles.iper.net.br/guacamole`).
  - O backend gera o token de autenticação temporário via API e monta a URL com `?token={token}#/client/{client_id}` apontando para o domínio público.
  - Isso elimina completamente erros de **Conteúdo Misto (Mixed Content)** que bloqueavam o carregamento do iframe em navegadores modernos (`https://ipersoft.iper.net.br` tentando carregar `http://10.10.1.2:8086`) e garante acessibilidade de qualquer rede externa sem depender do IP privado da VPN.
- **Portas Customizadas (ex: 2200)**: Assegura que tanto ao criar quanto ao sincronizar ou atualizar uma conexão, a porta informada pelo operador seja gravada no objeto `AssetGuacamole` e no dicionário `parameters["port"]` enviado à API do Guacamole.
- **Preservação de Credenciais**: Quando uma conexão é atualizada, os parâmetros existentes não são apagados; senhas existentes são mantidas caso o usuário não tenha digitado uma nova.
- **Importação Automática (1h) e Sob Demanda (`sync_guacamole_connections_with_db`)**:
  - A cada 1 hora (via `hourly_diagnostics_scheduler` em `main.py`) ou sob demanda via `POST /api/v1/integrations/guacamole/match`, o IperSoft consulta todas as conexões do Apache Guacamole, vincula a equipamentos existentes por `connection_id`, nome/hostname ou endereço IP, e importa automaticamente novos dispositivos cadastrados no Guacamole para o IperSoft (sem jamais excluir ou alterar conexões no servidor Guacamole automaticamente).
- **Envio / Exclusão Estritamente Manual**:
  - O IperSoft **nunca** altera nem exclui conexões no Apache Guacamole de forma automática ao salvar, desativar ou remover um ativo localmente. Qualquer envio ou remoção no servidor Guacamole deve ser acionado manualmente pelo operador nos botões dedicados (`POST /api/v1/assets/{id}/sync-guacamole` ou `DELETE /api/v1/assets/{id}/guacamole`).


### 5.2. `ZabbixService` (`app/services/zabbix.py`)
- **JSON-RPC**: Chamadas padronizadas a `api_jsonrpc.php` com suporte a autenticação por Token ou `user.login`.
- **Importação Automática (1h) e Sob Demanda (`sync_zabbix_hosts_with_db`)**:
  - A cada 1 hora (via `hourly_diagnostics_scheduler` em `main.py`) ou sob demanda via `POST /api/v1/integrations/zabbix/sync`, o IperSoft importa novos hosts cadastrados diretamente no Zabbix e vincula/atualiza ativos existentes (por `hostid`, `hostname`/`name` ou `ip_address`), evitando duplicidades com equipamentos já vindos do Guacamole ou criados manualmente.
- **Envio Estritamente Manual & Tratamento de Discovered Hosts (LLD)**:
  - Alterações de cadastro ou status feitas no IperSoft não alteram o Zabbix Server automaticamente; o envio para o Zabbix ocorre apenas quando o operador clica manualmente no botão **Sincronizar Zabbix** (`POST /api/v1/assets/{id}/sync-zabbix`).
  - **Hosts Descobertos por LLD (`flags: 4`)**: No Zabbix, hosts criados automaticamente por regras de descoberta (como máquinas virtuais VMware LLD ou ICMP Discovery) têm `flags == "4"`. O Zabbix Server bloqueia estritamente alterações em `host`, `name` (nome visível), `groups` e `interfaces` via API nesses hosts (`Cannot update "name" for a discovered host`). O `push_host_to_zabbix` detecta a flag `is_discovered` e atualiza exclusivamente o `status` (monitored/unmonitored), preservando a integridade do LLD do Zabbix e evitando erros HTTP 400.
  - Caracteres especiais como dois pontos (`:`), traços, espaços e acentuações são 100% suportados no Nome Visível tanto no IperSoft quanto no Zabbix Server.
- **Triggers / Alarmes**: Busca de triggers ativas (`trigger.get` com `filter={"value": 1}`) e mapeamento de severidades (0 a 5: Não classificado a Desastre).
- **Resolução Completa de Macros e Operational Data (`opdata`)**: Em chamadas `trigger.get` (`fetch_all_problems` e `fetch_host_problems`), inclusão obrigatória de `expandDescription: 1`, `expandComment: 1` e extração de `name` do `selectLastEvent`. Garante que nomes de protótipos de LLD (ex: `{#IFNAME}`) e thresholds com macros (ex: `{$TEMP.CRIT}`, `{$PART.CRIT}`) cheguem ao frontend 100% resolvidos com valores reais. Para os **Dados Operacionais (`opdata`)**, o sistema consulta os eventos ativos via `problem.get` em lote (`eventids`), obtendo o valor dinâmico avaliado em tempo real pelo Zabbix (ex: `status: down (0)`, `espaço livre: 4.86 %`, `status: sem energia (1)`), com fallback para macros resolvidas da trigger.
- **Itens e Histórico**: Coleta de métricas do host (`item.get`) e histórico numérico (`history.get` com tipos numéricos `0` float e `3` integer) ou de texto (`1`, `2`, `4`).
  - **Estratégia Otimizada para Janelas Temporais (`fetch_item_history`)**:
    - Para períodos curtos (`1h`, `6h`): Consulta direta em `history.get` (`sortorder: ASC`), cobrindo 1h (~60 pontos) e 6h (~360 pontos).
    - Para `24h`: Consulta `history.get` com limite ampliado (`limit: 2500`, `sortorder: ASC`) cobrindo as 24 horas completas; aplica downsampling uniforme para ~300 pontos caso ultrapasse esse limiar, preservando o ponto inicial e o ponto final mais recente.
    - Para `7d`: Consulta prioritariamente `trend.get` (`sortorder: ASC`) para consolidar 1 ponto médio por hora (`value_avg`), cobrindo os 7 dias completos (~168 pontos) com alta precisão e baixo consumo de memória, com fallback transparente para `history.get` caso necessário.
    - **Frontend `ZabbixNumericChart`**: Ordenação estrita crescente (`clock ASC`), 5 marcações temporais uniformes no Eixo X (0%, 25%, 50%, 75%, 100%) formatadas conforme a granularidade (`DD/MM` para 7d, `DD/MM HHh` para 24h, `HH:mm` para 1h/6h) e tooltip fluido com data e hora completas no padrão brasileiro (`toLocaleString('pt-BR')`).

### 5.3. `OxidizedService` (`app/services/oxidized.py`)
- **Consulta e Sincronização de Status**: Consulta endpoints `/nodes.json`, `/node/fetch/{node}` e `/node/version/{node}` para sincronizar status de backup dos nós com equipamentos do IperSoft.
  - **Prevenção de Colisões e Chaves Duplicadas**: A função `sync_nodes_with_database` utiliza dicionário em memória de registros existentes e dá prioridade absoluta a correspondência exata por nome (`node_name.lower()`), seguida por IP, garantindo que múltiplos nós com mesmo IP (ou NAT/VMs) nunca gerem `UniqueViolation` em `asset_oxidized`.
- **Disparo Manual de Backup**: Suporte a gatilho manual de backup (`/node/next/{node}`).
- **Recarregamento Sob Demanda e Desacoplamento de Sincronização (`/reload`)**:
  - **Desacoplamento Total de Integração Automática**: A edição, ativação/desativação em lote ou exclusão de um equipamento no IperSoft atualiza **exclusivamente o banco de dados do IperSoft**, sem disparar chamadas automáticas externas para o Zabbix, Guacamole ou daemon do Oxidized.
  - A sincronização das alterações do IperSoft para cada plataforma é feita **manualmente sob demanda pelo operador através de botões dedicados e separados por integração**:
    - **Sincronizar Zabbix**: Envia cadastro/status para a API do Zabbix Server (`POST /api/v1/assets/{id}/sync-zabbix`).
    - **Sincronizar Guacamole**: Envia conexão/credenciais para a API do Apache Guacamole (`POST /api/v1/assets/{id}/sync-guacamole`).
    - **Sincronizar Oxidized**: Atualiza o nó e aciona `POST /api/v1/assets/{id}/sync-oxidized` (que chama `/reload` no daemon do Oxidized).
  - Há botões dedicados de recarga manual sob demanda na tela de Integrações (**Recarregar Nós no Oxidized**) e diretamente no modal de detalhes do ativo na Aba 3 (**Comparativo & Sincronização Externa**).
- **Fornecimento Dinâmico de Inventário (`source: http`)**:
  - Endpoint `GET /api/v1/integrations/oxidized/nodes`: Entrega a lista de nós participantes do backup (`backup_enabled == True`) em formato JSON para consumo dinâmico pelo driver nativo `source: http` do Oxidized.
  - **Suporte a Timeout Ajustável por Dispositivo**: O payload exporta `"timeout": X` tanto como atributo de primeiro nível quanto dentro de `"vars": {"timeout": X}` (com padrão de 30s se não customizado). Isso permite aumentar o tempo limite para leitura de configurações pesadas (ex: switches e roteadores de borda/core) sem afetar o timeout geral de dispositivos mais rápidos.
  - **Normalização de Modelos em Minúsculas**: No Oxidized (Linux/Ruby), os arquivos de modelo de sistema operacional são estritamente case-sensitive e em minúsculas (`routeros.rb`, `dmos.rb`, `cisco.rb`). O backend converte automaticamente os modelos cadastrados no banco para minúsculas (`.lower()`).
  - **Filtragem de Protocolos Incompatíveis**: Conexões com protocolo não suportado pelo Oxidized (como `rdp` para máquinas Windows) são automaticamente ignoradas na exportação de nós.
  - **Portas Customizadas e Credenciais**: Mapeia automaticamente portas não padrão (ex: `2200`, `2233`) e credenciais de acesso remoto a partir dos vínculos com `AssetGuacamole`.
  - **Endpoint Legado / Compatibilidade CSV**: `GET /api/v1/integrations/oxidized/router.db` entrega o inventário diretamente no formato texto `router.db` delimitado por dois pontos (`name:model:ip:proto:port:user:pwd`).
- **Diretiva `resolve_dns: false` no Oxidized**: No `/opt/oxidized/config`, deve-se declarar `resolve_dns: false` para que o Oxidized conecte diretamente pelo endereço informado no campo `ip`, impedindo erros de resolução DNS (`Resolv::ResolvError`) provocados por nomes amigáveis que contenham espaços ou pontuações.

### 5.4. `DiagnosticsService` (`app/services/diagnostics.py`) & Agendador Horário (`main.py`)
- **ICMP Ping**: Execução nativa Linux (`ping -c 1 -W 2`) via `asyncio.create_subprocess_exec`.
- **SNMP Test**: Envio de pacote UDP de teste na porta 161 com community configurada.
- **TCP Test**: Teste de abertura de socket TCP na porta do serviço (ex: 22/2200 para SSH, 23 para Telnet, 3389 para RDP).
- **Agendador Horário Automático (`hourly_diagnostics_scheduler`)**: Background task iniciada no boot do FastAPI que executa a cada **1 hora (3600s)**:
  1. Importação automática de hosts do **Zabbix Server** para o IperSoft (`sync_zabbix_hosts_with_db`).
  2. Importação automática de conexões do **Apache Guacamole** para o IperSoft (`sync_guacamole_connections_with_db`).
  3. Bateria de diagnósticos de rede (ICMP, SNMP, TCP) em todos os ativos.

### 5.5. `VictoriaLogsService` (`app/services/victorialogs.py`)
- **Integração com LogsQL**: Consulta direta à API do VictoriaLogs (`GET /select/logsql/query`) via rede privada WireGuard (`http://10.10.1.2:9428`), sem intermediários.
- **Filtro de Dispositivo por IP/Hostname**: `(remote_ip:"<ip>" OR hostname:"<nome>")` com suporte a filtros de período (`5m`, `15m`, `1h`, `6h`, `24h`, `7d`), busca textual multi-termo (`AND "<termo>"`), níveis de severidade (crítico, erro, aviso, info) e limite configurável de linhas (100, 250, 500, 1.000, 2.500 e até 5.000 entradas).
- **Health & Stats**: Métricas de volume de logs em tempo real (`_time:1h | count()`) e health check nativo.

### 5.6. Stack de Backup de Roteadores & Telecom na Oracle Cloud (`10.10.2.2`)
- **Localização e Propósito**: Hospedada na instância ARM64 da Oracle Cloud (`/opt/backup-services`), isolada geograficamente do datacenter local (BrDrive), garantindo redundância total de Disaster Recovery para os ISPs.
- **SFTPGo (FTP / SFTP / Web Client)**:
  - Docker container: `sftpgo` (`drakkan/sftpgo:latest`).
  - FTP porta 21 (range passivo `50000-50100`, IP passivo forçado `10.10.2.2`).
  - SFTP porta 2022 e Web GUI porta 8082 (publicada via Traefik em `https://ftp.iper.net.br`).
  - Mapeamento das pastas dos clientes em `/opt/backup-services/data/ftp/<cliente>/` e pasta compartilhada `/tftp` acessível graficamente.
  - Administrador: `admin` / `09@Iper`.
  - Contas migradas do FileZilla: Todos os 24 usuários (provedores `bkp.*`, clientes `clientes.*`, UNMs `unm*` e `ie.mksolutions`) cadastrados com suas credenciais originais e pastas chroot dedicadas.
- **TFTP Server (tftp-hpa)**:
  - Docker container: `tftp-server` (Alpine `tftp-hpa` com `network_mode: host`).
  - Escuta em `0.0.0.0:69/udp` e grava em `/opt/backup-services/data/tftp/<cliente>/` (pastas criadas para todos os ISPs: Athila, ATM, Bkup, Diretrix, Fortaleza, Infonet, Inforline, Iper, LHTech, Oestenets, RTnet, Seven, Taionet).
  - Pastas gerenciáveis diretamente pela interface web do SFTPGo.
- **Rotina Diária de Compactação (`archive_backups.sh` + systemd timer)**:
  - Timer: `backup-archive.timer` disparado diariamente às **00:00:00 (Horário de Brasília)**.
  - Script: `/opt/backup-services/scripts/archive_backups.sh`.
  - Comportamento: Para cada pasta de cliente em `data/ftp` e `data/tftp`, compacta todos os arquivos soltos e subpastas (como árvores do UNM Fiberhome) em `_historico/<cliente>_AAAA-MM-DD.tar.gz`. Remove os arquivos arquivados para não sobrescrever nem duplicar, porém **preserva intacta a estrutura de subpastas vazias** para que softwares como UNM2000 nunca quebrem rotinas futuras.
  - Retenção automática de 90 dias com log em `/var/log/backup-archive.log`.

---

## 6. Frontend: Componentes e Padrões de Interface

### 6.1. `AssetDetailView.jsx` — Visualizador Organizado em 3 Abas Operacionais
A tela de detalhes do equipamento possui uma barra superior simplificada contendo apenas o botão de ação **Testar Conectividade** (os botões de sincronização foram concentrados com segurança dentro da Aba 3 para permitir análise prévia de divergências). A navegação é estruturada em **3 abas focadas** com carregamento sob demanda (lazy loading):
1. **Aba 1 — Operação & Monitoramento (Padrão ao abrir)**:
   - **Acesso Rápido**: Cards no topo para **Conectividade & Terminal Remoto Guacamole SSO** (abertura em nova aba ou terminal embutido via iframe, sem login manual) e **Backup de Configurações Oxidized** (status da coleta, visualização imediata da configuração atual e disparo de backup sob demanda).
   - **Monitoramento Zabbix (Alarmes & Itens)**: Lista de triggers ativas do host com severidade, Dado Operacional (`opdata`), reconhecimento (`event.acknowledge`) e encerramento manual; seletor de itens monitorados com busca rápida; e gráfico SVG interativo (`ZabbixNumericChart`) ou linha do tempo textual (`ZabbixTextTimeline`).
2. **Aba 2 — Cadastro & Parâmetros (IperSoft)**:
   - Formulário modular em grid 2x2 com campos desacoplados:
     - **Card 1: 1. Identificação Canônica & Rede (IperSoft)**: Apenas **Nome do Equipamento**, Endereço IP Principal, DNS/Domínio, Empresa/Grupo do Cliente e Diagnósticos Nativos Aplicáveis (Ping, SNMP, Porta).
     - **Card 2: 2. Monitoramento Zabbix Server**: Toggle de ativação, **Host Técnico no Zabbix**, **Nome Visível no Zabbix**, Community SNMP v2c e Porta.
     - **Card 3: 3. Acesso Remoto (Apache Guacamole)**: Toggle de ativação, **Nome da Conexão no Guacamole**, Protocolo, Porta Customizada, Usuário e Senha de acesso remoto.
     - **Card 4: 4. Backup Oxidized**: Toggle de ativação, **Nome do Nó no Oxidized** (campo somente leitura espelhando o nome do IperSoft), Modelo de SO e Timeout de Coleta em segundos.
   - Salvar atualiza exclusivamente o banco local do IperSoft, sem disparar alterações automáticas nos servidores externos.
3. **Aba 3 — Comparativo & Sincronização Externa**:
   - Alerta de divergências (`differences`) entre o cadastro do IperSoft e as ferramentas externas.
   - Grid comparativo de **3 colunas lado a lado** (**Zabbix Server**, **Apache Guacamole** e **Oxidized Daemon**) exibindo os dados reais consultados nas APIs externas e os botões dedicados de sincronização manual individual (**Sincronizar Zabbix**, **Sincronizar Guacamole**, **Sincronizar Oxidized**), permitindo ao operador avaliar as diferenças antes de aplicar alterações.

### 6.2. `ZabbixAlarmsView.jsx` — Central de Alarmes Zabbix (Tela Principal)
Aba e tela inicial padrão do IperSoft dedicada a incidentes e triggers ativas do Zabbix Server:
- Definida como a **view inicial principal** do sistema ao carregar e após o login (`activeNav = 'zabbix_alarms'`).
- Consulta em tempo real de triggers ativas (`GET /api/v1/integrations/zabbix/problems`) com cruzamento automático do inventário do IperSoft por hostid, hostname e nome.
- **Resolução Completa de Macros e Operational Data (`opdata`)**: Utiliza `expandDescription: 1`, `expandComment: 1`, priorização de `lastEvent.name` e consulta em lote `problem.get` para preencher os **Dados Operacionais** calculados pelo Zabbix. Logo abaixo do nome da trigger, é exibida a badge de **Dado Operacional** (ex: `status: down (0)`, `espaço livre: 4.86 %`) e as tags secundárias foram removidas para manter a interface limpa e focada no diagnóstico rápido.
- **Redirecionamento ao Equipamento**: Ao clicar no host/equipamento na lista, o usuário é redirecionado imediatamente para a tela de detalhes do equipamento (`AssetDetailView`) no IperSoft.
- **Reconhecimento e Encerramento de Alarmes**: Checkboxes integrados na lista global e na Linha 5 dos detalhes do ativo:
  - Checkbox **Reconhecido**: aciona `event.acknowledge` no Zabbix (marcando ou desmarcando reconhecimento com atualização de estado em tempo real sem recarregar a página).
  - Checkbox **Encerrar**: aciona `event.acknowledge` com ação de fechamento manual do problema (`POST /api/v1/integrations/zabbix/close`), marcando como resolvido e sincronizando em tempo real com o Zabbix Server.
- **Filtros e KPIs**: Cards de severidade clicáveis (Desastre, Alto, Médio, Aviso, Informação), barra de filtros alinhada horizontalmente com seletores lado a lado (Ordenar Por: Mais Recentes Primeiro, Reconhecimento, Severidade, Inventário) e pesquisa dinâmica por nome, IP, descrição ou dados operacionais.
- **Linha do Tempo em Blocos Temporais (`viewMode: 'timeline'`)**:
  - Exibe os incidentes agrupados em blocos de tempo para identificação rápida de correlação e causa raiz (ex: rompimento de fibra ou falta de energia afetando múltiplos nós simultaneamente).
  - Blocos temporais: `< 10 min` (Crítico/Imediato), `10 a 30 min` (Recente), `30 min a 1h`, `1h a 3h`, `Hoje (3 a 24h)`, `Esta Semana (1 a 7 dias)` e `Mais antigos (> 7 dias)`.
  - Cada bloco exibe cabeçalho temático com badge, contador de alarmes, descrição de contexto, e botão de recolher/expandir individual ou em lote.
  - Barra superior de resumo rápido (*Timeline Ribbon*) com contadores consolidados por bloco e botões Expandir/Recolher Todos.
  - Alternador de visualização no topo permitindo alternar instantaneamente entre a **Linha do Tempo** e a **Tabela Contínua** (`'flat'`).

### 6.3. Regras de Cores e Estados dos Badges nas Linhas
- **Verde**: Integração ativa e equipamento sincronizado/online.
- **Vermelho**: Equipamento marcado como ativo na integração, porém com falha de conexão, sem sincronização ou ausente na ferramenta externa.
- **Cinza / Desabilitado**: Integração desmarcada ou desativada no sistema (o usuário não precisa abrir a linha).

### 6.4. `AssetsList.jsx` — Seleção Múltipla, Ações em Lote e Busca Instantânea
- **Busca Instantânea em Memória e `useDeferredValue`**:
  - A filtragem por texto é realizada em tempo real no cliente com latência de **0ms**, evitando requisições de rede a cada tecla e eliminando qualquer travamento na digitação.
  - O hook `useDeferredValue` prioriza a resposta do cursor do teclado no input e realiza a filtragem da tabela em background.
  - Suporte a busca multi-termo por tokens independentes (nome, IP, hostname, DNS, community, grupo, Zabbix e Guacamole), botão de limpeza rápida (`X`) e badge de contagem de resultados encontrados.
- Permite seleção individual por checkbox em cada linha e seleção em massa via cabeçalho da tabela.
- Barra de ações em lote flutuante/topo (`bulk-actions-bar`):
  - Ativar / Desativar monitoramento no Zabbix em lote (atualização local no IperSoft).
  - Ativar / Desativar acesso remoto no Apache Guacamole em lote (atualização local de `ignore_guacamole` no IperSoft).
  - Ativar / Desativar backup no Oxidized em lote (atualização local de `backup_enabled` no IperSoft).
  - Endpoint dedicado no backend: `POST /api/v1/assets/bulk-integrations` (sem envio automático às plataformas externas).

---

## 7. Decisões Técnicas Críticas & Cuidados em Próximas Tarefas

1. **Portas Não-Padrão no Guacamole**:
   - Equipamentos como OLTs e switches frequentemente usam portas SSH alternativas (ex: 2200, 2222).
   - Ao alterar porta no IperSoft, sempre atualizar simultaneamente:
     - A coluna `port` em `asset_guacamole`.
     - O campo `parameters["port"]` enviado para o Apache Guacamole.
2. **Lazy Loading nas Integrações**:
   - Não disparar consultas pesadas ao Zabbix, Guacamole ou Oxidized ao listar ativos no inventário. O carregamento de alarmes, itens, árvore de conexões e histórico de backup deve ser feito sob demanda ao clicar nas respectivas abas/accordions.
3. **Persistência de Múltiplos Accordions**:
   - No estado do React em `AssetDetailView.jsx`, os accordions usam um conjunto ou dicionário de abas abertas (`openSections = { ipersoft: true, zabbix: false, ... }`), e nunca um único ID mutuamente exclusivo.
4. **Tratamento de Dados de Gráfico no Zabbix**:
   - Nem todos os itens do Zabbix são numéricos (alguns são strings, logs ou textos). O gráfico interativo SVG só deve ser renderizado para tipos de dados numéricos (valor tipo 0 e 3). Para tipos de texto, deve-se exibir tabela ou lista histórica formatada.
5. **Container Docker e Volumes**:
   - O código do backend e do frontend estão montados via volumes locais no `docker-compose.yml`. Alterações nos arquivos `.py` e `.jsx` recarregam automaticamente via live-reload (Uvicorn `--reload` e Vite HMR).
6. **Resolução de Macros no Zabbix**:
   - Triggers do Zabbix geradas por Descoberta de Baixo Nível (LLD) contêm macros como `{#IFNAME}`, `{#SNMPVALUE}`, e referências a thresholds como `{$TEMP.CRIT}`. Sempre requisitar `expandDescription: 1`, `expandComment: 1` e incluir `name` no `selectLastEvent` nas chamadas `trigger.get`. Priorizar `last_event.name` com fallback na `description` expandida da trigger para garantir que nenhum placeholder em formato `{...}` seja exibido ao operador.
7. **Tela Inicial do Sistema**:
   - A Central de Alarmes Zabbix (`zabbix_alarms`) é a tela de entrada do IperSoft por padrão. Alterações em rotas e redirecionamento de login no `App.jsx` devem sempre manter o foco operacional na central de incidentes.
8. **Controle de Versão Git e Segurança de Segredos**:
   - O projeto está versionado no GitHub em `everton2803/IperSoft` na branch `main`.
   - Sob nenhuma circunstância comitar o arquivo `.env` ou credenciais em texto claro. O `.gitignore` na raiz do projeto protege senhas, tokens, `node_modules/` e diretórios de build.
   - Sempre utilize mensagens de commit padronizadas (ex: `feat:`, `fix:`, `docs:`) e envie atualizações via `git push origin main`.
9. **Integração com Oxidized (`source: http`)**:
   - O plugin `source: http` do Oxidized herda da classe Ruby `JSONFile` e **somente aceita payloads JSON**. Configurações como `format: csv` ou `delimiter: ":"` causam quebra imediata (`undefined method 'empty?' for nil`).
   - Os arquivos de modelo dentro do container do Oxidized utilizam nomes em minúsculas (ex: `routeros.rb`, `datacom.rb`, `cisco.rb`). Qualquer modelo enviado em maiúsculas ou inexistente gera `Oxidized::ModelNotFound`, fazendo com que o daemon do Oxidized descarte o equipamento da memória. O IperSoft mapeia automaticamente apelidos e variantes de SO (ex: `dmos` -> `datacom`, `mikrotik` -> `routeros`, `cisco` -> `ios`) para os modelos oficiais do Oxidized.
   - No caso de equipamentos Datacom (DmOS), o modelo oficial e nativo do Oxidized é `datacom` (`datacom.rb`).
   - Na configuração do `/opt/oxidized/config`, a diretiva `resolve_dns: false` é mandatória para evitar falhas de `Resolv::ResolvError` decorrentes de nomes amigáveis de equipamentos. As chaves `map:` e `vars_map:` devem ser indentadas obrigatoriamente dentro de `http:`.
   - **Mapeamento Obrigatório de `timeout` no `/opt/oxidized/config`**: Por padrão, o plugin `source: http` (baseado em `JSONFile`) do Oxidized **somente** processa os campos que estiverem explicitamente listados em `map:` e `vars_map:`. Qualquer atributo extra no JSON é ignorado pelo Ruby. Para que o timeout customizado por dispositivo do IperSoft tenha efeito no daemon do Oxidized e sobreponha o timeout global, declare `timeout: timeout` tanto em `map:` (para `node[:timeout]`) quanto em `vars_map:`:
     ```yaml
     source:
       default: http
       http:
         url: http://<ip-ipersoft>:8000/api/v1/integrations/oxidized/nodes
         map:
           name: name
           model: model
           ip: ip
           group: group
           timeout: timeout
         vars_map:
           protocol: protocol
           ssh_port: ssh_port
           telnet_port: telnet_port
           username: username
           password: password
           timeout: timeout
     ```
10. **Limpeza Automática de Diagnósticos de Rede Órfãos/Desativados (`DiagnosticsService`)**:
    - Em `backend/app/services/diagnostics.py`, a função `_upsert_diag_in_session` atualiza o registro existente do equipamento (`asset_id` + `test_type` ou protocolo remoto) e remove quaisquer registros órfãos de portas ou protocolos antigos quando a porta/protocolo do ativo é alterada.
    - Hosts importados do Zabbix que utilizam exclusivamente Zabbix Agent (`port == 10050`, `type == 1`) sem interface SNMP (`type == 2`) têm o teste SNMP (porta 161) desabilitado por padrão (`_is_snmp_applicable_by_default`), evitando falsos positivos de timeout SNMP.
    - Tanto o lote horário (`run_all_diagnostics_batch`) quanto as rotas de edição (`update_asset`, `toggle_asset_status`, `bulk_update_integrations`) removem imediatamente da tabela `network_diagnostics` os testes de ativos inativos ou com `test_icmp`, `test_snmp`, `test_remote` / `ignore_guacamole` desmarcados.

---

## 8. Topologia Distribuída dos 3 Ambientes (LAN + WireGuard)

O ecossistema completo do projeto opera de forma distribuída em **3 ambientes Linux** interconectados via rede local e túneis **WireGuard**. A máquina principal do IperSoft já possui chaves SSH autorizadas e aliases configurados em `/home/everton/.ssh/config` para acesso direto e sem senha aos outros dois ambientes.

### 8.1. Resumo de Conectividade e Acesso SSH

| Ambiente | Hostname | IP Privado / WireGuard | Usuário SSH | Comando / Alias SSH | Chave SSH Utilizada |
|---|---|---|---|---|---|
| **1. VM Local (IperSoft)** | `everton-docker` | `192.168.28.102` | `everton` | *(Ambiente Local)* | `~/.ssh/id_ed25519` |
| **2. VPS Datacenter BrDrive** | `iper-ubuntu` | `10.10.1.2` | `root` | `ssh brdrive` *(ou `ssh 10.10.1.2`)* | `~/.ssh/id_ed25519` |
| **3. VM Oracle Cloud** | `vnic1` | `10.10.2.2` *(VPC: `10.0.0.62`)* | `ubuntu` *(sudo NOPASSWD)* | `ssh oracle` *(ou `ssh 10.10.2.2`)* | `~/.ssh/id_rsa_oracle` / `~/.ssh/id_ed25519` |

> **Nota sobre o IP da VM Oracle**: Embora ocasionalmente referenciada como `10.10.2.3`, o endereço ativo na interface WireGuard (`wg0`) da VM Oracle e registrado nas rotas de proxy reverso do Traefik é **`10.10.2.2`**. No `~/.ssh/config`, tanto `10.10.2.2` quanto `10.10.2.3`, `oracle` e `vm-oracle` apontam automaticamente para `10.10.2.2`.

---

### 8.2. Ambiente 1 — VM Local (`everton-docker` — `192.168.28.102`)
Hospeda a aplicação central **IperSoft** e serviços auxiliares locais:
- **IperSoft** (`/home/everton/IperSoft/docker-compose.yml`):
  - `ipersoft_frontend`: React 18 + Vite (portas `5173`, `3000`, `80`).
  - `ipersoft_backend`: FastAPI + Python 3.11 (porta `8000`).
  - `ipersoft_postgres`: PostgreSQL 16 Alpine (porta `5432`).
- **Traefik & Geofeed** (`/home/everton/.gemini/antigravity-cli/scratch/geofeed/docker-compose.yml`):
  - `traefik_proxy` (`traefik:v3.3`) e `geofeed_web` (`nginx:alpine`).

---

### 8.3. Ambiente 2 — VPS Datacenter BrDrive (`ssh brdrive` — `10.10.1.2`)
Atua como o **Core de Monitoramento, Gerência, NetFlow/Syslog e Proxy Reverso Público (`*.iper.net.br`)**. Todos os projetos residem em `/opt/`:

| Diretório em `brdrive` | Domínio / Rota Traefik | Containers Docker | Função Principal |
|---|---|---|---|
| `/opt/traefik` | *(Ingress Ports `80`/`443`)* | `traefik` (`traefik:v2.11`) | Reverse Proxy global + TLS Let's Encrypt. Roteia tráfego para containers locais e para a VM Oracle (`10.10.2.2`) via `/opt/traefik/dynamic/`. |
| `/opt/zabbix` | `https://zabbix70.iper.net.br` *(Direto: `http://10.10.1.2:8085`)* | `zabbix-server` (`10051`), `zabbix-web` (`8085`), `zabbix-postgres` (TimescaleDB PG15) | Monitoramento Zabbix 7.0 LTS integrado diretamente ao IperSoft. |
| `/opt/guacamole` | `https://guacamoles.iper.net.br` *(Direto: `http://10.10.1.2:8086/guacamole`)* | `guacamole` (`8086`), `guacd`, `guacamole-postgres` (PG15) | Gateway de acesso remoto SSH/Telnet/RDP integrado diretamente ao IperSoft. |
| `/opt/oxidized` | `https://oxidized.iper.net.br` *(Direto: `http://10.10.1.2:8888`)* | `oxidized` (`oxidized/oxidized:latest`, porta `8888`) | Backup automatizado de configurações de rede. Lê a lista de nós dinamicamente de `http://192.168.28.102:8000/api/v1/integrations/oxidized/nodes`. |
| `/opt/akvorado/docker` | `https://flows.iper.net.br` | `akvorado-inlet-1` (UDP `2055`/`4739`/`6343`), `akvorado-outlet-1` (BGP `10179`), `akvorado-console-1` (`8088`), `akvorado-orchestrator-1`, `akvorado-clickhouse-1`, `akvorado-kafka-1`, `akvorado-kafka-ui-1`, `akvorado-redis-1`, `akvorado-geoip-1` | Coletor e analisador de fluxos de tráfego (NetFlow / IPFIX / sFlow) e BGP. |
| `/opt/victorialogs` | `https://logs.iper.net.br` *(Direto: `http://10.10.1.2:9428`)* | `victorialogs` (`victoriametrics/victoria-logs:latest`, portas `514` UDP/TCP, `9428` HTTP) | Servidor central de Syslog integrado ao IperSoft para correlação de eventos em tempo real. |
| `/opt/weathermap` | `https://weathermap.iper.net.br` | `weathermap` | Mapas visuais de topologia e utilização de links. |
| `/opt/portainer` | `https://portainer.iper.net.br` | `portainer` (`portainer/portainer-ce:latest`) | Gerenciamento visual de containers Docker. |

---

### 8.4. Ambiente 3 — Instância Oracle Cloud (`ssh oracle` — `10.10.2.2`)
Hospeda os sistemas de **Visualização (Grafana), IPAM, Planejamento Óptico e Nuvem de Arquivos**, todos em `/opt/` e expostos em HTTPS através do Traefik da VPS BrDrive (`/opt/traefik/dynamic/*.yml` apontando para `10.10.2.2`):

| Diretório em `oracle` | Domínio Público (via Traefik BrDrive) | Containers Docker & Portas Internas | Função Principal |
|---|---|---|---|
| `/opt/grafana-stack` | `https://grafanas.iper.net.br` → `http://10.10.2.2:3000` | `grafana` (`grafana/grafana:latest`, plugin `alexanderzobnin-zabbix-app`) | Dashboards executivos e operacionais conectados ao Zabbix. |
| `/opt/phpipam` | `https://ipam.iper.net.br` → `http://10.10.2.2:8081` | `phpipam-web` (`8081->80`), `phpipam-cron`, `phpipam-db` (`mariadb:11`) | Gestão de endereçamento IP (IPv4/IPv6), sub-redes e VLANs. |
| `/opt/pon-planner` | `https://pon.iper.net.br` → `http://10.10.2.2:8000` | `pon-planner` (`pon-planner-backend`, porta `8000`) | Cálculo e planejamento de redes ópticas PON/FTTH. |
| `/opt/nextcloud` | `https://cloud.iper.net.br` → `http://10.10.2.2:8080` | `nextcloud` (`nextcloud:34.0.1`, `8080->80`), `nextcloud-db` (`mariadb:11`) | Armazenamento e compartilhamento corporativo de arquivos. |

