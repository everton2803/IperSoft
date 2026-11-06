import React, { useState, useEffect } from 'react';
import { 
  X, 
  Layers, 
  RefreshCw, 
  ArrowUpCircle, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Loader2, 
  GitBranch, 
  Server,
  FileCode,
  Clock
} from 'lucide-react';
import { authService } from '../services/api';

export const ZabbixTemplatesModal = ({ isOpen, onClose }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadTemplateUpdates();
    }
  }, [isOpen]);

  const loadTemplateUpdates = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const data = await authService.getZabbixTemplateUpdates();
      setTemplates(data || []);
      // Se estiver vazio, executa uma verificação inicial automaticamente
      if (!data || data.length === 0) {
        await handleCheckUpdates();
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao carregar templates.' });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckUpdates = async () => {
    setChecking(true);
    setFeedback(null);
    try {
      const res = await authService.checkZabbixTemplateUpdates();
      setTemplates(res.templates || []);
      const count = res.updates_available_count || 0;
      if (count > 0) {
        setFeedback({ 
          type: 'warning', 
          text: `${count} template(s) em uso possuem atualizações disponíveis no GitHub oficial!` 
        });
      } else {
        setFeedback({ 
          type: 'success', 
          text: 'Todos os templates oficiais em uso estão atualizados com o repositório oficial!' 
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Falha ao checar atualizações no GitHub.' });
    } finally {
      setChecking(false);
    }
  };

  const handleImportTemplate = async (templateId, templateName) => {
    if (!window.confirm(`Deseja importar a versão atualizada do template "${templateName}" para o Zabbix Central?\n\nAs novas métricas, itens e triggers oficiais serão mescladas automaticamente.`)) {
      return;
    }

    setUpdatingId(templateId);
    setFeedback(null);
    try {
      const res = await authService.importZabbixTemplateUpdate(templateId);
      setFeedback({ 
        type: 'success', 
        text: `Template "${templateName}" atualizado com sucesso no Zabbix Central para a versão ${res.new_version || 'mais recente'}!` 
      });
      // Atualizar lista local
      setTemplates(prev => prev.map(t => {
        if (t.template_id === templateId) {
          return {
            ...t,
            local_version: t.remote_version,
            has_update: false
          };
        }
        return t;
      }));
    } catch (err) {
      setFeedback({ type: 'error', text: err.message || 'Erro ao importar template.' });
    } finally {
      setUpdatingId(null);
    }
  };

  if (!isOpen) return null;

  const updatesCount = templates.filter(t => t.has_update).length;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1100 }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ maxWidth: 940, width: '92%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header */}
        <div className="modal-header" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ 
              width: 38, 
              height: 38, 
              borderRadius: 8, 
              background: 'rgba(229, 57, 53, 0.12)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              border: '1px solid rgba(229, 57, 53, 0.25)'
            }}>
              <Layers size={20} color="#e53935" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Monitoramento de Templates Oficiais Zabbix
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Monitore e atualize os templates oficiais da Zabbix SIA vinculados aos hosts em produção
              </p>
            </div>
          </div>
          <button 
            type="button" 
            className="btn-icon" 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
          {feedback && (
            <div 
              className={`feedback-banner ${feedback.type}`} 
              style={{ 
                marginBottom: '1rem', 
                padding: '0.75rem 1rem', 
                borderRadius: 8, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                fontSize: '0.85rem'
              }}
            >
              {feedback.type === 'error' && <AlertCircle size={16} />}
              {feedback.type === 'warning' && <ArrowUpCircle size={16} />}
              {feedback.type === 'success' && <CheckCircle2 size={16} />}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Action & Stats Bar */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1.25rem',
            padding: '0.85rem 1rem',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Templates em uso: <strong>{templates.length}</strong>
              </span>
              <span style={{ 
                fontSize: '0.75rem', 
                padding: '2px 8px', 
                borderRadius: 12, 
                fontWeight: 600,
                background: updatesCount > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: updatesCount > 0 ? '#f59e0b' : '#10b981',
                border: `1px solid ${updatesCount > 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
              }}>
                {updatesCount > 0 ? `${updatesCount} Atualização(ões) disponível(is)` : 'Todos em dia'}
              </span>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleCheckUpdates}
              disabled={checking || loading}
              style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
            >
              <RefreshCw size={14} className={checking ? 'spin-icon' : ''} />
              <span>{checking ? 'Verificando no GitHub...' : 'Verificar Atualizações no GitHub'}</span>
            </button>
          </div>

          {/* Templates Table */}
          {loading && templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>
              <Loader2 size={28} className="spin-icon" style={{ margin: '0 auto 0.75rem auto', display: 'block' }} />
              <span>Carregando templates monitorados...</span>
            </div>
          ) : templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>
              <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 0.75rem auto', display: 'block' }} />
              <p style={{ margin: 0 }}>Nenhum template oficial do Zabbix está com hosts associados no momento.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Template</th>
                    <th style={{ padding: '0.75rem 0.75rem', textAlign: 'center' }}>Hosts</th>
                    <th style={{ padding: '0.75rem 0.75rem', textAlign: 'center' }}>Versão Local</th>
                    <th style={{ padding: '0.75rem 0.75rem', textAlign: 'center' }}>Versão Git</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Último Commit Oficial (release/7.0)</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(tmpl => {
                    const isUpdating = updatingId === tmpl.template_id;
                    return (
                      <tr 
                        key={tmpl.template_id} 
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          background: tmpl.has_update ? 'rgba(245, 158, 11, 0.03)' : 'transparent'
                        }}
                      >
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <FileCode size={16} color="var(--color-primary)" />
                            <div>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>
                                {tmpl.name}
                              </span>
                              {tmpl.file_path && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                  {tmpl.file_path}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>
                          <span style={{ 
                            padding: '2px 8px', 
                            borderRadius: 10, 
                            background: 'rgba(255, 255, 255, 0.06)', 
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}>
                            {tmpl.hosts_count} {tmpl.hosts_count === 1 ? 'host' : 'hosts'}
                          </span>
                        </td>

                        <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>
                          <span style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.78rem',
                            color: tmpl.has_update ? '#ef4444' : 'var(--text-primary)'
                          }}>
                            {tmpl.local_version || 'N/A'}
                          </span>
                        </td>

                        <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>
                          <span style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: tmpl.has_update ? '#10b981' : 'var(--text-secondary)'
                          }}>
                            {tmpl.remote_version || 'N/A'}
                          </span>
                        </td>

                        <td style={{ padding: '0.85rem 1rem', maxWidth: 300 }}>
                          {tmpl.remote_commit_msg ? (
                            <div>
                              <p style={{ 
                                margin: 0, 
                                fontSize: '0.75rem', 
                                color: 'var(--text-primary)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }} title={tmpl.remote_commit_msg}>
                                {tmpl.remote_commit_msg}
                              </p>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 2, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                {tmpl.remote_commit_sha && <code>{tmpl.remote_commit_sha}</code>}
                                {tmpl.remote_commit_date && (
                                  <span>{new Date(tmpl.remote_commit_date).toLocaleDateString('pt-BR')}</span>
                                )}
                                {tmpl.remote_commit_url && (
                                  <a 
                                    href={tmpl.remote_commit_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                                    title="Ver commit no GitHub"
                                  >
                                    Ver Diff <ExternalLink size={10} />
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>—</span>
                          )}
                        </td>

                        <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                          {tmpl.has_update ? (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleImportTemplate(tmpl.template_id, tmpl.name)}
                              disabled={isUpdating}
                              style={{ 
                                fontSize: '0.75rem', 
                                padding: '0.35rem 0.75rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                background: '#10b981',
                                borderColor: '#059669'
                              }}
                              title="Importa o YAML oficial do GitHub diretamente para o Zabbix Central"
                            >
                              {isUpdating ? (
                                <>
                                  <Loader2 size={12} className="spin-icon" />
                                  <span>Importando...</span>
                                </>
                              ) : (
                                <>
                                  <ArrowUpCircle size={13} />
                                  <span>Atualizar</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: 4, 
                              color: '#10b981', 
                              fontSize: '0.75rem',
                              fontWeight: 500
                            }}>
                              <CheckCircle2 size={13} />
                              Em dia
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Info Banner */}
          <div style={{ 
            marginTop: '1.25rem', 
            padding: '0.75rem 1rem', 
            borderRadius: 8, 
            background: 'rgba(255, 255, 255, 0.02)', 
            border: '1px solid var(--border-color)',
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>💡</span>
            <div>
              <strong>Segurança & Proteção de Customizações:</strong> Apenas templates oficiais da Zabbix SIA com hosts em produção são monitorados. Seus templates customizados (como com o prefixo <code>IPER ...</code>) são protegidos e nunca são afetados por atualizações do repositório oficial.
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
