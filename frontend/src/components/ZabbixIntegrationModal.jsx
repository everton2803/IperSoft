import React, { useState, useEffect } from 'react';
import { 
  X, 
  Server, 
  Key, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  RefreshCw, 
  Eye, 
  Database,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { authService } from '../services/api';

export const ZabbixIntegrationModal = ({ isOpen, onClose, onSyncComplete, isAdmin }) => {
  const [activeTab, setActiveTab] = useState('config'); // 'config' | 'preview'
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [authType, setAuthType] = useState('token'); // 'token' | 'userpass'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  // Status & states
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null); // { type: 'success' | 'error', text: '' }
  const [previewHosts, setPreviewHosts] = useState([]);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setStatusMessage(null);
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const cfg = await authService.getZabbixConfig();
      if (cfg) {
        setUrl(cfg.url || '');
        setHasSavedToken(cfg.has_token || false);
        setUsername(cfg.username || '');
        setLastSync(cfg.last_sync || null);
        if (cfg.username) {
          setAuthType('userpass');
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar config zabbix:', err);
    }
  };

  const handleTestConnection = async () => {
    if (!url.trim()) {
      setStatusMessage({ type: 'error', text: 'Informe a URL do Zabbix.' });
      return;
    }

    setIsLoading(true);
    setStatusMessage(null);
    try {
      const payload = {
        url: url.trim(),
        token: authType === 'token' ? token.trim() || undefined : undefined,
        username: authType === 'userpass' ? username.trim() || undefined : undefined,
        password: authType === 'userpass' ? password || undefined : undefined,
      };

      const res = await authService.testZabbixConnection(payload);
      setStatusMessage({ type: 'success', text: res.message || 'Conexão estabelecida com sucesso!' });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Erro ao conectar ao Zabbix.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      setStatusMessage({ type: 'error', text: 'A URL do Zabbix é obrigatória.' });
      return;
    }

    setIsLoading(true);
    setStatusMessage(null);
    try {
      await authService.saveZabbixConfig({
        url: url.trim(),
        token: authType === 'token' ? token.trim() : undefined,
        username: authType === 'userpass' ? username.trim() : undefined,
        password: authType === 'userpass' ? password : undefined,
      });

      setStatusMessage({ type: 'success', text: 'Configurações do Zabbix salvas com sucesso.' });
      setHasSavedToken(Boolean(token || hasSavedToken));
      setToken('');
      setPassword('');
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Erro ao salvar configuração.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const data = await authService.previewZabbixHosts();
      setPreviewHosts(data.hosts || []);
      setActiveTab('preview');
      setStatusMessage({ 
        type: 'success', 
        text: `${data.total} hosts encontrados no Zabbix prontos para importação.` 
      });
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Erro ao carregar pré-visualização.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const result = await authService.syncZabbixHosts();
      setStatusMessage({ type: 'success', text: result.message });
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message || 'Erro ao sincronizar hosts.' });
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container zabbix-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-box">
            <Server size={18} className="modal-title-icon" />
            <h2 className="modal-title">Integração Zabbix Server</h2>
          </div>
          <button className="btn-close-modal" onClick={onClose} title="Fechar">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            <span>Configuração da API</span>
          </button>
          <button
            className={`modal-tab ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            <span>Pré-visualização de Hosts ({previewHosts.length})</span>
          </button>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div className={`alert-box alert-${statusMessage.type}`} style={{ margin: '1rem 1.25rem 0' }}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Body */}
        <div className="modal-body">
          {activeTab === 'config' && (
            <form onSubmit={handleSaveConfig} className="zabbix-form">
              <div className="form-group">
                <label className="form-label">URL da API Zabbix</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="ex: http://192.168.1.50/zabbix ou http://zabbix.suaempresa.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={!isAdmin}
                  required
                />
                <span className="form-field-hint">
                  Pode ser informado o endereço base ou o endpoint direto <code>/api_jsonrpc.php</code>.
                </span>
              </div>

              {/* Auth Mode Toggle */}
              <div className="form-group">
                <label className="form-label">Método de Autenticação</label>
                <div className="auth-mode-selector">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="authType"
                      value="token"
                      checked={authType === 'token'}
                      onChange={() => setAuthType('token')}
                      disabled={!isAdmin}
                    />
                    <span>API Token (Recomendado - Zabbix 5.4+)</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="authType"
                      value="userpass"
                      checked={authType === 'userpass'}
                      onChange={() => setAuthType('userpass')}
                      disabled={!isAdmin}
                    />
                    <span>Usuário e Senha</span>
                  </label>
                </div>
              </div>

              {authType === 'token' ? (
                <div className="form-group">
                  <label className="form-label">
                    API Token {hasSavedToken && <span className="tag-saved">(Chave já configurada no banco)</span>}
                  </label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder={hasSavedToken ? '•••••••••••••••••••••••• (deixe em branco para manter)' : 'Cole aqui o token gerado no Zabbix'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={!isAdmin}
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
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Senha</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Senha do usuário"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                </div>
              )}

              {/* Actions Toolbar */}
              <div className="modal-actions-bar">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTestConnection}
                  disabled={isLoading || isSyncing}
                >
                  {isLoading ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                  <span>Testar Conexão</span>
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handlePreview}
                  disabled={isLoading || isSyncing}
                >
                  <Eye size={14} />
                  <span>Buscar Hosts</span>
                </button>

                {isAdmin && (
                  <button
                    type="submit"
                    className="btn-primary"
                    style={{ width: 'auto' }}
                    disabled={isLoading || isSyncing}
                  >
                    Salvar Conexão
                  </button>
                )}
              </div>
            </form>
          )}

          {activeTab === 'preview' && (
            <div className="preview-container">
              <div className="preview-toolbar">
                <span className="preview-count">
                  {previewHosts.length} hosts encontrados no Zabbix
                </span>

                {isAdmin && (
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ width: 'auto', padding: '0.45rem 1rem' }}
                    onClick={handleSyncNow}
                    disabled={isSyncing || previewHosts.length === 0}
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 size={14} className="spin-icon" />
                        <span>Sincronizando...</span>
                      </>
                    ) : (
                      <>
                        <Database size={14} />
                        <span>Importar para a Base Unificada</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {previewHosts.length === 0 ? (
                <div className="empty-preview">
                  <p>Nenhum host carregado ainda. Clique em "Buscar Hosts" na aba de configuração.</p>
                </div>
              ) : (
                <div className="preview-table-wrapper">
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>Nome Visível</th>
                        <th>Hostname</th>
                        <th>IP / DNS</th>
                        <th>Porta</th>
                        <th>SNMP Comm.</th>
                        <th>Grupos</th>
                        <th>Templates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewHosts.map((h, i) => (
                        <tr key={i}>
                          <td><strong>{h.name}</strong></td>
                          <td><code>{h.hostname}</code></td>
                          <td>{h.ip_address || h.dns || '-'}</td>
                          <td>{h.port || '10050'}</td>
                          <td>{h.snmp_community || '-'}</td>
                          <td>
                            <div className="badge-list">
                              {(h.host_groups || []).map((g, gi) => (
                                <span key={gi} className="mini-badge">{g}</span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <div className="badge-list">
                              {(h.templates || []).slice(0, 2).map((t, ti) => (
                                <span key={ti} className="mini-badge template-badge">{t}</span>
                              ))}
                              {(h.templates || []).length > 2 && (
                                <span className="mini-badge">+{h.templates.length - 2}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
