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
  Clock, 
  Play, 
  Key, 
  X, 
  Filter, 
  HelpCircle,
  Activity,
  ExternalLink
} from 'lucide-react';
import { ipScannerService } from '../services/api';

export const IpManagementView = ({ onSelectAsset }) => {
  const [activeTab, setActiveTab] = useState('ips'); // 'ips' | 'prefixes' | 'communities'
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
        message: `Varredura de ${prefixStr} concluída em ${res.duration_seconds}s! Ativos: ${res.total_active} (SNMP: ${res.total_snmp}, Apenas ICMP: ${res.total_icmp_only})`
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
      alert(`Erro: ${err.message}`);
    }
  };

  // Criar Comunidade
  const handleCreateCommunity = async (e) => {
    e.preventDefault();
    if (!newCommunity.name.trim() || !newCommunity.community.trim()) return;
    try {
      await ipScannerService.createCommunity(newCommunity);
      setShowCommunityModal(false);
      setNewCommunity({ name: '', community: '', version: '2c', port: 161, is_default: false });
      loadAllData();
    } catch (err) {
      alert(`Erro: ${err.message}`);
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
    <div className="view-container" style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ padding: '8px', background: 'var(--color-primary-light, #e0f2fe)', borderRadius: '8px', color: '#0284c7' }}>
              <Network size={24} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Gestão de Prefixos & Varredura de IPs</h1>
              <p style={{ margin: 0, color: 'var(--text-muted, #64748b)', fontSize: '0.875rem' }}>
                Descoberta de rede via ICMP e SNMP com matching automático de equipamentos e sessões
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button 
            className="btn-secondary" 
            onClick={() => setShowCommunityModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
          >
            <Key size={15} />
            <span>Comunidades SNMP ({communities.length})</span>
          </button>

          <button 
            className="btn-primary" 
            onClick={() => setShowPrefixModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
          >
            <Plus size={15} />
            <span>Cadastrar Prefixo</span>
          </button>

          <button 
            className="btn-icon" 
            onClick={loadAllData} 
            title="Atualizar Dados"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {scanResultToast && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: scanResultToast.type === 'success' ? '#ecfdf5' : '#fef2f2',
          color: scanResultToast.type === 'success' ? '#065f46' : '#991b1b',
          border: `1px solid ${scanResultToast.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
          fontSize: '0.9rem'
        }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: '#e0f2fe', color: '#0369a1' }}>
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{stats.total_prefixes || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>Prefixos Monitorados</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: '#dcfce7', color: '#15803d' }}>
            <Activity size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{stats.total_discovered_ips || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>IPs Ativos Totais</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: '#fef3c7', color: '#b45309' }}>
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{stats.total_snmp || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>🟢 Com SNMP (Gerenciáveis)</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: '#ffedd5', color: '#c2410c' }}>
            <Radio size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{stats.total_icmp_only || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>🟡 Apenas Ping (Sem SNMP)</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '10px', borderRadius: '8px', background: '#ede9fe', color: '#6d28d9' }}>
            <Server size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{stats.total_matched_assets || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>🔗 Ativos Vinculados</div>
          </div>
        </div>
      </div>

      {/* Tabs & Client Filter Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.5rem' }}>
          <button
            onClick={() => setActiveTab('ips')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'ips' ? 'var(--color-primary, #0284c7)' : 'transparent',
              color: activeTab === 'ips' ? '#fff' : 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.9rem'
            }}
          >
            <Server size={16} />
            <span>Tabela Geral de IPs ({discoveredIps.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('prefixes')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'prefixes' ? 'var(--color-primary, #0284c7)' : 'transparent',
              color: activeTab === 'prefixes' ? '#fff' : 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.9rem'
            }}
          >
            <Layers size={16} />
            <span>Prefixos & Varreduras ({prefixes.length})</span>
          </button>
        </div>

        {/* Client Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', fontWeight: 600 }}>Cliente / Sessão:</span>
          {clientOptions.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedClient(c)}
              style={{
                padding: '3px 10px',
                borderRadius: '9999px',
                border: '1px solid var(--border-color, #cbd5e1)',
                background: selectedClient === c ? 'var(--color-primary, #0284c7)' : 'transparent',
                color: selectedClient === c ? '#fff' : 'inherit',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                cursor: 'pointer'
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
        <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
          {/* Filters Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '280px', maxWidth: '400px' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Buscar por IP, Hostname ou Modelo..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.75rem 0.45rem 2rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    background: 'var(--bg-input, #fff)',
                    fontSize: '0.85rem'
                  }}
                />
              </div>
              <button type="submit" className="btn-secondary" style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}>
                Filtrar
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Filter size={15} color="#94a3b8" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '0.85rem',
                  background: 'var(--bg-input, #fff)'
                }}
              >
                <option value="all">Todos os Status</option>
                <option value="snmp_and_icmp">🟢 SNMP + ICMP (Ativos Completos)</option>
                <option value="icmp_only">🟡 Apenas Ping (Sem SNMP)</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color, #e2e8f0)', textAlign: 'left', color: 'var(--text-muted, #64748b)' }}>
                <th style={{ padding: '0.6rem 0.5rem' }}>Status</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Endereço IP</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Hostname Identificado</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Modelo / Descrição</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Cliente / Sessão</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Sub-rede</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Ativo no IperSoft</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Último Visto</th>
              </tr>
            </thead>
            <tbody>
              {discoveredIps.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    Nenhum IP encontrado para os filtros selecionados. Cadastre um prefixo e execute a varredura.
                  </td>
                </tr>
              ) : (
                discoveredIps.map((ip) => (
                  <tr key={ip.id} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)', transition: 'background 0.2s' }}>
                    <td style={{ padding: '0.6rem 0.5rem' }}>
                      {ip.snmp_alive ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          SNMP + Ping
                        </span>
                      ) : ip.icmp_alive ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          Apenas Ping
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Inativo</span>
                      )}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600, fontFamily: 'monospace' }}>
                      {ip.ip_address}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', fontWeight: 500 }}>
                      {ip.hostname ? (
                        <span style={{ color: '#0f172a' }}>{ip.hostname}</span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Não respondeu SNMP</span>
                      )}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', color: '#475569', fontSize: '0.8rem', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ip.description || '-'}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem' }}>
                      <span style={{ textTransform: 'uppercase', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>
                        {ip.client_group || 'geral'}
                      </span>
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                      {ip.prefix_str || '-'}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem' }}>
                      {ip.asset_id ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#0284c7', fontWeight: 600, fontSize: '0.8rem' }}>
                          <CheckCircle2 size={13} color="#10b981" />
                          <span>{ip.asset_name || `Ativo #${ip.asset_id}`}</span>
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Novo IP</span>
                      )}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', color: '#94a3b8', fontSize: '0.75rem' }}>
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
        <div className="card" style={{ padding: '1.25rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color, #e2e8f0)', textAlign: 'left', color: 'var(--text-muted, #64748b)' }}>
                <th style={{ padding: '0.6rem 0.5rem' }}>Prefixo CIDR</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Cliente / Sessão</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Comunidade SNMP</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Descrição</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Última Varredura</th>
                <th style={{ padding: '0.6rem 0.5rem' }}>Hosts Ativos</th>
                <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {prefixes.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    Nenhum prefixo cadastrado ainda. Clique em "Cadastrar Prefixo" acima.
                  </td>
                </tr>
              ) : (
                prefixes.map((pref) => (
                  <tr key={pref.id} style={{ borderBottom: '1px solid var(--border-color, #f1f5f9)' }}>
                    <td style={{ padding: '0.6rem 0.5rem', fontWeight: 700, fontFamily: 'monospace', color: '#0284c7' }}>
                      {pref.prefix}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem' }}>
                      <span style={{ textTransform: 'uppercase', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
                        {pref.client_group}
                      </span>
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', color: '#475569' }}>
                      {pref.community_name}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b' }}>
                      {pref.description || '-'}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b', fontSize: '0.8rem' }}>
                      {pref.last_scan_at ? new Date(pref.last_scan_at).toLocaleString('pt-BR') : 'Nunca escaneado'}
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600 }}>
                      <span style={{ background: pref.total_hosts_found > 0 ? '#dcfce7' : '#f1f5f9', color: pref.total_hosts_found > 0 ? '#15803d' : '#64748b', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.75rem' }}>
                        {pref.total_hosts_found} hosts
                      </span>
                    </td>

                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button
                          className="btn-primary"
                          style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: '4px 10px' }}
                          onClick={() => handleScanPrefix(pref.id, pref.prefix)}
                          disabled={scanningPrefixId === pref.id}
                        >
                          <Play size={12} className={scanningPrefixId === pref.id ? 'animate-spin' : ''} />
                          <span>{scanningPrefixId === pref.id ? 'Escaneando...' : 'Escanear Agora'}</span>
                        </button>

                        <button
                          className="btn-icon btn-danger-icon"
                          style={{ padding: '4px' }}
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
      {/* MODAL: CADASTRAR PREFIXO                                             */}
      {/* ==================================================================== */}
      {showPrefixModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="card" style={{ width: '100%', maxWidth: '480px', padding: '1.5rem', background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Cadastrar Sub-rede / Prefixo</h3>
              <button onClick={() => setShowPrefixModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreatePrefix}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>Prefixo CIDR *</label>
                <input
                  type="text"
                  placeholder="Ex: 10.90.10.0/24 ou 172.16.50.0/24"
                  value={newPrefix.prefix}
                  onChange={(e) => setNewPrefix({ ...newPrefix, prefix: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>Cliente / Sessão *</label>
                <input
                  type="text"
                  placeholder="Ex: atm, athila, bkup..."
                  value={newPrefix.client_group}
                  onChange={(e) => setNewPrefix({ ...newPrefix, client_group: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>Comunidade SNMP Específica</label>
                <select
                  value={newPrefix.community_id}
                  onChange={(e) => setNewPrefix({ ...newPrefix, community_id: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="">Padrão (Tentar todas cadastradas)</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.community})</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>Descrição / Finalidade</label>
                <input
                  type="text"
                  placeholder="Ex: Switches e OLTs POP Matriz"
                  value={newPrefix.description}
                  onChange={(e) => setNewPrefix({ ...newPrefix, description: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowPrefixModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Salvar Prefixo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: GERENCIAR COMUNIDADES SNMP                                    */}
      {/* ==================================================================== */}
      {showCommunityModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="card" style={{ width: '100%', maxWidth: '550px', padding: '1.5rem', background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Comunidades SNMP</h3>
              <button onClick={() => setShowCommunityModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            {/* Lista Existente */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>Comunidades Cadastradas:</div>
              <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                {communities.map((c) => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span style={{ marginLeft: '8px', fontFamily: 'monospace', color: '#0284c7', fontSize: '0.8rem' }}>'{c.community}'</span>
                      {c.is_default && <span style={{ marginLeft: '6px', background: '#dcfce7', color: '#15803d', fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px' }}>Padrão</span>}
                    </div>
                    <button 
                      onClick={() => handleDeleteCommunity(c.id, c.name)} 
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Formulário Nova Comunidade */}
            <form onSubmit={handleCreateCommunity} style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Adicionar Nova Comunidade:</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="text"
                  placeholder="Nome (ex: POP Matriz)"
                  value={newCommunity.name}
                  onChange={(e) => setNewCommunity({ ...newCommunity, name: e.target.value })}
                  required
                  style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
                <input
                  type="text"
                  placeholder="String (ex: ipermonitor)"
                  value={newCommunity.community}
                  onChange={(e) => setNewCommunity({ ...newCommunity, community: e.target.value })}
                  required
                  style={{ padding: '0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCommunityModal(false)}>Fechar</button>
                <button type="submit" className="btn-primary">Adicionar Comunidade</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
