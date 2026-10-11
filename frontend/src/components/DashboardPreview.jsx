import React from 'react';
import { 
  Server, 
  Terminal, 
  FileCode, 
  Globe, 
  PieChart, 
  Radio, 
  UserPlus, 
  ArrowRight,
  Database 
} from 'lucide-react';

export const DashboardPreview = ({ user, onOpenUserManagement, onOpenZabbix, onGoToAssets }) => {
  const modules = [
    { 
      id: 'zabbix', 
      name: 'Zabbix Server', 
      type: 'Hosts & Monitoramento', 
      icon: Server, 
      status: 'Pronto para Sincronizar',
      isReady: true,
      actionText: 'Configurar e Sincronizar'
    },
    { 
      id: 'guacamole', 
      name: 'Apache Guacamole', 
      type: 'Sessões SSH / RDP', 
      icon: Terminal, 
      status: 'Próxima Integração',
      isReady: false 
    },
    { 
      id: 'oxidized', 
      name: 'Oxidized', 
      type: 'Backups de Configuração', 
      icon: FileCode, 
      status: 'Próxima Integração',
      isReady: false 
    },
    { 
      id: 'phpipam', 
      name: 'phpIPAM', 
      type: 'Gestão de IP e VLANs', 
      icon: Globe, 
      status: 'Próxima Integração',
      isReady: false 
    },
    { 
      id: 'grafana', 
      name: 'Grafana & Rsyslog', 
      type: 'Telemetria & Logs', 
      icon: PieChart, 
      status: 'Próxima Integração',
      isReady: false 
    },
    { 
      id: 'nfsen', 
      name: 'nfdump & NfSen', 
      type: 'Análise de NetFlow', 
      icon: Radio, 
      status: 'Próxima Integração',
      isReady: false 
    },
  ];

  return (
    <div className="dashboard-content">
      {/* Top Header */}
      <div className="dashboard-topbar">
        <div>
          <h1 className="dashboard-title">Ambiente de Operações</h1>
          <p className="dashboard-sub">Módulos e Integrações de Infraestrutura</p>
        </div>

        <div className="dashboard-actions-row">
          <button 
            className="btn-secondary" 
            onClick={onGoToAssets}
          >
            <Server size={15} />
            <span>Ver Base de Ativos</span>
          </button>

          {user.role === 'admin' && (
            <button 
              id="open-user-mgmt-btn"
              className="btn-primary" 
              onClick={onOpenUserManagement}
              style={{ width: 'auto', padding: '0.6rem 1.1rem' }}
            >
              <UserPlus size={15} />
              <span>Cadastrar Usuário</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-strip">
        <div className="status-item">
          <span className="status-label">Operador</span>
          <span className="status-value">{user.full_name}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Nível de Acesso</span>
          <span className="status-value highlight">
            {user.role === 'admin' ? 'Administrador' : 'Operador NOC'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Base de Dados</span>
          <span className="status-value">PostgreSQL 16 Ativo</span>
        </div>
        <div className="status-item">
          <span className="status-label">Gateway NOC</span>
          <span className="status-value online">
            <span className="dot-online"></span> Operacional
          </span>
        </div>
      </div>

      {/* Modules Grid */}
      <div className="modules-section">
        <h2 className="section-title">Contêineres e Plataformas Integradas</h2>
        <div className="modules-grid">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <div 
                key={m.id} 
                className={`module-card ${m.isReady ? 'module-ready-card' : ''}`}
                onClick={() => m.id === 'zabbix' && onOpenZabbix && onOpenZabbix()}
                style={m.isReady ? { cursor: 'pointer' } : {}}
              >
                <div className="module-icon-box">
                  <Icon size={18} />
                </div>
                <div className="module-info">
                  <div className="module-name">{m.name}</div>
                  <div className="module-type">{m.type}</div>
                </div>
                {m.isReady ? (
                  <span className="module-badge module-badge-active">
                    {m.actionText} →
                  </span>
                ) : (
                  <span className="module-badge">{m.status}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
