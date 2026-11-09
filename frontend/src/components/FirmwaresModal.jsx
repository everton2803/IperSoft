import React, { useState, useEffect } from 'react';
import { 
  X, 
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
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Server,
  Layers,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { firmwaresService } from '../services/api';

export const FirmwaresModal = ({ 
  isOpen, 
  onClose, 
  asset = null 
}) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('todos');
  const [copiedItem, setCopiedItem] = useState(null);
  const [copiedCmd, setCopiedCmd] = useState(null);
  const [expandedFile, setExpandedFile] = useState(null);
  const [commandsCache, setCommandsCache] = useState({});
  const [loadingCmd, setLoadingCmd] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await firmwaresService.getFiles();
      setData(res);
      // Se houver ativo datacom ou mikrotik, pre-seleciona a pasta se existir
      if (asset) {
        const prof = (asset.os_profile || asset.backup_model || '').toLowerCase();
        if (prof.includes('datacom') || prof.includes('dmos')) {
          if (res.folders && res.folders.includes('datacom')) {
            setSelectedFolder('datacom');
          }
        } else if (prof.includes('mikrotik') || prof.includes('routeros')) {
          if (res.folders && res.folders.includes('mikrotik')) {
            setSelectedFolder('mikrotik');
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar firmwares:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = (url, key) => {
    navigator.clipboard.writeText(url);
    setCopiedItem(key);
    setTimeout(() => setCopiedItem(null), 2500);
  };

  const handleCopyCommand = (cmdText, key) => {
    navigator.clipboard.writeText(cmdText);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const handleToggleCommands = async (file) => {
    const key = file.relative_path;
    if (expandedFile === key) {
      setExpandedFile(null);
      return;
    }
    setExpandedFile(key);

    if (!commandsCache[key]) {
      setLoadingCmd(key);
      try {
        const res = await firmwaresService.getCommand({
          filename: file.filename,
          relative_path: file.relative_path,
          os_profile: asset?.os_profile,
          backup_model: asset?.backup_model,
          http_base_url: data?.http_base_url
        });
        setCommandsCache(prev => ({ ...prev, [key]: res.commands || [] }));
      } catch (err) {
        console.error('Erro ao gerar comandos:', err);
      } finally {
        setLoadingCmd(null);
      }
    }
  };

  if (!isOpen) return null;

  const files = data?.files || [];
  const folders = data?.folders || [];
  const httpBaseUrl = data?.http_base_url || 'http://10.10.1.2:8089';
  const webUrl = data?.web_url || 'https://firmware.iper.net.br';

  const filteredFiles = files.filter(f => {
    const matchFolder = selectedFolder === 'todos' || f.folder === selectedFolder;
    const matchSearch = searchTerm === '' || 
      f.filename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.folder.toLowerCase().includes(searchTerm.toLowerCase());
    return matchFolder && matchSearch;
  });

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div 
        className="modal-content-large" 
        onClick={e => e.stopPropagation()} 
        style={{ maxWidth: '960px', width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header */}
        <div className="modal-header-modern" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(33, 150, 243, 0.2) 0%, rgba(3, 169, 244, 0.3) 100%)',
              padding: '10px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(33, 150, 243, 0.4)'
            }}>
              <HardDrive size={22} color="#00bcd4" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)' }}>
                  Servidor de Firmwares & Arquivos
                </h2>
                <span className="badge-status-pill badge-green" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                  <span className="dot-online" style={{ marginRight: 4 }}></span>
                  HTTP Ativo
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Envio pelo PC via Web (FileBrowser) e download direto de alta velocidade nos equipamentos de rede (Nginx).
              </p>
            </div>
          </div>
          <button 
            type="button" 
            className="btn-icon" 
            onClick={onClose} 
            title="Fechar"
            style={{ borderRadius: '8px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Action Shortcuts Strip */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          flexWrap: 'wrap', 
          gap: '10px',
          padding: '0.85rem 0',
          borderBottom: '1px solid var(--border-color)'
        }}>
          {/* Quick Metrics */}
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '0.82rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-color)' }}>
              <Layers size={14} color="#00bcd4" />
              <span>Arquivos: <strong>{data?.total_files || 0}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-color)' }}>
              <HardDrive size={14} color="#4caf50" />
              <span>Espaço: <strong>{data?.total_size_formatted || '0 B'}</strong></span>
            </div>
            {asset && (
              <div style={{ 
                background: 'rgba(33, 150, 243, 0.12)', 
                border: '1px solid rgba(33, 150, 243, 0.3)', 
                borderRadius: '6px', 
                padding: '2px 8px', 
                fontSize: '0.75rem',
                color: '#29b6f6'
              }}>
                Ativo alvo: <strong>{asset.name}</strong> ({asset.os_profile || asset.backup_model || 'Geral'})
              </div>
            )}
          </div>

          {/* External Links Buttons */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <a 
              href={webUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.82rem' }}
              title="Abre a interface web para fazer upload do firmware do seu computador"
            >
              <UploadCloud size={15} />
              <span>Fazer Upload (Web)</span>
              <ExternalLink size={12} />
            </a>

            <a 
              href={httpBaseUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.82rem' }}
              title="Abre o índice de arquivos servidos via HTTP"
            >
              <Server size={14} color="#4caf50" />
              <span>Índice HTTP</span>
              <ExternalLink size={12} />
            </a>

            <button 
              type="button" 
              className="btn-secondary" 
              onClick={loadFiles} 
              disabled={loading}
              title="Recarregar lista de arquivos"
              style={{ padding: '6px 10px' }}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '0.85rem 0', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              className="form-input" 
              placeholder="Buscar por nome do arquivo (ex: DmOS, swu, bin)..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: '32px', fontSize: '0.85rem' }}
            />
          </div>

          {/* Folder Pills */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
            <button
              type="button"
              className={`pill-btn ${selectedFolder === 'todos' ? 'active' : ''}`}
              onClick={() => setSelectedFolder('todos')}
              style={{
                background: selectedFolder === 'todos' ? 'var(--color-primary)' : 'var(--bg-secondary)',
                color: selectedFolder === 'todos' ? '#fff' : 'var(--text-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '9999px',
                padding: '4px 12px',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              Todos ({files.length})
            </button>
            {folders.map(f => (
              <button
                key={f}
                type="button"
                className={`pill-btn ${selectedFolder === f ? 'active' : ''}`}
                onClick={() => setSelectedFolder(f)}
                style={{
                  background: selectedFolder === f ? 'var(--color-primary)' : 'var(--bg-secondary)',
                  color: selectedFolder === f ? '#fff' : 'var(--text-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '9999px',
                  padding: '4px 12px',
                  fontSize: '0.78rem',
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

        {/* Files List Container */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', paddingRight: '4px' }}>
          {loading && files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <Loader2 size={28} className="spin-icon" style={{ margin: '0 auto 10px' }} />
              <p>Consultando arquivos de firmware no servidor...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '3rem 1rem', 
              background: 'var(--bg-secondary)', 
              borderRadius: '8px', 
              border: '1px dashed var(--border-color)' 
            }}>
              <HardDrive size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px', opacity: 0.6 }} />
              <h4 style={{ margin: '0 0 6px', color: 'var(--text-color)' }}>Nenhum firmware encontrado</h4>
              <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {searchTerm || selectedFolder !== 'todos' 
                  ? 'Nenhum arquivo corresponde aos filtros selecionados.' 
                  : 'Nenhum arquivo foi enviado ainda para o servidor de firmwares.'}
              </p>
              <a 
                href={webUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <UploadCloud size={15} />
                <span>Enviar Firmware via Web</span>
              </a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredFiles.map(file => {
                const isExpanded = expandedFile === file.relative_path;
                const isCopied = copiedItem === file.relative_path;
                const commands = commandsCache[file.relative_path] || [];

                return (
                  <div 
                    key={file.relative_path}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      transition: 'border-color 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '220px', flex: '1 1 auto' }}>
                        <div style={{
                          background: 'rgba(33, 150, 243, 0.1)',
                          border: '1px solid rgba(33, 150, 243, 0.25)',
                          borderRadius: '6px',
                          padding: '7px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <FileCode size={18} color="#00bcd4" />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-color)', wordBreak: 'break-all' }}>
                              {file.filename}
                            </span>
                            <span style={{
                              background: 'rgba(255, 255, 255, 0.06)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              padding: '1px 6px',
                              fontSize: '0.72rem',
                              color: 'var(--text-muted)'
                            }}>
                              📁 {file.folder}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', gap: '12px' }}>
                            <span>Tamanho: <strong style={{ color: 'var(--text-color)' }}>{file.size_formatted}</strong></span>
                            {file.modified_at && (
                              <span>Atualizado: {new Date(file.modified_at).toLocaleDateString('pt-BR')}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* File Actions */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleCopyLink(file.download_url, file.relative_path)}
                          title="Copiar URL direta de download HTTP para os equipamentos"
                          style={{
                            fontSize: '0.78rem',
                            padding: '5px 10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            borderColor: isCopied ? '#4caf50' : 'var(--border-color)',
                            color: isCopied ? '#4caf50' : 'var(--text-color)'
                          }}
                        >
                          {isCopied ? <Check size={14} /> : <Copy size={14} />}
                          <span>{isCopied ? 'URL Copiada!' : 'Copiar URL HTTP'}</span>
                        </button>

                        <button
                          type="button"
                          className={`btn-secondary ${isExpanded ? 'active' : ''}`}
                          onClick={() => handleToggleCommands(file)}
                          title="Exibe o comando pronto para copiar e colar no CLI do Switch/Roteador"
                          style={{
                            fontSize: '0.78rem',
                            padding: '5px 10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                        >
                          <Terminal size={14} color="#00bcd4" />
                          <span>Comandos CLI</span>
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable CLI Commands Box */}
                    {isExpanded && (
                      <div style={{
                        marginTop: '10px',
                        paddingTop: '10px',
                        borderTop: '1px solid var(--border-color)',
                        background: 'rgba(0, 0, 0, 0.15)',
                        borderRadius: '6px',
                        padding: '10px'
                      }}>
                        {loadingCmd === file.relative_path ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <Loader2 size={14} className="spin-icon" />
                            <span>Gerando comandos CLI para o perfil do equipamento...</span>
                          </div>
                        ) : commands.length === 0 ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            URL de download: <code>{file.download_url}</code>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#00bcd4', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Terminal size={13} />
                              <span>Comandos prontos para copiar e colar no terminal do equipamento:</span>
                            </div>

                            {commands.map((cmdObj, idx) => {
                              const cmdKey = `${file.relative_path}_${idx}`;
                              const isCmdCopied = copiedCmd === cmdKey;

                              return (
                                <div 
                                  key={idx}
                                  style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    padding: '8px 10px'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-color)' }}>
                                      {cmdObj.label}
                                    </span>
                                    <button
                                      type="button"
                                      className="btn-icon"
                                      onClick={() => handleCopyCommand(cmdObj.command, cmdKey)}
                                      title="Copiar comando para área de transferência"
                                      style={{
                                        padding: '3px 8px',
                                        fontSize: '0.72rem',
                                        height: 'auto',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        color: isCmdCopied ? '#4caf50' : 'var(--text-muted)'
                                      }}
                                    >
                                      {isCmdCopied ? <Check size={12} /> : <Copy size={12} />}
                                      <span>{isCmdCopied ? 'Copiado!' : 'Copiar'}</span>
                                    </button>
                                  </div>
                                  <pre style={{
                                    margin: 0,
                                    padding: '6px 8px',
                                    background: 'rgba(0, 0, 0, 0.35)',
                                    borderRadius: '4px',
                                    fontFamily: 'monospace',
                                    fontSize: '0.78rem',
                                    color: '#81c784',
                                    overflowX: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                  }}>
                                    {cmdObj.command}
                                  </pre>
                                  {cmdObj.description && (
                                    <small style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '3px' }}>
                                      {cmdObj.description}
                                    </small>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer Quick Help */}
        <div style={{
          marginTop: '1rem',
          paddingTop: '0.85rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          fontSize: '0.76rem',
          color: 'var(--text-muted)'
        }}>
          <div>
            💡 <strong>Dica:</strong> Em switches <strong>Datacom DmOS</strong>, use o comando <code>request system software-upgrade url http://...</code> diretamente no SSH.
          </div>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ padding: '6px 16px' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
