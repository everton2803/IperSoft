import React, { useState, useEffect } from 'react';
import './App.css';
import { Navbar } from './components/Navbar';
import { LoginForm } from './components/LoginForm';
import { AssetsList } from './components/AssetsList';
import { AssetDetailView } from './components/AssetDetailView';
import { IntegrationsView } from './components/IntegrationsView';
import { AlarmsView } from './components/AlarmsView';
import { ZabbixAlarmsView } from './components/ZabbixAlarmsView';
import { UserManagementModal } from './components/UserManagementModal';
import { authService, diagnosticsService } from './services/api';
import { ThemeProvider } from './context/ThemeContext';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [activeNav, setActiveNav] = useState('zabbix_alarms'); // 'zabbix_alarms' | 'assets' | 'alarms' | 'integrations'
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [alarmCount, setAlarmCount] = useState(0);
  const [zabbixAlarmCount, setZabbixAlarmCount] = useState(0);
  
  // Admin user modal
  const [isUserMgmtOpen, setIsUserMgmtOpen] = useState(false);

  const fetchAlarmCount = async () => {
    try {
      if (authService.getToken()) {
        const [stats, zbxRes] = await Promise.all([
          diagnosticsService.getStats().catch(() => ({ total_alarms: 0 })),
          authService.getZabbixProblems().catch(() => ({ stats: { total: 0 } }))
        ]);
        setAlarmCount(stats.total_alarms || 0);
        setZabbixAlarmCount(zbxRes?.stats?.total || 0);
      }
    } catch {
      // Ignora silenciosamente se offline ou deslogado
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = authService.getToken();
        if (token) {
          const user = await authService.getMe();
          if (user) {
            setCurrentUser(user);
            fetchAlarmCount();
          }
        }
      } catch (e) {
        console.warn('Sessão expirada:', e);
      } finally {
        setIsInitializing(false);
      }
    };

    checkAuth();
  }, []);

  // Polling para contagem de alarmes a cada 30s
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(fetchAlarmCount, 30000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    setActiveNav('zabbix_alarms');
    fetchAlarmCount();
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    setIsUserMgmtOpen(false);
    setAlarmCount(0);
    setZabbixAlarmCount(0);
  };

  return (
    <div className="app-layout">
      <Navbar 
        user={currentUser} 
        activeNav={activeNav}
        onSelectNav={(nav) => {
          setActiveNav(nav);
          setSelectedAssetId(null);
          fetchAlarmCount();
        }}
        onLogout={handleLogout} 
        onOpenUserManagement={() => setIsUserMgmtOpen(true)}
        alarmCount={alarmCount}
        zabbixAlarmCount={zabbixAlarmCount}
      />

      <main className="main-content">
        {isInitializing ? (
          <div className="loading-screen">
            <Loader2 size={28} className="spin-icon" style={{ color: 'var(--color-primary)' }} />
          </div>
        ) : currentUser ? (
          <>
            {activeNav === 'assets' && (
              selectedAssetId ? (
                <AssetDetailView 
                  assetId={selectedAssetId}
                  onBack={() => setSelectedAssetId(null)}
                  isAdmin={currentUser.role === 'admin'}
                />
              ) : (
                <AssetsList 
                  isAdmin={currentUser.role === 'admin'}
                  onSelectAsset={(id) => setSelectedAssetId(id)}
                />
              )
            )}

            {activeNav === 'alarms' && (
              <AlarmsView 
                isAdmin={currentUser.role === 'admin'}
              />
            )}

            {activeNav === 'zabbix_alarms' && (
              <ZabbixAlarmsView 
                isAdmin={currentUser.role === 'admin'}
                onSelectAsset={(id) => {
                  setSelectedAssetId(id);
                  setActiveNav('assets');
                }}
              />
            )}

            {activeNav === 'integrations' && (
              <IntegrationsView 
                isAdmin={currentUser.role === 'admin'}
              />
            )}

            {/* Admin User Management Modal */}
            {currentUser.role === 'admin' && (
              <UserManagementModal
                isOpen={isUserMgmtOpen}
                onClose={() => setIsUserMgmtOpen(false)}
                currentAdminId={currentUser.id}
              />
            )}
          </>
        ) : (
          <div className="login-wrapper">
            <LoginForm onAuthSuccess={handleAuthSuccess} />
          </div>
        )}
      </main>

      <footer className="footer-bar">
        <div className="footer-inner">
          <span>IPERSOFT • Gestão de Ativos de Redes</span>
          <span className="footer-status">Base PostgreSQL Conectada</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
