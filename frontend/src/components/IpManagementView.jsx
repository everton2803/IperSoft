import React, { useState, useEffect, useMemo } from 'react';
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
  Edit2,
  Layers, 
  Server, 
  Play, 
  Key, 
  X, 
  Filter, 
  Activity
} from 'lucide-react';
import { ipScannerService } from '../services/api';
import { AccordionSection } from './common/AccordionSection';
import { DensityToggle } from './common/DensityToggle';

export const IpManagementView = ({ onSelectAsset }) => {
  const [density, setDensity] = useState(() => {
    return localStorage.getItem('ipersoft_density_ip_table') || 'comfortable';
  });
  const [selectedClient, setSelectedClient] = useState('todos');
  const [selectedPrefixId, setSelectedPrefixId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('ips'); // 'ips' | 'vlans'

  // Dados
  const [stats, setStats] = useState({
    total_prefixes: 0,
    total_discovered_ips: 0,
    total_snmp: 0,
    total_icmp_only: 0,
    total_matched_assets: 0,
    total_vlans: 0
  });
  const [allPrefixes, setAllPrefixes] = useState([]);
  const [discoveredIps, setDiscoveredIps] = useState([]);
  const [discoveredVlans, setDiscoveredVlans] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [probes, setProbes] = useState([]);

  // Estados de Carregamento
  const [loading, setLoading] = useState(false);
  const [scanningPrefixId, setScanningPrefixId] = useState(null);
  const [scanningAllPrefixes, setScanningAllPrefixes] = useState(false);
  const [extractingVlans, setExtractingVlans] = useState(false);
  const [syncingPhpIpam, setSyncingPhpIpam] = useState(false);
  const [testingProbeId, setTestingProbeId] = useState(null);
  const [probeTestResults, setProbeTestResults] = useState({});
  const [scanResultToast, setScanResultToast] = useState(null);
  const [modalError, setModalError] = useState('');

  // Modais
  const [showPrefixModal, setShowPrefixModal] = useState(false);
  const [editingPrefixId, setEditingPrefixId] = useState(null);
  const [showCommunityModal, setShowCommunityModal] = useState(false);
  const [editingCommunityId, setEditingCommunityId] = useState(null);
  const [showProbeModal, setShowProbeModal] = useState(false);
  const [editingProbeId, setEditingProbeId] = useState(null);

  // Formulários
  const [newPrefix, setNewPrefix] = useState({ prefix: '', client_group: '', description: '', community_ids: [], probe_id: '' });
  const [newCommunity, setNewCommunity] = useState({ name: '', community: '', version: '2c', port: 161, is_default: false });
  const [newProbe, setNewProbe] = useState({ name: '', url: '', client_group: '', phpipam_agent_code: '', is_default: false });

  // Lista dinâmica de clientes: mostra clientes que possuem prefixo ou VLAN extraída
  const clientOptions = useMemo(() => {
    const prefGroups = allPrefixes.map((p) => (p.client_group || '').trim().toLowerCase());
    const vlanGroups = discoveredVlans.map((v) => (v.client_group || '').trim().toLowerCase());
    const groups = Array.from(new Set([...prefGroups, ...vlanGroups].filter(Boolean))).sort();
    return ['todos', ...groups];
  }, [allPrefixes, discoveredVlans]);

  // Prefixos filtrados pelo cliente selecionado
  const filteredPrefixes = useMemo(() => {
    if (selectedClient === 'todos') return allPrefixes;
    return allPrefixes.filter(
      (p) => (p.client_group || '').trim().toLowerCase() === selectedClient
    );
  }, [allPrefixes, selectedClient]);

  useEffect(() => {
    loadAllData();
  }, [selectedClient, selectedPrefixId, statusFilter]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [statsData, prefData, commData, probeData, ipsData, vlansData] = await Promise.all([
        ipScannerService.getStats().catch(() => ({})),
        ipScannerService.getPrefixes('todos').catch(() => []),
        ipScannerService.getCommunities().catch(() => []),
        ipScannerService.getProbes().catch(() => []),
        ipScannerService.getDiscoveredIps({
          clientGroup: selectedClient,
          prefixId: selectedPrefixId,
          status: statusFilter,
          search: search
        }).catch(() => []),
        ipScannerService.getDiscoveredVlans({
          clientGroup: selectedClient,
          search: search
        }).catch(() => [])
      ]);

      setStats(statsData || {});
      setAllPrefixes(prefData || []);
      setCommunities(commData || []);
      setProbes(probeData || []);
      setDiscoveredIps(ipsData || []);
      setDiscoveredVlans(vlansData || []);
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
      prefixId: selectedPrefixId,
      status: statusFilter,
      search: search
    }).then(res => setDiscoveredIps(res || []));
    ipScannerService.getDiscoveredVlans({
      clientGroup: selectedClient,
      search: search
    }).then(res => setDiscoveredVlans(res || []));
  };

  // Disparar Varredura Manual de um Prefixo
  const handleScanPrefix = async (prefixId, prefixStr) => {
    setScanningPrefixId(prefixId);
    setScanResultToast(null);
    try {
      const res = await ipScannerService.scanPrefix(prefixId);
      setScanResultToast({
        type: 'success',
        message: `Varredura de ${prefixStr} concluída em ${res.duration_seconds}s! Ativos: ${res.total_active} (SNMP: ${res.total_snmp}, Apenas Ping: ${res.total_icmp_only}, Vinculados: ${res.matched_assets || 0})`
      });
      await loadAllData();
    } catch (err) {
      setScanResultToast({
        type: 'error',
        message: `Falha na varredura de ${prefixStr}: ${err.message}`
      });
    } finally {
      setScanningPrefixId(null);
    }
  };

  // Disparar Varredura Manual de Todos os Prefixos (via Scanner Probes)
  const handleScanAllPrefixes = async () => {
    setScanningAllPrefixes(true);
    setScanResultToast(null);
    try {
      const res = await ipScannerService.scanAllPrefixes({ clientGroup: selectedClient });
      const st = res.stats || {};
      setActiveTab('ips');
      setScanResultToast({
        type: 'success',
        message: `Varredura em lote concluída em ${st.duration_seconds || 0}s! Prefixos escaneados: ${st.prefixes_scanned || 0}/${st.total_prefixes || 0} | Ativos: ${st.total_active || 0} (SNMP: ${st.total_snmp || 0}, Apenas Ping: ${st.total_icmp_only || 0}, Vinculados: ${st.matched_assets || 0})`
      });
      await loadAllData();
    } catch (err) {
      setScanResultToast({
        type: 'error',
        message: `Falha na varredura em lote dos prefixos: ${err.message}`
      });
    } finally {
      setScanningAllPrefixes(false);
    }
  };

  // Extrair VLANs dos backups no Oxidized (Manual)
  const handleExtractOxidizedVlans = async () => {
    setExtractingVlans(true);
    setScanResultToast(null);
    try {
      const res = await ipScannerService.extractOxidizedVlans({ clientGroup: selectedClient });
      const st = res.stats || {};
      setActiveTab('vlans');
      setScanResultToast({
        type: 'success',
        message: `Varredura de backups do Oxidized concluída! Equipamentos analisados: ${st.scanned_devices || 0} (${st.devices_with_vlans || 0} com VLANs) | Total de VLANs identificadas: ${st.total_vlans_extracted || 0} (+${st.vlans_created || 0} novas / ${st.vlans_updated || 0} atualizadas).`
      });
      await loadAllData();
    } catch (err) {
      setScanResultToast({
        type: 'error',
        message: `Falha ao extrair VLANs do Oxidized: ${err.message}`
      });
    } finally {
      setExtractingVlans(false);
    }
  };

  // Sincronizar Equipamentos, VLANs, Prefixos e IPs Descobertos com o phpIPAM (Manual)
  const handleSyncPhpIpam = async () => {
    setSyncingPhpIpam(true);
    setScanResultToast(null);
    try {
      const res = await ipScannerService.syncPhpIpam({ clientGroup: selectedClient });
      const st = res.stats || {};
      setScanResultToast({
        type: 'success',
        message: `phpIPAM sincronizado! Equipamentos: +${st.devices_created || 0}/${st.devices_updated || 0} | VLANs: +${st.vlans_created || 0}/${st.vlans_updated || 0} (${st.subnets_linked_to_vlans || 0} sub-redes associadas a VLANs) | Sub-redes: +${st.subnets_created || 0}/${st.subnets_updated || 0} | IPs: +${st.ips_created || 0}/${st.ips_updated || 0} (${st.ips_linked_to_devices || 0} vinculados a equipamentos).`
      });
      await loadAllData();
    } catch (err) {
      setScanResultToast({
        type: 'error',
        message: `Falha ao sincronizar com phpIPAM: ${err.message}`
      });
    } finally {
      setSyncingPhpIpam(false);
    }
  };

  // Abrir modal para Cadastrar Novo Prefixo
  const handleOpenNewPrefixModal = () => {
    setModalError('');
    setEditingPrefixId(null);
    setNewPrefix({ prefix: '', client_group: '', description: '', community_ids: [], probe_id: '' });
    setShowPrefixModal(true);
  };

  // Abrir modal para Editar Prefixo Existente
  const handleOpenEditPrefixModal = (pref) => {
    setModalError('');
    setEditingPrefixId(pref.id);
    const currentIds = Array.isArray(pref.community_ids) && pref.community_ids.length > 0
      ? pref.community_ids.map(Number)
      : (pref.community_id ? [Number(pref.community_id)] : []);
    setNewPrefix({
      prefix: pref.prefix || '',
      client_group: pref.client_group || '',
      description: pref.description || '',
      community_ids: currentIds,
      probe_id: pref.probe_id ? String(pref.probe_id) : ''
    });
    setShowPrefixModal(true);
  };

  // Alternar seleção de comunidade SNMP no modal do prefixo
  const handleToggleCommunityId = (commId) => {
    const idNum = Number(commId);
    setNewPrefix((prev) => {
      const exists = prev.community_ids.includes(idNum);
      return {
        ...prev,
        community_ids: exists
          ? prev.community_ids.filter((id) => id !== idNum)
          : [...prev.community_ids, idNum]
      };
    });
  };

  // Criar ou Editar Prefixo
  const handleSavePrefix = async (e) => {
    e.preventDefault();
    setModalError('');
    if (!newPrefix.prefix.trim() || !newPrefix.client_group.trim()) return;
    const payload = {
      prefix: newPrefix.prefix.trim(),
      client_group: newPrefix.client_group.trim().toLowerCase(),
      description: (newPrefix.description || '').trim(),
      community_ids: (newPrefix.community_ids || []).map(Number),
      probe_id: newPrefix.probe_id ? Number(newPrefix.probe_id) : null
    };
    try {
      if (editingPrefixId) {
        const updated = await ipScannerService.updatePrefix(editingPrefixId, payload);
        setShowPrefixModal(false);
        setEditingPrefixId(null);
        setNewPrefix({ prefix: '', client_group: '', description: '', community_ids: [], probe_id: '' });
        setScanResultToast({
          type: 'success',
          message: `Prefixo ${updated.prefix} (${updated.client_group.toUpperCase()}) atualizado com sucesso!`
        });
      } else {
        const created = await ipScannerService.createPrefix(payload);
        setShowPrefixModal(false);
        setNewPrefix({ prefix: '', client_group: '', description: '', community_ids: [], probe_id: '' });
        setSelectedClient('todos');
        setScanResultToast({
          type: 'success',
          message: `Prefixo ${created.prefix} (${created.client_group.toUpperCase()}) cadastrado! Clique em "Escanear Agora" na tabela abaixo para iniciar a descoberta.`
        });
      }
      await loadAllData();
    } catch (err) {
      setModalError(err.message || 'Erro ao salvar prefixo.');
    }
  };

  // Iniciar edição de comunidade SNMP
  const handleStartEditCommunity = (comm) => {
    setModalError('');
    setEditingCommunityId(comm.id);
    setNewCommunity({
      name: comm.name || '',
      community: comm.community || '',
      version: comm.version || '2c',
      port: comm.port || 161,
      is_default: Boolean(comm.is_default)
    });
  };

  // Cancelar edição de comunidade SNMP
  const handleCancelEditCommunity = () => {
    setModalError('');
    setEditingCommunityId(null);
    setNewCommunity({ name: '', community: '', version: '2c', port: 161, is_default: false });
  };

  // Criar ou Atualizar Comunidade
  const handleSaveCommunity = async (e) => {
    e.preventDefault();
    setModalError('');
    if (!newCommunity.name.trim() || !newCommunity.community.trim()) return;
    try {
      if (editingCommunityId) {
        await ipScannerService.updateCommunity(editingCommunityId, newCommunity);
        setEditingCommunityId(null);
      } else {
        await ipScannerService.createCommunity(newCommunity);
      }
      setNewCommunity({ name: '', community: '', version: '2c', port: 161, is_default: false });
      await loadAllData();
    } catch (err) {
      setModalError(err.message || 'Erro ao salvar comunidade.');
    }
  };

  // Excluir Prefixo
  const handleDeletePrefix = async (id, prefix) => {
    if (!window.confirm(`Deseja realmente remover o prefixo ${prefix} e todos os IPs descobertos dele?`)) return;
    try {
      await ipScannerService.deletePrefix(id);
      if (String(selectedPrefixId) === String(id)) {
        setSelectedPrefixId('');
      }
      await loadAllData();
    } catch (err) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  };

  // Excluir Comunidade
  const handleDeleteCommunity = async (id, name) => {
    if (!window.confirm(`Excluir a comunidade '${name}'?`)) return;
    try {
      await ipScannerService.deleteCommunity(id);
      await loadAllData();
    } catch (err) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  };

  // Gerenciamento de Probes / Agentes Remotos (Zabbix Proxy / phpIPAM)
  const handleStartEditProbe = (pr) => {
    setModalError('');
    setEditingProbeId(pr.id);
    setNewProbe({
      name: pr.name || '',
      url: pr.url || '',
      client_group: pr.client_group || '',
      phpipam_agent_code: pr.phpipam_agent_code || '',
      is_default: Boolean(pr.is_default)
    });
  };

  const handleCancelEditProbe = () => {
    setModalError('');
    setEditingProbeId(null);
    setNewProbe({ name: '', url: '', client_group: '', phpipam_agent_code: '', is_default: false });
  };

  const handleSaveProbe = async (e) => {
    e.preventDefault();
    setModalError('');
    if (!newProbe.name.trim() || !newProbe.url.trim()) return;
    try {
      if (editingProbeId) {
        await ipScannerService.updateProbe(editingProbeId, newProbe);
        setEditingProbeId(null);
      } else {
        await ipScannerService.createProbe(newProbe);
      }
      setNewProbe({ name: '', url: '', client_group: '', phpipam_agent_code: '', is_default: false });
      await loadAllData();
    } catch (err) {
      setModalError(err.message || 'Erro ao salvar probe.');
    }
  };

  const handleDeleteProbe = async (id, name) => {
    if (!window.confirm(`Excluir o agente/probe '${name}'?`)) return;
    try {
      await ipScannerService.deleteProbe(id);
      await loadAllData();
    } catch (err) {
      alert(`Erro ao excluir probe: ${err.message}`);
    }
  };

  const handleTestProbe = async (id) => {
    setTestingProbeId(id);
    try {
      const res = await ipScannerService.testProbe(id);
      setProbeTestResults((prev) => ({ ...prev, [id]: res }));
    } catch (err) {
      setProbeTestResults((prev) => ({
        ...prev,
        [id]: { status: 'offline', message: err.message }
      }));
    } finally {
      setTestingProbeId(null);
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)' }}>Gestão de Prefixos & Varredura de IPs</h1>
                <span
                  title="A descoberta pelos Scanner Probes e a varredura dos backups no Oxidized rodam automaticamente todos os dias às 04:00h da madrugada (horário de Brasília), além de poderem ser acionadas manualmente nos botões ao lado."
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: '9999px',
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    color: '#10b981'
                  }}
                >
                  Automático: 04:00h (Probes + Oxidized)
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Descoberta de rede via ICMP e SNMP com matching automático de equipamentos e sessões
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button 
            className="btn-secondary" 
            onClick={handleScanAllPrefixes}
            disabled={scanningAllPrefixes || allPrefixes.length === 0}
            title="Dispara manualmente agora a descoberta de IPs em todos os prefixos (ou do cliente selecionado) através dos Scanner Probes"
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', borderColor: 'rgba(245, 158, 11, 0.45)', color: '#f59e0b' }}
          >
            <Play size={15} className={scanningAllPrefixes ? 'spin-icon' : ''} />
            <span>{scanningAllPrefixes ? 'Escaneando Probes...' : 'Escanear Todos os Prefixos'}</span>
          </button>

          <button 
            className="btn-secondary" 
            onClick={handleExtractOxidizedVlans}
            disabled={extractingVlans}
            title="Varre os backups de configuração no Oxidized (MikroTik, Huawei, Datacom, Juniper) para extrair as VLANs dos equipamentos"
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', borderColor: 'rgba(59, 130, 246, 0.45)', color: '#60a5fa' }}
          >
            <Layers size={15} className={extractingVlans ? 'spin-icon' : ''} />
            <span>{extractingVlans ? 'Lendo Backups Oxidized...' : 'Extrair VLANs (Oxidized)'}</span>
          </button>

          <button 
            className="btn-secondary" 
            onClick={handleSyncPhpIpam}
            disabled={syncingPhpIpam}
            title="Envia equipamentos, VLANs, sub-redes e associa os IPs descobertos aos equipamentos no phpIPAM"
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', borderColor: 'rgba(16, 185, 129, 0.45)', color: '#10b981' }}
          >
            <RefreshCw size={15} className={syncingPhpIpam ? 'spin-icon' : ''} />
            <span>{syncingPhpIpam ? 'Sincronizando phpIPAM...' : 'Sincronizar phpIPAM'}</span>
          </button>

          <button 
            className="btn-secondary" 
            onClick={() => {
              setModalError('');
              setEditingProbeId(null);
              setNewProbe({ name: '', url: '', client_group: '', phpipam_agent_code: '', is_default: false });
              setShowProbeModal(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
          >
            <Server size={15} />
            <span>Probes / Agentes ({probes.length})</span>
          </button>

          <button 
            className="btn-secondary" 
            onClick={() => {
              setModalError('');
              setEditingCommunityId(null);
              setNewCommunity({ name: '', community: '', version: '2c', port: 161, is_default: false });
              setShowCommunityModal(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem' }}
          >
            <Key size={15} />
            <span>Comunidades SNMP ({communities.length})</span>
          </button>

          <button 
            className="btn-primary" 
            onClick={handleOpenNewPrefixModal}
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
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{allPrefixes.length}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Prefixos Cadastrados</div>
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

        <div 
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.1rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}
          onClick={() => setActiveTab('vlans')}
          title="Clique para visualizar as VLANs extraídas dos backups do Oxidized"
        >
          <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.14)', color: '#60a5fa' }}>
            <Network size={22} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>{stats.total_vlans || discoveredVlans.length || 0}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>VLANs (Oxidized)</div>
          </div>
        </div>
      </div>

      {/* Filtro Dinâmico de Clientes / Sessões (Mostra apenas os que têm prefixo associado) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 700, marginRight: '4px' }}>
            Cliente / Sessão:
          </span>
          {clientOptions.map((c) => (
            <button
              key={c}
              onClick={() => {
                setSelectedClient(c);
                setSelectedPrefixId('');
              }}
              style={{
                padding: '5px 14px',
                borderRadius: '9999px',
                border: selectedClient === c ? '1px solid var(--color-primary)' : '1px solid var(--border-medium)',
                background: selectedClient === c ? 'var(--color-primary)' : 'var(--bg-secondary)',
                color: selectedClient === c ? '#fff' : 'var(--text-main)',
                fontSize: '0.76rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'var(--transition-fast)'
              }}
            >
              {c === 'todos' ? `TODOS (${allPrefixes.length})` : c}
            </button>
          ))}
        </div>

        {selectedPrefixId && (
          <button
            className="btn-secondary"
            onClick={() => setSelectedPrefixId('')}
            style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <X size={13} />
            <span>Limpar filtro de sub-rede</span>
          </button>
        )}
      </div>

      {/* ==================================================================== */}
      {/* SEÇÃO 1: PREFIXOS CADASTRADOS & BOTÃO DE SCAN MANUAL                 */}
      {/* ==================================================================== */}
      <div style={{ marginBottom: '1.25rem' }}>
        <AccordionSection
          title={`Sub-redes / Prefixos Cadastrados (${filteredPrefixes.length})`}
          subtitle="Gerenciamento de blocos CIDR, comunidades SNMP e agentes de varredura"
          icon={Layers}
          defaultOpen={true}
          storageKey="ip_prefixes_acc"
          badge={
            selectedPrefixId ? (
              <span className="badge-tag-canonical" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                Filtro Ativo: {filteredPrefixes.find(p => String(p.id) === String(selectedPrefixId))?.prefix || selectedPrefixId}
              </span>
            ) : null
          }
          headerRight={
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {selectedPrefixId ? 'Clique para desmarcar filtro' : 'Clique no prefixo para filtrar'}
            </span>
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table className={`users-table ${density === 'compact' ? 'is-compact' : ''}`} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr>
              <th>Prefixo CIDR</th>
              <th>Cliente / Sessão</th>
              <th>Probe / Agente</th>
              <th>Comunidade SNMP</th>
              <th>Descrição</th>
              <th>Última Varredura</th>
              <th>Hosts Ativos</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredPrefixes.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  Nenhum prefixo cadastrado. Clique no botão <strong>"+ Cadastrar Prefixo"</strong> no topo direito.
                </td>
              </tr>
            ) : (
              filteredPrefixes.map((pref) => (
                <tr 
                  key={pref.id} 
                  style={{ 
                    background: String(selectedPrefixId) === String(pref.id) ? 'var(--color-primary-subtle)' : 'transparent',
                    cursor: 'pointer'
                  }}
                  onClick={() => setSelectedPrefixId(String(selectedPrefixId) === String(pref.id) ? '' : pref.id)}
                  title="Clique na linha para filtrar os IPs desta sub-rede abaixo"
                >
                  <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                    {pref.prefix}
                  </td>

                  <td>
                    <span style={{ textTransform: 'uppercase', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-border)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
                      {pref.client_group}
                    </span>
                  </td>

                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>
                    {pref.probe_name || 'Central (brdrive)'}
                  </td>

                  <td style={{ color: 'var(--text-main)', fontWeight: 500 }}>
                    {Array.isArray(pref.community_names) && pref.community_names.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {pref.community_names.map((cName, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-medium)',
                              color: 'var(--text-main)',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontSize: '0.73rem',
                              fontWeight: 600
                            }}
                          >
                            {cName}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {pref.community_name || 'Todas cadastradas'}
                      </span>
                    )}
                  </td>

                  <td style={{ color: 'var(--text-secondary)' }}>
                    {pref.description || '-'}
                  </td>

                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    {pref.last_scan_at ? new Date(pref.last_scan_at).toLocaleString('pt-BR') : 'Nunca escaneado'}
                  </td>

                  <td style={{ fontWeight: 700 }}>
                    <span style={{ background: (pref.total_hosts_found || 0) > 0 ? 'var(--color-success-bg)' : 'var(--bg-secondary)', color: (pref.total_hosts_found || 0) > 0 ? 'var(--color-success)' : 'var(--text-muted)', padding: '3px 10px', borderRadius: '9999px', fontSize: '0.75rem' }}>
                      {pref.total_hosts_found || 0} hosts
                    </span>
                  </td>

                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button
                        className="btn-primary"
                        style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', padding: '6px 14px' }}
                        onClick={() => handleScanPrefix(pref.id, pref.prefix)}
                        disabled={scanningPrefixId === pref.id}
                      >
                        <Play size={13} className={scanningPrefixId === pref.id ? 'spin-icon' : ''} />
                        <span>{scanningPrefixId === pref.id ? 'Escaneando...' : 'Escanear Agora'}</span>
                      </button>

                      <button
                        className="btn-secondary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem', padding: '6px 10px' }}
                        onClick={() => handleOpenEditPrefixModal(pref)}
                        title="Editar Prefixo e Comunidades SNMP"
                      >
                        <Edit2 size={14} />
                        <span>Editar</span>
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
        </AccordionSection>
      </div>

      {/* ==================================================================== */}
      {/* SEÇÃO 2: ABAS DE IPS DESCOBERTOS E VLANS EXTRAÍDAS (OXIDIZED)        */}
      {/* ==================================================================== */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.25rem', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setActiveTab('ips')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: activeTab === 'ips' ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                background: activeTab === 'ips' ? 'var(--color-primary-subtle)' : 'var(--bg-secondary)',
                color: activeTab === 'ips' ? 'var(--color-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <Server size={16} />
              <span>IPs Descobertos ({discoveredIps.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('vlans')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: activeTab === 'vlans' ? '1px solid #3b82f6' : '1px solid var(--border-subtle)',
                background: activeTab === 'vlans' ? 'rgba(59, 130, 246, 0.14)' : 'var(--bg-secondary)',
                color: activeTab === 'vlans' ? '#60a5fa' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <Layers size={16} />
              <span>VLANs via Oxidized ({discoveredVlans.length})</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '260px' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder={activeTab === 'vlans' ? "Buscar por VLAN ID, Nome ou Equipamento..." : "Buscar por IP, Hostname ou Modelo..."}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingLeft: '2.2rem', height: '36px' }}
                />
              </div>
              <button type="submit" className="btn-secondary" style={{ height: '36px', padding: '0 0.85rem' }}>
                Filtrar
              </button>
            </form>

            {activeTab === 'ips' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Filter size={15} style={{ color: 'var(--text-secondary)' }} />
                <select
                  className="form-input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ width: 'auto', height: '36px', padding: '0 0.85rem' }}
                >
                  <option value="all">Todos os Status</option>
                  <option value="snmp_and_icmp">SNMP + ICMP (Ativos Completos)</option>
                  <option value="icmp_only">Apenas Ping (Sem SNMP)</option>
                </select>
              </div>
            )}

            <DensityToggle
              storageKey="ip_table"
              density={density}
              onChange={setDensity}
            />
          </div>
        </div>

        {/* Table IPs vs Table VLANs */}
        {activeTab === 'ips' ? (
          <table className={`users-table ${density === 'compact' ? 'is-compact' : ''}`} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
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
                    Nenhum IP descoberto ainda para este filtro. Clique em <strong>"Escanear Agora"</strong> no prefixo desejado acima.
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
        ) : (
          <table className={`users-table ${density === 'compact' ? 'is-compact' : ''}`} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>VLAN ID</th>
                <th>Nome / Identificação</th>
                <th>Sub-rede L3 Associada</th>
                <th>Equipamentos & Interfaces (Backup Oxidized)</th>
                <th>Status phpIPAM</th>
                <th>Extraída em</th>
              </tr>
            </thead>
            <tbody>
              {discoveredVlans.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    Nenhuma VLAN extraída para este filtro. Clique no botão <strong>"Extrair VLANs (Oxidized)"</strong> no topo direito para varrer os backups.
                  </td>
                </tr>
              ) : (
                discoveredVlans.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span style={{ textTransform: 'uppercase', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-border)', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>
                        {v.client_group}
                      </span>
                    </td>

                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.86rem', color: '#60a5fa', background: 'rgba(59, 130, 246, 0.14)', border: '1px solid rgba(59, 130, 246, 0.35)', padding: '2px 9px', borderRadius: '6px' }}>
                        VLAN {v.vlan_id}
                      </span>
                    </td>

                    <td style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                      {v.name}
                    </td>

                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.79rem', color: 'var(--text-secondary)' }}>
                      {(() => {
                        const tunnels = [];
                        if (Array.isArray(v.devices)) {
                          v.devices.forEach((d) => {
                            (d.interfaces || []).forEach((iface) => {
                              if ((iface.startsWith('VPLS:') || iface.startsWith('VPWS:')) && !tunnels.includes(iface)) {
                                tunnels.push(iface);
                              }
                            });
                          });
                        }
                        const hasSubnets = Array.isArray(v.subnets) && v.subnets.length > 0;
                        if (!hasSubnets && tunnels.length === 0) {
                          return <span style={{ color: 'var(--text-muted)' }}>L2 Pura</span>;
                        }
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {hasSubnets && v.subnets.map((sub, idx) => (
                              <span key={`sub-${idx}`} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-main)' }}>
                                {sub}
                              </span>
                            ))}
                            {tunnels.slice(0, 2).map((tun, idx) => (
                              <span
                                key={`tun-${idx}`}
                                title={`Túnel MPLS L2VPN: ${tun}`}
                                style={{
                                  background: 'rgba(168, 85, 247, 0.14)',
                                  border: '1px solid rgba(168, 85, 247, 0.4)',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  color: '#c084fc',
                                  fontWeight: 700,
                                  fontSize: '0.73rem'
                                }}
                              >
                                {tun}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>

                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {Array.isArray(v.devices) && v.devices.map((d, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => d.asset_id && onSelectAsset && onSelectAsset(d.asset_id)}
                            title={`Equipamento: ${d.asset_name} (${d.model || ''}) | Interfaces: ${(d.interfaces || []).join(', ') || '-'} | IPs: ${(d.ips || []).join(', ') || '-'}`}
                            style={{
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-medium)',
                              borderRadius: '6px',
                              padding: '3px 8px',
                              cursor: d.asset_id ? 'pointer' : 'default',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              color: 'var(--text-main)',
                              fontSize: '0.76rem',
                              fontWeight: 600
                            }}
                          >
                            <Server size={12} style={{ color: 'var(--color-primary)' }} />
                            <span>{d.asset_name}</span>
                            {Array.isArray(d.interfaces) && d.interfaces.length > 0 && (
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontFamily: 'var(--font-mono)', fontSize: '0.71rem' }}>
                                ({d.interfaces.slice(0, 2).join(', ')})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </td>

                    <td>
                      {v.phpipam_vlan_id ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '3px 9px', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: 700 }}>
                          <CheckCircle2 size={12} />
                          Sincronizada (#{v.phpipam_vlan_id})
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>Pendente Sync</span>
                      )}
                    </td>

                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {v.last_extracted_at ? new Date(v.last_extracted_at).toLocaleString('pt-BR') : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ==================================================================== */}
      {/* MODAL: CADASTRAR / EDITAR PREFIXO                                    */}
      {/* ==================================================================== */}
      {showPrefixModal && (
        <div className="modal-overlay" onClick={() => setShowPrefixModal(false)}>
          <div className="modal-container" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-box">
                <Network size={20} className="modal-title-icon" />
                <h2 className="modal-title">
                  {editingPrefixId ? 'Editar Sub-rede / Prefixo' : 'Cadastrar Sub-rede / Prefixo'}
                </h2>
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
              <form onSubmit={handleSavePrefix} className="admin-create-form">
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Prefixo CIDR *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: 10.90.10.0/24 ou 192.168.0.0/24"
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
                    placeholder="Ex: iper, atm, athila, bkup..."
                    value={newPrefix.client_group}
                    onChange={(e) => setNewPrefix({ ...newPrefix, client_group: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Probe / Agente de Varredura (VM Zabbix Proxy)</label>
                  <select
                    className="form-input"
                    value={newPrefix.probe_id || ''}
                    onChange={(e) => setNewPrefix({ ...newPrefix, probe_id: e.target.value })}
                  >
                    <option value="">Automático (Usa o Probe do Cliente ou Central)</option>
                    {probes.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name} — {pr.url} {pr.client_group ? `[${pr.client_group.toUpperCase()}]` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      Comunidades SNMP Associadas ({(newPrefix.community_ids || []).length === 0 ? 'Todas' : `${newPrefix.community_ids.length} selecionada(s)`})
                    </label>
                    {communities.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setNewPrefix({ ...newPrefix, community_ids: communities.map((c) => Number(c.id)) })}
                          style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                        >
                          Marcar todas
                        </button>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>|</span>
                        <button
                          type="button"
                          onClick={() => setNewPrefix({ ...newPrefix, community_ids: [] })}
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                        >
                          Limpar seleção
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    Selecione apenas as comunidades desejadas para este prefixo. Se nenhuma for marcada, o scanner testará todas as cadastradas.
                  </div>

                  <div
                    style={{
                      maxHeight: '165px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-medium)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-secondary)',
                      padding: '0.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem'
                    }}
                  >
                    {communities.length === 0 ? (
                      <div style={{ padding: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
                        Nenhuma comunidade cadastrada ainda.
                      </div>
                    ) : (
                      communities.map((c) => {
                        const isChecked = (newPrefix.community_ids || []).includes(Number(c.id));
                        return (
                          <label
                            key={c.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: isChecked ? 'var(--color-primary-subtle)' : 'var(--bg-surface)',
                              border: isChecked ? '1px solid var(--color-primary)' : '1px solid var(--border-subtle)',
                              color: 'var(--text-main)',
                              fontSize: '0.83rem'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleCommunityId(c.id)}
                                style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                              />
                              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{c.name}</span>
                            </div>
                            <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                              {c.community}
                            </code>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">Descrição / Finalidade</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ex: Servidores e VMs"
                    value={newPrefix.description}
                    onChange={(e) => setNewPrefix({ ...newPrefix, description: e.target.value })}
                  />
                </div>

                <div className="form-actions-right" style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowPrefixModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.6rem 1.4rem' }}>
                    {editingPrefixId ? 'Salvar Alterações' : 'Salvar Prefixo'}
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
                          <tr
                            key={c.id}
                            style={{
                              background: editingCommunityId === c.id ? 'var(--color-primary-subtle)' : 'transparent'
                            }}
                          >
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
                              <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '4px 8px' }}
                                  onClick={() => handleStartEditCommunity(c)}
                                  title="Editar comunidade"
                                >
                                  <Edit2 size={13} />
                                  <span>Editar</span>
                                </button>
                                <button 
                                  type="button"
                                  className="btn-delete-user"
                                  onClick={() => handleDeleteCommunity(c.id, c.name)}
                                  title="Excluir comunidade"
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
              </div>

              {/* Formulário Nova / Editar Comunidade */}
              <form onSubmit={handleSaveCommunity} className="admin-create-form" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ margin: 0, color: 'var(--color-primary)' }}>
                    {editingCommunityId ? '✎ Editar Comunidade Selecionada' : '+ Adicionar Nova Comunidade'}
                  </label>
                  {editingCommunityId && (
                    <button
                      type="button"
                      onClick={handleCancelEditCommunity}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      Cancelar edição
                    </button>
                  )}
                </div>
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
                    {editingCommunityId ? 'Salvar Alterações' : 'Adicionar Comunidade'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: PROBES / AGENTES REMOTOS (VMs Zabbix Proxy + phpIPAM Agent)   */}
      {/* ==================================================================== */}
      {showProbeModal && (
        <div className="modal-overlay" onClick={() => setShowProbeModal(false)}>
          <div className="modal-container" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-box">
                <Server size={20} className="modal-title-icon" />
                <h2 className="modal-title">Probes de Varredura & Agentes nas VMs dos Clientes</h2>
              </div>
              <button className="btn-close-modal" onClick={() => setShowProbeModal(false)} title="Fechar">
                <X size={18} />
              </button>
            </div>

            {modalError && (
              <div className="alert-box alert-error" role="alert">
                <AlertCircle size={15} />
                <span>{modalError}</span>
              </div>
            )}

            <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                  Probes Cadastrados ({probes.length})
                </label>
                <div className="users-table-wrapper" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th>Nome do Probe</th>
                        <th>URL (Porta 8005)</th>
                        <th>Cliente</th>
                        <th style={{ textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {probes.map((pr) => {
                        const testRes = probeTestResults[pr.id];
                        return (
                          <tr
                            key={pr.id}
                            style={{
                              background: editingProbeId === pr.id ? 'var(--color-primary-subtle)' : 'transparent'
                            }}
                          >
                            <td>
                              <strong>{pr.name}</strong>
                              {pr.is_default && (
                                <span style={{ marginLeft: '6px', background: 'var(--color-success-bg)', color: 'var(--color-success)', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                  Padrão
                                </span>
                              )}
                              {testRes && (
                                <div style={{ fontSize: '0.72rem', marginTop: '3px', color: testRes.status === 'online' ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
                                  {testRes.message}
                                </div>
                              )}
                            </td>
                            <td><code>{pr.url}</code></td>
                            <td>
                              {pr.client_group ? (
                                <span style={{ textTransform: 'uppercase', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>
                                  {pr.client_group}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Geral</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '4px 8px' }}
                                  onClick={() => handleTestProbe(pr.id)}
                                  disabled={testingProbeId === pr.id}
                                  title="Testar conexão com o container ipersoft_scanner desta VM"
                                >
                                  <Activity size={13} />
                                  <span>{testingProbeId === pr.id ? '...' : 'Testar'}</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', padding: '4px 8px' }}
                                  onClick={() => handleStartEditProbe(pr)}
                                  title="Editar Probe"
                                >
                                  <Edit2 size={13} />
                                  <span>Editar</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn-delete-user"
                                  onClick={() => handleDeleteProbe(pr.id, pr.name)}
                                  title="Excluir Probe"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <form onSubmit={handleSaveProbe} className="admin-create-form" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ margin: 0, color: 'var(--color-primary)' }}>
                    {editingProbeId ? '✎ Editar Probe Selecionado' : '+ Cadastrar Novo Probe (VM Zabbix Proxy do Cliente)'}
                  </label>
                  {editingProbeId && (
                    <button
                      type="button"
                      onClick={handleCancelEditProbe}
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      Cancelar edição
                    </button>
                  )}
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Nome / Identificação *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: VM Zabbix Proxy - Inforline"
                      value={newProbe.name}
                      onChange={(e) => setNewProbe({ ...newProbe, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">URL do Scanner (Porta 8005) *</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: http://172.16.10.22:8005"
                      value={newProbe.url}
                      onChange={(e) => setNewProbe({ ...newProbe, url: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cliente / Sessão Padrão</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: inforline, lhtech, taionet..."
                      value={newProbe.client_group}
                      onChange={(e) => setNewProbe({ ...newProbe, client_group: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Key do phpipam-agent (Opcional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ex: a8f5f167f44f4964e6c998dee827110c"
                      value={newProbe.phpipam_agent_code}
                      onChange={(e) => setNewProbe({ ...newProbe, phpipam_agent_code: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '1rem', padding: '0.85rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                    📦 Como subir o Scanner + phpIPAM Agent na VM do Zabbix Proxy do Cliente:
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Na pasta <code>/opt/ipersoft/scanner/docker-compose.remote-agent.yml</code> já deixamos o stack pronto com os 2 containers:
                    <br />
                    1. <strong>ipersoft-scanner</strong> (porta <code>8005</code>): executa os scans SNMP + Ping sob demanda direto da VM do cliente.
                    <br />
                    2. <strong>phpipam-agent</strong> (cron 15m): faz os pings contínuos (<code>fping</code>) e atualiza o status Online/Offline direto no phpIPAM.
                  </div>
                </div>

                <div className="form-actions-right" style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowProbeModal(false)}>
                    Fechar
                  </button>
                  <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.6rem 1.4rem' }}>
                    {editingProbeId ? 'Salvar Alterações' : 'Adicionar Probe'}
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
