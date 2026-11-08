import React, { useState, useEffect } from 'react';
import { 
  Network, 
  Search, 
  Plus, 
  RefreshCw, 
  Radio, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  Trash2, 
  Layers, 
  Server, 
  Play, 
  Key, 
  X, 
  Filter, 
  Activity
} from 'lucide-react';
import { ipScannerService } from '../services/api';

export const IpManagementView = ({ onSelectAsset }) => {
  const [activeTab, setActiveTab] = useState('ips'); // 'ips' | 'prefixes'
  const [selectedClient, setSelectedClient] = useState('todos');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Dados
  const [stats, setStats] = useState({
    total_prefixes: 0,
    total_discovered_ips: 0,
    total_snmp: 0,
    total_icmp_only: 0,
    total_matched_assets: 0
  });
  const [prefixes, setPrefixes] = useState([]);
  const [discoveredIps, setDiscoveredIps] = useState([]);
  const [communities, setCommunities] = useState([]);

  // Estados de Carregamento
  const [loading, setLoading] = useState(false);
  const [scanningPrefixId, setScanningPrefixId] = useState(null);
  const [scanResultToast, setScanResultToast] = useState(null);
  const [modalError, setModalError] = useState('');

  // Modais
  const [showPrefixModal, setShowPrefixModal] = useState(false);
  const [showCommunityModal, setShowCommunityModal] = useState(false);

  // Formulários
  const [newPrefix, setNewPrefix] = useState({ prefix: '', client_group: 'atm', description: '', community_id: '' });
  const [newCommunity, setNewCommunity] = useState({ name: '', community: '', version: '2c', port: 161, is_default: false });

  // Lista prévia de clientes para filtro
  const clientOptions = ['todos', 'atm', 'athila', 'bkup', 'noc', 'transporte'];

  useEffect(() => {
    loadAllData();
  }, [selectedClient, statusFilter]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [statsData, prefData, commData, ipsData] = await Promise.all([
        ipScannerService.getStats().catch(() => ({})),
        ipScannerService.getPrefixes(selectedClient).catch(() => []),
        ipScannerService.getCommunities().catch(() => []),
        ipScannerService.getDiscoveredIps({
          clientGroup: selectedClient,
          status: statusFilter,
          search: search
        }).catch(() => [])
      ]);

      setStats(statsData || {});
      setPrefixes(prefData || []);
      setCommunities(commData || []);
      setDiscoveredIps(ipsData || []);
    } catch (err) {
      console.error("Erro ao carregar dados do IP Scanner:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    ipScannerService.getDiscoveredIps({
      clientGroup: selectedClient,
      status: statusFilter,
      search: search
    }).then(res => setDiscoveredIps(res || []));
  };

  // Disparar Varredura Manual de um Prefixo
  const handleScanPrefix = async (prefixId, prefixStr) => {
    setScanningPrefixId(prefixId);
    setScanResultToast(null);
    try {
      const res = await ipScannerService.scanPrefix(prefixId);
      setScanResultToast({
        type: 'success',
        message: `Varredura de ${prefixStr} concluída em ${res.duration_seconds}s! Ativos: ${res.total_active} (SNMP: ${res.total_snmp}, Apenas Ping: ${res.total_icmp_only})`
      });
      loadAllData();
    } catch (err) {
      setScanResultToast({
        type: 'error',
        message: `Falha na varredura de ${prefixStr}: ${err.message}`
      });
    } finally {
      setScanningPrefixId(null);
    }
  };

  // Criar Prefixo
  const handleCreatePrefix = async (e) => {
    e.preventDefault();
    setModalError('');
    if (!newPrefix.prefix.trim()) return;
    try {
      await ipScannerService.createPrefix({
        prefix: newPrefix.prefix.trim(),
        client_group: newPrefix.client_group.trim().toLowerCase(),
        description: newPrefix.description.trim(),
        community_id: newPrefix.community_id ? parseInt(newPrefix.community_id) : null
      });
      setShowPrefixModal(false);
      setNewPrefix({ prefix: '', client_group: 'atm', description: '', community_id: '' });
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Erro ao cadastrar prefixo.');
    }
  };

  // Criar Comunidade
  const handleCreateCommunity = async (e) => {
    e.preventDefault();
    setModalError('');
    if (!newCommunity.name.trim() || !newCommunity.community.trim()) return;
    try {
      await ipScannerService.createCommunity(newCommunity);
      setNewCommunity({ name: '', community: '', version: '2c', port: 161, is_default: false });
      loadAllData();
    } catch (err) {
      setModalError(err.message || 'Erro ao criar comunidade.');
    }
  };

  // Excluir Prefixo
  const handleDeletePrefix = async (id, prefix) => {
    if (!window.confirm(`Deseja realmente remover o prefixo ${prefix} e todos os IPs descobertos dele?`)) return;
    try {
      await ipScannerService.deletePrefix(id);
      loadAllData();
    } catch (err) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  };

  // Excluir Comunidade
  const handleDeleteCommunity = async (id, name) => {
    if (!window.confirm(`Excluir a comunidade '${name}'?`)) return;
    try {
      await ipScannerService.deleteCommunity(id);
      loadAllData();
    } catch (err) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  };

  return (
    <div className="view-container" style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto', color: 'var(--text-main)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ padding: '10px', background: 'var(--color-primary-subtle)', border: '1px solid var(--color-primary-border)', borderRadius: '10px', color: 'var(--color-primary)' }}>
              <Network size={22} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>Gestão de Prefixos & Varredura de IPs</h1>
              <p style={{ margin: '2px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Descoberta de rede via ICMP e SNMP com matching automático de equipamentos e sessões
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button 
            className="btn-secondary" 
            onClick={() => { setModalError(''); setShowCommunityModal(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
          >
            <Key size={15} />
            <span>Comunidades SNMP ({communities.length})</span>
          </button>

          <button 
            className="btn-primary" 
            onClick={() => { setModalError(''); setShowPrefixModal(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', width: 'auto', padding: '0.55rem 1rem' }}
          >
            <Plus size={16} />
            <span>Cadastrar Prefixo</span>
          </button>

          <button 
            className="btn-icon" 
            onClick={loadAllData} 
            title="Atualizar Dados"
          >
            <RefreshCw size={16} className={loading ? 'spin-icon' : ''} />
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {scanResultToast && (
        <div className={`alert-box ${scanResultToast.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1.25rem', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {scanResultToast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{scanResultToast.message}</span>
          </div>
          <button onClick={() => setScanResultToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{stats.total_prefixes || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Prefixos Monitorados</div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
            <Activity size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{stats.total_discovered_ips || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>IPs Ativos Totais</div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{stats.total_snmp || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Com SNMP (Gerenciáveis)</div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
            <Radio size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{stats.total_icmp_only || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Apenas Ping (Sem SNMP)</div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
            <Server size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{stats.total_matched_assets || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Ativos Vinculados</div>
          </div>
        </div>
      </div>

      {/* Tabs & Client Filter Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setActiveTab('ips')}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: 'var(--radius-sm)',
              border: activeTab === 'ips' ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
              background: activeTab === 'ips' ? 'var(--color-primary)' : 'var(--bg-surface)',
              color: activeTab === 'ips' ? '#fff' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.875rem',
              transition: 'var(--transition-fast)'
            }}
          >
            <Server size={15} />
            <span>Tabela Geral de IPs ({discoveredIps.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('prefixes')}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: 'var(--radius-sm)',
              border: activeTab === 'prefixes' ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
              background: activeTab === 'prefixes' ? 'var(--color-primary)' : 'var(--bg-surface)',
              color: activeTab === 'prefixes' ? '#fff' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontSize: '0.875rem',
              transition: 'var(--transition-fast)'
            }}
          >
            <Layers size={15} />
            <span>Prefixos & Varreduras ({prefixes.length})</span>
          </button>
        </div>

        {/* Client Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, marginRight: '4px' }}>Cliente / Sessão:</span>
          {clientOptions.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedClient(c)}
              style={{
                padding: '4px 12px',
                borderRadius: '9999px',
                border: selectedClient === c ? '1px solid var(--color-primary)' : '1px solid var(--border-medium)',
                background: selectedClient === c ? 'var(--color-primary)' : 'var(--bg-surface)',
                color: selectedClient === c ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'var(--transition-fast)'
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: TABELA GERAL DE TODOS OS IPS DESCOBERTOS                      */}
      {/* ==================================================================== */}
      {activeTab === 'ips' && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.25rem', overflowX: 'auto' }}>
          {/* Filters Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '280px', maxWidth: '440px' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Buscar por IP, Hostname ou Modelo..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: '2.2rem', height: '38px' }}
                />
              </div>
              <button type="submit" className="btn-secondary" style={{ height: '38px', padding: '0 1rem' }}>
                Filtrar
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Filter size={15} style={{ color: 'var(--text-secondary)' }} />
              <select
                className="form-input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: 'auto', height: '38px', padding: '0 0.85rem' }}
              >
                <option value="all">Todos os Status</option>
                <option value="snmp_and_icmp">SNMP + ICMP (Ativos Completos)</option>
                <option value="icmp_only">Apenas Ping (Sem SNMP)</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <table className="users-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Endereço IP</th>
                <th>Hostname Identificado</th>
                <th>Modelo / Descrição</th>
                <th>Cliente / Sessão</th>
                <th>Sub-rede</th>
                <th>Ativo no IperSoft</th>
                <th>Último Visto</th>
              </tr>
            </thead>
            <tbody>
              {discoveredIps.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    Nenhum IP encontrado para os filtros selecionados. Vá em "Prefixos & Varreduras" e clique em "Escanear Agora".
                  </td>
                </tr>
              ) : (
                discoveredIps.map((ip) => (
                  <tr key={ip.id}>
                    <td>
                      {ip.snmp_alive ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '3px 9px', borderRadius: '9999px', fontSize: '0.73rem', fontWeight: 700 }}>
                          SNMP + Ping
                        </span>
                      ) : ip.icmp_alive ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', padding: '3px 9px', borderRadius: '9999px', fontSize: '0.73rem', fontWeight: 700 }}>
                          Apenas Ping
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Inativo</span>
                      )}
                    </td>

                    <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                      {ip.ip_address}
                    </td>

                    <td style={{ fontWeight: 600 }}>
                      {ip.hostname ? (
                        <span style={{ color: 'var(--text-main)' }}>{ip.hostname}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>Sem resposta SNMP</span>
                      )}
                    </td>

                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={ip.description || ''}>
                      {ip.description || '-'}
                    </td>

                    <td>
                      <span style={{ textTransform: 'uppercase', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-border)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>
                        {ip.client_group || 'geral'}
                      </span>
                    </td>

                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                      {ip.prefix_str || '-'}
                    </td>

                    <td>
                      {ip.asset_id ? (
                        <button
                          onClick={() => onSelectAsset && onSelectAsset(ip.asset_id)}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.8rem' }}
                        >
                          <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />
                          <span>{ip.asset_name || `Ativo #${ip.asset_id}`}</span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Novo IP</span>
                      )}
                    </td>

                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {ip.last_seen_at ? new Date(ip.last_seen_at).toLocaleString('pt-BR') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: PREFIXOS CADASTRADOS & BOTÃO DE SCAN MANUAL                   */}
      {/* ==================================================================== */}
      {activeTab === 'prefixes' && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.25rem', overflowX: 'auto' }}>
          <table className="users-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                <th>Prefixo CIDR</th>
                <th>Cliente / Sessão</th>
                <th>Comunidade SNMP</th>
                <th>Descrição</th>
                <th>Última Varredura</th>
                <th>Hosts Ativos</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {prefixes.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    Nenhum prefixo cadastrado ainda. Clique em "Cadastrar Prefixo" acima.
                  </td>
                </tr>
              ) : (
                prefixes.map((pref) => (
                  <tr key={pref.id}>
                    <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                      {pref.prefix}
                    </td>

                    <td>
                      <span style={{ textTransform: 'uppercase', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-border)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
                        {pref.client_group}
                      </span>
                    </td>

                    <td style={{ color: 'var(--text-main)', fontWeight: 500 }}>
                      {pref.community_name}
                    </td>

                    <td style={{ color: 'var(--text-secondary)' }}>
                      {pref.description || '-'}
                    </td>

                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {pref.last_scan_at ? new Date(pref.last_scan_at).toLocaleString('pt-BR') : 'Nunca escaneado'}
                    </td>

                    <td style={{ fontWeight: 700 }}>
                      <span style={{ background: pref.total_hosts_found > 0 ? 'var(--color-success-bg)' : 'var(--bg-secondary)', color: pref.total_hosts_found > 0 ? 'var(--color-success)' : 'var(--text-muted)', padding: '3px 10px', borderRadius: '9999px', fontSize: '0.75rem' }}>
                        {pref.total_hosts_found} hosts
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button
                          className="btn-primary"
                          style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', padding: '6px 12px' }}
                          onClick={() => handleScanPrefix(pref.id, pref.prefix)}
                          disabled={scanningPrefixId === pref.id}
                        >
                          <Play size={13} className={scanningPrefixId === pref.id ? 'spin-icon' : ''} />
                          <span>{scanningPrefixId === pref.id ? 'Escaneando...' : 'Escanear Agora'}</span>
                        </button>

                        <button
                          className="btn-delete-user"
                          onClick={() => handleDeletePrefix(pref.id, pref.prefix)}
                          title="Remover Prefixo"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: CADASTRAR PREFIXO (Usando Design System Nativo do IperSoft)   */}
      {/* ==================================================================== */}
      {showPrefixModal && (
        <div className="modal-overlay" onClick={() => setShowPrefixModal(false)}>
          <div className="modal-container" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-box">
                <Network size={20} className="modal-title-icon" />
                <h2 className="modal-title">Cadastrar Sub-rede / Prefixo</h2>
              </div>
              <button className="btn-close-modal" onClick={() => setShowPrefixModal(false)} title="Fechar">
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="alert-box alert-error" role="alert">
                <AlertCircle size={15} />
                <span>{modalError}</span>
              </div>
            )}

            <div className="modal-body">
              <form onSubmit={handleCreatePrefix} className="admin-create-form">
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Prefixo CIDR *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: 10.90.10.0/24 ou 172.16.50.0/24"
                    value={newPrefix.prefix}
                    onChange={(e) => setNewPrefix({ ...newPrefix, prefix: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Cliente / Sessão *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: atm, athila, bkup..."
                    value={newPrefix.client_group}
                    onChange={(e) => setNewPrefix({ ...newPrefix, client_group: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Comunidade SNMP Específica</label>
                  <select
                    className="form-input"
                    value={newPrefix.community_id}
                    onChange={(e) => setNewPrefix({ ...newPrefix, community_id: e.target.value })}
                  >
                    <option value="">Padrão (Tentar todas cadastradas)</option>
                    {communities.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.community})</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">Descrição / Finalidade</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: Switches e OLTs POP Matriz"
                    value={newPrefix.description}
                    onChange={(e) => setNewPrefix({ ...newPrefix, description: e.target.value })}
                  />
                </div>

                <div className="form-actions-right" style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowPrefixModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.6rem 1.4rem' }}>
                    Salvar Prefixo
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: GERENCIAR COMUNIDADES SNMP (Design System Nativo do IperSoft) */}
      {/* ==================================================================== */}
      {showCommunityModal && (
        <div className="modal-overlay" onClick={() => setShowCommunityModal(false)}>
          <div className="modal-container" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-box">
                <Key size={20} className="modal-title-icon" />
                <h2 className="modal-title">Comunidades SNMP</h2>
              </div>
              <button className="btn-close-modal" onClick={() => setShowCommunityModal(false)} title="Fechar">
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="alert-box alert-error" role="alert">
                <AlertCircle size={15} />
                <span>{modalError}</span>
              </div>
            )}

            <div className="modal-body">
              {/* Lista Existente */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Comunidades Cadastradas ({communities.length})
                </label>
                <div className="users-table-wrapper" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>Identificação</th>
                        <th>Community String</th>
                        <th>Versão</th>
                        <th style={{ textAlign: 'right' }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {communities.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            Nenhuma comunidade cadastrada.
                          </td>
                        </tr>
                      ) : (
                        communities.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.name}</strong>
                              {c.is_default && (
                                <span style={{ marginLeft: '6px', background: 'var(--color-success-bg)', color: 'var(--color-success)', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                  Padrão
                                </span>
                              )}
                            </td>
                            <td><code>{c.community}</code></td>
                            <td>v{c.version}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button 
                                className="btn-delete-user"
                                onClick={() => handleDeleteCommunity(c.id, c.name)}
                                title="Excluir comunidade"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Formulário Nova Comunidade */}
              <form onSubmit={handleCreateCommunity} className="admin-create-form" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.75rem', color: 'var(--color-primary)' }}>
                  + Adicionar Nova Comunidade
                </label>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Nome / Identificação *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: POP Matriz"
                      value={newCommunity.name}
                      onChange={(e) => setNewCommunity({ ...newCommunity, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Community String *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: ipermonitor"
                      value={newCommunity.community}
                      onChange={(e) => setNewCommunity({ ...newCommunity, community: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-actions-right" style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowCommunityModal(false)}>
                    Fechar
                  </button>
                  <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.6rem 1.4rem' }}>
                    Adicionar Comunidade
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
