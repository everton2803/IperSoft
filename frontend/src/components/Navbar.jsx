import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon, Network, LogOut, Users, Server, Layers, AlertTriangle, ShieldAlert } from 'lucide-react';

export const Navbar = ({ 
  user, 
  activeNav, 
  onSelectNav, 
  onLogout, 
  onOpenUserManagement,
  alarmCount = 0,
  zabbixAlarmCount = 0
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="navbar-container">
      <div className="navbar-inner">
        {/* Brand */}
        <div className="brand-logo" id="brand-logo" onClick={() => onSelectNav && onSelectNav('zabbix_alarms')}>
          <div className="brand-icon-wrapper">
            <Network size={20} className="brand-icon" />
          </div>
          <div className="brand-text">
            <span className="brand-title">IPER<span className="brand-highlight">SOFT</span></span>
            <span className="brand-subtitle">Ativos de Rede</span>
          </div>
        </div>

        {/* Center Navigation if authenticated */}
        {user && (
          <nav className="navbar-nav">
            <button
              className={`nav-link-btn ${activeNav === 'zabbix_alarms' ? 'active' : ''}`}
              onClick={() => onSelectNav('zabbix_alarms')}
              style={{ position: 'relative' }}
              title="Central Principal: Triggers disparadas e incidentes ativos monitorados no Zabbix"
            >
              <ShieldAlert size={15} color={zabbixAlarmCount > 0 ? '#e53935' : 'inherit'} />
              <span>Alarmes Zabbix</span>
              {zabbixAlarmCount > 0 && (
                <span style={{
                  backgroundColor: '#e53935',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  borderRadius: '9999px',
                  padding: '1px 6px',
                  marginLeft: '4px',
                  lineHeight: '1.2'
                }}>
                  {zabbixAlarmCount}
                </span>
              )}
            </button>

            <button
              className={`nav-link-btn ${activeNav === 'assets' ? 'active' : ''}`}
              onClick={() => onSelectNav('assets')}
            >
              <Server size={15} />
              <span>Ativos de Rede</span>
            </button>

            <button
              className={`nav-link-btn ${activeNav === 'alarms' ? 'active' : ''}`}
              onClick={() => onSelectNav('alarms')}
              style={{ position: 'relative' }}
              title="Central de Diagnósticos e Alarmes IperSoft (ICMP Ping, SNMP, Portas Remotas)"
            >
              <AlertTriangle size={15} color={alarmCount > 0 ? 'var(--color-danger)' : 'inherit'} />
              <span>Alarmes IperSoft</span>
              {alarmCount > 0 && (
                <span style={{
                  backgroundColor: 'var(--color-danger)',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  borderRadius: '9999px',
                  padding: '1px 6px',
                  marginLeft: '4px',
                  lineHeight: '1.2'
                }}>
                  {alarmCount}
                </span>
              )}
            </button>

            <button
              className={`nav-link-btn ${activeNav === 'integrations' ? 'active' : ''}`}
              onClick={() => onSelectNav('integrations')}
            >
              <Layers size={15} />
              <span>Integrações</span>
            </button>
          </nav>
        )}

        {/* Actions */}
        <div className="navbar-actions">
          {/* Theme switcher */}
          <button
            id="theme-toggle-btn"
            className="btn-icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* User profile & actions if logged in */}
          {user && (
            <div className="user-nav-box">
              {user.role === 'admin' && (
                <button
                  id="admin-users-btn"
                  className="btn-secondary"
                  onClick={onOpenUserManagement}
                  title="Gerenciar Usuários"
                >
                  <Users size={15} />
                  <span>Usuários</span>
                </button>
              )}

              <div className="user-info-pill">
                <span className="user-name">{user.full_name || user.username}</span>
                <span className={`user-role-badge role-${user.role}`}>
                  {user.role === 'admin' ? 'Admin' : 'Operador'}
                </span>
              </div>

              <button
                id="navbar-logout-btn"
                className="btn-icon btn-danger-icon"
                onClick={onLogout}
                title="Sair"
                aria-label="Encerrar sessão"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
