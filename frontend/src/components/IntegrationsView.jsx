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
  ChevronDown,
  ChevronRight,
  FileText,
  Activity
} from 'lucide-react';
import { authService } from '../services/api';

export const IntegrationsView = ({ isAdmin }) => {
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
  const [showZbxSettings, setShowZbxSettings] = useState(false);

  // Guacamole state
  const [guacUrl, setGuacUrl] = useState('');
  const [guacUsername, setGuacUsername] = useState('');
  const [guacPassword, setGuacPassword] = useState('');
  const [guacHasPassword, setGuacHasPassword] = useState(false);
  const [guacIsConnected, setGuacIsConnected] = useState(false);
  const [guacLastSync, setGuacLastSync] = useState(null);
  const [guacLoading, setGuacLoading] = useState(false);
  const [guacTesting, setGuacTesting] = useState(false);
  const [guacMatching, setGuacMatching] = useState(false);
  const [guacMatchResult, setGuacMatchResult] = useState(null);
  const [showGuacSettings, setShowGuacSettings] = useState(false);

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
  const [showOxSettings, setShowOxSettings] = useState(false);

  // VictoriaLogs state
  const [vlogsUrl, setVlogsUrl] = useState('http://10.10.1.2:9428');
  const [vlogsIsConnected, setVlogsIsConnected] = useState(false);
  const [vlogsLoading, setVlogsLoading] = useState(false);
  const [vlogsTesting, setVlogsTesting] = useState(false);
  const [vlogsStats, setVlogsStats] = useState(null);
  const [showVlogsSettings, setShowVlogsSettings] = useState(false);

  // Global feedback
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const [zbxCfg, guacCfg, oxCfg, vlogsCfg, vlogsStatData] = await Promise.all([
        authService.getZabbixConfig().catch(() => null),
        authService.getGuacamoleConfig().catch(() => null),
        authService.getOxidizedConfig().catch(() => null),
        authService.getVictoriaLogsConfig().catch(() => null),
        authService.getVictoriaLogsStats().catch(() => null)
      ]);

      if (zbxCfg) {
        setZbxUrl(zbxCfg.url || '');
        setZbxHasToken(zbxCfg.has_token || false);
        setZbxUsername(zbxCfg.username || '');
        setZbxIsConnected(zbxCfg.is_active || false);
        setZbxLastSync(zbxCfg.last_sync || null);
        if (zbxCfg.username) setZbxAuthType('userpass');
        if (!zbxCfg.is_active) setShowZbxSettings(true);
      }

      if (guacCfg) {
        setGuacUrl(guacCfg.url || '');
        setGuacUsername(guacCfg.username || '');
        setGuacHasPassword(guacCfg.has_password || false);
        setGuacIsConnected(guacCfg.is_active || false);
        setGuacLastSync(guacCfg.last_sync || null);
        if (!guacCfg.is_active) setShowGuacSettings(true);
      }

      if (oxCfg) {
        setOxUrl(oxCfg.url || 'http://10.10.1.2:8888');
        setOxUsername(oxCfg.username || '');
        setOxHasPassword(oxCfg.has_password || false);
        setOxIsConnected(oxCfg.is_active || false);
        setOxLastSync(oxCfg.last_sync || null);
        if (!oxCfg.is_active) setShowOxSettings(true);
      }

      if (vlogsCfg) {
        setVlogsUrl(vlogsCfg.url || 'http://10.10.1.2:9428');
        setVlogsIsConnected(vlogsCfg.is_active || false);
        if (!vlogsCfg.is_active) setShowVlogsSettings(true);
      }

      if (vlogsStatData) {
        setVlogsStats(vlogsStatData);
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

  return (
    <div className="integrations-view">
      {/* Header */}
      <div className="integrations-header">
        <div>
          <h1 className="section-title">Integrações de Sistemas</h1>
          <p className="dashboard-sub">
            Sincronização de inventário e credenciais de API com Zabbix Server, Apache Guacamole e Oxidized
          </p>
        </div>
      </div>

      {feedback && (
        <div className={`alert-box alert-${feedback.type}`} style={{ marginBottom: '1.25rem' }}>
          {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* GRID EM 3 COLUNAS PARA AS 3 INTEGRAÇÕES ATIVAS */}
      <div className="integrations-three-col-grid">
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
                  Importação automática de hosts a cada <strong>1 hora</strong>. O envio de alterações do IperSoft para o Zabbix é estritamente manual.
                </p>
              </div>
            </div>
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

          {/* Seção retrátil de credenciais */}
          <div className="integration-settings-collapse">
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setShowZbxSettings(!showZbxSettings)}
            >
              <Settings size={14} />
              <span>Configurações de Conexão e Credenciais</span>
              {showZbxSettings ? <ChevronDown size={15} style={{ marginLeft: 'auto' }} /> : <ChevronRight size={15} style={{ marginLeft: 'auto' }} />}
            </button>

            {showZbxSettings && (
              <form onSubmit={handleSaveZabbix} className="integration-form" style={{ marginTop: '0.85rem' }}>
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
                      placeholder={zbxHasToken ? '•••••••••••• (em branco mantém)' : 'Cole o token da API'}
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

                <div className="integration-actions-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleTestZabbix}
                    disabled={zbxTesting || zbxLoading || zbxSyncing}
                  >
                    {zbxTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                    <span>Testar</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ width: 'auto' }}
                      disabled={zbxLoading || zbxTesting || zbxSyncing}
                    >
                      {zbxLoading ? 'Salvando...' : 'Salvar'}
                    </button>
                  )}
                </div>
              </form>
            )}
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
                  Importação automática de conexões (SSH/Telnet/RDP) a cada <strong>1 hora</strong>. Criação e edição no Guacamole são manuais.
                </p>
              </div>
            </div>
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

          {/* Seção retrátil de credenciais */}
          <div className="integration-settings-collapse">
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setShowGuacSettings(!showGuacSettings)}
            >
              <Settings size={14} />
              <span>Configurações de Conexão e Credenciais</span>
              {showGuacSettings ? <ChevronDown size={15} style={{ marginLeft: 'auto' }} /> : <ChevronRight size={15} style={{ marginLeft: 'auto' }} />}
            </button>

            {showGuacSettings && (
              <form onSubmit={handleSaveGuacamole} className="integration-form" style={{ marginTop: '0.85rem' }}>
                <div className="form-group">
                  <label className="form-label">URL do Guacamole</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="ex: http://ip-da-sua-vps:8080/guacamole"
                    value={guacUrl}
                    onChange={(e) => setGuacUrl(e.target.value)}
                    disabled={!isAdmin || guacLoading || guacMatching}
                    required
                  />
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

                <div className="integration-actions-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleTestGuacamole}
                    disabled={guacTesting || guacLoading || guacMatching}
                  >
                    {guacTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                    <span>Testar</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ width: 'auto' }}
                      disabled={guacLoading || guacTesting || guacMatching}
                    >
                      {guacLoading ? 'Salvando...' : 'Salvar'}
                    </button>
                  )}
                </div>
              </form>
            )}
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

          {/* Seção retrátil de credenciais + Endpoint source: http */}
          <div className="integration-settings-collapse">
            <button
              type="button"
              className="btn-collapse-settings"
              onClick={() => setShowOxSettings(!showOxSettings)}
            >
              <Settings size={14} />
              <span>Configurações & Endpoint Source HTTP</span>
              {showOxSettings ? <ChevronDown size={15} style={{ marginLeft: 'auto' }} /> : <ChevronRight size={15} style={{ marginLeft: 'auto' }} />}
            </button>

            {showOxSettings && (
              <form onSubmit={handleSaveOxidized} className="integration-form" style={{ marginTop: '0.85rem' }}>
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
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Usuário (Opcional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Sem auth"
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

                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <ExternalLink size={12} color="var(--color-primary)" />
                      Endpoint <code>source: http</code>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '2px 7px', fontSize: '0.7rem', height: 'auto' }}
                      onClick={handleCopySourceUrl}
                    >
                      {copiedSourceUrl ? <Check size={11} color="var(--color-success)" /> : <Copy size={11} />}
                      <span>{copiedSourceUrl ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>
                  <code style={{ fontSize: '0.72rem', padding: '5px 8px', background: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', wordBreak: 'break-all' }}>
                    {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/integrations/oxidized/nodes` : '/api/v1/integrations/oxidized/nodes'}
                  </code>
                </div>

                <div className="integration-actions-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleTestOxidized}
                    disabled={oxTesting || oxLoading || oxSyncing}
                  >
                    {oxTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                    <span>Testar</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="submit"
                      className="btn-primary"
                      style={{ width: 'auto' }}
                      disabled={oxLoading || oxTesting || oxSyncing || oxReloading}
                    >
                      {oxLoading ? 'Salvando...' : 'Salvar'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>

        {/* =========================================================================
            CARD 4: VICTORIALOGS (SYSLOG CENTRAL)
            ========================================================================= */}
        <div className="integration-column-card">
          <div className="integration-card-header">
            <div className="integration-title-group">
              <div className="integration-icon-wrapper" style={{ background: 'rgba(76, 175, 80, 0.12)', color: '#4caf50' }}>
                <FileText size={20} />
              </div>
              <div>
                <h3 className="integration-title">VictoriaLogs</h3>
                <span className="integration-subtitle">Syslog UDP/TCP 514 (Retenção 30d)</span>
              </div>
            </div>
            <span className={`status-pill ${vlogsIsConnected ? 'status-pill-ok' : 'status-pill-disabled'}`}>
              {vlogsIsConnected ? 'Ativo' : 'Desconectado'}
            </span>
          </div>

          <div className="integration-status-strip">
            <div className="status-item">
              <span className="status-label">Endereço Direto:</span>
              <span className="status-value"><code>{vlogsUrl || '10.10.1.2:9428'}</code></span>
            </div>
            <div className="status-item">
              <span className="status-label">Logs (Última 1h):</span>
              <span className="status-value">{vlogsStats?.total_1h ? `${vlogsStats.total_1h.toLocaleString('pt-BR')} msgs` : 'Ativo'}</span>
            </div>
          </div>

          <div className="integration-card-body">
            <div className="integration-summary-box">
              <p>
                Armazenamento central de logs Syslog coletados em portas UDP e TCP 514 na VPS BrDrive.
                Integrado ao IperSoft para correlacionar quedas de rede e alarmes com o registro dos equipamentos.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                <span className="badge-tag-canonical" style={{ background: 'rgba(76, 175, 80, 0.15)', color: '#81c784' }}>
                  LogsQL
                </span>
                <span className="badge-tag-canonical">
                  Syslog RFC3164/5424
                </span>
              </div>
            </div>

            {/* Botão de Toggle das Configurações */}
            <button
              type="button"
              className="btn-toggle-settings"
              onClick={() => setShowVlogsSettings(!showVlogsSettings)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Settings size={14} />
                <span>Configurações de Conexão</span>
              </div>
              {showVlogsSettings ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {/* Formulário Retrátil */}
            {showVlogsSettings && (
              <form onSubmit={handleSaveVictoriaLogs} className="integration-settings-form">
                <div className="form-group">
                  <label className="form-label">URL da API do VictoriaLogs</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="http://10.10.1.2:9428"
                    value={vlogsUrl}
                    onChange={(e) => setVlogsUrl(e.target.value)}
                    disabled={!isAdmin || vlogsLoading}
                  />
                  <small className="form-help">
                    Endereço interno do container VictoriaLogs na porta 9428 (sem passar pelo Traefik).
                  </small>
                </div>

                <div className="integration-actions-footer">
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
                      {vlogsLoading ? 'Salvando...' : 'Salvar'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
