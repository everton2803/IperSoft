import React, { useState, useEffect } from 'react';
import { 
  HardDrive, 
  UploadCloud, 
  ExternalLink, 
  Copy, 
  Check, 
  RefreshCw, 
  Search, 
  Folder, 
  FileCode, 
  Terminal, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Server,
  Layers,
  Settings,
  Clock,
  ChevronDown,
  ChevronRight,
  Info,
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { firmwaresService } from '../services/api';

export const FirmwaresView = ({ isAdmin = false, initialAssetContext = null }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('todos');
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState('datacom_dmos');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [httpUrl, setHttpUrl] = useState('http://10.10.1.2:8089');
  const [webUrl, setWebUrl] = useState('https://firmware.iper.net.br');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(null);

  useEffect(() => {
    loadData();
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await firmwaresService.getConfig();
      if (cfg) {
        if (cfg.url) setHttpUrl(cfg.url);
        if (cfg.public_url) setWebUrl(cfg.public_url);
      }
    } catch (err) {
      console.warn('Erro ao carregar configurações de firmware:', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await firmwaresService.getFiles();
      setData(res);
      if (res.http_base_url) setHttpUrl(res.http_base_url);
      if (res.web_url) setWebUrl(res.web_url);

      // Auto-seleciona o primeiro arquivo se houver e nenhum estiver selecionado
      if (res.files && res.files.length > 0 && !selectedFile) {
        setSelectedFile(res.files[0]);
      }
    } catch (err) {
      console.error('Erro ao carregar arquivos de firmware:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await firmwaresService.testConnection({ url: httpUrl, public_url: webUrl });
      setConnectionStatus(res);
      if (res.is_connected) {
        setFeedback({
          type: 'success',
          text: `Conexão OK! Download HTTP (${res.http_service?.latency_ms || 0}ms) e Web FileBrowser (${res.web_service?.latency_ms || 0}ms) ativos.`
        });
        await loadData();
      } else {
        setFeedback({
          type: 'error',
          text: `Falha na conexão: HTTP (${res.http_service?.error || 'Erro'}) | Web (${res.web_service?.error || 'Erro'})`
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao testar conexão.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await firmwaresService.saveConfig({
        url: httpUrl.trim(),
        public_url: webUrl.trim(),
        is_active: true
      });
      setFeedback({ type: 'success', text: 'Configurações do Servidor de Firmwares salvas com sucesso!' });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao salvar configurações.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = (url) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyCommand = (cmdText) => {
    navigator.clipboard.writeText(cmdText);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  const files = data?.files || [];
  const folders = data?.folders || [];
  const totalFiles = data?.total_files || files.length;
  const totalSizeFormatted = data?.total_size_formatted || '0 B';
  const effectiveHttpUrl = httpUrl.replace(/\/+$/, '');
  const effectiveWebUrl = webUrl.replace(/\/+$/, '');

  const filteredFiles = files.filter(f => {
    const matchFolder = selectedFolder === 'todos' || f.folder === selectedFolder;
    const matchSearch = searchTerm === '' || 
      f.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.folder.toLowerCase().includes(searchTerm.toLowerCase());
    return matchFolder && matchSearch;
  });

  // Gera os comandos CLI em tempo real de acordo com o arquivo selecionado e o perfil do SO
  const getGeneratedCommands = () => {
    if (!selectedFile) return [];
    const dlUrl = `${effectiveHttpUrl}/${selectedFile.relative_path.replace(/^\/+/, '')}`;
    const fn = selectedFile.filename;
    const ext = fn.split('.').pop()?.toLowerCase();

    switch (selectedProfile) {
      case 'datacom_dmos':
        return [
          {
            title: 'Upgrade Direto no DmOS (Recomendado)',
            command: `request system software-upgrade url ${dlUrl}`,
            desc: 'Faz o download do pacote de firmware (.swu ou .img) diretamente para a memória do switch/OLT e realiza a instalação completa.'
          },
          {
            title: 'Copiar Arquivo para a Memória Flash',
            command: `copy ${dlUrl} flash:${fn}`,
            desc: 'Apenas transfere o arquivo para o armazenamento local sem iniciar a instalação imediata.'
          }
        ];
      case 'datacom_dmswitch':
        return [
          {
            title: 'Copiar Firmware para Flash (DmSwitch)',
            command: `copy ${dlUrl} flash:${fn}`,
            desc: 'Download HTTP nativo para switches Datacom das famílias DM4000, DM4100, DM1200 e DM2100.'
          }
        ];
      case 'mikrotik':
        return [
          {
            title: 'Download via /tool fetch (RouterOS v6 e v7)',
            command: `/tool fetch url="${dlUrl}" mode=http dst-path="${fn}"`,
            desc: 'Baixa o pacote (.npk) para a raiz do RouterOS. Para aplicar a atualização, basta reiniciar o equipamento (/system reboot).'
          }
        ];
      case 'cisco_ios':
        return [
          {
            title: 'Copiar Firmware para Flash (Cisco IOS / XE)',
            command: `copy ${dlUrl} flash:${fn}`,
            desc: 'Transferência HTTP nativa para switches Cisco Catalyst e roteadores ISR.'
          }
        ];
      case 'linux_generic':
      default:
        return [
          {
            title: 'Download via curl',
            command: `curl -O ${dlUrl}`,
            desc: 'Download universal via terminal Linux ou estação operacional.'
          },
          {
            title: 'Download via wget',
            command: `wget ${dlUrl}`,
            desc: 'Download via wget em servidores ou appliances.'
          }
        ];
    }
  };

  return (
    <div className="view-container" style={{ padding: '1.5rem', maxWidth: '1440px', margin: '0 auto', color: 'var(--text-main)' }}>
      {/* HEADER DA TELA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            padding: '12px',
            background: 'linear-gradient(135deg, rgba(0, 188, 212, 0.15) 0%, rgba(3, 169, 244, 0.25) 100%)',
            border: '1px solid rgba(0, 188, 212, 0.35)',
            borderRadius: '12px',
            color: '#00bcd4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <HardDrive size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Servidor de Firmwares & Arquivos
              </h1>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#10b981',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <span className="dot-online" style={{ margin: 0 }}></span>
                HTTP Ativo (Porta 8089)
              </span>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  background: 'rgba(0, 188, 212, 0.15)',
                  border: '1px solid rgba(0, 188, 212, 0.35)',
                  color: '#00bcd4'
                }}
              >
                HTTPS Web Ativo
              </span>
            </div>
            <p style={{ margin: '3px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
              Upload web de firmwares pelo PC e download direto em alta velocidade para equipamentos Datacom, MikroTik e Cisco.
            </p>
          </div>
        </div>

        {/* Action Buttons na Barra Superior */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href={effectiveWebUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
            title="Abre a interface Web do FileBrowser em nova aba para enviar arquivos do seu computador"
          >
            <UploadCloud size={16} />
            <span>Fazer Upload (Web)</span>
            <ExternalLink size={13} />
          </a>

          <a
            href={effectiveHttpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
            title="Abre o índice HTTP de arquivos servidos na porta 8089"
          >
            <Server size={15} color="#4caf50" />
            <span>Índice HTTP</span>
            <ExternalLink size={13} />
          </a>

          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            disabled={loading}
            title="Atualizar lista de arquivos"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
          >
            <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            <span>Atualizar</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              className={`btn-secondary ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
              title="Configurações das URLs do Servidor de Firmwares"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
            >
              <Settings size={14} />
              <span>Configurações</span>
              {showSettings ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* FEEDBACK DE MENSAGENS */}
      {feedback && (
        <div 
          style={{
            marginBottom: '1rem',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            border: `1px solid ${feedback.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: feedback.type === 'success' ? '#10b981' : '#ef4444'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.text}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setFeedback(null)} 
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px 6px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* SEÇÃO RETRÁTIL DE CONFIGURAÇÕES DE URL (ADMIN) */}
      {showSettings && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1.25rem',
          marginBottom: '1.5rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
            <Settings size={16} color="var(--color-primary)" />
            <span>Configuração das URLs e Endpoints de Firmware</span>
          </div>

          <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-main)' }}>
                  URL HTTP de Download para Equipamentos (porta 8089)
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={httpUrl}
                  onChange={(e) => setHttpUrl(e.target.value)}
                  placeholder="ex: http://10.10.1.2:8089"
                  required
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
                <small style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginTop: '3px' }}>
                  Endereço HTTP direto e sem autenticação acessível pela rede dos equipamentos de rede.
                </small>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--text-main)' }}>
                  URL da Interface Web de Upload (FileBrowser)
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder="ex: https://firmware.iper.net.br"
                  required
                  style={{ width: '100%', fontSize: '0.85rem' }}
                />
                <small style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginTop: '3px' }}>
                  Endereço público com certificado HTTPS utilizado pelos operadores no navegador.
                </small>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestConnection}
                disabled={testing || saving}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
              >
                {testing ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />}
                <span>Testar Conexão</span>
              </button>

              <button
                type="submit"
                className="btn-primary"
                disabled={testing || saving}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
              >
                {saving ? <Loader2 size={14} className="spin-icon" /> : <Check size={14} />}
                <span>Salvar Configurações</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STRIP DE CARDS DE MÉTRICAS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ padding: '10px', background: 'rgba(0, 188, 212, 0.1)', borderRadius: '8px', color: '#00bcd4' }}>
            <FileCode size={22} />
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block' }}>Total de Firmwares</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>{totalFiles}</span>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ padding: '10px', background: 'rgba(76, 175, 80, 0.1)', borderRadius: '8px', color: '#4caf50' }}>
            <HardDrive size={22} />
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block' }}>Espaço em Disco</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>{totalSizeFormatted}</span>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ padding: '10px', background: 'rgba(255, 152, 0, 0.1)', borderRadius: '8px', color: '#ff9800' }}>
            <Folder size={22} />
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block' }}>Pastas / Fabricantes</span>
            <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>{folders.length}</span>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ padding: '10px', background: 'rgba(156, 39, 176, 0.1)', borderRadius: '8px', color: '#ab47bc' }}>
            <Server size={22} />
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block' }}>Endpoint HTTP</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>Porta 8089 (TCP)</span>
          </div>
        </div>
      </div>

      {/* WORKSPACE DIVIDIDO: LISTA DE FIRMWARES À ESQUERDA E GERADOR DE COMANDOS À DIREITA */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
        gap: '1.5rem',
        alignItems: 'start'
      }}>
        {/* COLUNA ESQUERDA: LISTA DE ARQUIVOS */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} color="var(--color-primary)" />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                Arquivos Disponíveis no Servidor
              </h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Mostrando {filteredFiles.length} de {files.length}
            </span>
          </div>

          {/* Barra de Busca e Filtro de Pastas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Buscar por nome do arquivo (ex: DM4270, swu, bin, npk)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '32px', fontSize: '0.85rem', width: '100%' }}
              />
            </div>

            {/* Folder Pills */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
              <button
                type="button"
                onClick={() => setSelectedFolder('todos')}
                style={{
                  background: selectedFolder === 'todos' ? 'var(--color-primary)' : 'var(--bg-card)',
                  color: selectedFolder === 'todos' ? '#fff' : 'var(--text-main)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '9999px',
                  padding: '4px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Todos ({files.length})
              </button>
              {folders.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSelectedFolder(f)}
                  style={{
                    background: selectedFolder === f ? 'var(--color-primary)' : 'var(--bg-card)',
                    color: selectedFolder === f ? '#fff' : 'var(--text-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '9999px',
                    padding: '4px 12px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Folder size={12} />
                  <span>{f}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Lista de Arquivos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '540px', overflowY: 'auto', paddingRight: '4px' }}>
            {loading && files.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                <Loader2 size={28} className="spin-icon" style={{ margin: '0 auto 10px' }} />
                <p>Consultando firmwares no disco...</p>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '3rem 1rem',
                border: '1px dashed var(--border-subtle)',
                borderRadius: '8px'
              }}>
                <HardDrive size={36} color="var(--text-secondary)" style={{ margin: '0 auto 12px', opacity: 0.6 }} />
                <h4 style={{ margin: '0 0 6px', color: 'var(--text-main)' }}>Nenhum firmware encontrado</h4>
                <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Envie novos pacotes (.swu, .img, .bin, .npk) diretamente pelo navegador.
                </p>
                <a
                  href={effectiveWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <UploadCloud size={15} />
                  <span>Fazer Upload (Web)</span>
                </a>
              </div>
            ) : (
              filteredFiles.map(file => {
                const isSelected = selectedFile?.relative_path === file.relative_path;

                return (
                  <div
                    key={file.relative_path}
                    onClick={() => setSelectedFile(file)}
                    style={{
                      background: isSelected ? 'var(--color-primary-subtle)' : 'var(--bg-card)',
                      border: `1px solid ${isSelected ? 'var(--color-primary-border)' : 'var(--border-subtle)'}`,
                      borderRadius: '8px',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: '1 1 auto' }}>
                        <div style={{
                          padding: '8px',
                          background: isSelected ? 'rgba(0, 188, 212, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                          borderRadius: '6px',
                          color: '#00bcd4',
                          marginTop: '2px'
                        }}>
                          <FileCode size={20} />
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-main)', wordBreak: 'break-all', display: 'block' }}>
                            {file.filename}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                            <span style={{
                              background: 'rgba(0, 188, 212, 0.1)',
                              border: '1px solid rgba(0, 188, 212, 0.25)',
                              borderRadius: '4px',
                              padding: '1px 7px',
                              fontSize: '0.72rem',
                              color: '#00bcd4',
                              fontWeight: 600
                            }}>
                              📁 {file.folder}
                            </span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                              Tamanho: <strong style={{ color: 'var(--text-main)' }}>{file.size_formatted}</strong>
                            </span>
                            {file.modified_at && (
                              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                • {new Date(file.modified_at).toLocaleDateString('pt-BR')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyLink(file.download_url);
                        }}
                        title="Copiar URL HTTP direta"
                        style={{
                          fontSize: '0.76rem',
                          padding: '5px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <Copy size={13} />
                        <span>Copiar URL</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUNA DIREITA: GERADOR DE COMANDOS CLI PARA EQUIPAMENTOS */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Terminal size={18} color="#00bcd4" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Gerador de Comandos para Switches & Roteadores
            </h3>
          </div>

          {selectedFile ? (
            <>
              {/* Card do Arquivo Selecionado */}
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '12px 14px'
              }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Arquivo selecionado para upgrade:
                </div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)', wordBreak: 'break-all' }}>
                  {selectedFile.filename}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <span>Tamanho: <strong>{selectedFile.size_formatted}</strong></span>
                  <span>Pasta: <code>{selectedFile.folder}</code></span>
                </div>

                {/* URL Direta */}
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="text"
                    readOnly
                    className="form-input"
                    value={selectedFile.download_url}
                    style={{ fontSize: '0.78rem', padding: '6px 10px', flex: '1 1 auto', background: 'rgba(0,0,0,0.2)' }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleCopyLink(selectedFile.download_url)}
                    style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                  >
                    {copiedLink ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                    <span>{copiedLink ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                </div>
              </div>

              {/* Seletor de Perfil do Equipamento */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-main)' }}>
                  Selecione o Sistema / Família do Equipamento:
                </label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    { id: 'datacom_dmos', label: 'Datacom DmOS (DM4270, DM4615, OLTs)' },
                    { id: 'datacom_dmswitch', label: 'Datacom DmSwitch (DM4000 / DM4100)' },
                    { id: 'mikrotik', label: 'MikroTik RouterOS (v6 / v7)' },
                    { id: 'cisco_ios', label: 'Cisco IOS / Catalyst' },
                    { id: 'linux_generic', label: 'Linux / Genérico (curl / wget)' }
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProfile(p.id)}
                      style={{
                        background: selectedProfile === p.id ? 'var(--color-primary)' : 'var(--bg-card)',
                        color: selectedProfile === p.id ? '#fff' : 'var(--text-main)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Comandos Gerados Prontos para Copiar */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  Comandos gerados (prontos para colar no SSH / Guacamole):
                </span>

                {getGeneratedCommands().map((cmd, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#00bcd4' }}>
                        {cmd.title}
                      </span>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleCopyCommand(cmd.command)}
                        style={{
                          fontSize: '0.74rem',
                          padding: '4px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}
                      >
                        {copiedCmd ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copiedCmd ? 'Copiado!' : 'Copiar Linha'}</span>
                      </button>
                    </div>

                    <pre style={{
                      margin: 0,
                      padding: '8px 12px',
                      background: 'rgba(0, 0, 0, 0.45)',
                      borderRadius: '6px',
                      fontFamily: 'monospace',
                      fontSize: '0.82rem',
                      color: '#81c784',
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                      {cmd.command}
                    </pre>

                    <small style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                      {cmd.desc}
                    </small>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '3rem 1rem',
              color: 'var(--text-secondary)',
              border: '1px dashed var(--border-subtle)',
              borderRadius: '8px'
            }}>
              <Terminal size={32} style={{ margin: '0 auto 10px', opacity: 0.5 }} />
              <p>Selecione um arquivo de firmware na lista ao lado para gerar os comandos CLI prontos para o seu equipamento.</p>
            </div>
          )}
        </div>
      </div>

      {/* GUIA DE BOAS PRÁTICAS E COMANDOS NA PARTE INFERIOR */}
      <div style={{
        marginTop: '1.5rem',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '10px',
        padding: '1.25rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
          <Info size={16} color="var(--color-primary)" />
          <span>Guia Rápido de Upgrade em Equipamentos de Rede</span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1rem',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '4px' }}>Datacom DmOS (Switches & OLTs):</strong>
            O comando <code>request system software-upgrade url http://...</code> realiza o download em poucos segundos (~15s) e prepara o boot na partição secundária de forma segura.
          </div>

          <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '4px' }}>MikroTik RouterOS:</strong>
            Use <code>/tool fetch url="http://..." mode=http dst-path="pacote.npk"</code> para salvar o arquivo diretamente na memória flash. O MikroTik aplica na reinicialização.
          </div>

          <div style={{ background: 'var(--bg-card)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <strong style={{ color: 'var(--text-main)', display: 'block', marginBottom: '4px' }}>Cisco Catalyst:</strong>
            O comando <code>copy http://... flash:</code> utiliza sockets TCP comuns, evitando perdas de pacotes e timeouts característicos do TFTP antigo.
          </div>
        </div>
      </div>
    </div>
  );
};
