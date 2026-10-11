---
description: Regras e contexto do projeto IperSoft para o Antigravity
globs: ["**/*"]
---

# Regras e Contexto do Projeto IperSoft

## Sobre o Projeto
O **IperSoft** é um sistema unificado de Gestão de Ativos de Rede e Telecom integrado a **Zabbix**, **Apache Guacamole** e **Oxidized**, com diagnósticos de rede integrados (Ping ICMP, SNMP, testes TCP).

## Stack Tecnológica
- **Backend**: Python 3.11, FastAPI, SQLAlchemy 2.0, PostgreSQL 16, HTTPX, Pydantic, Uvicorn.
- **Frontend**: React 18, Vite, Lucide React, Axios, CSS Puro (sem Tailwind, tema dark mode).
- **Ambiente**: Docker Compose (`db:5432`, `backend:8000`, `frontend:5173/3000/80`).

## Diretrizes de Implementação
1. **Modelos Modulares**:
   - `Asset` é a entidade canônica central.
   - Relacionamentos 1:1 e 1:N com `AssetZabbix`, `AssetGuacamole` e `AssetOxidized`.
2. **Acesso Remoto Guacamole & Portas Customizadas**:
   - Ao salvar ou sincronizar portas (ex: 2200 para OLTs ou portas não-padrão de SSH/Telnet), sempre persistir no campo `port` de `AssetGuacamole` e propagar dentro de `parameters["port"]` no Guacamole.
3. **Lazy Load de Integrações**:
   - Os dados do Zabbix (itens, triggers, gráficos), Guacamole (credenciais, pastas) e Oxidized (status de backup) devem ser carregados sob demanda quando o usuário clica nas linhas/accordions do `AssetDetailView.jsx`.
4. **Accordions Independentes**:
   - O usuário pode manter múltiplas linhas de detalhes abertas simultaneamente (não colapsar as anteriores).
5. **Feedback Visual nas Linhas**:
   - Status verde: integração ativa e sincronizada.
   - Status vermelho: marcada ativa mas com erro ou não sincronizada.
   - Status cinza/desabilitado: integração desativada para aquele host.
