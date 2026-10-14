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
- `raw_data`: JSON flexível com metadados adicionais (ex: `ignore_guacamole`).
- **Relacionamentos**:
  - `zabbix` -> `AssetZabbix` (1:1 com cascade delete).
  - `guacamole` -> `AssetGuacamole` (1:N com cascade delete).
  - `oxidized` -> `AssetOxidized` (1:1 com cascade delete).
  - `diagnostics` -> `NetworkDiagnostic` (1:N com cascade delete).

### 4.2. `AssetZabbix` (`asset_zabbix`)
- `hostid`: ID do host no Zabbix.
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

### 5.1. `GuacamoleService` (`app/services/guacamole.py`)
- **Autenticação**: Post em `/api/tokens` enviando `username` e `password`. Detecta o `dataSource` ativo (`postgresql` ou `mysql`).
- **Identifier Decodificado**: Guacamole usa identificadores base64 (ex: `MTIzAGMAcG9zdGdyZXNxbA==`). A função `extract_raw_identifier` extrai com segurança a ID numérica real antes de chamar endpoints de atualização.
- **Portas Customizadas (ex: 2200)**: Assegura que tanto ao criar quanto ao sincronizar ou atualizar uma conexão, a porta informada pelo operador seja gravada no objeto `AssetGuacamole` e no dicionário `parameters["port"]` enviado à API do Guacamole.
- **Preservação de Credenciais**: Quando uma conexão é atualizada, os parâmetros existentes não são apagados; senhas existentes são mantidas caso o usuário não tenha digitado uma nova.

### 5.2. `ZabbixService` (`app/services/zabbix.py`)
- **JSON-RPC**: Chamadas padronizadas a `api_jsonrpc.php` com suporte a autenticação por Token ou `user.login`.
- **Triggers / Alarmes**: Busca de triggers ativas (`trigger.get` com `filter={"value": 1}`) e mapeamento de severidades (0 a 5: Não classificado a Desastre).
- **Resolução Completa de Macros**: Em chamadas `trigger.get` (`fetch_all_problems` e `fetch_host_problems`), inclusão obrigatória de `expandDescription: 1`, `expandComment: 1` e extração de `name` do `selectLastEvent`. Garante que nomes de protótipos de LLD (ex: `{#IFNAME}`) e thresholds com macros (ex: `{$TEMP.CRIT}`, `{$PART.CRIT}`) cheguem ao frontend 100% resolvidos com valores reais (ex: `GigabitEthernet0/7/7`, `90%`).
- **Itens e Histórico**: Coleta de métricas do host (`item.get`) e histórico numérico (`history.get` com tipos numéricos `0` float e `3` integer) ou de texto (`1`, `2`, `4`).

### 5.3. `OxidizedService` (`app/services/oxidized.py`)
- **Consulta e Sincronização de Status**: Consulta endpoints `/nodes.json`, `/node/fetch/{node}` e `/node/version/{node}` para sincronizar status de backup dos nós com equipamentos do IperSoft.
  - **Prevenção de Colisões e Chaves Duplicadas**: A função `sync_nodes_with_database` utiliza dicionário em memória de registros existentes e dá prioridade absoluta a correspondência exata por nome (`node_name.lower()`), seguida por IP, garantindo que múltiplos nós com mesmo IP (ou NAT/VMs) nunca gerem `UniqueViolation` em `asset_oxidized`.
- **Disparo Manual de Backup**: Suporte a gatilho manual de backup (`/node/next/{node}`).
- **Recarregamento e Expurgar Nós Excluídos (`/reload`)**:
  - O daemon do Oxidized mantém nós na memória RAM. Ao excluir um equipamento no IperSoft ou desativar seu backup (`backup_enabled = False`), o IperSoft remove imediatamente o registro de `AssetOxidized` e aciona `GET /reload` no Oxidized para que a lista da fonte seja relida e os nós excluídos sejam expurgados da memória imediatamente.
  - Na sincronização periódica (`sync_nodes_with_database`), caso o nó pertença a um ativo cujo backup está desativado no IperSoft (`backup_enabled == False`), o IperSoft respeita estritamente a escolha do operador, não reativando o backup e expurgando o nó do daemon.
  - Há também botão dedicado na tela de Integrações: **Recarregar Nós no Oxidized** (`POST /api/v1/integrations/oxidized/reload`).
- **Fornecimento Dinâmico de Inventário (`source: http`)**:
  - Endpoint `GET /api/v1/integrations/oxidized/nodes`: Entrega a lista de nós participantes do backup (`backup_enabled == True`) em formato JSON para consumo dinâmico pelo driver nativo `source: http` do Oxidized.
  - **Normalização de Modelos em Minúsculas**: No Oxidized (Linux/Ruby), os arquivos de modelo de sistema operacional são estritamente case-sensitive e em minúsculas (`routeros.rb`, `dmos.rb`, `cisco.rb`). O backend converte automaticamente os modelos cadastrados no banco para minúsculas (`.lower()`).
  - **Filtragem de Protocolos Incompatíveis**: Conexões com protocolo não suportado pelo Oxidized (como `rdp` para máquinas Windows) são automaticamente ignoradas na exportação de nós.
  - **Portas Customizadas e Credenciais**: Mapeia automaticamente portas não padrão (ex: `2200`, `2233`) e credenciais de acesso remoto a partir dos vínculos com `AssetGuacamole`.
  - **Endpoint Legado / Compatibilidade CSV**: `GET /api/v1/integrations/oxidized/router.db` entrega o inventário diretamente no formato texto `router.db` delimitado por dois pontos (`name:model:ip:proto:port:user:pwd`).
- **Diretiva `resolve_dns: false` no Oxidized**: No `/opt/oxidized/config`, deve-se declarar `resolve_dns: false` para que o Oxidized conecte diretamente pelo endereço informado no campo `ip`, impedindo erros de resolução DNS (`Resolv::ResolvError`) provocados por nomes amigáveis que contenham espaços ou pontuações.

### 5.4. `DiagnosticsService` (`app/services/diagnostics.py`)
- **ICMP Ping**: Execução nativa Linux (`ping -c 1 -W 2`) via `asyncio.create_subprocess_exec`.
- **SNMP Test**: Envio de pacote UDP de teste na porta 161 com community configurada.
- **TCP Test**: Teste de abertura de socket TCP na porta do serviço (ex: 22/2200 para SSH, 23 para Telnet, 3389 para RDP).
- **Agendador Horário Automático**: Background task iniciada no boot do FastAPI (`hourly_diagnostics_scheduler`) que executa diagnósticos em todos os ativos a cada 1 hora.

---

## 6. Frontend: Componentes e Padrões de Interface

### 6.1. `AssetDetailView.jsx` — Visualizador de 6 Linhas Independentes
O modal de detalhes do equipamento foi planejado para carregar dados sob demanda (lazy loading) e permitir manter múltiplos painéis abertos simultaneamente sem fechar os outros:
1. **Linha 1 — Dados IperSoft & Diagnósticos**:
   - Informações canônicas (Nome, Hostname, IP, Cliente/Grupo).
   - **Ativação Centralizada de Integrações**: Checkboxes para habilitar/desabilitar Zabbix, Guacamole e Oxidized diretamente no inventário master, com feedback visual imediato e sem bloquear reativações quando a linha estiver desabilitada.
   - Badges rápidos de conectividade no cabeçalho da linha (Ping, SNMP, Acesso Remoto).
   - Ao abrir: Permite rodar testes manuais imediatos (ICMP, SNMP, TCP) e ver latências.
2. **Linha 2 — Dados no Zabbix**:
   - Carrega sob demanda via API do Zabbix.
   - Exibe Nome no Zabbix, Nome Visível, Interfaces cadastradas, Host Groups e Templates associados.
3. **Linha 3 — Dados no Guacamole**:
   - Carrega sob demanda via API do Guacamole.
   - Exibe Pasta/Grupo da conexão, IP, Protocolo, **Porta Customizada** (ex: 2200), Usuário e presença de Senha.
   - Permite editar e sincronizar credenciais e porta diretamente com o Guacamole.
4. **Linha 4 — Dados no Oxidized**:
   - Carrega status de backup, nome do nó, modelo configurado (`RouterOS`, `Cisco`, etc.), grupo e data/hora do último backup com tempo de execução.
5. **Linha 5 — Status Zabbix (Alarmes e Itens)**:
   - Alarmes/Triggers ativos do host com badge de severidade, checkbox de reconhecimento direto (`event.acknowledge`) e checkbox de encerramento/resolução manual do alarme (`event.acknowledge` com action de close).
   - Lista completa de itens monitorados pelo Zabbix.
   - Ao selecionar um item numérico, renderiza o sub-componente `ZabbixNumericChart`: gráfico SVG interativo com cálculo de mínimo, máximo, média e último valor com tooltip ao passar o mouse.
6. **Linha 6 — Conexão Remota Guacamole**:
   - Abertura de sessão direta do Guacamole dentro de iframe ou nova janela, reutilizando credenciais sem forçar novo login manual na interface web do Guacamole.

### 6.2. `ZabbixAlarmsView.jsx` — Central de Alarmes Zabbix (Tela Principal)
Aba e tela inicial padrão do IperSoft dedicada a incidentes e triggers ativas do Zabbix Server:
- Definida como a **view inicial principal** do sistema ao carregar e após o login (`activeNav = 'zabbix_alarms'`).
- Consulta em tempo real de triggers ativas (`GET /api/v1/integrations/zabbix/problems`) com cruzamento automático do inventário do IperSoft por hostid, hostname e nome.
- **Resolução Completa de Macros**: Utiliza `expandDescription: 1`, `expandComment: 1` e priorização de `lastEvent.name` no backend para expandir 100% das macros de LLD (`{#IFNAME}`, etc.) e macros de thresholds (`{$TEMP.CRIT}`, etc.).
- **Redirecionamento ao Equipamento**: Ao clicar no host/equipamento na lista, o usuário é redirecionado imediatamente para a tela de detalhes do equipamento (`AssetDetailView`) no IperSoft.
- **Reconhecimento e Encerramento de Alarmes**: Checkboxes integrados na lista global e na Linha 5 dos detalhes do ativo:
  - Checkbox **Reconhecido**: aciona `event.acknowledge` no Zabbix (marcando ou desmarcando reconhecimento com atualização de estado em tempo real sem recarregar a página).
  - Checkbox **Encerrar**: aciona `event.acknowledge` com ação de fechamento manual do problema (`POST /api/v1/integrations/zabbix/close`), marcando como resolvido e sincronizando em tempo real com o Zabbix Server.
- **Filtros e KPIs**: Cards de severidade clicáveis (Desastre, Alto, Médio, Aviso, Informação), barra de filtros alinhada horizontalmente com seletores lado a lado (Ordenar Por: Mais Recentes Primeiro, Reconhecimento, Severidade, Inventário) e pesquisa dinâmica por nome, IP, descrição ou tags.

### 6.3. Regras de Cores e Estados dos Badges nas Linhas
- **Verde**: Integração ativa e equipamento sincronizado/online.
- **Vermelho**: Equipamento marcado como ativo na integração, porém com falha de conexão, sem sincronização ou ausente na ferramenta externa.
- **Cinza / Desabilitado**: Integração desmarcada ou desativada no sistema (o usuário não precisa abrir a linha).

### 6.4. `AssetsList.jsx` — Seleção Múltipla e Ações em Lote de Integrações
- Permite seleção individual por checkbox em cada linha e seleção em massa via cabeçalho da tabela.
- Barra de ações em lote flutuante/topo (`bulk-actions-bar`):
  - Ativar / Desativar monitoramento no Zabbix em lote (com sincronização em tempo real no Zabbix Server).
  - Ativar / Desativar acesso remoto no Apache Guacamole em lote (com atualização de `ignore_guacamole`).
  - Ativar / Desativar backup no Oxidized em lote (com exclusão de dados obsoletos de backup e disparo automático de `GET /reload` para expurgo imediato da memória do Oxidized).
  - Endpoint dedicado no backend: `POST /api/v1/assets/bulk-integrations`.

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
   - Os arquivos de modelo dentro do container do Oxidized utilizam nomes em minúsculas (ex: `routeros.rb`, `dmos.rb`, `cisco.rb`). Qualquer modelo enviado em maiúsculas gera `Oxidized::ModelNotFound`. O IperSoft sempre envia os modelos em `.lower()`.
   - Na configuração do `/opt/oxidized/config`, a diretiva `resolve_dns: false` é mandatória para evitar falhas de `Resolv::ResolvError` decorrentes de nomes amigáveis de equipamentos. As chaves `map:` e `vars_map:` devem ser indentadas obrigatoriamente dentro de `http:`.

