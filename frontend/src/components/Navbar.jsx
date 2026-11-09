import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { NavDropdown } from './common/NavDropdown';
import { 
  Sun, 
  Moon, 
  Network, 
  LogOut, 
  Users, 
  Server, 
  Layers, 
  Activity, 
  ShieldAlert, 
  Map, 
  HardDrive, 
  Settings,
  Cpu
} from 'lucide-react';

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
  const [openDropdown, setOpenDropdown] = useState(null);

  const toggleDropdown = (name) => {
    setOpenDropdown(prev => (prev === name ? null : name));
  };

  const closeDropdowns = () => {
    setOpenDropdown(null);
  };

  // Determina qual grupo está ativo de acordo com a rota atual
  const isNocActive = activeNav === 'zabbix_alarms' || activeNav === 'alarms';
  const isInfraActive = activeNav === 'assets' || activeNav === 'ips' || activeNav === 'weathermap';
  const isToolsActive = activeNav === 'firmwares';
  const isSystemActive = activeNav === 'integrations';

  return (
    <header className="navbar-container">
      <div className="navbar-inner">
        {/* Brand */}
        <div 
          className="brand-logo" 
          id="brand-logo" 
          onClick={() => {
            closeDropdowns();
            if (onSelectNav) onSelectNav('zabbix_alarms');
          }}
        >
          <div className="brand-icon-wrapper">
            <Network size={20} className="brand-icon" />
          </div>
          <div className="brand-text">
            <span className="brand-title">IPER<span className="brand-highlight">SOFT</span></span>
            <span className="brand-subtitle">Gestão de Rede & NOC</span>
          </div>
        </div>

        {/* Center Navigation if authenticated — Modular Mega-Dropdowns */}
        {user && (
          <nav className="navbar-nav" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* GRUPO 1: NOC & OPERAÇÃO */}
            <NavDropdown
              label="NOC & Operação"
              icon={ShieldAlert}
              isActive={isNocActive}
              badgeCount={zabbixAlarmCount + alarmCount}
              badgeColor="#e53935"
              isOpen={openDropdown === 'noc'}
              onToggle={() => toggleDropdown('noc')}
              onClose={closeDropdowns}
              items={[
                {
                  id: 'zabbix_alarms',
                  label: 'Central de Incidentes',
                  subtitle: 'Triggers disparadas e problemas no Zabbix',
                  icon: <ShieldAlert size={15} color={zabbixAlarmCount > 0 ? '#e53935' : 'inherit'} />,
                  badge: zabbixAlarmCount > 0 ? zabbixAlarmCount : null,
                  badgeColor: '#e53935',
                  active: activeNav === 'zabbix_alarms',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('zabbix_alarms');
                  }
                },
                {
                  id: 'alarms',
                  label: 'Diagnóstico de Rede',
                  subtitle: 'Testes ativos de Ping (ICMP), SNMP e Portas TCP',
                  icon: <Activity size={15} color={alarmCount > 0 ? 'var(--color-danger)' : 'inherit'} />,
                  badge: alarmCount > 0 ? alarmCount : null,
                  badgeColor: 'var(--color-danger)',
                  active: activeNav === 'alarms',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('alarms');
                  }
                }
              ]}
            />

            {/* GRUPO 2: INFRAESTRUTURA */}
            <NavDropdown
              label="Infraestrutura"
              icon={Server}
              isActive={isInfraActive}
              isOpen={openDropdown === 'infra'}
              onToggle={() => toggleDropdown('infra')}
              onClose={closeDropdowns}
              items={[
                {
                  id: 'assets',
                  label: 'Inventário de Ativos',
                  subtitle: 'Cadastro unificado de switches, OLTs e roteadores',
                  icon: <Server size={15} />,
                  active: activeNav === 'assets',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('assets');
                  }
                },
                {
                  id: 'ips',
                  label: 'Gestão de Prefixos & IPs',
                  subtitle: 'Varredura SNMP/ICMP, sub-redes e descoberta de VLANs',
                  icon: <Network size={15} />,
                  active: activeNav === 'ips',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('ips');
                  }
                },
                {
                  id: 'weathermap',
                  label: 'Weathermap Topológico',
                  subtitle: 'Mapas de enlace e tráfego em tempo real',
                  icon: <Map size={15} />,
                  active: activeNav === 'weathermap',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('weathermap');
                  }
                }
              ]}
            />

            {/* GRUPO 3: FERRAMENTAS & ARQUIVOS */}
            <NavDropdown
              label="Ferramentas"
              icon={HardDrive}
              isActive={isToolsActive}
              isOpen={openDropdown === 'tools'}
              onToggle={() => toggleDropdown('tools')}
              onClose={closeDropdowns}
              items={[
                {
                  id: 'firmwares',
                  label: 'Servidor de Firmwares',
                  subtitle: 'Upload Web (FileBrowser) e download HTTP para switches',
                  icon: <HardDrive size={15} color="#00bcd4" />,
                  active: activeNav === 'firmwares',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('firmwares');
                  }
                }
              ]}
            />

            {/* GRUPO 4: SISTEMA */}
            <NavDropdown
              label="Sistema"
              icon={Settings}
              isActive={isSystemActive}
              isOpen={openDropdown === 'system'}
              onToggle={() => toggleDropdown('system')}
              onClose={closeDropdowns}
              items={[
                {
                  id: 'integrations',
                  label: 'Painel de Integrações',
                  subtitle: 'Zabbix, Guacamole, Oxidized, VictoriaLogs e Firmwares',
                  icon: <Layers size={15} />,
                  active: activeNav === 'integrations',
                  onClick: () => {
                    closeDropdowns();
                    onSelectNav('integrations');
                  }
                },
                ...(user.role === 'admin' ? [
                  { divider: true },
                  {
                    id: 'users',
                    label: 'Gestão de Usuários',
                    subtitle: 'Contas de acesso, perfis e permissões',
                    icon: <Users size={15} color="#ff9800" />,
                    onClick: () => {
                      closeDropdowns();
                      if (onOpenUserManagement) onOpenUserManagement();
                    }
                  }
                ] : [])
              ]}
            />
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
            <div className="user-nav-box" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
