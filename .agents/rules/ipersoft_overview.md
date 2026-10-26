---
description: Regras e contexto do projeto IperSoft para o Antigravity
globs: ["**/*"]
---

# Regras e Contexto do Projeto IperSoft

## Sobre o Projeto
O **IperSoft** é um sistema unificado de Gestão de Ativos de Rede e Telecom integrado a **Zabbix**, **Apache Guacamole**, **Oxidized**, **VictoriaLogs (Syslog)** e **Stack de Backup Remoto (SFTPGo/TFTP)** na Oracle Cloud, com diagnósticos de rede integrados (Ping ICMP, SNMP, testes TCP).

A fonte de verdade técnica detalhada e documentação arquitetural reside em `AGENTS.md`.

## Stack Tecnológica
- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0, PostgreSQL 16, HTTPX, Pydantic, Uvicorn.
- **Frontend**: React 18, Vite, Lucide React, Axios, CSS Puro (sem Tailwind, tema dark mode).
- **Ambiente**: Docker Compose (`db:5432`, `backend:8000`, `frontend:5173/3000/80`, `traefik:80/443`).

## Diretrizes de Implementação
1. **Modelos Modulares e Parsing por IP**:
   - `Asset` é a entidade canônica central (`name`, `ip_address`).
   - A vinculação/parsing entre IperSoft, Zabbix, Guacamole e Oxidized é realizada estritamente pelo **Endereço IP** (`ip_address`) como prioridade 1.
   - Relacionamentos com `AssetZabbix`, `AssetGuacamole` e `AssetOxidized`.
2. **Acesso Remoto Guacamole SSO & URL Pública**:
   - Resolução via domínio público HTTPS (`https://guacamoles.iper.net.br/guacamole`) para evitar erros de Conteúdo Misto (Mixed Content) no terminal embutido (`iframe`) e permitir acesso externo fora da VPN.
   - Portas customizadas (ex: 2200 para OLTs) persistidas em `port` e propagadas em `parameters["port"]`.
3. **Lazy Load de Integrações e Dados Operacionais**:
   - Dados do Zabbix (itens, triggers, gráficos com downsampling e trend.get), Guacamole (credenciais, pastas) e Oxidized carregados sob demanda.
   - Triggers do Zabbix com resolução de macros e dados operacionais (`opdata`) em tempo real.
4. **Syslog VictoriaLogs**:
   - Consulta direta via LogsQL com filtros de período, severidade, busca textual multi-termo e limite configurável de 100 a 5.000 linhas.
5. **Feedback Visual nas Linhas e Cards**:
   - Status verde: integração ativa e sincronizada.
   - Status vermelho: marcada ativa mas com erro ou não sincronizada.
   - Status cinza/desabilitado: integração desativada para aquele host.
