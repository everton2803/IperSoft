import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Terminal, 
  FileCode, 
  Radio, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  RefreshCw, 
  Link,
  Check,
  Layers,
  ExternalLink,
  Copy,
  RotateCcw,
  Settings,
  Clock,
  ChevronRight,
  FileText,
  HardDrive,
  UploadCloud
} from 'lucide-react';
import { authService } from '../services/api';
import { ZabbixTemplatesModal } from './ZabbixTemplatesModal';
import { SlideOverDrawer } from './common/SlideOverDrawer';

export const IntegrationsView = ({ isAdmin, onSelectNav }) => {
  // Estado do Drawer Lateral (qual integração está sendo configurada)
  const [activeDrawer, setActiveDrawer] = useState(null);

  // Zabbix state
  const [zbxUrl, setZbxUrl] = useState('');
  const [zbxToken, setZbxToken] = useState('');
  const [zbxAuthType, setZbxAuthType] = useState('token');
  const [zbxUsername, setZbxUsername] = useState('');
  const [zbxPassword, setZbxPassword] = useState('');
  const [zbxHasToken, setZbxHasToken] = useState(false);
  const [zbxIsConnected, setZbxIsConnected] = useState(false);
  const [zbxLastSync, setZbxLastSync] = useState(null);
  const [zbxLoading, setZbxLoading] = useState(false);
  const [zbxTesting, setZbxTesting] = useState(false);
  const [zbxSyncing, setZbxSyncing] = useState(false);
  const [zbxSyncResult, setZbxSyncResult] = useState(null);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templateUpdatesCount, setTemplateUpdatesCount] = useState(0);

  // Guacamole state
  const [guacUrl, setGuacUrl] = useState('');
  const [guacPublicUrl, setGuacPublicUrl] = useState('https://guacamoles.iper.net.br/guacamole');
  const [guacUsername, setGuacUsername] = useState('');
  const [guacPassword, setGuacPassword] = useState('');
  const [guacHasPassword, setGuacHasPassword] = useState(false);
  const [guacIsConnected, setGuacIsConnected] = useState(false);
  const [guacLastSync, setGuacLastSync] = useState(null);
  const [guacLoading, setGuacLoading] = useState(false);
  const [guacTesting, setGuacTesting] = useState(false);
  const [guacMatching, setGuacMatching] = useState(false);
  const [guacMatchResult, setGuacMatchResult] = useState(null);

  // Oxidized state
  const [oxUrl, setOxUrl] = useState('https://oxidized.iper.net.br');
  const [oxUsername, setOxUsername] = useState('');
  const [oxPassword, setOxPassword] = useState('');
  const [oxHasPassword, setOxHasPassword] = useState(false);
  const [oxIsConnected, setOxIsConnected] = useState(false);
  const [oxLastSync, setOxLastSync] = useState(null);
  const [oxLoading, setOxLoading] = useState(false);
  const [oxTesting, setOxTesting] = useState(false);
  const [oxSyncing, setOxSyncing] = useState(false);
  const [oxReloading, setOxReloading] = useState(false);
  const [oxSyncResult, setOxSyncResult] = useState(null);
  const [copiedSourceUrl, setCopiedSourceUrl] = useState(false);

  // VictoriaLogs state
  const [vlogsUrl, setVlogsUrl] = useState('http://10.10.1.2:9428');
  const [vlogsIsConnected, setVlogsIsConnected] = useState(false);
  const [vlogsLoading, setVlogsLoading] = useState(false);
  const [vlogsTesting, setVlogsTesting] = useState(false);
  const [vlogsStats, setVlogsStats] = useState(null);

  // Firmwares state
  const [fwHttpUrl, setFwHttpUrl] = useState('http://10.10.1.2:8089');
  const [fwWebUrl, setFwWebUrl] = useState('https://firmware.iper.net.br');
  const [fwIsConnected, setFwIsConnected] = useState(false);
  const [fwLoading, setFwLoading] = useState(false);
  const [fwTesting, setFwTesting] = useState(false);
  const [fwFilesData, setFwFilesData] = useState(null);

  // Global feedback
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const [zbxCfg, guacCfg, oxCfg, vlogsCfg, vlogsStatData, fwCfg, fwFiles] = await Promise.all([
        authService.getZabbixConfig().catch(() => null),
        authService.getGuacamoleConfig().catch(() => null),
        authService.getOxidizedConfig().catch(() => null),
        authService.getVictoriaLogsConfig().catch(() => null),
        authService.getVictoriaLogsStats().catch(() => null),
        authService.getFirmwaresConfig().catch(() => null),
        authService.getFirmwaresFiles().catch(() => null)
      ]);

      if (zbxCfg) {
        setZbxUrl(zbxCfg.url || '');
        setZbxHasToken(zbxCfg.has_token || false);
        setZbxUsername(zbxCfg.username || '');
        setZbxIsConnected(zbxCfg.is_active || false);
        setZbxLastSync(zbxCfg.last_sync || null);
        if (zbxCfg.username) setZbxAuthType('userpass');

        authService.getZabbixTemplateUpdates()
          .then(data => {
            if (data && Array.isArray(data)) {
              setTemplateUpdatesCount(data.filter(t => t.has_update).length);
            }
          })
          .catch(() => {});
      }

      if (guacCfg) {
        setGuacUrl(guacCfg.url || '');
        setGuacPublicUrl(guacCfg.public_url || 'https://guacamoles.iper.net.br/guacamole');
        setGuacUsername(guacCfg.username || '');
        setGuacHasPassword(guacCfg.has_password || false);
        setGuacIsConnected(guacCfg.is_active || false);
        setGuacLastSync(guacCfg.last_sync || null);
      }

      if (oxCfg) {
        setOxUrl(oxCfg.url || 'http://10.10.1.2:8888');
        setOxUsername(oxCfg.username || '');
        setOxHasPassword(oxCfg.has_password || false);
        setOxIsConnected(oxCfg.is_active || false);
        setOxLastSync(oxCfg.last_sync || null);
      }

      if (vlogsCfg) {
        setVlogsUrl(vlogsCfg.url || 'http://10.10.1.2:9428');
        setVlogsIsConnected(vlogsCfg.is_active || false);
      }

      if (vlogsStatData) {
        setVlogsStats(vlogsStatData);
      }

      if (fwCfg) {
        setFwHttpUrl(fwCfg.url || 'http://10.10.1.2:8089');
        setFwWebUrl(fwCfg.public_url || 'https://firmware.iper.net.br');
        setFwIsConnected(fwCfg.is_active || false);
      }

      if (fwFiles) {
        setFwFilesData(fwFiles);
      }
    } catch (err) {
      console.warn('Erro ao carregar configurações:', err);
    }
  };

  // Zabbix Handlers
  const handleTestZabbix = async () => {
    if (!zbxUrl.trim()) {
      setFeedback({ type: 'error', text: 'Informe a URL da API do Zabbix.' });
      return;
    }

    setZbxTesting(true);
    setFeedback(null);
    try {
      const payload = {
        url: zbxUrl.trim(),
        token: zbxAuthType === 'token' ? zbxToken.trim() || undefined : undefined,
        username: zbxAuthType === 'userpass' ? zbxUsername.trim() || undefined : undefined,
        password: zbxAuthType === 'userpass' ? zbxPassword || undefined : undefined,
      };

      const res = await authService.testZabbixConnection(payload);
      setFeedback({ type: 'success', text: res.message || 'Conexão com Zabbix validada com sucesso.' });
      setZbxIsConnected(true);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao conectar ao Zabbix.' });
      setZbxIsConnected(false);
    } finally {
      setZbxTesting(false);
    }
  };

  const handleSaveZabbix = async (e) => {
    e.preventDefault();
    if (!zbxUrl.trim()) {
      setFeedback({ type: 'error', text: 'A URL do Zabbix é obrigatória.' });
      return;
    }

    setZbxLoading(true);
    setFeedback(null);
    try {
      await authService.saveZabbixConfig({
        url: zbxUrl.trim(),
        token: zbxAuthType === 'token' ? zbxToken.trim() : undefined,
        username: zbxAuthType === 'userpass' ? zbxUsername.trim() : undefined,
        password: zbxAuthType === 'userpass' ? zbxPassword : undefined,
      });

      setFeedback({ type: 'success', text: 'Configurações de API do Zabbix salvas com sucesso.' });
      setZbxHasToken(Boolean(zbxToken || zbxHasToken));
      setZbxToken('');
      setZbxPassword('');
      setZbxIsConnected(true);
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configuração do Zabbix.' });
    } finally {
      setZbxLoading(false);
    }
  };

  const handleSyncZabbixHosts = async () => {
    setZbxSyncing(true);
    setFeedback(null);
    setZbxSyncResult(null);
    try {
      const res = await authService.syncZabbixHosts();
      setZbxSyncResult(res);
      setFeedback({
        type: 'success',
        text: res.message || `Sincronização concluída: ${res.created || 0} novos importados, ${res.updated || 0} atualizados.`
      });
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao buscar e importar hosts do Zabbix.' });
    } finally {
      setZbxSyncing(false);
    }
  };

  // Guacamole Handlers
  const handleTestGuacamole = async () => {
    if (!guacUrl.trim() || !guacUsername.trim()) {
      setFeedback({ type: 'error', text: 'Informe a URL e o usuário administrador do Guacamole.' });
      return;
    }

    setGuacTesting(true);
    setFeedback(null);
    try {
      const res = await authService.testGuacamoleConnection({
        url: guacUrl.trim(),
        username: guacUsername.trim(),
        password: guacPassword || undefined
      });
      setFeedback({ type: 'success', text: res.message || 'Conexão com Apache Guacamole validada com sucesso!' });
      setGuacIsConnected(true);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao autenticar no Apache Guacamole.' });
      setGuacIsConnected(false);
    } finally {
      setGuacTesting(false);
    }
  };

  const handleSaveGuacamole = async (e) => {
    e.preventDefault();
    if (!guacUrl.trim() || !guacUsername.trim()) {
      setFeedback({ type: 'error', text: 'A URL e o usuário administrador do Guacamole são obrigatórios.' });
      return;
    }

    setGuacLoading(true);
    setFeedback(null);
    try {
      await authService.saveGuacamoleConfig({
        url: guacUrl.trim(),
        public_url: guacPublicUrl.trim(),
        username: guacUsername.trim(),
        password: guacPassword || undefined
      });

      setFeedback({ type: 'success', text: 'Configurações de acesso do Apache Guacamole salvas com sucesso.' });
      setGuacHasPassword(Boolean(guacPassword || guacHasPassword));
      setGuacPassword('');
      setGuacIsConnected(true);
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configuração do Guacamole.' });
    } finally {
      setGuacLoading(false);
    }
  };

  const handleMatchGuacamoleConnections = async () => {
    if (!guacIsConnected && !guacHasPassword && !guacPassword) {
      setFeedback({ type: 'error', text: 'Salve as credenciais do Guacamole antes de vincular.' });
      return;
    }

    setGuacMatching(true);
    setFeedback(null);
    setGuacMatchResult(null);
    try {
      const res = await authService.matchGuacamoleConnections();
      setGuacMatchResult(res);
      setFeedback({ 
        type: 'success', 
        text: res.message || `${res.matched} conexões do Guacamole foram vinculadas aos ativos pelo IP com sucesso.` 
      });
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao buscar e vincular conexões do Guacamole.' });
    } finally {
      setGuacMatching(false);
    }
  };

  // Oxidized Handlers
  const handleTestOxidized = async () => {
    if (!oxUrl.trim()) {
      setFeedback({ type: 'error', text: 'Informe a URL da API do Oxidized.' });
      return;
    }
    setOxTesting(true);
    setFeedback(null);
    try {
      const res = await authService.testOxidizedConnection({
        url: oxUrl.trim(),
        username: oxUsername.trim() || undefined,
        password: oxPassword || undefined
      });
      setFeedback({ type: 'success', text: res.message || 'Conexão com Oxidized validada com sucesso!' });
      setOxIsConnected(true);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao conectar ao Oxidized.' });
      setOxIsConnected(false);
    } finally {
      setOxTesting(false);
    }
  };

  const handleSaveOxidized = async (e) => {
    if (e) e.preventDefault();
    if (!oxUrl.trim()) {
      setFeedback({ type: 'error', text: 'A URL do Oxidized é obrigatória.' });
      return;
    }
    setOxLoading(true);
    setFeedback(null);
    try {
      await authService.saveOxidizedConfig({
        url: oxUrl.trim(),
        username: oxUsername.trim() || undefined,
        password: oxPassword || undefined
      });
      setFeedback({ type: 'success', text: 'Configuração do Oxidized salva com sucesso!' });
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configuração do Oxidized.' });
    } finally {
      setOxLoading(false);
    }
  };

  const handleSyncOxidized = async () => {
    setOxSyncing(true);
    setFeedback(null);
    setOxSyncResult(null);
    try {
      const res = await authService.syncOxidizedNodes();
      setOxSyncResult(res);
      setFeedback({
        type: 'success',
        text: `Sincronização concluída! ${res.matched_count} de ${res.total_nodes} nós do Oxidized foram vinculados aos ativos do IperSoft.`
      });
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao sincronizar nós do Oxidized.' });
    } finally {
      setOxSyncing(false);
    }
  };

  const handleReloadOxidized = async () => {
    setOxReloading(true);
    setFeedback(null);
    try {
      const res = await authService.reloadOxidizedNodes();
      setFeedback({
        type: 'success',
        text: res.message || 'Lista recarregada no Oxidized! Equipamentos excluídos foram removidos da memória.'
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao recarregar nós no Oxidized.' });
    } finally {
      setOxReloading(false);
    }
  };

  const handleCopySourceUrl = () => {
    const origin = window.location.origin;
    const sourceUrl = `${origin}/api/v1/integrations/oxidized/nodes`;
    navigator.clipboard.writeText(sourceUrl);
    setCopiedSourceUrl(true);
    setTimeout(() => setCopiedSourceUrl(false), 2500);
  };

  // VictoriaLogs Handlers
  const handleTestVictoriaLogs = async () => {
    if (!vlogsUrl.trim()) {
      setFeedback({ type: 'error', text: 'Informe a URL do VictoriaLogs.' });
      return;
    }
    setVlogsTesting(true);
    setFeedback(null);
    try {
      const res = await authService.testVictoriaLogsConnection({ url: vlogsUrl.trim() });
      setFeedback({ type: 'success', text: res.message || 'Conexão com VictoriaLogs validada com sucesso.' });
      setVlogsIsConnected(true);
      const statData = await authService.getVictoriaLogsStats().catch(() => null);
      if (statData) setVlogsStats(statData);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao conectar ao VictoriaLogs.' });
      setVlogsIsConnected(false);
    } finally {
      setVlogsTesting(false);
    }
  };

  const handleSaveVictoriaLogs = async (e) => {
    e.preventDefault();
    if (!vlogsUrl.trim()) {
      setFeedback({ type: 'error', text: 'A URL do VictoriaLogs é obrigatória.' });
      return;
    }
    setVlogsLoading(true);
    setFeedback(null);
    try {
      await authService.saveVictoriaLogsConfig({
        url: vlogsUrl.trim(),
        is_active: true
      });
      setFeedback({ type: 'success', text: 'Configuração do VictoriaLogs salva com sucesso.' });
      setVlogsIsConnected(true);
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configuração do VictoriaLogs.' });
    } finally {
      setVlogsLoading(false);
    }
  };

  // Firmwares Handlers
  const handleTestFirmwares = async () => {
    if (!fwHttpUrl.trim()) {
      setFeedback({ type: 'error', text: 'Informe a URL HTTP de download de firmwares.' });
      return;
    }
    setFwTesting(true);
    setFeedback(null);
    try {
      const res = await authService.testFirmwaresConnection({ 
        url: fwHttpUrl.trim(),
        public_url: fwWebUrl.trim()
      });
      if (res.is_connected) {
        setFeedback({ 
          type: 'success', 
          text: `Conexão OK! Download HTTP (${res.http_service?.latency_ms || 0}ms) e Web Upload (${res.web_service?.latency_ms || 0}ms) validados com sucesso.` 
        });
        setFwIsConnected(true);
        const filesData = await authService.getFirmwaresFiles().catch(() => null);
        if (filesData) setFwFilesData(filesData);
      } else {
        setFeedback({ 
          type: 'error', 
          text: `Falha na comunicação com o Servidor de Firmwares: HTTP (${res.http_service?.error || 'Erro'}) | Web (${res.web_service?.error || 'Erro'})` 
        });
        setFwIsConnected(false);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao conectar ao Servidor de Firmwares.' });
      setFwIsConnected(false);
    } finally {
      setFwTesting(false);
    }
  };

  const handleSaveFirmwares = async (e) => {
    e.preventDefault();
    if (!fwHttpUrl.trim()) {
      setFeedback({ type: 'error', text: 'A URL HTTP de download é obrigatória.' });
      return;
    }
    setFwLoading(true);
    setFeedback(null);
    try {
      await authService.saveFirmwaresConfig({
        url: fwHttpUrl.trim(),
        public_url: fwWebUrl.trim(),
        is_active: true
      });
      setFeedback({ type: 'success', text: 'Configuração do Servidor de Firmwares salva com sucesso.' });
      setFwIsConnected(true);
      await loadConfigs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configuração do Servidor de Firmwares.' });
    } finally {
      setFwLoading(false);
    }
  };

  return (
    <div className="integrations-view">
      {/* Header Panorâmico */}
      <div className="integrations-header">
        <div>
          <h1 className="section-title">Integrações de Sistemas</h1>
          <p className="dashboard-sub">
            Conectividade, sincronização de ativos e credenciais de API com toda a stack de monitoramento
          </p>
        </div>
      </div>

      {feedback && !activeDrawer && (
        <div className={`alert-box alert-${feedback.type}`} style={{ marginBottom: '1.25rem' }}>
          {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* GRADE PANORÂMICA DE INTEGRAÇÕES */}
      <div className="integrations-three-col-grid" style={{ alignItems: 'stretch' }}>
        
        {/* 1. ZABBIX SERVER CARD */}
        <div className="integration-main-card">
          <div className="integration-card-header">
            <div className="integration-header-left">
              <div className="integration-icon-container" style={{ background: 'rgba(229, 57, 53, 0.1)', borderColor: 'rgba(229, 57, 53, 0.25)' }}>
                <Radio size={22} color="#e53935" />
              </div>
              <div>
                <div className="integration-title-row">
                  <h2 className="integration-main-title">Zabbix Server</h2>
                  <span className={`connection-badge ${zbxIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                    {zbxIsConnected ? (
                      <>
                        <span className="dot-online" style={{ marginRight: 4 }}></span>
                        Conectado
                      </>
                    ) : (
                      'Não Conectado'
                    )}
                  </span>
                </div>
                <p className="integration-main-sub">
                  Importação automática de hosts a cada <strong>1 hora</strong>. O envio para o Zabbix é estritamente manual.
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setActiveDrawer('zabbix')}
                title="Configurações e Credenciais do Zabbix"
                style={{ borderRadius: '8px', padding: '6px' }}
              >
                <Settings size={16} />
              </button>
            )}
          </div>

          <div className="integration-status-strip">
            <div className="status-strip-item">
              <Clock size={13} color="var(--color-primary)" />
              <span>Última sincronização: <strong>{zbxLastSync ? new Date(zbxLastSync).toLocaleString('pt-BR') : 'N/A'}</strong></span>
            </div>
            <div className="status-strip-item">
              <span className="mini-badge">Auto-Import: 1h</span>
            </div>
          </div>

          {isAdmin && (
            <div className="integration-primary-actions">
              <button
                type="button"
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleSyncZabbixHosts}
                disabled={zbxSyncing || zbxLoading || zbxTesting}
                title="Busca todos os hosts do Zabbix, vincula com os ativos existentes e importa os novos para o IperSoft"
              >
                {zbxSyncing ? (
                  <>
                    <Loader2 size={15} className="spin-icon" />
                    <span>Importando Hosts do Zabbix...</span>
                  </>
                ) : (
                  <>
                    <Link size={15} />
                    <span>Sincronizar & Importar Hosts Agora</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                onClick={() => setShowTemplatesModal(true)}
                title="Monitora e atualiza os templates oficiais do Zabbix diretamente do repositório GitHub"
              >
                <Layers size={15} color="#e53935" />
                <span>Templates Oficiais Zabbix</span>
                {templateUpdatesCount > 0 ? (
                  <span style={{ 
                    background: 'rgba(245, 158, 11, 0.2)', 
                    color: '#f59e0b', 
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    fontSize: '0.72rem', 
                    padding: '1px 7px', 
                    borderRadius: 10, 
                    fontWeight: 600 
                  }}>
                    {templateUpdatesCount} atualização(ões)
                  </span>
                ) : (
                  <span style={{ 
                    background: 'rgba(16, 185, 129, 0.15)', 
                    color: '#10b981', 
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    fontSize: '0.72rem', 
                    padding: '1px 7px', 
                    borderRadius: 10, 
                    fontWeight: 500 
                  }}>
                    Em dia
                  </span>
                )}
              </button>
            </div>
          )}

          {zbxSyncResult && (
            <div className="match-summary-card">
              <div className="match-summary-header">
                <span className="match-summary-title">Resultado:</span>
                <span className="match-summary-badge">
                  {zbxSyncResult.updated || 0} atualizados • {zbxSyncResult.created || 0} novos
                </span>
              </div>
              <p className="match-summary-desc">{zbxSyncResult.message}</p>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setActiveDrawer('zabbix')}
            >
              <Settings size={14} />
              <span>Configurações & Credenciais</span>
              <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
            </button>
          </div>
        </div>

        {/* 2. APACHE GUACAMOLE CARD */}
        <div className="integration-main-card">
          <div className="integration-card-header">
            <div className="integration-header-left">
              <div className="integration-icon-container">
                <Terminal size={22} className="integration-icon-main" />
              </div>
              <div>
                <div className="integration-title-row">
                  <h2 className="integration-main-title">Apache Guacamole</h2>
                  <span className={`connection-badge ${guacIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                    {guacIsConnected ? (
                      <>
                        <span className="dot-online" style={{ marginRight: 4 }}></span>
                        Conectado
                      </>
                    ) : (
                      'Não Conectado'
                    )}
                  </span>
                </div>
                <p className="integration-main-sub">
                  Importação automática de conexões (SSH/Telnet/RDP) a cada <strong>1 hora</strong>. Criação e edição são manuais.
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setActiveDrawer('guacamole')}
                title="Configurações e Credenciais do Guacamole"
                style={{ borderRadius: '8px', padding: '6px' }}
              >
                <Settings size={16} />
              </button>
            )}
          </div>

          <div className="integration-status-strip">
            <div className="status-strip-item">
              <Clock size={13} color="var(--color-primary)" />
              <span>Última sincronização: <strong>{guacLastSync ? new Date(guacLastSync).toLocaleString('pt-BR') : 'N/A'}</strong></span>
            </div>
            <div className="status-strip-item">
              <span className="mini-badge">Auto-Import: 1h</span>
            </div>
          </div>

          {isAdmin && (
            <div className="integration-primary-actions">
              <button
                type="button"
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleMatchGuacamoleConnections}
                disabled={guacMatching || guacLoading || guacTesting}
                title="Busca todas as conexões do Guacamole, vincula com os ativos existentes por IP e importa as novas"
              >
                {guacMatching ? (
                  <>
                    <Loader2 size={15} className="spin-icon" />
                    <span>Importando Conexões...</span>
                  </>
                ) : (
                  <>
                    <Link size={15} />
                    <span>Sincronizar & Importar Conexões Agora</span>
                  </>
                )}
              </button>
            </div>
          )}

          {guacMatchResult && (
            <div className="match-summary-card">
              <div className="match-summary-header">
                <span className="match-summary-title">Resultado:</span>
                <span className="match-summary-badge">
                  {guacMatchResult.matched} vinculadas • {guacMatchResult.created_new || 0} novas
                </span>
              </div>
              <p className="match-summary-desc">{guacMatchResult.message}</p>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setActiveDrawer('guacamole')}
            >
              <Settings size={14} />
              <span>Configurações & Credenciais</span>
              <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
            </button>
          </div>
        </div>

        {/* 3. OXIDIZED CARD */}
        <div className="integration-main-card">
          <div className="integration-card-header">
            <div className="integration-header-left">
              <div className="integration-icon-container" style={{ background: 'rgba(233, 30, 99, 0.1)', borderColor: 'rgba(233, 30, 99, 0.25)' }}>
                <FileCode size={22} color="#e91e63" />
              </div>
              <div>
                <div className="integration-title-row">
                  <h2 className="integration-main-title">Oxidized Backup</h2>
                  <span className={`connection-badge ${oxIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                    {oxIsConnected ? (
                      <>
                        <span className="dot-online" style={{ marginRight: 4 }}></span>
                        Conectado
                      </>
                    ) : (
                      'Não Conectado'
                    )}
                  </span>
                </div>
                <p className="integration-main-sub">
                  O Oxidized lê a lista de equipamentos dinamicamente do IperSoft via <code>source: http</code>.
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setActiveDrawer('oxidized')}
                title="Configurações e Endpoint do Oxidized"
                style={{ borderRadius: '8px', padding: '6px' }}
              >
                <Settings size={16} />
              </button>
            )}
          </div>

          <div className="integration-status-strip">
            <div className="status-strip-item">
              <Clock size={13} color="var(--color-primary)" />
              <span>Última consulta: <strong>{oxLastSync ? new Date(oxLastSync).toLocaleString('pt-BR') : 'N/A'}</strong></span>
            </div>
            <div className="status-strip-item">
              <span className="mini-badge">Fonte: IperSoft HTTP</span>
            </div>
          </div>

          <div className="integration-primary-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={handleReloadOxidized}
              disabled={oxReloading || oxSyncing || oxTesting || oxLoading || !isAdmin}
              title="Força o Oxidized a recarregar a lista de nós do IperSoft (/reload)"
            >
              {oxReloading ? <Loader2 size={14} className="spin-icon" /> : <RotateCcw size={14} />}
              <span>{oxReloading ? 'Recarregando...' : 'Recarregar Nós (/reload)'}</span>
            </button>

            <button
              type="button"
              className="btn-secondary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={handleSyncOxidized}
              disabled={oxSyncing || oxTesting || oxLoading || oxReloading}
              title="Atualiza o status do último backup de cada nó no IperSoft"
            >
              {oxSyncing ? <Loader2 size={14} className="spin-icon" /> : <Layers size={14} />}
              <span>{oxSyncing ? 'Consultando...' : 'Atualizar Status'}</span>
            </button>
          </div>

          {oxSyncResult && (
            <div className="match-summary-card">
              <div className="match-summary-header">
                <span className="match-summary-title">Status Atualizado:</span>
                <span className="match-summary-badge">
                  {oxSyncResult.matched_count} de {oxSyncResult.total_nodes} nós vinculados
                </span>
              </div>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setActiveDrawer('oxidized')}
            >
              <Settings size={14} />
              <span>Configurações & Endpoint Source</span>
              <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
            </button>
          </div>
        </div>

        {/* 4. VICTORIALOGS (SYSLOG CENTRAL) CARD */}
        <div className="integration-main-card">
          <div className="integration-card-header">
            <div className="integration-header-left">
              <div className="integration-icon-container" style={{ background: 'rgba(76, 175, 80, 0.1)', borderColor: 'rgba(76, 175, 80, 0.25)' }}>
                <FileText size={22} color="#4caf50" />
              </div>
              <div>
                <div className="integration-title-row">
                  <h2 className="integration-main-title">VictoriaLogs</h2>
                  <span className={`connection-badge ${vlogsIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                    {vlogsIsConnected ? (
                      <>
                        <span className="dot-online" style={{ marginRight: 4 }}></span>
                        Conectado
                      </>
                    ) : (
                      'Não Conectado'
                    )}
                  </span>
                </div>
                <p className="integration-main-sub">
                  Coletor e buscador central de Syslog em portas UDP e TCP <strong>514</strong> com retenção de 30 dias na VPS BrDrive.
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setActiveDrawer('victorialogs')}
                title="Configurações do VictoriaLogs"
                style={{ borderRadius: '8px', padding: '6px' }}
              >
                <Settings size={16} />
              </button>
            )}
          </div>

          <div className="integration-status-strip">
            <div className="status-strip-item">
              <Clock size={13} color="var(--color-primary)" />
              <span>Volume recente: <strong>{vlogsStats?.total_1h ? `${vlogsStats.total_1h.toLocaleString('pt-BR')} msgs (1h)` : 'Ativo'}</strong></span>
            </div>
            <div className="status-strip-item">
              <span className="mini-badge" style={{ background: 'rgba(76, 175, 80, 0.15)', color: '#81c784' }}>Syslog 514</span>
            </div>
          </div>

          {isAdmin && (
            <div className="integration-primary-actions">
              <button
                type="button"
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleTestVictoriaLogs}
                disabled={vlogsTesting || vlogsLoading}
                title="Testa a comunicação direta com o container VictoriaLogs"
              >
                {vlogsTesting ? (
                  <>
                    <Loader2 size={15} className="spin-icon" />
                    <span>Testando Conexão...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={15} />
                    <span>Testar Conexão com VictoriaLogs</span>
                  </>
                )}
              </button>
            </div>
          )}

          {vlogsStats && (
            <div className="match-summary-card">
              <div className="match-summary-header">
                <span className="match-summary-title">Métricas de Coleta:</span>
                <span className="match-summary-badge" style={{ background: 'rgba(76, 175, 80, 0.15)', color: '#81c784' }}>
                  {vlogsStats.total_24h ? `${vlogsStats.total_24h.toLocaleString('pt-BR')} msgs (24h)` : 'Online'}
                </span>
              </div>
              <p className="match-summary-desc">
                Serviço de Syslog ativo. Logs consultados em tempo real na tela do equipamento via LogsQL nativo.
              </p>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setActiveDrawer('victorialogs')}
            >
              <Settings size={14} />
              <span>Configurações de Conexão</span>
              <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
            </button>
          </div>
        </div>

        {/* 5. SERVIDOR DE FIRMWARES & ARQUIVOS */}
        <div className="integration-main-card">
          <div className="integration-card-header">
            <div className="integration-header-left">
              <div className="integration-icon-container" style={{ background: 'rgba(0, 188, 212, 0.1)', borderColor: 'rgba(0, 188, 212, 0.25)' }}>
                <HardDrive size={22} color="#00bcd4" />
              </div>
              <div>
                <div className="integration-title-row">
                  <h2 className="integration-main-title">Servidor de Firmwares & Arquivos</h2>
                  <span className={`connection-badge ${fwIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                    {fwIsConnected ? (
                      <>
                        <span className="dot-online" style={{ marginRight: 4 }}></span>
                        Conectado
                      </>
                    ) : (
                      'Não Conectado'
                    )}
                  </span>
                </div>
                <p className="integration-main-sub">
                  Upload web via <strong>FileBrowser</strong> e download direto em switches e OLTs via <strong>HTTP Nginx</strong> na porta 8089.
                </p>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className="btn-icon"
                onClick={() => setActiveDrawer('firmwares')}
                title="Configurações do Servidor de Firmwares"
                style={{ borderRadius: '8px', padding: '6px' }}
              >
                <Settings size={16} />
              </button>
            )}
          </div>

          <div className="integration-status-strip">
            <div className="status-strip-item">
              <Layers size={13} color="var(--color-primary)" />
              <span>Armazenados: <strong>{fwFilesData?.total_files || 0} arquivos ({fwFilesData?.total_size_formatted || '0 B'})</strong></span>
            </div>
            <div className="status-strip-item">
              <span className="mini-badge" style={{ background: 'rgba(0, 188, 212, 0.15)', color: '#00bcd4' }}>HTTP 8089</span>
            </div>
            <div className="status-strip-item">
              <span className="mini-badge" style={{ background: 'rgba(76, 175, 80, 0.15)', color: '#81c784' }}>HTTPS Web</span>
            </div>
          </div>

          <div className="integration-primary-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              style={{ flex: '1 1 auto', justifyContent: 'center' }}
              onClick={() => onSelectNav && onSelectNav('firmwares')}
              title="Abre a tela completa do Servidor de Firmwares para copiar URLs e comandos CLI"
            >
              <HardDrive size={15} />
              <span>Explorar Firmwares & Comandos</span>
            </button>

            <a
              href={fwWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              title="Abre a interface Web do FileBrowser em nova aba para enviar arquivos do computador"
            >
              <UploadCloud size={15} color="#00bcd4" />
              <span>Web Upload</span>
              <ExternalLink size={12} />
            </a>

            <a
              href={fwHttpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              title="Abre a listagem de arquivos HTTP dos equipamentos"
            >
              <Server size={14} color="#4caf50" />
              <span>Índice HTTP</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setActiveDrawer('firmwares')}
            >
              <Settings size={14} />
              <span>Configurações de Conexão</span>
              <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
            </button>
          </div>
        </div>

      </div>

      {/* MODAL DE TEMPLATES ZABBIX */}
      <ZabbixTemplatesModal 
        isOpen={showTemplatesModal} 
        onClose={() => { 
          setShowTemplatesModal(false); 
          loadConfigs(); 
        }} 
      />

      {/* DRAWER LATERAL DESLIZANTE DE CONFIGURAÇÕES DE INTEGRAÇÃO */}
      <SlideOverDrawer
        isOpen={Boolean(activeDrawer)}
        onClose={() => setActiveDrawer(null)}
        title={
          activeDrawer === 'zabbix' ? 'Configurações: Zabbix Server' :
          activeDrawer === 'guacamole' ? 'Configurações: Apache Guacamole' :
          activeDrawer === 'oxidized' ? 'Configurações: Oxidized Daemon' :
          activeDrawer === 'victorialogs' ? 'Configurações: VictoriaLogs' :
          activeDrawer === 'firmwares' ? 'Configurações: Servidor de Firmwares' : ''
        }
        subtitle={
          activeDrawer === 'zabbix' ? 'URL da API JSON-RPC, credenciais e token de acesso' :
          activeDrawer === 'guacamole' ? 'API REST, URL pública HTTPS para SSO e credenciais admin' :
          activeDrawer === 'oxidized' ? 'API REST de nós e endpoint dinâmico source: http' :
          activeDrawer === 'victorialogs' ? 'Endpoint interno do coletor de logs Syslog (UDP/TCP 514)' :
          activeDrawer === 'firmwares' ? 'Porta HTTP 8089 para download direto e portal Web FileBrowser' : ''
        }
        icon={
          activeDrawer === 'zabbix' ? Radio :
          activeDrawer === 'guacamole' ? Terminal :
          activeDrawer === 'oxidized' ? FileCode :
          activeDrawer === 'victorialogs' ? FileText :
          activeDrawer === 'firmwares' ? HardDrive : Settings
        }
        width="540px"
      >
        {/* Alerta de feedback dentro do Drawer */}
        {feedback && (
          <div className={`alert-box alert-${feedback.type}`} style={{ marginBottom: '1.25rem' }}>
            {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* 1. FORMULÁRIO ZABBIX NO DRAWER */}
        {activeDrawer === 'zabbix' && (
          <form onSubmit={handleSaveZabbix} className="integration-form">
            <div className="form-group">
              <label className="form-label">URL da API Zabbix</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: http://192.168.1.50/zabbix"
                value={zbxUrl}
                onChange={(e) => setZbxUrl(e.target.value)}
                disabled={!isAdmin || zbxLoading}
                required
              />
              <small className="form-help">
                URL base onde o frontend do Zabbix está rodando (com endpoint <code>api_jsonrpc.php</code>).
              </small>
            </div>

            <div className="form-group">
              <label className="form-label">Método de Autenticação</label>
              <div className="auth-mode-selector">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="zbxAuthType"
                    value="token"
                    checked={zbxAuthType === 'token'}
                    onChange={() => setZbxAuthType('token')}
                    disabled={!isAdmin || zbxLoading}
                  />
                  <span>API Token (5.4+)</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="zbxAuthType"
                    value="userpass"
                    checked={zbxAuthType === 'userpass'}
                    onChange={() => setZbxAuthType('userpass')}
                    disabled={!isAdmin || zbxLoading}
                  />
                  <span>Usuário / Senha</span>
                </label>
              </div>
            </div>

            {zbxAuthType === 'token' ? (
              <div className="form-group">
                <label className="form-label">
                  API Token {zbxHasToken && <span className="tag-saved">(Gravado)</span>}
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder={zbxHasToken ? '•••••••••••• (em branco mantém gravado)' : 'Cole o token da API Zabbix'}
                  value={zbxToken}
                  onChange={(e) => setZbxToken(e.target.value)}
                  disabled={!isAdmin || zbxLoading}
                />
              </div>
            ) : (
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Usuário</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Admin"
                    value={zbxUsername}
                    onChange={(e) => setZbxUsername(e.target.value)}
                    disabled={!isAdmin || zbxLoading}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Senha</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Senha"
                    value={zbxPassword}
                    onChange={(e) => setZbxPassword(e.target.value)}
                    disabled={!isAdmin || zbxLoading}
                  />
                </div>
              </div>
            )}

            <div className="integration-actions-footer" style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestZabbix}
                disabled={zbxTesting || zbxLoading || zbxSyncing}
              >
                {zbxTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                <span>Testar Conexão</span>
              </button>
              {isAdmin && (
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={zbxLoading || zbxTesting || zbxSyncing}
                >
                  {zbxLoading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              )}
            </div>
          </form>
        )}

        {/* 2. FORMULÁRIO GUACAMOLE NO DRAWER */}
        {activeDrawer === 'guacamole' && (
          <form onSubmit={handleSaveGuacamole} className="integration-form">
            <div className="form-group">
              <label className="form-label">URL da API Guacamole (Servidor / Backend)</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: https://guacamoles.iper.net.br/guacamole ou http://10.10.1.2:8086/guacamole"
                value={guacUrl}
                onChange={(e) => setGuacUrl(e.target.value)}
                disabled={!isAdmin || guacLoading || guacMatching}
                required
              />
              <small className="form-help">
                Endereço de rede utilizado pelo backend do IperSoft para autenticar e criar conexões.
              </small>
            </div>

            <div className="form-group">
              <label className="form-label">URL Pública / Externa (Navegador & Terminal Embutido)</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://guacamoles.iper.net.br/guacamole"
                value={guacPublicUrl}
                onChange={(e) => setGuacPublicUrl(e.target.value)}
                disabled={!isAdmin || guacLoading || guacMatching}
                required
              />
              <small className="form-help">
                URL pública HTTPS acessada pelo navegador do operador para login SSO direto e terminal embutido.
              </small>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Usuário Admin</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="guacadmin"
                  value={guacUsername}
                  onChange={(e) => setGuacUsername(e.target.value)}
                  disabled={!isAdmin || guacLoading || guacMatching}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Senha {guacHasPassword && <span className="tag-saved">(Gravada)</span>}
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder={guacHasPassword ? '••••••••••••' : 'Senha'}
                  value={guacPassword}
                  onChange={(e) => setGuacPassword(e.target.value)}
                  disabled={!isAdmin || guacLoading || guacMatching}
                />
              </div>
            </div>

            <div className="integration-actions-footer" style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestGuacamole}
                disabled={guacTesting || guacLoading || guacMatching}
              >
                {guacTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                <span>Testar Conexão</span>
              </button>
              {isAdmin && (
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={guacLoading || guacTesting || guacMatching}
                >
                  {guacLoading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              )}
            </div>
          </form>
        )}

        {/* 3. FORMULÁRIO OXIDIZED NO DRAWER */}
        {activeDrawer === 'oxidized' && (
          <form onSubmit={handleSaveOxidized} className="integration-form">
            <div className="form-group">
              <label className="form-label">URL da API do Oxidized</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: https://oxidized.iper.net.br ou http://ip:8888"
                value={oxUrl}
                onChange={(e) => setOxUrl(e.target.value)}
                disabled={!isAdmin || oxLoading || oxSyncing}
                required
              />
              <small className="form-help">
                URL da API REST do daemon Oxidized onde os nós e backups são consultados.
              </small>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Usuário (Opcional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Sem autenticação"
                  value={oxUsername}
                  onChange={(e) => setOxUsername(e.target.value)}
                  disabled={!isAdmin || oxLoading || oxSyncing}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Senha (Opcional)</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder={oxHasPassword ? '••••••••' : 'Opcional'}
                  value={oxPassword}
                  onChange={(e) => setOxPassword(e.target.value)}
                  disabled={!isAdmin || oxLoading || oxSyncing}
                />
              </div>
            </div>

            {/* Caixa Informativa com Endpoint source: http */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              marginTop: '0.5rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <ExternalLink size={13} color="var(--color-primary)" />
                  Endpoint Dinâmico <code>source: http</code>
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '0.72rem', height: 'auto' }}
                  onClick={handleCopySourceUrl}
                >
                  {copiedSourceUrl ? <Check size={12} color="var(--color-success)" /> : <Copy size={12} />}
                  <span>{copiedSourceUrl ? 'Copiado!' : 'Copiar URL'}</span>
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Configure esta URL no seu arquivo <code>~/.config/oxidized/config</code> para que o Oxidized consulte a lista de ativos em tempo real:
              </p>
              <code style={{ fontSize: '0.74rem', padding: '6px 8px', background: 'rgba(0, 0, 0, 0.35)', borderRadius: '4px', wordBreak: 'break-all', color: 'var(--color-primary)' }}>
                {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/integrations/oxidized/nodes` : '/api/v1/integrations/oxidized/nodes'}
              </code>
            </div>

            <div className="integration-actions-footer" style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestOxidized}
                disabled={oxTesting || oxLoading || oxSyncing}
              >
                {oxTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                <span>Testar Conexão</span>
              </button>
              {isAdmin && (
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={oxLoading || oxTesting || oxSyncing || oxReloading}
                >
                  {oxLoading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              )}
            </div>
          </form>
        )}

        {/* 4. FORMULÁRIO VICTORIALOGS NO DRAWER */}
        {activeDrawer === 'victorialogs' && (
          <form onSubmit={handleSaveVictoriaLogs} className="integration-form">
            <div className="form-group">
              <label className="form-label">URL da API VictoriaLogs</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: http://10.10.1.2:9428"
                value={vlogsUrl}
                onChange={(e) => setVlogsUrl(e.target.value)}
                disabled={!isAdmin || vlogsLoading}
                required
              />
              <small className="form-help">
                Endereço interno do container VictoriaLogs na porta 9428 (sem passar pelo proxy reverso).
              </small>
            </div>

            <div style={{
              background: 'rgba(76, 175, 80, 0.06)',
              border: '1px solid rgba(76, 175, 80, 0.2)',
              borderRadius: '8px',
              padding: '0.85rem',
              marginTop: '0.5rem',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              lineHeight: '1.5'
            }}>
              <strong style={{ color: '#81c784', display: 'block', marginBottom: '4px' }}>
                Fluxo de Syslog Centralizado
              </strong>
              Equipamentos de rede devem apontar o envio de syslog para a VPS BrDrive em UDP ou TCP na porta <code>514</code>. O IperSoft consulta o histórico diretamente via sintaxe nativa LogsQL.
            </div>

            <div className="integration-actions-footer" style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestVictoriaLogs}
                disabled={vlogsTesting || vlogsLoading}
              >
                {vlogsTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                <span>Testar Conexão</span>
              </button>
              {isAdmin && (
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={vlogsLoading || vlogsTesting}
                >
                  {vlogsLoading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              )}
            </div>
          </form>
        )}

        {/* 5. FORMULÁRIO SERVIDOR DE FIRMWARES NO DRAWER */}
        {activeDrawer === 'firmwares' && (
          <form onSubmit={handleSaveFirmwares} className="integration-form">
            <div className="form-group">
              <label className="form-label">URL HTTP de Download para Equipamentos (porta 8089)</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: http://10.10.1.2:8089"
                value={fwHttpUrl}
                onChange={(e) => setFwHttpUrl(e.target.value)}
                disabled={!isAdmin || fwLoading}
                required
              />
              <small className="form-help">
                Endereço HTTP direto sem autenticação utilizado por switches Datacom, MikroTik e Cisco para baixar firmwares via CLI.
              </small>
            </div>

            <div className="form-group">
              <label className="form-label">URL da Interface Web de Upload (FileBrowser)</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: https://firmware.iper.net.br"
                value={fwWebUrl}
                onChange={(e) => setFwWebUrl(e.target.value)}
                disabled={!isAdmin || fwLoading}
                required
              />
              <small className="form-help">
                URL pública com SSL utilizada pelos operadores para enviar firmwares de 100MB+ pelo navegador.
              </small>
            </div>

            <div className="integration-actions-footer" style={{ marginTop: '1.5rem', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestFirmwares}
                disabled={fwTesting || fwLoading}
              >
                {fwTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                <span>Testar Conexão</span>
              </button>
              {isAdmin && (
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={fwLoading || fwTesting}
                >
                  {fwLoading ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              )}
            </div>
          </form>
        )}
      </SlideOverDrawer>
    </div>
  );
};
