import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  RefreshCw, 
  Trash2, 
  Server, 
  Edit2, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Database,
  Terminal,
  ExternalLink,
  Layers,
  Check,
  AlertTriangle,
  Monitor,
  Key,
  Eye,
  EyeOff,
  Copy,
  Activity,
  Clock,
  XCircle,
  Radio,
  Cpu,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckSquare,
  HardDrive,
  PowerOff
} from 'lucide-react';
import { authService, diagnosticsService } from '../services/api';

// Função para ordenação natural de endereços IPv4
const parseIPv4 = (ipStr) => {
  if (!ipStr || typeof ipStr !== 'string') return null;
  const clean = ipStr.trim();
  const parts = clean.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) {
    return parts.map(Number);
  }
  return null;
};

const compareAssets = (a, b, field, direction) => {
  let diff = 0;
  if (field === 'ip') {
    const ipA = (a.ip_address || a.dns || '').trim();
    const ipB = (b.ip_address || b.dns || '').trim();
    const parsedA = parseIPv4(ipA);
    const parsedB = parseIPv4(ipB);

    if (parsedA && parsedB) {
      for (let i = 0; i < 4; i++) {
        if (parsedA[i] !== parsedB[i]) {
          diff = parsedA[i] - parsedB[i];
          break;
        }
      }
    } else if (parsedA && !parsedB) {
      diff = -1; // IPs válidos primeiro
    } else if (!parsedA && parsedB) {
      diff = 1;
    } else {
      diff = ipA.localeCompare(ipB, undefined, { numeric: true, sensitivity: 'base' });
    }
  } else if (field === 'name') {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    diff = nameA.localeCompare(nameB);
  }

  if (diff === 0) {
    diff = (a.name || '').localeCompare(b.name || '');
  }

  return direction === 'asc' ? diff : -diff;
};

// Retorna o status visual padronizado de uma integração: 'ok' (verde) | 'disabled' (cinza) | 'divergent' (laranja/âmbar) | 'error' (vermelho)
const getIntegrationBadge = (asset, type) => {
  if (type === 'zabbix') {
    // 1. Zabbix: Desativado na integração (Cinza)
    const isZbxDisabled = asset.status === 'unmonitored' || asset.zabbix?.status === 'unmonitored';
    if (isZbxDisabled) {
      return {
        label: 'Zabbix',
        status: 'disabled',
        tooltip: 'Monitoramento Zabbix desativado para este equipamento no IperSoft',
        dotColor: 'gray',
        hasCheck: false,
        hasAlert: false
      };
    }

    // 2. Zabbix: Ativo no IperSoft, verificar vínculo no Zabbix
    const hostId = asset.zabbix?.hostid || asset.external_id;
    const hasZbxHost = Boolean(hostId && hostId !== 'None');

    if (!hasZbxHost) {
      return {
        label: 'Zabbix',
        status: 'divergent',
        tooltip: 'Ativo no IperSoft, porém pendente de cadastro ou não vinculado no Zabbix Server',
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Verificar se há informações divergentes conhecidas
    if (asset.zabbix?.snmp_community && asset.snmp_community && 
        asset.zabbix.snmp_community.trim() !== asset.snmp_community.trim()) {
      return {
        label: 'Zabbix',
        status: 'divergent',
        tooltip: `Zabbix: Community SNMP divergente (Zabbix: ${asset.zabbix.snmp_community} vs IperSoft: ${asset.snmp_community})`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    if (asset.zabbix?.port && asset.port && 
        String(asset.zabbix.port).trim() !== String(asset.port).trim()) {
      return {
        label: 'Zabbix',
        status: 'divergent',
        tooltip: `Zabbix: Porta do agente divergente (Zabbix: ${asset.zabbix.port} vs IperSoft: ${asset.port})`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Ativo e Presente (Verde)
    return {
      label: 'Zabbix',
      status: 'ok',
      tooltip: `Cadastrado e ativo no Zabbix (HostID: ${hostId})`,
      dotColor: 'green',
      hasCheck: true,
      hasAlert: false
    };
  }

  if (type === 'guacamole') {
    // 1. Guacamole: Desativado na integração (Cinza)
    const isGuacDisabled = Boolean(asset.ignore_guacamole);
    if (isGuacDisabled) {
      return {
        label: 'Guacamole',
        status: 'disabled',
        tooltip: 'Acesso remoto Guacamole desativado/ignorado para este equipamento no IperSoft',
        dotColor: 'gray',
        hasCheck: false,
        hasAlert: false
      };
    }

    // 2. Guacamole: Ativo no IperSoft, verificar conexão
    const primaryGuac = (asset.guacamole && asset.guacamole.length > 0) ? asset.guacamole[0] : null;
    const connId = primaryGuac?.connection_id || asset.guacamole_connection_id;
    const hasRealGuac = Boolean(connId && !String(connId).startsWith('local-'));

    if (!hasRealGuac) {
      return {
        label: 'Guacamole',
        status: 'divergent',
        tooltip: 'Habilitado no IperSoft, porém sem conexão cadastrada no Apache Guacamole',
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Checar divergência de IP entre Guacamole e IperSoft
    const cleanAssetIp = (asset.ip_address || '').trim().toLowerCase();
    const cleanGuacIp = (primaryGuac?.hostname || '').trim().toLowerCase();
    if (cleanAssetIp && cleanGuacIp && cleanAssetIp !== '-' && cleanGuacIp !== cleanAssetIp) {
      return {
        label: 'Guacamole',
        status: 'divergent',
        tooltip: `Guacamole: Endereço IP divergente (Guacamole: ${cleanGuacIp} vs IperSoft: ${cleanAssetIp})`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Checar divergência de porta entre Guacamole e IperSoft
    if (primaryGuac?.port && asset.guacamole_port && 
        String(primaryGuac.port).trim() !== String(asset.guacamole_port).trim()) {
      return {
        label: 'Guacamole',
        status: 'divergent',
        tooltip: `Guacamole: Porta remota divergente (Guacamole: ${primaryGuac.port} vs IperSoft: ${asset.guacamole_port})`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    const remoteProto = (primaryGuac?.protocol || asset.guacamole_protocol || 'ssh').toUpperCase();
    const remotePort = primaryGuac?.port || asset.guacamole_port || '';

    // Ativo e Presente (Verde)
    return {
      label: 'Guacamole',
      status: 'ok',
      tooltip: `Terminal configurado no Guacamole (${remoteProto}${remotePort ? `:${remotePort}` : ''})`,
      dotColor: 'green',
      hasCheck: true,
      hasAlert: false
    };
  }

  if (type === 'oxidized') {
    // 1. Oxidized: Desativado na integração (Cinza)
    const isOxDisabled = asset.backup_enabled === false;
    if (isOxDisabled) {
      return {
        label: 'Oxidized',
        status: 'disabled',
        tooltip: 'Backup no Oxidized desativado para este equipamento no IperSoft',
        dotColor: 'gray',
        hasCheck: false,
        hasAlert: false
      };
    }

    // 2. Oxidized: Ativo no IperSoft, verificar nó no Oxidized
    const ox = asset.oxidized;
    if (!ox) {
      return {
        label: 'Oxidized',
        status: 'divergent',
        tooltip: `Backup habilitado no IperSoft, aguardando sincronização no Oxidized (${asset.backup_model || 'RouterOS'})`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Checar divergência de modelo de sistema operacional
    if (ox.model && asset.backup_model && 
        ox.model.trim().toLowerCase() !== asset.backup_model.trim().toLowerCase()) {
      return {
        label: 'Oxidized',
        status: 'divergent',
        tooltip: `Oxidized: Modelo de SO divergente (Oxidized: ${ox.model} vs IperSoft: ${asset.backup_model})`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Status do backup
    if (ox.status === 'success') {
      return {
        label: 'Oxidized',
        status: 'ok',
        tooltip: `Backup Oxidized: Em dia (${ox.model || asset.backup_model || 'RouterOS'})`,
        dotColor: 'green',
        hasCheck: true,
        hasAlert: false
      };
    }

    if (ox.status === 'fail' || ox.status === 'no_connection') {
      return {
        label: 'Oxidized',
        status: 'error',
        tooltip: `Backup Oxidized: Falha no último backup (${ox.status}) - ${ox.model || asset.backup_model || 'RouterOS'}`,
        dotColor: 'red',
        hasCheck: false,
        hasAlert: true
      };
    }

    // Outros status (never, pending, etc.)
    return {
      label: 'Oxidized',
      status: 'divergent',
      tooltip: `Backup Oxidized: Aguardando primeira coleta (${ox.status || 'Pendente'})`,
      dotColor: 'yellow',
      hasCheck: false,
      hasAlert: true
    };
  }

  return { label: type, status: 'disabled', tooltip: '', dotColor: 'gray', hasCheck: false, hasAlert: false };
};

export const AssetsList = ({ onOpenZabbix, isAdmin, onSelectAsset }) => {
  const [assets, setAssets] = useState([]);
  const [retestingId, setRetestingId] = useState(null);
  const [stats, setStats] = useState({ 
    total: 0, 
    monitored: 0, 
    unmonitored: 0, 
    with_zabbix: 0, 
    with_guacamole: 0, 
    with_both: 0, 
    missing_guacamole: 0, 
    missing_zabbix: 0, 
    groups_count: 0, 
    groups_list: [] 
  });
  
  // Navigation & Filter state
  const [viewMode, setViewMode] = useState('unified'); // 'unified' | 'zabbix' | 'guacamole'
  const [presenceFilter, setPresenceFilter] = useState('all'); // 'all' | 'both' | 'missing_guacamole' | 'missing_zabbix'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'monitored' | 'unmonitored'
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [guacBaseUrl, setGuacBaseUrl] = useState('');
  const [revealedPasswords, setRevealedPasswords] = useState({});

  // Ordenação & Duplicados
  const [sortField, setSortField] = useState('name'); // 'name' | 'ip'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);

  // Seleção múltipla para ações em lote
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [isBulkLoading, setIsBulkLoading] = useState(false);

  const handleToggleSelect = (assetId) => {
    setSelectedAssetIds(prev => 
      prev.includes(assetId) 
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    );
  };

  const handleSelectAllDisplayed = () => {
    const displayedIds = displayedAssets.map(a => a.id);
    const allSelected = displayedIds.length > 0 && displayedIds.every(id => selectedAssetIds.includes(id));
    if (allSelected) {
      setSelectedAssetIds(prev => prev.filter(id => !displayedIds.includes(id)));
    } else {
      setSelectedAssetIds(prev => Array.from(new Set([...prev, ...displayedIds])));
    }
  };

  const handleClearSelection = () => {
    setSelectedAssetIds([]);
  };

  const handleBulkIntegrationAction = async (integration, enable) => {
    if (selectedAssetIds.length === 0) return;
    const count = selectedAssetIds.length;
    const actionLabel = enable ? 'Ativar' : 'Desativar';
    const integNames = {
      zabbix: 'Zabbix',
      guacamole: 'Guacamole',
      oxidized: 'Oxidized'
    };
    const integName = integNames[integration] || integration;

    const confirmMsg = `Deseja realmente ${actionLabel.toLowerCase()} a integração ${integName} para os ${count} equipamentos selecionados?` +
      (integration === 'oxidized' && !enable ? ' O backup será desativado e os nós serão expurgados da memória do Oxidized imediatamente.' : '');

    if (!window.confirm(confirmMsg)) return;

    setIsBulkLoading(true);
    setFeedbackMsg(null);
    try {
      const payload = {
        asset_ids: selectedAssetIds
      };
      if (integration === 'zabbix') payload.zabbix_enabled = enable;
      if (integration === 'guacamole') payload.guacamole_enabled = enable;
      if (integration === 'oxidized') payload.oxidized_enabled = enable;

      await authService.bulkUpdateIntegrations(payload);
      setFeedbackMsg({
        type: 'success',
        text: `${count} equipamentos atualizados: ${integName} ${enable ? 'ativado' : 'desativado'} com sucesso!`
      });
      setSelectedAssetIds([]);
      await loadAssets();
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: err.message || `Erro ao atualizar integração ${integName} em lote.`
      });
    } finally {
      setIsBulkLoading(false);
    }
  };

  // Edit Asset Modal state
  const [editingAsset, setEditingAsset] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    hostname: '',
    ip_address: '',
    client_group: '',
    port: '',
    snmp_community: '',
    guacamole_connection_id: '',
    guacamole_protocol: 'ssh',
    guacamole_username: '',
    guacamole_password: '',
    backup_model: 'RouterOS',
    backup_enabled: true,
    status: 'monitored',
    sync_zabbix: true
  });
  const [isSaving, setIsSaving] = useState(false);

  const toggleShowPass = (id) => {
    setRevealedPasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setFeedbackMsg({ type: 'success', text: 'Senha copiada para a área de transferência!' });
  };

  // Mapeamento de IPs duplicados
  const duplicateIpMap = useMemo(() => {
    const counts = {};
    assets.forEach((asset) => {
      const ip = asset.ip_address?.trim();
      if (ip && ip !== '-' && ip !== '127.0.0.1' && ip !== 'localhost') {
        counts[ip] = (counts[ip] || 0) + 1;
      }
    });
    return counts;
  }, [assets]);

  // Contagem de equipamentos que compartilham IP duplicado
  const duplicateAssetsCount = useMemo(() => {
    let count = 0;
    Object.values(duplicateIpMap).forEach((c) => {
      if (c > 1) count += c;
    });
    return count;
  }, [duplicateIpMap]);

  // Quantidade de IPs distintos que estão duplicados
  const duplicateDistinctIpsCount = useMemo(() => {
    return Object.values(duplicateIpMap).filter((c) => c > 1).length;
  }, [duplicateIpMap]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleToggleDuplicatesFilter = () => {
    if (!showOnlyDuplicates) {
      setShowOnlyDuplicates(true);
      setSortField('ip');
      setSortDirection('asc');
    } else {
      setShowOnlyDuplicates(false);
    }
  };

  const displayedAssets = useMemo(() => {
    let list = [...assets];
    if (showOnlyDuplicates) {
      list = list.filter((asset) => {
        const ip = asset.ip_address?.trim();
        return ip && duplicateIpMap[ip] > 1;
      });
    }
    list.sort((a, b) => compareAssets(a, b, sortField, sortDirection));
    return list;
  }, [assets, showOnlyDuplicates, duplicateIpMap, sortField, sortDirection]);

  const renderSortHeader = (label, field, extraStyle = {}) => {
    const isActive = sortField === field;
    return (
      <th
        className="sortable-th"
        style={extraStyle}
        onClick={() => handleSort(field)}
        title={`Clique para ordenar por ${label} (${isActive && sortDirection === 'asc' ? 'Decrescente' : 'Crescente'})`}
      >
        <div className="th-sort-wrapper">
          <span>{label}</span>
          {isActive ? (
            sortDirection === 'asc' ? (
              <ArrowUp size={13} className="sort-icon-active" />
            ) : (
              <ArrowDown size={13} className="sort-icon-active" />
            )
          ) : (
            <ArrowUpDown size={12} className="sort-icon-inactive" />
          )}
        </div>
      </th>
    );
  };

  useEffect(() => {
    // Carregar URL base do Guacamole se configurada
    authService.getGuacamoleConfig()
      .then(cfg => {
        if (cfg && cfg.url) {
          let clean = cfg.url.trim().replace(/\/+$/, '');
          if (!clean.endsWith('/guacamole') && !clean.includes('/guacamole/')) {
            clean = `${clean}/guacamole`;
          }
          setGuacBaseUrl(clean);
        }
      })
      .catch(() => {});
  }, []);

  const getGuacamoleLaunchUrl = (asset) => {
    if (!guacBaseUrl) return null;
    const connId = (asset.guacamole && asset.guacamole.length > 0) 
      ? asset.guacamole[0].connection_id 
      : asset.guacamole_connection_id;
    if (!connId) return null;
    return `${guacBaseUrl}/#/client/${connId}`;
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [assetsData, statsData, guacCfg] = await Promise.all([
        authService.getAssets({ 
          search: searchTerm, 
          group: selectedGroup,
          status: statusFilter === 'all' ? undefined : statusFilter,
          presence: presenceFilter === 'all' ? undefined : presenceFilter,
          sort_by: sortField === 'ip' ? 'ip' : 'name',
          sort_dir: sortDirection
        }),
        authService.getAssetStats(),
        authService.getGuacamoleConfig().catch(() => null)
      ]);
      setAssets(assetsData);
      setStats(statsData);
      if (guacCfg && guacCfg.url) {
        let clean = guacCfg.url.trim().replace(/\/+$/, '');
        if (!clean.endsWith('/guacamole') && !clean.includes('/guacamole/')) {
          clean = `${clean}/guacamole`;
        }
        setGuacBaseUrl(clean);
      }
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Erro ao carregar ativos.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedGroup, statusFilter, presenceFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadData();
  };

  const handleToggleStatus = async (asset) => {
    const currentStatus = asset.zabbix ? asset.zabbix.status : asset.status;
    const nextStatus = currentStatus === 'monitored' ? 'unmonitored' : 'monitored';
    const actionLabel = nextStatus === 'unmonitored' ? 'desativar' : 'reativar';
    
    if (!window.confirm(`Deseja ${actionLabel} o monitoramento do ativo "${asset.name}" no IperSoft e no Zabbix Server?`)) {
      return;
    }

    try {
      const res = await authService.toggleAssetStatus(asset.id, nextStatus, true);
      setFeedbackMsg({ type: 'success', text: res.message });
      loadData();
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Falha ao alterar status.' });
    }
  };

  const handleOpenEdit = (asset) => {
    setEditingAsset(asset);
    const primaryGuac = (asset.guacamole && asset.guacamole.length > 0) ? asset.guacamole[0] : null;
    setEditForm({
      name: asset.name || '',
      hostname: asset.hostname || '',
      ip_address: asset.ip_address || '',
      client_group: asset.client_group || (asset.host_groups?.[0] || ''),
      port: (asset.zabbix && asset.zabbix.port) || asset.port || '10050',
      snmp_community: (asset.zabbix && asset.zabbix.snmp_community) || asset.snmp_community || 'ipermonitor',
      guacamole_connection_id: primaryGuac ? primaryGuac.connection_id : (asset.guacamole_connection_id || ''),
      guacamole_protocol: primaryGuac ? primaryGuac.protocol : (asset.guacamole_protocol || 'ssh'),
      guacamole_port: primaryGuac ? (primaryGuac.port || '22') : (asset.guacamole_port || '22'),
      guacamole_username: primaryGuac ? (primaryGuac.username || '') : '',
      guacamole_password: primaryGuac ? (primaryGuac.password || '') : '',
      backup_model: asset.backup_model || (asset.oxidized ? asset.oxidized.model : 'RouterOS'),
      backup_enabled: asset.backup_enabled !== false,
      status: (asset.zabbix && asset.zabbix.status) || asset.status || 'monitored',
      sync_zabbix: true,
      sync_guacamole: true
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingAsset) return;

    setIsSaving(true);
    try {
      await authService.updateAsset(editingAsset.id, editForm);
      setFeedbackMsg({ type: 'success', text: `Ativo "${editForm.name}" atualizado com sucesso.` });
      setEditingAsset(null);
      loadData();
    } catch (err) {
      alert(err.message || 'Erro ao atualizar ativo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (asset) => {
    if (!window.confirm(`Excluir o ativo "${asset.name}" da base do IperSoft? (O Zabbix e Guacamole não serão afetados)`)) return;
    try {
      await authService.deleteAsset(asset.id);
      setFeedbackMsg({ type: 'success', text: `Ativo "${asset.name}" removido da base IperSoft.` });
      loadData();
    } catch (err) {
      alert(err.message || 'Erro ao excluir ativo.');
    }
  };

  const handleQuickTest = async (asset) => {
    setRetestingId(asset.id);
    try {
      await diagnosticsService.testAsset(asset.id);
      setFeedbackMsg({ type: 'success', text: `Testes de conectividade concluídos para "${asset.name}".` });
      loadData();
    } catch (err) {
      alert(err.message || 'Erro ao executar teste de conectividade.');
    } finally {
      setRetestingId(null);
    }
  };

  return (
    <div className="assets-section">
      {/* Top Header */}
      <div className="assets-header-bar">
        <div>
          <h2 className="section-title">Inventário de Ativos de Rede</h2>
          <p className="dashboard-sub">
            Hub unificado de dispositivos • Monitoramento Zabbix & Acesso Remoto Guacamole
          </p>
        </div>

        <div className="assets-header-actions">
          <button 
            className="btn-secondary" 
            onClick={loadData}
            title="Atualizar dados"
          >
            <RefreshCw size={14} className={isLoading ? 'spin-icon' : ''} />
            <span>Atualizar Dados</span>
          </button>
        </div>
      </div>

      {/* Overview Statistics Strip */}
      <div className="status-strip" style={{ marginBottom: '1rem' }}>
        <div 
          className={`status-item clickable-stat ${presenceFilter === 'all' && statusFilter === 'all' ? 'active-stat' : ''}`}
          onClick={() => { setPresenceFilter('all'); setStatusFilter('all'); }}
          title="Ver todos os ativos cadastrados"
        >
          <span className="status-label">Total Unificado</span>
          <span className="status-value">{stats.total}</span>
        </div>

        <div 
          className={`status-item clickable-stat ${presenceFilter === 'both' ? 'active-stat' : ''}`}
          onClick={() => setPresenceFilter('both')}
          title="Equipamentos cadastrados no Zabbix E no Guacamole"
        >
          <span className="status-label">Integrados (Ambos)</span>
          <span className="status-value online">
            <span className="dot-online"></span> {stats.with_both}
          </span>
        </div>

        <div 
          className={`status-item clickable-stat ${presenceFilter === 'missing_guacamole' ? 'active-stat' : ''}`}
          onClick={() => setPresenceFilter('missing_guacamole')}
          title="Equipamentos no Zabbix que ainda NÃO possuem terminal no Guacamole"
        >
          <span className="status-label">Falta no Guacamole</span>
          <span className="status-value" style={{ color: 'var(--color-primary)' }}>
            {stats.missing_guacamole}
          </span>
        </div>

        <div 
          className={`status-item clickable-stat ${presenceFilter === 'missing_zabbix' ? 'active-stat' : ''}`}
          onClick={() => setPresenceFilter('missing_zabbix')}
          title="Equipamentos no Guacamole que ainda NÃO estão monitorados no Zabbix"
        >
          <span className="status-label">Falta no Zabbix</span>
          <span className="status-value" style={{ color: 'var(--text-muted)' }}>
            {stats.missing_zabbix}
          </span>
        </div>

        <div className="status-item">
          <span className="status-label">Grupos Zabbix</span>
          <span className="status-value">{stats.groups_count}</span>
        </div>

        <div 
          className={`status-item clickable-stat ${showOnlyDuplicates ? 'active-stat' : ''}`}
          onClick={handleToggleDuplicatesFilter}
          title="Clique para filtrar apenas equipamentos com endereços IP duplicados"
        >
          <span className="status-label">IPs Duplicados</span>
          <span className="status-value" style={{ color: duplicateAssetsCount > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
            {duplicateAssetsCount > 0 && <Copy size={13} style={{ marginRight: 4, display: 'inline' }} />}
            {duplicateAssetsCount}
          </span>
        </div>
      </div>

      {/* VIEW MODE SELECTOR (Unified / Zabbix / Guacamole) */}
      <div className="view-mode-bar">
        <div className="view-mode-tabs">
          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'unified' ? 'active' : ''}`}
            onClick={() => setViewMode('unified')}
          >
            <Layers size={15} />
            <span>Visão Unificada</span>
            <span className="tab-count">{stats.total}</span>
          </button>

          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'zabbix' ? 'active' : ''}`}
            onClick={() => setViewMode('zabbix')}
          >
            <Server size={15} />
            <span>Monitoramento Zabbix</span>
            <span className="tab-count">{stats.with_zabbix}</span>
          </button>

          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'guacamole' ? 'active' : ''}`}
            onClick={() => setViewMode('guacamole')}
          >
            <Terminal size={15} />
            <span>Acesso Remoto Guacamole</span>
            <span className="tab-count">{stats.with_guacamole}</span>
          </button>
        </div>

        {/* Presence Quick Filter Chips */}
        <div className="presence-filter-bar">
          <button
            type="button"
            className={`presence-filter-chip ${presenceFilter === 'all' && !showOnlyDuplicates ? 'active' : ''}`}
            onClick={() => {
              setShowOnlyDuplicates(false);
              setPresenceFilter('all');
            }}
          >
            Todos ({stats.total})
          </button>
          <button
            type="button"
            className={`presence-filter-chip ${presenceFilter === 'both' ? 'active' : ''}`}
            onClick={() => {
              setShowOnlyDuplicates(false);
              setPresenceFilter('both');
            }}
            title="Presente em ambos os sistemas"
          >
            <Check size={12} color="var(--color-success)" />
            Ambos ({stats.with_both})
          </button>
          <button
            type="button"
            className={`presence-filter-chip ${presenceFilter === 'missing_guacamole' ? 'active' : ''}`}
            onClick={() => {
              setShowOnlyDuplicates(false);
              setPresenceFilter('missing_guacamole');
            }}
            title="Falta cadastrar terminal no Guacamole"
          >
            <AlertTriangle size={12} color="var(--color-primary)" />
            Sem Guacamole ({stats.missing_guacamole})
          </button>
          <button
            type="button"
            className={`presence-filter-chip ${presenceFilter === 'missing_zabbix' ? 'active' : ''}`}
            onClick={() => {
              setShowOnlyDuplicates(false);
              setPresenceFilter('missing_zabbix');
            }}
            title="Falta monitorar no Zabbix"
          >
            <AlertTriangle size={12} color="var(--text-muted)" />
            Sem Zabbix ({stats.missing_zabbix})
          </button>
          <button
            type="button"
            className={`presence-filter-chip duplicate-filter-chip ${showOnlyDuplicates ? 'active' : ''}`}
            onClick={handleToggleDuplicatesFilter}
            title={showOnlyDuplicates ? "Clique para exibir todos os equipamentos" : "Clique para filtrar equipamentos com IP duplicado e agrupá-los por IP"}
          >
            <Copy size={12} color="#f59e0b" />
            IPs Duplicados ({duplicateAssetsCount})
          </button>
        </div>
      </div>

      {/* Filter toolbar: Search + Group Dropdown + Status Toggle */}
      <div className="assets-filters-bar">
        {/* Status Mode Tabs */}
        <div className="status-filter-tabs">
          <button
            type="button"
            className={`status-filter-tab ${statusFilter === 'monitored' ? 'active' : ''}`}
            onClick={() => setStatusFilter('monitored')}
          >
            <span className="dot-online" style={{ marginRight: 5 }}></span>
            <span>Ativos ({stats.monitored})</span>
          </button>
          <button
            type="button"
            className={`status-filter-tab ${statusFilter === 'unmonitored' ? 'active' : ''}`}
            onClick={() => setStatusFilter('unmonitored')}
          >
            <span>Inativos ({stats.unmonitored})</span>
          </button>
          <button
            type="button"
            className={`status-filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <span>Todos Status</span>
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="search-box-form">
          <div className="input-wrapper search-wrapper">
            <Search size={15} className="input-icon" />
            <input
              type="text"
              className="form-input search-input"
              placeholder="Buscar por nome, host, IP ou community..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </form>

        {/* Group select */}
        <div className="group-filter-box">
          <Filter size={14} className="filter-icon" />
          <select
            className="form-input group-select"
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
          >
            <option value="">Todos os Grupos ({stats.groups_count})</option>
            {(stats.groups_list || []).map((g, idx) => (
              <option key={idx} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {/* Quick Sort Controls */}
        <div className="quick-sort-group">
          <button
            type="button"
            className={`sort-action-btn ${sortField === 'ip' ? 'active' : ''}`}
            onClick={() => handleSort('ip')}
            title="Ordenar a lista por endereço IP"
          >
            <ArrowUpDown size={13} />
            <span>IP {sortField === 'ip' ? (sortDirection === 'asc' ? '↑ (0-9)' : '↓ (9-0)') : ''}</span>
          </button>
          <button
            type="button"
            className={`sort-action-btn ${sortField === 'name' ? 'active' : ''}`}
            onClick={() => handleSort('name')}
            title="Ordenar a lista por Nome alfabético"
          >
            <span>Nome {sortField === 'name' ? (sortDirection === 'asc' ? 'A-Z' : 'Z-A') : ''}</span>
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div className={`alert-box alert-${feedbackMsg.type}`} style={{ marginBottom: '1rem' }}>
          {feedbackMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{feedbackMsg.text}</span>
          <button 
            type="button" 
            onClick={() => setFeedbackMsg(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {showOnlyDuplicates && (
        <div className="duplicate-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} color="#f59e0b" />
            <span>
              Exibindo <strong>{displayedAssets.length} equipamentos</strong> com endereços IP duplicados ({duplicateDistinctIpsCount} IPs compartilhados), agrupados e ordenados por IP.
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
            onClick={() => setShowOnlyDuplicates(false)}
          >
            Ver Todos os Equipamentos
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* BARRA DE AÇÕES EM LOTE QUANDO HÁ SELEÇÃO */}
      {/* ========================================================================= */}
      {selectedAssetIds.length > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-info">
            <CheckSquare size={16} color="#60a5fa" />
            <span className="bulk-count">
              {selectedAssetIds.length} {selectedAssetIds.length === 1 ? 'equipamento selecionado' : 'equipamentos selecionados'}
            </span>
            <button type="button" className="btn-bulk-text" onClick={handleSelectAllDisplayed}>
              {displayedAssets.length > 0 && displayedAssets.every(a => selectedAssetIds.includes(a.id))
                ? 'Desmarcar Exibidos' 
                : `Selecionar Todos Exibidos (${displayedAssets.length})`}
            </button>
            <button type="button" className="btn-bulk-text" onClick={handleClearSelection}>
              Limpar Seleção
            </button>
          </div>

          <div className="bulk-actions-buttons">
            {/* Zabbix */}
            <div className="bulk-action-group">
              <span className="bulk-group-label">Zabbix:</span>
              <button 
                type="button" 
                className="btn-bulk-action btn-bulk-enable"
                onClick={() => handleBulkIntegrationAction('zabbix', true)}
                disabled={isBulkLoading}
                title="Ativar monitoramento no Zabbix para os equipamentos selecionados"
              >
                <Activity size={13} /> Ativar
              </button>
              <button 
                type="button" 
                className="btn-bulk-action btn-bulk-disable"
                onClick={() => handleBulkIntegrationAction('zabbix', false)}
                disabled={isBulkLoading}
                title="Desativar monitoramento no Zabbix para os equipamentos selecionados"
              >
                <PowerOff size={13} /> Desativar
              </button>
            </div>

            {/* Guacamole */}
            <div className="bulk-action-group">
              <span className="bulk-group-label">Guacamole:</span>
              <button 
                type="button" 
                className="btn-bulk-action btn-bulk-enable"
                onClick={() => handleBulkIntegrationAction('guacamole', true)}
                disabled={isBulkLoading}
                title="Ativar acesso remoto no Apache Guacamole para os equipamentos selecionados"
              >
                <Terminal size={13} /> Ativar
              </button>
              <button 
                type="button" 
                className="btn-bulk-action btn-bulk-disable"
                onClick={() => handleBulkIntegrationAction('guacamole', false)}
                disabled={isBulkLoading}
                title="Desativar/ignorar acesso no Guacamole para os equipamentos selecionados"
              >
                <PowerOff size={13} /> Desativar
              </button>
            </div>

            {/* Oxidized */}
            <div className="bulk-action-group">
              <span className="bulk-group-label">Oxidized:</span>
              <button 
                type="button" 
                className="btn-bulk-action btn-bulk-enable"
                onClick={() => handleBulkIntegrationAction('oxidized', true)}
                disabled={isBulkLoading}
                title="Ativar backup no Oxidized para os equipamentos selecionados"
              >
                <HardDrive size={13} /> Ativar
              </button>
              <button 
                type="button" 
                className="btn-bulk-action btn-bulk-disable"
                onClick={() => handleBulkIntegrationAction('oxidized', false)}
                disabled={isBulkLoading}
                title="Desativar backup e expurgar nós do daemon do Oxidized para os selecionados"
              >
                <PowerOff size={13} /> Desativar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TABELA DE ATIVOS: RENDERIZAÇÃO CONFORME VIEW MODE */}
      {/* ========================================================================= */}
      <div className="assets-table-container">
        {displayedAssets.length === 0 ? (
          <div className="empty-assets-card">
            <Database size={32} className="empty-icon" />
            <h3>Nenhum ativo encontrado</h3>
            <p>
              {showOnlyDuplicates 
                ? 'Nenhum equipamento com endereço IP duplicado encontrado.' 
                : 'Não foram encontrados equipamentos para os filtros selecionados.'}
            </p>
          </div>
        ) : (
          <table className="users-table assets-table">
            {/* 1. VISÃO PRINCIPAL LIMPA: EQUIPAMENTO, SINCRONIZAÇÃO E TESTES */}
            {viewMode === 'unified' && (
              <>
                <thead>
                  <tr>
                    <th className="checkbox-cell">
                      <input 
                        type="checkbox" 
                        className="asset-checkbox"
                        checked={displayedAssets.length > 0 && displayedAssets.every(a => selectedAssetIds.includes(a.id))}
                        onChange={handleSelectAllDisplayed}
                        title="Selecionar / Desmarcar todos os exibidos"
                      />
                    </th>
                    {renderSortHeader('Equipamento', 'name')}
                    {renderSortHeader('Endereço IP', 'ip')}
                    <th>Plataformas Sincronizadas</th>
                    <th>Status dos Testes de Conectividade</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAssets.map((asset) => {
                    const hasZbx = Boolean(asset.zabbix || asset.external_id);
                    const hasGuac = Boolean((asset.guacamole && asset.guacamole.length > 0) || asset.guacamole_connection_id);
                    const zbx = asset.zabbix;
                    const primaryGuac = (asset.guacamole && asset.guacamole.length > 0) ? asset.guacamole[0] : null;
                    const remoteProto = (primaryGuac?.protocol || asset.guacamole_protocol || 'ssh').toUpperCase();
                    const cleanIp = asset.ip_address?.trim();
                    const isDup = cleanIp && cleanIp !== '-' && duplicateIpMap[cleanIp] > 1;

                    return (
                      <tr 
                        key={asset.id} 
                        className={`clickable-asset-row ${isDup ? 'row-duplicate-ip' : ''} ${selectedAssetIds.includes(asset.id) ? 'row-selected' : ''}`}
                        onClick={(e) => {
                          // Evita disparar se clicou num botão específico ou checkbox
                          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
                          if (onSelectAsset) onSelectAsset(asset.id);
                        }}
                      >
                        <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            className="asset-checkbox"
                            checked={selectedAssetIds.includes(asset.id)}
                            onChange={() => handleToggleSelect(asset.id)}
                          />
                        </td>
                        {/* EQUIPAMENTO */}
                        <td>
                          <div className="asset-name-cell">
                            <span className="asset-visible-name" style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                              {asset.name}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="asset-hostname" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                                {asset.hostname}
                              </span>
                              {(asset.client_group || (asset.host_groups && asset.host_groups[0])) && (
                                <span 
                                  style={{ 
                                    fontSize: '0.68rem', 
                                    padding: '1px 6px', 
                                    borderRadius: '4px', 
                                    background: 'rgba(255, 255, 255, 0.07)', 
                                    color: 'var(--color-primary)',
                                    fontWeight: 500
                                  }}
                                  title="Empresa / Host Group / Pasta Guacamole"
                                >
                                  {asset.client_group || asset.host_groups[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* ENDEREÇO IP */}
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                            <code style={{ fontSize: '0.82rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                              {asset.ip_address || asset.dns || '-'}
                            </code>
                            {isDup && (
                              <span 
                                className="duplicate-ip-tag" 
                                title={`Endereço IP compartilhado por ${duplicateIpMap[cleanIp]} equipamentos na base`}
                              >
                                <Copy size={10} /> Duplicado ({duplicateIpMap[cleanIp]}x)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* PLATAFORMAS SINCRONIZADAS */}
                        <td>
                          <div className="presence-badge-pair">
                            {['zabbix', 'guacamole', 'oxidized'].map((itype) => {
                              const badge = getIntegrationBadge(asset, itype);
                              return (
                                <span 
                                  key={itype}
                                  className={`presence-pill presence-status-${badge.status}`} 
                                  title={badge.tooltip}
                                >
                                  <span className={`presence-dot ${badge.dotColor}`}></span>
                                  {badge.label}
                                  {badge.hasCheck && <Check size={10} style={{ marginLeft: 2 }} />}
                                  {badge.hasAlert && <AlertTriangle size={10} style={{ marginLeft: 2 }} />}
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        {/* STATUS DOS TESTES */}
                        <td>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* PING */}
                            {zbx?.icmp_status === 'ok' ? (
                              <span className="status-pill-ok" title={zbx.icmp_latency_ms ? `Latência: ${zbx.icmp_latency_ms} ms` : 'Ping OK'}>
                                <CheckCircle2 size={11} /> Ping {zbx.icmp_latency_ms ? `${zbx.icmp_latency_ms}ms` : 'OK'}
                              </span>
                            ) : zbx?.icmp_status === 'timeout' ? (
                              <span className="status-pill-timeout" title="Tempo limite esgotado">
                                <Clock size={11} /> Ping Timeout
                              </span>
                            ) : zbx?.icmp_status === 'failed' ? (
                              <span className="status-pill-fail" title="Falha de comunicação">
                                <XCircle size={11} /> Ping Falhou
                              </span>
                            ) : (
                              <span className="status-pill-none" title="Não testado">Ping -</span>
                            )}

                            {/* SNMP */}
                            {zbx?.snmp_status === 'ok' ? (
                              <span className="status-pill-ok" title={zbx.snmp_message || 'SNMP OK'}>
                                <CheckCircle2 size={11} /> SNMP OK
                              </span>
                            ) : zbx?.snmp_status === 'timeout' ? (
                              <span className="status-pill-timeout" title={zbx.snmp_message || 'Timeout SNMP'}>
                                <Clock size={11} /> SNMP Timeout
                              </span>
                            ) : zbx?.snmp_status === 'failed' ? (
                              <span className="status-pill-fail" title={zbx.snmp_message || 'Falha SNMP'}>
                                <XCircle size={11} /> SNMP Falhou
                              </span>
                            ) : (
                              <span className="status-pill-none" title="Não testado">SNMP -</span>
                            )}

                            {/* ACESSO REMOTO (SSH / TELNET / RDP) */}
                            {primaryGuac ? (
                              primaryGuac.tcp_status === 'ok' ? (
                                <span className="status-pill-ok" title={`Porta ${primaryGuac.port} aberta (${primaryGuac.tcp_latency_ms || ''}ms)`}>
                                  <CheckCircle2 size={11} /> {remoteProto} OK
                                </span>
                              ) : primaryGuac.tcp_status === 'timeout' ? (
                                <span className="status-pill-timeout" title="Timeout de conexão TCP">
                                  <Clock size={11} /> {remoteProto} Timeout
                                </span>
                              ) : primaryGuac.tcp_status === 'failed' ? (
                                <span className="status-pill-fail" title="Porta fechada ou inacessível">
                                  <XCircle size={11} /> {remoteProto} Falhou
                                </span>
                              ) : (
                                <span className="status-pill-none">{remoteProto} -</span>
                              )
                            ) : null}
                          </div>
                        </td>

                        {/* AÇÕES */}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn-open-detail"
                              onClick={() => onSelectAsset && onSelectAsset(asset.id)}
                              title="Abrir tela de detalhes e sincronização do equipamento"
                            >
                              <Edit2 size={13} />
                              <span>Ver Detalhes</span>
                            </button>

                            <button
                              type="button"
                              className="btn-icon"
                              onClick={() => handleQuickTest(asset)}
                              disabled={retestingId === asset.id}
                              title="Testar conectividade agora"
                              style={{ display: 'inline-flex', padding: '0.35rem 0.5rem' }}
                            >
                              <Activity size={13} className={retestingId === asset.id ? 'spin-icon' : ''} color="var(--color-primary)" />
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                className="btn-delete-user"
                                onClick={() => handleDelete(asset)}
                                title="Remover ativo apenas do IperSoft"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}

            {/* 2. ABA ZABBIX (MONITORAMENTO) */}
            {viewMode === 'zabbix' && (
              <>
                <thead>
                  <tr>
                    <th className="checkbox-cell">
                      <input 
                        type="checkbox" 
                        className="asset-checkbox"
                        checked={displayedAssets.length > 0 && displayedAssets.every(a => selectedAssetIds.includes(a.id))}
                        onChange={handleSelectAllDisplayed}
                        title="Selecionar / Desmarcar todos os exibidos"
                      />
                    </th>
                    {renderSortHeader('Host Zabbix', 'name')}
                    {renderSortHeader('IP / DNS', 'ip')}
                    <th>Ping (ICMP)</th>
                    <th>SNMP v2c</th>
                    <th>Porta Zabbix</th>
                    <th>Community SNMP</th>
                    <th>Grupos de Rede</th>
                    <th>Status Zabbix</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAssets.map((asset) => {
                    const zbx = asset.zabbix;
                    const zbxStatus = zbx ? zbx.status : asset.status;
                    const groups = (zbx && zbx.host_groups) || asset.host_groups || [];
                    const cleanIp = asset.ip_address?.trim();
                    const isDup = cleanIp && cleanIp !== '-' && duplicateIpMap[cleanIp] > 1;

                    return (
                      <tr 
                        key={asset.id} 
                        className={`clickable-asset-row ${zbxStatus === 'unmonitored' ? 'row-unmonitored' : ''} ${isDup ? 'row-duplicate-ip' : ''} ${selectedAssetIds.includes(asset.id) ? 'row-selected' : ''}`}
                        onClick={(e) => {
                          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
                          if (onSelectAsset) onSelectAsset(asset.id);
                        }}
                      >
                        <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            className="asset-checkbox"
                            checked={selectedAssetIds.includes(asset.id)}
                            onChange={() => handleToggleSelect(asset.id)}
                          />
                        </td>
                        <td>
                          <div className="asset-name-cell">
                            <span className="asset-visible-name">{asset.name}</span>
                            <span className="asset-hostname">{asset.hostname}</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                            <code style={{ fontSize: '0.82rem', fontWeight: 600 }}>{asset.ip_address || asset.dns || '-'}</code>
                            {isDup && (
                              <span 
                                className="duplicate-ip-tag" 
                                title={`Endereço IP compartilhado por ${duplicateIpMap[cleanIp]} equipamentos`}
                              >
                                <Copy size={10} /> Duplicado ({duplicateIpMap[cleanIp]}x)
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {zbx?.icmp_status === 'ok' ? (
                            <span className="status-pill-ok" title={zbx.icmp_latency_ms ? `Latência: ${zbx.icmp_latency_ms} ms` : 'Ping OK'}>
                              <CheckCircle2 size={11} /> {zbx.icmp_latency_ms ? `${zbx.icmp_latency_ms}ms` : 'OK'}
                            </span>
                          ) : zbx?.icmp_status === 'timeout' ? (
                            <span className="status-pill-timeout" title="Tempo limite esgotado (100% perda)">
                              <Clock size={11} /> Timeout
                            </span>
                          ) : zbx?.icmp_status === 'failed' ? (
                            <span className="status-pill-fail" title="Falha de comunicação">
                              <XCircle size={11} /> Falha
                            </span>
                          ) : (
                            <span className="status-pill-none">Pendente</span>
                          )}
                        </td>
                        <td>
                          {zbx?.snmp_status === 'ok' ? (
                            <span className="status-pill-ok" title={zbx.snmp_message || 'SNMP OK'}>
                              <CheckCircle2 size={11} /> OK
                            </span>
                          ) : zbx?.snmp_status === 'timeout' ? (
                            <span className="status-pill-timeout" title={zbx.snmp_message || 'Sem resposta SNMP'}>
                              <Clock size={11} /> Timeout
                            </span>
                          ) : zbx?.snmp_status === 'failed' ? (
                            <span className="status-pill-fail" title={zbx.snmp_message || 'Falha de comunicação SNMP'}>
                              <XCircle size={11} /> Falha
                            </span>
                          ) : (
                            <span className="status-pill-none">Pendente</span>
                          )}
                        </td>
                        <td>
                          <span className="port-tag">{(zbx && zbx.port) || asset.port || '10050'}</span>
                        </td>
                        <td>
                          {(zbx && zbx.snmp_community) || asset.snmp_community ? (
                            <span className="community-tag">{(zbx && zbx.snmp_community) || asset.snmp_community}</span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          <div className="badge-list">
                            {groups.slice(0, 3).map((g, gi) => (
                              <span key={gi} className="mini-badge">{g}</span>
                            ))}
                            {groups.length > 3 && (
                              <span className="mini-badge" title={groups.slice(3).join(', ')}>
                                +{groups.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`status-toggle-btn ${zbxStatus === 'monitored' ? 'is-active' : 'is-inactive'}`}
                            onClick={() => handleToggleStatus(asset)}
                            title={zbxStatus === 'monitored' ? 'Clique para desativar no Zabbix' : 'Clique para reativar no Zabbix'}
                          >
                            <span className="toggle-dot"></span>
                            <span>{zbxStatus === 'monitored' ? 'Ativo' : 'Desativado'}</span>
                          </button>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn-icon"
                            onClick={() => handleQuickTest(asset)}
                            disabled={retestingId === asset.id}
                            title="Testar conectividade agora (Ping, SNMP e Portas)"
                            style={{ display: 'inline-flex', padding: '0.35rem 0.5rem', marginRight: '4px' }}
                          >
                            <Activity size={13} className={retestingId === asset.id ? 'spin-icon' : ''} color="var(--color-primary)" />
                          </button>
                          <button
                            className="btn-delete-user"
                            onClick={() => handleOpenEdit(asset)}
                            title="Editar parâmetros Zabbix"
                          >
                            <Edit2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}

            {/* 3. ABA GUACAMOLE (ACESSO REMOTO) */}
            {viewMode === 'guacamole' && (
              <>
                <thead>
                  <tr>
                    <th className="checkbox-cell">
                      <input 
                        type="checkbox" 
                        className="asset-checkbox"
                        checked={displayedAssets.length > 0 && displayedAssets.every(a => selectedAssetIds.includes(a.id))}
                        onChange={handleSelectAllDisplayed}
                        title="Selecionar / Desmarcar todos os exibidos"
                      />
                    </th>
                    {renderSortHeader('Dispositivo', 'name')}
                    <th>Conexão no Guacamole</th>
                    {renderSortHeader('IP Destino', 'ip')}
                    <th>Protocolo & Porta</th>
                    <th>Status Conexão (TCP)</th>
                    <th>Credenciais</th>
                    <th>Terminal Web</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAssets.map((asset) => {
                    const guacConns = asset.guacamole || [];
                    const primaryGuac = guacConns.length > 0 ? guacConns[0] : null;
                    const hasGuac = Boolean(primaryGuac || asset.guacamole_connection_id);
                    const guacUrl = getGuacamoleLaunchUrl(asset);
                    const connName = primaryGuac ? primaryGuac.connection_name : asset.name;
                    const protocol = (primaryGuac ? primaryGuac.protocol : asset.guacamole_protocol) || 'ssh';
                    const port = (primaryGuac ? primaryGuac.port : (protocol === 'ssh' ? '22' : (protocol === 'telnet' ? '23' : '3389')));
                    const cleanIp = asset.ip_address?.trim();
                    const isDup = cleanIp && cleanIp !== '-' && duplicateIpMap[cleanIp] > 1;

                    return (
                      <tr 
                        key={asset.id} 
                        className={`clickable-asset-row ${isDup ? 'row-duplicate-ip' : ''} ${selectedAssetIds.includes(asset.id) ? 'row-selected' : ''}`}
                        onClick={(e) => {
                          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
                          if (onSelectAsset) onSelectAsset(asset.id);
                        }}
                      >
                        <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            className="asset-checkbox"
                            checked={selectedAssetIds.includes(asset.id)}
                            onChange={() => handleToggleSelect(asset.id)}
                          />
                        </td>
                        <td>
                          <div className="asset-name-cell">
                            <span className="asset-visible-name">{asset.name}</span>
                            <span className="asset-hostname">{asset.hostname}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                            {hasGuac ? connName : <span className="text-muted">Não configurada</span>}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                            <code style={{ fontSize: '0.82rem', fontWeight: 600 }}>{asset.ip_address || asset.dns || '-'}</code>
                            {isDup && (
                              <span 
                                className="duplicate-ip-tag" 
                                title={`Endereço IP compartilhado por ${duplicateIpMap[cleanIp]} equipamentos`}
                              >
                                <Copy size={10} /> Duplicado ({duplicateIpMap[cleanIp]}x)
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {hasGuac ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <span className="mini-badge" style={{ textTransform: 'uppercase', color: 'var(--color-primary)' }}>
                                {protocol}
                              </span>
                              <span className="port-tag">{port}</span>
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {hasGuac && primaryGuac ? (
                            primaryGuac.tcp_status === 'ok' ? (
                              <span className="status-pill-ok" title={primaryGuac.tcp_message || 'Porta Aberta'}>
                                <CheckCircle2 size={11} /> Aberta {primaryGuac.tcp_latency_ms ? `(${primaryGuac.tcp_latency_ms}ms)` : ''}
                              </span>
                            ) : primaryGuac.tcp_status === 'timeout' ? (
                              <span className="status-pill-timeout" title={primaryGuac.tcp_message || 'Timeout de conexão TCP'}>
                                <Clock size={11} /> Timeout
                              </span>
                            ) : primaryGuac.tcp_status === 'failed' ? (
                              <span className="status-pill-fail" title={primaryGuac.tcp_message || 'Porta fechada'}>
                                <XCircle size={11} /> Fechada
                              </span>
                            ) : (
                              <span className="status-pill-none">Pendente</span>
                            )
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {hasGuac && (primaryGuac?.username || primaryGuac?.password) ? (
                            <div className="cred-badge">
                              <Key size={11} color="var(--color-primary)" />
                              <span className="cred-user">{primaryGuac.username || '-'}</span>
                              {primaryGuac.password && (
                                <div className="cred-pass-box">
                                  <span>{revealedPasswords[primaryGuac.id] ? primaryGuac.password : '••••••••'}</span>
                                  <button
                                    type="button"
                                    className="cred-pass-btn"
                                    onClick={() => toggleShowPass(primaryGuac.id)}
                                    title={revealedPasswords[primaryGuac.id] ? "Ocultar senha" : "Ver senha"}
                                  >
                                    {revealedPasswords[primaryGuac.id] ? <EyeOff size={11} /> : <Eye size={11} />}
                                  </button>
                                  <button
                                    type="button"
                                    className="cred-pass-btn"
                                    onClick={() => copyToClipboard(primaryGuac.password)}
                                    title="Copiar senha"
                                  >
                                    <Copy size={10} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {hasGuac && guacUrl ? (
                            <a
                              href={guacUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="guac-pill-badge"
                              title="Abrir terminal remoto em nova aba"
                            >
                              <Terminal size={11} style={{ marginRight: 4 }} />
                              Abrir {protocol.toUpperCase()}
                              <ExternalLink size={10} style={{ marginLeft: 4 }} />
                            </a>
                          ) : (
                            <span className="text-muted" style={{ fontSize: '0.72rem' }}>Sem conexão</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              className="btn-icon"
                              onClick={() => handleQuickTest(asset)}
                              disabled={retestingId === asset.id}
                              title="Testar conectividade desta porta agora"
                              style={{ display: 'inline-flex', padding: '0.35rem 0.5rem' }}
                            >
                              <Activity size={13} className={retestingId === asset.id ? 'spin-icon' : ''} color="var(--color-primary)" />
                            </button>
                            {hasGuac && guacUrl && (
                              <a
                                href={guacUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="guac-action-icon"
                                title="Abrir terminal Guacamole em nova aba"
                              >
                                <Terminal size={13} />
                              </a>
                            )}
                            <button
                              className="btn-delete-user"
                              onClick={() => handleOpenEdit(asset)}
                              title="Editar ativo"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
          </table>
        )}
      </div>

      {/* ========================================================================= */}
      {/* EDIT ASSET MODAL COM SEÇÕES MODULARES */}
      {/* ========================================================================= */}
      {editingAsset && (
        <div className="modal-overlay" onClick={() => setEditingAsset(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div className="modal-title-box">
                <Edit2 size={17} className="modal-title-icon" />
                <h2 className="modal-title">Editar Ativo de Rede</h2>
              </div>
              <button className="btn-close-modal" onClick={() => setEditingAsset(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              {/* SEÇÃO 1: IDENTIFICAÇÃO CANÔNICA */}
              <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  1. Identificação Geral do Equipamento
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div className="form-group">
                    <label className="form-label">Nome Visível</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Hostname / Host Técnico</label>
                      <input
                        type="text"
                        className="form-input"
                        value={editForm.hostname}
                        onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Endereço IP Principal</label>
                      <input
                        type="text"
                        className="form-input"
                        value={editForm.ip_address}
                        onChange={(e) => setEditForm({ ...editForm, ip_address: e.target.value })}
                        placeholder="192.168.1.1"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Empresa / Grupo do Cliente (Host Group & Pasta Guacamole)</label>
                    <input
                      type="text"
                      list="modal-client-groups-list"
                      className="form-input"
                      value={editForm.client_group}
                      onChange={(e) => setEditForm({ ...editForm, client_group: e.target.value })}
                      placeholder="Ex: athila, atm, diretrix..."
                    />
                    <datalist id="modal-client-groups-list">
                      {(stats.groups_list || []).map((grp) => (
                        <option key={grp} value={grp} />
                      ))}
                    </datalist>
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '3px' }}>
                      Define o grupo correspondente no Zabbix e a pasta organizacional no Guacamole.
                    </small>
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Modelo de SO (Oxidized)</label>
                      <select
                        className="form-input"
                        value={editForm.backup_model || 'RouterOS'}
                        onChange={(e) => setEditForm({ ...editForm, backup_model: e.target.value })}
                      >
                        <option value="RouterOS">MikroTik (RouterOS)</option>
                        <option value="ios">Cisco (IOS / IOS-XE)</option>
                        <option value="dmos">Datacom (DmOS)</option>
                        <option value="vrp">Huawei (VRP)</option>
                        <option value="fortios">Fortinet (FortiOS)</option>
                        <option value="edgecos">EdgeCore / EdgeOS</option>
                        <option value="junos">Juniper (JunOS)</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '1.25rem' }}>
                      <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={editForm.backup_enabled !== false}
                          onChange={(e) => setEditForm({ ...editForm, backup_enabled: e.target.checked })}
                        />
                        <span>Habilitar backup no Oxidized</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* SEÇÃO 2: DADOS DE MONITORAMENTO (ZABBIX) */}
              <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-success)', textTransform: 'uppercase' }}>
                  2. Parâmetros Zabbix Server
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div className="form-grid">
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label className="form-label">SNMP Community</label>
                        <button
                          type="button"
                          onClick={() => setEditForm({ ...editForm, snmp_community: 'ipermonitor' })}
                          style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.7rem', cursor: 'pointer' }}
                        >
                          Usar 'ipermonitor'
                        </button>
                      </div>
                      <input
                        type="text"
                        className="form-input"
                        value={editForm.snmp_community}
                        onChange={(e) => setEditForm({ ...editForm, snmp_community: e.target.value })}
                        placeholder="ipermonitor"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Porta do Agente / SNMP</label>
                      <input
                        type="text"
                        className="form-input"
                        value={editForm.port}
                        onChange={(e) => setEditForm({ ...editForm, port: e.target.value })}
                        placeholder="161 ou 10050"
                      />
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Status no Zabbix</label>
                      <select
                        className="form-input"
                        value={editForm.status}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      >
                        <option value="monitored">Em Monitoramento (Ativo)</option>
                        <option value="unmonitored">Desativado (Inativo)</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '1.25rem' }}>
                      <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={editForm.sync_zabbix}
                          onChange={(e) => setEditForm({ ...editForm, sync_zabbix: e.target.checked })}
                        />
                        <span>Sincronizar alteração no Zabbix Server</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* SEÇÃO 3: ACESSO REMOTO (GUACAMOLE) */}
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
                  3. Parâmetros Apache Guacamole
                </span>
                <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                  <div className="form-group">
                    <label className="form-label">ID Conexão Guacamole</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.guacamole_connection_id || ''}
                      onChange={(e) => setEditForm({ ...editForm, guacamole_connection_id: e.target.value })}
                      placeholder="Identificador ou Hash"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Protocolo de Terminal</label>
                    <select
                      className="form-input"
                      value={editForm.guacamole_protocol || 'ssh'}
                      onChange={(e) => {
                        const proto = e.target.value;
                        const defP = proto === 'ssh' ? '22' : (proto === 'telnet' ? '23' : '3389');
                        const isDef = editForm.guacamole_port === '22' || editForm.guacamole_port === '23' || editForm.guacamole_port === '3389';
                        setEditForm({ 
                          ...editForm, 
                          guacamole_protocol: proto,
                          guacamole_port: isDef ? defP : editForm.guacamole_port
                        });
                      }}
                    >
                      <option value="ssh">SSH</option>
                      <option value="telnet">Telnet</option>
                      <option value="rdp">RDP</option>
                      <option value="vnc">VNC</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Porta Remota (SSH/Telnet/RDP)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.guacamole_port || ''}
                      onChange={(e) => setEditForm({ ...editForm, guacamole_port: e.target.value })}
                      placeholder="22"
                    />
                  </div>
                </div>

                <div className="form-grid" style={{ marginTop: '0.75rem' }}>
                  <div className="form-group">
                    <label className="form-label">Usuário de Acesso Remoto</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.guacamole_username || ''}
                      onChange={(e) => setEditForm({ ...editForm, guacamole_username: e.target.value })}
                      placeholder="ex: iper ou root"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Senha de Acesso Remoto</label>
                    <input
                      type="password"
                      className="form-input"
                      value={editForm.guacamole_password || ''}
                      onChange={(e) => setEditForm({ ...editForm, guacamole_password: e.target.value })}
                      placeholder="Senha cadastrada no Guacamole"
                    />
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem' }}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editForm.sync_guacamole !== false}
                      onChange={(e) => setEditForm({ ...editForm, sync_guacamole: e.target.checked })}
                    />
                    Sincronizar alterações com o Apache Guacamole
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingAsset(null)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto' }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
