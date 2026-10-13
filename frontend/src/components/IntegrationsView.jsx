import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Terminal, 
  FileCode, 
  Globe, 
  PieChart, 
  Radio, 
  Key, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  RefreshCw, 
  Link,
  ShieldCheck,
  Check,
  Layers,
  ExternalLink,
  Copy,
  RotateCcw
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
  const [zbxLoading, setZbxLoading] = useState(false);
  const [zbxTesting, setZbxTesting] = useState(false);

  // Guacamole state
  const [guacUrl, setGuacUrl] = useState('');
  const [guacUsername, setGuacUsername] = useState('');
  const [guacPassword, setGuacPassword] = useState('');
  const [guacHasPassword, setGuacHasPassword] = useState(false);
  const [guacIsConnected, setGuacIsConnected] = useState(false);
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
  const [oxLoading, setOxLoading] = useState(false);
  const [oxTesting, setOxTesting] = useState(false);
  const [oxSyncing, setOxSyncing] = useState(false);
  const [oxReloading, setOxReloading] = useState(false);
  const [oxSyncResult, setOxSyncResult] = useState(null);
  const [copiedSourceUrl, setCopiedSourceUrl] = useState(false);

  // Global feedback
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: '' }

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const [zbxCfg, guacCfg, oxCfg] = await Promise.all([
        authService.getZabbixConfig().catch(() => null),
        authService.getGuacamoleConfig().catch(() => null),
        authService.getOxidizedConfig().catch(() => null)
      ]);

      if (zbxCfg) {
        setZbxUrl(zbxCfg.url || '');
        setZbxHasToken(zbxCfg.has_token || false);
        setZbxUsername(zbxCfg.username || '');
        setZbxIsConnected(zbxCfg.is_active || false);
        if (zbxCfg.username) setZbxAuthType('userpass');
      }

      if (guacCfg) {
        setGuacUrl(guacCfg.url || '');
        setGuacUsername(guacCfg.username || '');
        setGuacHasPassword(guacCfg.has_password || false);
        setGuacIsConnected(guacCfg.is_active || false);
      }

      if (oxCfg) {
        setOxUrl(oxCfg.url || 'https://oxidized.iper.net.br');
        setOxUsername(oxCfg.username || '');
        setOxHasPassword(oxCfg.has_password || false);
        setOxIsConnected(oxCfg.is_active || false);
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
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configuração do Zabbix.' });
    } finally {
      setZbxLoading(false);
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

  const remainingIntegrations = [
    {
      id: 'phpipam',
      name: 'phpIPAM',
      type: 'Gestão de IP e VLANs',
      desc: 'Unificação do plano de sub-redes, controle de alocação de IPs e inventário de VLANs.',
      icon: Globe,
      status: 'Próxima Etapa'
    },
    {
      id: 'grafana',
      name: 'Grafana & Rsyslog',
      type: 'Telemetria & Logs',
      desc: 'Centralização de syslog de rede, telemetria de tráfego e dashboards visuais operacionais.',
      icon: PieChart,
      status: 'Próxima Etapa'
    },
    {
      id: 'nfsen',
      name: 'nfdump & NfSen',
      type: 'Análise de NetFlow / sFlow',
      desc: 'Coleta de fluxos de rede para análise de consumo de tráfego de banda e segurança.',
      icon: Radio,
      status: 'Próxima Etapa'
    }
  ];

  return (
    <div className="integrations-view">
      {/* Header */}
      <div className="integrations-header">
        <div>
          <h1 className="section-title">Integrações de Sistemas</h1>
          <p className="dashboard-sub">
            Conexão e credenciais de API com os contêineres e serviços externos da infraestrutura
          </p>
        </div>
      </div>

      {feedback && (
        <div className={`alert-box alert-${feedback.type}`} style={{ marginBottom: '1.25rem' }}>
          {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* 1. APACHE GUACAMOLE CARD */}
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
                      Conectado via API
                    </>
                  ) : (
                    'Não Conectado'
                  )}
                </span>
              </div>
              <p className="integration-main-sub">
                Gateway de terminal web (SSH / Telnet) para acesso remoto aos switches e roteadores da rede.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveGuacamole} className="integration-form">
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
            <span className="form-field-hint">
              Informe a URL do Guacamole (com ou sem <code>/guacamole</code>). O sistema normaliza automaticamente.
            </span>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Usuário Administrador</label>
              <input
                type="text"
                className="form-input"
                placeholder="ex: guacadmin ou seu usuário admin"
                value={guacUsername}
                onChange={(e) => setGuacUsername(e.target.value)}
                disabled={!isAdmin || guacLoading || guacMatching}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Senha {guacHasPassword && <span className="tag-saved">(Senha já salva no banco)</span>}
              </label>
              <input
                type="password"
                className="form-input"
                placeholder={guacHasPassword ? '•••••••••••••••• (deixe em branco para manter)' : 'Senha de administrador do Guacamole'}
                value={guacPassword}
                onChange={(e) => setGuacPassword(e.target.value)}
                disabled={!isAdmin || guacLoading || guacMatching}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="integration-actions-footer">
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
              <>
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={guacLoading || guacTesting || guacMatching}
                >
                  {guacLoading ? 'Salvando...' : 'Salvar Configurações'}
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  onClick={handleMatchGuacamoleConnections}
                  disabled={guacMatching || guacLoading || guacTesting}
                  title="Busca todas as conexões do Guacamole, vincula com os ativos existentes por IP e importa as restantes"
                >
                  {guacMatching ? (
                    <>
                      <Loader2 size={14} className="spin-icon" />
                      <span>Sincronizando Conexões...</span>
                    </>
                  ) : (
                    <>
                      <Link size={14} />
                      <span>Sincronizar & Importar Conexões do Guacamole</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </form>

        {/* Match Result Details Card if executed */}
        {guacMatchResult && (
          <div className="match-summary-card">
            <div className="match-summary-header">
              <span className="match-summary-title">Resultado da Sincronização:</span>
              <span className="match-summary-badge">
                {guacMatchResult.matched} vinculadas • {guacMatchResult.created_new || 0} importadas
              </span>
            </div>
            <p className="match-summary-desc">
              {guacMatchResult.message}
            </p>
          </div>
        )}
      </div>

      {/* 2. ZABBIX SERVER CARD */}
      <div className="integration-main-card">
        <div className="integration-card-header">
          <div className="integration-header-left">
            <div className="integration-icon-container">
              <Server size={22} className="integration-icon-main" />
            </div>
            <div>
              <div className="integration-title-row">
                <h2 className="integration-main-title">Zabbix Server</h2>
                <span className={`connection-badge ${zbxIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                  {zbxIsConnected ? (
                    <>
                      <span className="dot-online" style={{ marginRight: 4 }}></span>
                      Conectado via API
                    </>
                  ) : (
                    'Não Conectado'
                  )}
                </span>
              </div>
              <p className="integration-main-sub">
                Comunicação JSON-RPC ativa para telemetria de monitoramento e sincronização de status de hosts (<code>host.update</code>).
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveZabbix} className="integration-form">
          <div className="form-group">
            <label className="form-label">URL da API Zabbix</label>
            <input
              type="text"
              className="form-input"
              placeholder="ex: http://192.168.1.50/zabbix ou http://zabbix.suaempresa.com"
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
                <span>API Token (Recomendado - Zabbix 5.4+)</span>
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
                <span>Usuário e Senha</span>
              </label>
            </div>
          </div>

          {zbxAuthType === 'token' ? (
            <div className="form-group">
              <label className="form-label">
                API Token {zbxHasToken && <span className="tag-saved">(Chave ativa e gravada no banco)</span>}
              </label>
              <input
                type="password"
                className="form-input"
                placeholder={zbxHasToken ? '•••••••••••••••••••••••• (deixe em branco para manter)' : 'Cole o token de autenticação'}
                value={zbxToken}
                onChange={(e) => setZbxToken(e.target.value)}
                disabled={!isAdmin || zbxLoading}
              />
            </div>
          ) : (
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Usuário Zabbix</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="ex: Admin"
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
                  placeholder="Senha do usuário"
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
              disabled={zbxTesting || zbxLoading}
            >
              {zbxTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
              <span>Testar Conexão</span>
            </button>

            {isAdmin && (
              <button
                type="submit"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={zbxLoading || zbxTesting}
              >
                {zbxLoading ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            )}
          </div>
        </form>
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
                <h2 className="integration-main-title">Oxidized (Backup de Configurações)</h2>
                <span className={`connection-badge ${oxIsConnected ? 'badge-connected' : 'badge-pending'}`}>
                  {oxIsConnected ? (
                    <>
                      <span className="dot-online" style={{ marginRight: 4 }}></span>
                      Conectado via API
                    </>
                  ) : (
                    'Não Conectado'
                  )}
                </span>
              </div>
              <p className="integration-main-sub">
                Coleta automatizada de scripts/configurações de switches e roteadores via SSH/Telnet com versionamento em Git.
              </p>
            </div>
          </div>
        </div>

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
            <span className="form-field-hint">
              URL do serviço web do Oxidized (porta 8888 ou proxy reverso HTTPS).
            </span>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Usuário (Opcional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Deixe vazio se não houver autenticação web"
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
                placeholder={oxHasPassword ? '•••••••••••••••• (deixe vazio para manter)' : 'Senha do Oxidized Web se houver'}
                value={oxPassword}
                onChange={(e) => setOxPassword(e.target.value)}
                disabled={!isAdmin || oxLoading || oxSyncing}
              />
            </div>
          </div>

          {/* BOX DE FONTE DINÂMICA (SOURCE: HTTP) */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '1rem',
            marginTop: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ExternalLink size={14} color="var(--color-primary)" />
                URL de Fonte Dinâmica para o Oxidized (<code>source: http</code>)
              </span>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '3px 8px', fontSize: '0.72rem', height: 'auto' }}
                onClick={handleCopySourceUrl}
              >
                {copiedSourceUrl ? <Check size={12} color="var(--color-success)" /> : <Copy size={12} />}
                <span>{copiedSourceUrl ? 'Copiado!' : 'Copiar Endpoint'}</span>
              </button>
            </div>
            <code style={{ fontSize: '0.78rem', padding: '6px 10px', background: 'rgba(0, 0, 0, 0.3)', borderRadius: '4px', wordBreak: 'break-all' }}>
              {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/integrations/oxidized/nodes` : '/api/v1/integrations/oxidized/nodes'}
            </code>
            <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
              Ao configurar essa URL como <code>source: http</code> no <code>~/.config/oxidized/config</code>, o Oxidized importará automaticamente os nós cadastrados no IperSoft organizados pelos grupos de cliente (<code>athila</code>, <code>atm</code>, etc.).
            </small>
          </div>

          <div className="integration-actions-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleTestOxidized}
              disabled={oxTesting || oxLoading || oxSyncing}
            >
              {oxTesting ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
              <span>Testar Conexão</span>
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleSyncOxidized}
              disabled={oxSyncing || oxTesting || oxLoading || oxReloading}
              title="Ler nós cadastrados no Oxidized e associar aos ativos do IperSoft"
            >
              {oxSyncing ? <Loader2 size={14} className="spin-icon" /> : <Layers size={14} />}
              <span>{oxSyncing ? 'Sincronizando Nós...' : 'Sincronizar Nós do Oxidized'}</span>
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleReloadOxidized}
              disabled={oxReloading || oxSyncing || oxTesting || oxLoading}
              title="Força o Oxidized a recarregar a fonte de dados (/reload), removendo da memória nós excluídos do IperSoft"
            >
              {oxReloading ? <Loader2 size={14} className="spin-icon" /> : <RotateCcw size={14} />}
              <span>{oxReloading ? 'Recarregando...' : 'Recarregar Nós no Oxidized'}</span>
            </button>

            {isAdmin && (
              <button
                type="submit"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={oxLoading || oxTesting || oxSyncing || oxReloading}
              >
                {oxLoading ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            )}
          </div>
        </form>

        {oxSyncResult && (
          <div className="match-summary-card">
            <div className="match-summary-header">
              <span className="match-summary-title">Resultado da Sincronização:</span>
              <span className="match-summary-badge">
                {oxSyncResult.matched_count} de {oxSyncResult.total_nodes} nós vinculados
              </span>
            </div>
            <p className="match-summary-desc">
              Os nós do Oxidized foram vinculados com sucesso pelo endereço IP ou nome aos ativos da base.
            </p>
          </div>
        )}
      </div>

      {/* 3. UPCOMING INTEGRATIONS ROADMAP */}
      <div className="upcoming-section">
        <h2 className="section-title" style={{ fontSize: '1.05rem', marginBottom: '0.85rem' }}>
          Próximas Integrações da Infraestrutura
        </h2>
        <div className="modules-grid">
          {remainingIntegrations.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="module-card">
                <div className="module-icon-box">
                  <Icon size={18} />
                </div>
                <div className="module-info">
                  <div className="module-name">{item.name}</div>
                  <div className="module-type">{item.type}</div>
                  <p className="module-subdesc">{item.desc}</p>
                </div>
                <span className="module-badge">{item.status}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
