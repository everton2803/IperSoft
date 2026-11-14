import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
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
  PowerOff,
  Zap,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { authService, diagnosticsService } from '../services/api';
import { DensityToggle } from './common/DensityToggle';

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
const getIntegrationBadge = (asset, type, vlogsActivity = null) => {
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
    const normModel = (m) => {
      if (!m) return '';
      const s = m.trim().toLowerCase();
      if (s === 'dmos' || s === 'datacom') return 'datacom';
      return s;
    };
    if (ox.model && asset.backup_model && 
        normModel(ox.model) !== normModel(asset.backup_model)) {
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

  if (type === 'syslog') {
    const cleanIp = asset.ip_address?.trim();
    if (!cleanIp || cleanIp === '-') {
      return {
        label: 'Syslog',
        status: 'disabled',
        tooltip: 'Syslog: Equipamento sem endereço IP cadastrado',
        dotColor: 'gray',
        hasCheck: false,
        hasAlert: false
      };
    }

    const isActiveNow = Boolean(vlogsActivity?.active_now_ips && Array.isArray(vlogsActivity.active_now_ips) && vlogsActivity.active_now_ips.includes(cleanIp));
    const count24h = (vlogsActivity?.counts_24h && typeof vlogsActivity.counts_24h === 'object' && vlogsActivity.counts_24h[cleanIp]) || 0;

    if (isActiveNow) {
      return {
        label: 'Syslog',
        status: 'ok',
        tooltip: `Syslog Ativo: recebendo logs em tempo real (${count24h.toLocaleString('pt-BR')} eventos em 24h)`,
        dotColor: 'green',
        hasCheck: true,
        hasAlert: false
      };
    }

    if (count24h > 0) {
      return {
        label: 'Syslog',
        status: 'idle',
        tooltip: `Syslog Inativo no momento: ${count24h.toLocaleString('pt-BR')} logs em 24h, mas sem eventos nos últimos 15 min`,
        dotColor: 'yellow',
        hasCheck: false,
        hasAlert: false
      };
    }

    return {
      label: 'Syslog',
      status: 'disabled',
      tooltip: 'Syslog: Nenhum log recebido deste IP nas últimas 24h',
      dotColor: 'gray',
      hasCheck: false,
      hasAlert: false
    };
  }

  return { label: type, status: 'disabled', tooltip: '', dotColor: 'gray', hasCheck: false, hasAlert: false };
};

const normalizeBackupModel = (m) => {
  if (!m) return '';
  const s = String(m).trim().toLowerCase();
  if (s === 'dmos' || s === 'datacom') return 'datacom';
  return s;
};

// Audita todas as integrações do ativo comparando valores cadastrados nas plataformas vs IperSoft
const auditAssetIntegrations = (asset, vlogsActivity = null) => {
  const diffs = [];

  // 1. ZABBIX
  const isZbxDisabled = asset.status === 'unmonitored' || asset.zabbix?.status === 'unmonitored';
  const zbxHostId = asset.zabbix?.hostid || asset.external_id;
  const hasZbxHost = Boolean(zbxHostId && zbxHostId !== 'None');
  const zbxDiffs = [];

  let zbxPlatform;
  if (isZbxDisabled) {
    zbxPlatform = {
      key: 'zabbix',
      short: 'ZBX',
      label: 'Zabbix',
      status: 'disabled',
      dotColor: 'gray',
      statusLabel: 'Desativado',
      summary: 'Monitoramento desativado no IperSoft',
      diffs: [],
      canSync: false
    };
  } else if (!hasZbxHost) {
    zbxDiffs.push({
      field: 'Vínculo de Host',
      platformVal: 'Não vinculado',
      ipersoftVal: asset.name || asset.hostname || '-'
    });
    zbxPlatform = {
      key: 'zabbix',
      short: 'ZBX',
      label: 'Zabbix',
      status: 'divergent',
      dotColor: 'yellow',
      statusLabel: 'Não Sincronizado',
      summary: 'Ativo sem host vinculado no Zabbix Server',
      diffs: zbxDiffs,
      canSync: true
    };
  } else {
    if (asset.zabbix?.name && asset.name && asset.zabbix.name.trim() !== asset.name.trim()) {
      zbxDiffs.push({
        field: 'Nome Visível',
        platformVal: asset.zabbix.name,
        ipersoftVal: asset.name
      });
    }
    if (asset.zabbix?.snmp_community && asset.snmp_community &&
        asset.zabbix.snmp_community.trim() !== asset.snmp_community.trim()) {
      zbxDiffs.push({
        field: 'Community SNMP',
        platformVal: asset.zabbix.snmp_community,
        ipersoftVal: asset.snmp_community
      });
    }
    if (asset.zabbix?.port && asset.port &&
        String(asset.zabbix.port).trim() !== String(asset.port).trim()) {
      zbxDiffs.push({
        field: 'Porta Agente/SNMP',
        platformVal: String(asset.zabbix.port),
        ipersoftVal: String(asset.port)
      });
    }
    const zbxNamedGroups = (asset.zabbix?.host_groups || [])
      .map(g => String(g).trim())
      .filter(g => g && !/^\d+$/.test(g));
    if (asset.client_group && zbxNamedGroups.length > 0 &&
        !zbxNamedGroups.some(g => g.toLowerCase() === asset.client_group.trim().toLowerCase())) {
      zbxDiffs.push({
        field: 'Grupo / Cliente',
        platformVal: zbxNamedGroups.join(', '),
        ipersoftVal: asset.client_group
      });
    }

    zbxPlatform = {
      key: 'zabbix',
      short: 'ZBX',
      label: 'Zabbix',
      status: zbxDiffs.length > 0 ? 'divergent' : 'ok',
      dotColor: zbxDiffs.length > 0 ? 'yellow' : 'green',
      statusLabel: zbxDiffs.length > 0 ? `${zbxDiffs.length} divergência(s)` : 'Em dia',
      summary: `HostID: ${zbxHostId}${asset.zabbix?.port ? ` • Porta ${asset.zabbix.port}` : ''}`,
      diffs: zbxDiffs,
      canSync: true
    };
  }
  zbxDiffs.forEach(d => diffs.push({ target: 'zabbix', targetLabel: 'Zabbix', ...d }));

  // 2. GUACAMOLE
  const isGuacDisabled = Boolean(asset.ignore_guacamole);
  const primaryGuac = (asset.guacamole && asset.guacamole.length > 0) ? asset.guacamole[0] : null;
  const connId = primaryGuac?.connection_id || asset.guacamole_connection_id;
  const hasRealGuac = Boolean(connId && !String(connId).startsWith('local-'));
  const guacDiffs = [];

  let guacPlatform;
  if (isGuacDisabled) {
    guacPlatform = {
      key: 'guacamole',
      short: 'GUA',
      label: 'Guacamole',
      status: 'disabled',
      dotColor: 'gray',
      statusLabel: 'Ignorado',
      summary: 'Acesso remoto desativado para este ativo',
      diffs: [],
      canSync: false
    };
  } else if (!hasRealGuac) {
    const proto = (asset.guacamole_protocol || 'ssh').toUpperCase();
    const port = asset.guacamole_port || (proto === 'TELNET' ? '23' : proto === 'RDP' ? '3389' : '22');
    guacDiffs.push({
      field: 'Conexão Remota',
      platformVal: 'Não cadastrada',
      ipersoftVal: `${proto}:${port}`
    });
    guacPlatform = {
      key: 'guacamole',
      short: 'GUA',
      label: 'Guacamole',
      status: 'divergent',
      dotColor: 'yellow',
      statusLabel: 'Não Sincronizado',
      summary: 'Habilitado no IperSoft, sem conexão no Guacamole',
      diffs: guacDiffs,
      canSync: true
    };
  } else {
    if (primaryGuac?.connection_name && asset.name &&
        primaryGuac.connection_name.trim() !== asset.name.trim()) {
      guacDiffs.push({
        field: 'Nome da Conexão',
        platformVal: primaryGuac.connection_name,
        ipersoftVal: asset.name
      });
    }
    const cleanAssetIp = (asset.ip_address || '').trim().toLowerCase();
    const cleanGuacIp = (primaryGuac?.hostname || '').trim().toLowerCase();
    if (cleanAssetIp && cleanGuacIp && cleanAssetIp !== '-' && cleanGuacIp !== cleanAssetIp) {
      guacDiffs.push({
        field: 'IP / Host Remoto',
        platformVal: primaryGuac.hostname,
        ipersoftVal: asset.ip_address
      });
    }
    const expProto = (asset.guacamole_protocol || '').trim().toLowerCase();
    const actProto = (primaryGuac?.protocol || '').trim().toLowerCase();
    if (expProto && actProto && expProto !== actProto) {
      guacDiffs.push({
        field: 'Protocolo',
        platformVal: actProto.toUpperCase(),
        ipersoftVal: expProto.toUpperCase()
      });
    }
    if (primaryGuac?.port && asset.guacamole_port &&
        String(primaryGuac.port).trim() !== String(asset.guacamole_port).trim()) {
      guacDiffs.push({
        field: 'Porta Remota',
        platformVal: String(primaryGuac.port),
        ipersoftVal: String(asset.guacamole_port)
      });
    }

    const rProto = (primaryGuac?.protocol || asset.guacamole_protocol || 'ssh').toUpperCase();
    const rPort = primaryGuac?.port || asset.guacamole_port || '';
    guacPlatform = {
      key: 'guacamole',
      short: 'GUA',
      label: 'Guacamole',
      status: guacDiffs.length > 0 ? 'divergent' : 'ok',
      dotColor: guacDiffs.length > 0 ? 'yellow' : 'green',
      statusLabel: guacDiffs.length > 0 ? `${guacDiffs.length} divergência(s)` : 'Em dia',
      summary: `${rProto}${rPort ? `:${rPort}` : ''} • ID: ${connId}`,
      diffs: guacDiffs,
      canSync: true
    };
  }
  guacDiffs.forEach(d => diffs.push({ target: 'guacamole', targetLabel: 'Guacamole', ...d }));

  // 3. OXIDIZED
  const isOxDisabled = asset.backup_enabled === false;
  const ox = asset.oxidized;
  const oxDiffs = [];

  let oxPlatform;
  if (isOxDisabled) {
    oxPlatform = {
      key: 'oxidized',
      short: 'OXI',
      label: 'Oxidized',
      status: 'disabled',
      dotColor: 'gray',
      statusLabel: 'Desativado',
      summary: 'Backup automático desativado no IperSoft',
      diffs: [],
      canSync: false
    };
  } else if (!ox) {
    oxDiffs.push({
      field: 'Nó de Backup',
      platformVal: 'Não sincronizado',
      ipersoftVal: `${asset.name} (${asset.backup_model || 'RouterOS'})`
    });
    oxPlatform = {
      key: 'oxidized',
      short: 'OXI',
      label: 'Oxidized',
      status: 'divergent',
      dotColor: 'yellow',
      statusLabel: 'Não Sincronizado',
      summary: `Aguardando sincronização (${asset.backup_model || 'RouterOS'})`,
      diffs: oxDiffs,
      canSync: true
    };
  } else {
    if (ox.node_name && asset.name && ox.node_name.trim() !== asset.name.trim()) {
      oxDiffs.push({
        field: 'Nome do Nó',
        platformVal: ox.node_name,
        ipersoftVal: asset.name
      });
    }
    if (ox.model && asset.backup_model &&
        normalizeBackupModel(ox.model) !== normalizeBackupModel(asset.backup_model)) {
      oxDiffs.push({
        field: 'Modelo Backup',
        platformVal: ox.model,
        ipersoftVal: asset.backup_model
      });
    }
    const expOxGroup = (asset.client_group || 'default').trim();
    const actOxGroup = (ox.group || 'default').trim();
    if (ox.group && expOxGroup.toLowerCase() !== actOxGroup.toLowerCase()) {
      oxDiffs.push({
        field: 'Grupo Backup',
        platformVal: actOxGroup,
        ipersoftVal: expOxGroup
      });
    }
    if (ox.timeout && asset.backup_timeout && Number(ox.timeout) !== Number(asset.backup_timeout)) {
      oxDiffs.push({
        field: 'Timeout Backup',
        platformVal: `${ox.timeout}s`,
        ipersoftVal: `${asset.backup_timeout}s`
      });
    }

    const isBackupError = ox.status === 'fail' || ox.status === 'no_connection';
    const oxStatus = oxDiffs.length > 0 ? 'divergent' : (isBackupError ? 'error' : (ox.status === 'success' ? 'ok' : 'idle'));
    const oxDot = oxDiffs.length > 0 ? 'yellow' : (isBackupError ? 'red' : (ox.status === 'success' ? 'green' : 'yellow'));
    const oxStatusLabel = oxDiffs.length > 0
      ? `${oxDiffs.length} divergência(s)`
      : (isBackupError ? `Falha (${ox.status})` : (ox.status === 'success' ? 'Backup OK' : `Aguardando (${ox.status || 'pendente'})`));

    oxPlatform = {
      key: 'oxidized',
      short: 'OXI',
      label: 'Oxidized',
      status: oxStatus,
      dotColor: oxDot,
      statusLabel: oxStatusLabel,
      summary: `${ox.model || asset.backup_model || 'RouterOS'} • Grupo: ${ox.group || 'default'}`,
      diffs: oxDiffs,
      canSync: true
    };
  }
  oxDiffs.forEach(d => diffs.push({ target: 'oxidized', targetLabel: 'Oxidized', ...d }));

  // 4. SYSLOG (Telemetria)
  const syslogBadge = getIntegrationBadge(asset, 'syslog', vlogsActivity);
  const syslogPlatform = {
    key: 'syslog',
    short: 'LOG',
    label: 'Syslog',
    status: syslogBadge.status,
    dotColor: syslogBadge.dotColor,
    statusLabel: syslogBadge.status === 'ok' ? 'Ativo agora' : (syslogBadge.status === 'idle' ? 'Logs 24h' : 'Sem logs'),
    summary: syslogBadge.tooltip,
    diffs: [],
    canSync: false
  };

  const corePlatforms = [zbxPlatform, guacPlatform, oxPlatform];
  const activePlatforms = corePlatforms.filter(p => p.status !== 'disabled');
  const okCount = activePlatforms.filter(p => p.status === 'ok').length;
  const hasError = corePlatforms.some(p => p.status === 'error');
  const hasDivergence = diffs.length > 0;

  return {
    platforms: [zbxPlatform, guacPlatform, oxPlatform, syslogPlatform],
    diffs,
    hasDivergence,
    hasError,
    okCount,
    activeCount: activePlatforms.length
  };
};

// Audita os testes de conectividade (Ping ICMP, SNMP e Porta Remota) para exibição agrupada
const auditAssetConnectivity = (asset) => {
  const zbx = asset.zabbix;
  const primaryGuac = (asset.guacamole && asset.guacamole.length > 0) ? asset.guacamole[0] : null;
  const isGuacDisabled = Boolean(asset.ignore_guacamole);
  const remoteProto = (primaryGuac?.protocol || asset.guacamole_protocol || 'ssh').toUpperCase();

  const mapDot = (status) => {
    if (status === 'ok') return 'green';
    if (status === 'timeout') return 'yellow';
    if (status === 'failed') return 'red';
    return 'gray';
  };

  const mapLabel = (status, okText = 'OK') => {
    if (status === 'ok') return okText;
    if (status === 'timeout') return 'Timeout';
    if (status === 'failed') return 'Falhou';
    return 'Não testado';
  };

  const tests = [
    {
      key: 'icmp',
      short: 'PING',
      label: 'ICMP Ping',
      status: zbx?.icmp_status || 'none',
      dotColor: mapDot(zbx?.icmp_status),
      statusLabel: mapLabel(zbx?.icmp_status, zbx?.icmp_latency_ms ? `${zbx.icmp_latency_ms}ms` : 'OK'),
      detail: zbx?.icmp_status === 'ok'
        ? (zbx.icmp_latency_ms ? `Latência: ${zbx.icmp_latency_ms} ms` : 'Respondendo ao ICMP')
        : (zbx?.icmp_status === 'timeout' ? 'Tempo limite esgotado' : (zbx?.icmp_status === 'failed' ? 'Inacessível via ICMP' : 'Aguardando verificação'))
    },
    {
      key: 'snmp',
      short: 'SNMP',
      label: 'SNMP v2c',
      status: zbx?.snmp_status || 'none',
      dotColor: mapDot(zbx?.snmp_status),
      statusLabel: mapLabel(zbx?.snmp_status, 'OK'),
      detail: zbx?.snmp_message || (zbx?.snmp_status === 'ok' ? 'OID sysName respondendo' : 'Aguardando verificação SNMP')
    }
  ];

  if (primaryGuac && !isGuacDisabled) {
    const rPort = primaryGuac.port || asset.guacamole_port || '';
    tests.push({
      key: 'remote',
      short: remoteProto,
      label: `Acesso ${remoteProto}${rPort ? ` (${rPort})` : ''}`,
      status: primaryGuac.tcp_status || 'none',
      dotColor: mapDot(primaryGuac.tcp_status),
      statusLabel: mapLabel(primaryGuac.tcp_status, 'Aberta'),
      detail: primaryGuac.tcp_status === 'ok'
        ? `Porta ${rPort || '-'} aberta${primaryGuac.tcp_latency_ms ? ` (${primaryGuac.tcp_latency_ms}ms)` : ''}`
        : (primaryGuac.tcp_message || (primaryGuac.tcp_status ? 'Porta inacessível ou timeout TCP' : 'Aguardando teste de porta TCP'))
    });
  }

  const okCount = tests.filter(t => t.status === 'ok').length;
  const failCount = tests.filter(t => t.status === 'failed').length;
  const timeoutCount = tests.filter(t => t.status === 'timeout').length;
  const untestedCount = tests.filter(t => t.status === 'none').length;

  return {
    tests,
    okCount,
    failCount,
    timeoutCount,
    untestedCount,
    totalCount: tests.length
  };
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
  const deferredSearch = useDeferredValue(searchTerm);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [guacBaseUrl, setGuacBaseUrl] = useState('');
  const [revealedPasswords, setRevealedPasswords] = useState({});
  const [vlogsActivity, setVlogsActivity] = useState({ active_now_ips: [], counts_24h: {} });

  // Ordenação, Duplicados & Divergências
  const [sortField, setSortField] = useState('name'); // 'name' | 'ip'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [showOnlyDivergent, setShowOnlyDivergent] = useState(false);

  // Popover interativo agrupado (Plataformas e Conectividade)
  const [openPopover, setOpenPopover] = useState(null); // { assetId, type, openUpward, left, top, bottom, width }
  const [syncingKey, setSyncingKey] = useState(null); // `${assetId}:${target}`

  useEffect(() => {
    if (!openPopover) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.status-popover-wrapper')) {
        setOpenPopover(null);
      }
    };
    const handleViewportChange = (e) => {
      if (e.target && e.target.closest && e.target.closest('.status-popover-dropdown')) return;
      setOpenPopover(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [openPopover]);

  // Densidade e Filtros Avançados
  const [density, setDensity] = useState(() => {
    return localStorage.getItem('ipersoft_density_assets_table') || 'comfortable';
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(() => {
    return localStorage.getItem('ipersoft_assets_show_filters') === 'true';
  });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedGroup) count++;
    if (statusFilter !== 'all') count++;
    if (presenceFilter !== 'all') count++;
    if (showOnlyDuplicates) count++;
    if (showOnlyDivergent) count++;
    return count;
  }, [selectedGroup, statusFilter, presenceFilter, showOnlyDuplicates, showOnlyDivergent]);

  const handleClearFilters = () => {
    setSelectedGroup('');
    setStatusFilter('all');
    setPresenceFilter('all');
    setShowOnlyDuplicates(false);
    setShowOnlyDivergent(false);
  };

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

    const confirmMsg = `Deseja realmente ${actionLabel.toLowerCase()} a integração ${integName} no IperSoft para os ${count} equipamentos selecionados?`;

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
        text: `${count} equipamentos atualizados no IperSoft: ${integName} ${enable ? 'ativado' : 'desativado'} com sucesso!`
      });
      setSelectedAssetIds([]);
      await loadData();
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: err.message || `Erro ao atualizar integração ${integName} em lote.`
      });
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleBulkDetectOS = async () => {
    if (selectedAssetIds.length === 0) return;
    const count = selectedAssetIds.length;
    const confirmMsg = `Deseja executar a detecção inteligente de SO (SNMP + fallback SSH) para os ${count} equipamentos selecionados? Os perfis de SO e modelos de backup detectados serão atualizados automaticamente.`;
    if (!window.confirm(confirmMsg)) return;

    setIsBulkLoading(true);
    setFeedbackMsg(null);
    try {
      const res = await authService.bulkDetectAssetOS(selectedAssetIds, true);
      setFeedbackMsg({
        type: 'success',
        text: `Detecção de SO concluída: ${res.detected} de ${res.total} equipamentos identificados e atualizados com sucesso!`
      });
      setSelectedAssetIds([]);
      await loadData();
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: err.message || 'Erro ao executar detecção de SO em lote.'
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
    backup_timeout: 30,
    status: 'monitored'
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

  // Auditoria em memória de divergências entre IperSoft e Zabbix / Guacamole / Oxidized
  const auditByAssetId = useMemo(() => {
    const map = {};
    assets.forEach((asset) => {
      map[asset.id] = {
        integrations: auditAssetIntegrations(asset, vlogsActivity),
        connectivity: auditAssetConnectivity(asset)
      };
    });
    return map;
  }, [assets, vlogsActivity]);

  const divergentAssetsCount = useMemo(() => {
    return assets.filter((a) => auditByAssetId[a.id]?.integrations?.hasDivergence).length;
  }, [assets, auditByAssetId]);

  const handleToggleDivergentFilter = () => {
    setShowOnlyDivergent((prev) => !prev);
  };

  const togglePopover = (e, assetId, type) => {
    e.stopPropagation();
    if (openPopover && openPopover.assetId === assetId && openPopover.type === type) {
      setOpenPopover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < 340 && rect.top > spaceBelow;
    const popoverWidth = type === 'platforms' ? 370 : 300;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popoverWidth - 16);
    }
    setOpenPopover({
      assetId,
      type,
      openUpward,
      left,
      top: openUpward ? undefined : rect.bottom + 6,
      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined,
      width: popoverWidth
    });
  };

  const handleQuickSyncPlatform = async (asset, target) => {
    const key = `${asset.id}:${target}`;
    setSyncingKey(key);
    try {
      let res;
      if (target === 'zabbix') {
        res = await authService.syncAssetToZabbix(asset.id);
      } else if (target === 'guacamole') {
        res = await authService.syncAssetToGuacamole(asset.id);
      } else if (target === 'oxidized') {
        res = await authService.syncAssetToOxidized(asset.id);
      } else if (target === 'all') {
        res = await authService.syncAssetToAll(asset.id);
      }
      setFeedbackMsg({
        type: 'success',
        text: res?.message || `Sincronização (${target.toUpperCase()}) executada com sucesso para "${asset.name}".`
      });
      await loadData();
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: err.message || `Falha ao sincronizar "${asset.name}" com ${target}.`
      });
    } finally {
      setSyncingKey(null);
    }
  };

  const displayedAssets = useMemo(() => {
    let list = [...assets];

    // 1. Filtro instantâneo multi-termo em memória (0ms de latência, sem lag de digitação)
    const query = (deferredSearch || '').trim().toLowerCase();
    if (query) {
      const tokens = query.split(/\s+/).filter(Boolean);
      list = list.filter((asset) => {
        const zbxName = asset.zabbix?.name || '';
        const zbxHost = asset.zabbix?.host || '';
        const guacName = asset.guacamole?.[0]?.connection_name || '';
        const oxModel = asset.oxidized?.model || asset.backup_model || '';

        const fullText = `${asset.name || ''} ${asset.hostname || ''} ${asset.snmp_hostname || ''} ${asset.ip_address || ''} ${asset.dns || ''} ${asset.snmp_community || ''} ${asset.client_group || ''} ${zbxName} ${zbxHost} ${guacName} ${oxModel}`.toLowerCase();

        return tokens.every(token => fullText.includes(token));
      });
    }

    // 2. Filtro de IPs duplicados
    if (showOnlyDuplicates) {
      list = list.filter((asset) => {
        const ip = asset.ip_address?.trim();
        return ip && duplicateIpMap[ip] > 1;
      });
    }

    // 3. Filtro de Cadastros Divergentes entre IperSoft e Integrações
    if (showOnlyDivergent) {
      list = list.filter((asset) => auditByAssetId[asset.id]?.integrations?.hasDivergence);
    }

    // 4. Ordenação
    list.sort((a, b) => compareAssets(a, b, sortField, sortDirection));
    return list;
  }, [assets, deferredSearch, showOnlyDuplicates, showOnlyDivergent, duplicateIpMap, auditByAssetId, sortField, sortDirection]);

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
    // Carregar URL base do Guacamole se configurada (preferencialmente HTTPS pública)
    authService.getGuacamoleConfig()
      .then(cfg => {
        if (cfg && (cfg.public_url || cfg.url)) {
          let clean = (cfg.public_url || cfg.url).trim().replace(/\/+$/, '');
          if (clean.includes('10.10.1.2:8086') || clean.startsWith('http://')) {
            clean = 'https://guacamoles.iper.net.br/guacamole';
          }
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
      const [assetsData, statsData, guacCfg, vlogsAct] = await Promise.all([
        authService.getAssets({ 
          group: selectedGroup,
          status: statusFilter === 'all' ? undefined : statusFilter,
          presence: presenceFilter === 'all' ? undefined : presenceFilter,
          sort_by: sortField === 'ip' ? 'ip' : 'name',
          sort_dir: sortDirection
        }),
        authService.getAssetStats(),
        authService.getGuacamoleConfig().catch(() => null),
        authService.getVictoriaLogsActivity().catch(() => null)
      ]);
      setAssets(assetsData);
      setStats(statsData);
      if (vlogsAct) {
        setVlogsActivity(vlogsAct);
      }
      if (guacCfg && (guacCfg.public_url || guacCfg.url)) {
        let clean = (guacCfg.public_url || guacCfg.url).trim().replace(/\/+$/, '');
        if (clean.includes('10.10.1.2:8086') || clean.startsWith('http://')) {
          clean = 'https://guacamoles.iper.net.br/guacamole';
        }
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
  };

  const handleToggleStatus = async (asset) => {
    const currentStatus = asset.zabbix ? asset.zabbix.status : asset.status;
    const nextStatus = currentStatus === 'monitored' ? 'unmonitored' : 'monitored';
    const actionLabel = nextStatus === 'unmonitored' ? 'desativar' : 'reativar';
    
    if (!window.confirm(`Deseja ${actionLabel} o monitoramento do ativo "${asset.name}" no IperSoft?`)) {
      return;
    }

    try {
      const res = await authService.toggleAssetStatus(asset.id, nextStatus);
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
      backup_timeout: asset.backup_timeout || 30,
      status: (asset.zabbix && asset.zabbix.status) || asset.status || 'monitored'
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingAsset) return;

    setIsSaving(true);
    try {
      await authService.updateAsset(editingAsset.id, editForm);
      setFeedbackMsg({ type: 'success', text: `Ativo "${editForm.name}" salvo no IperSoft. Para sincronizar com Zabbix, Guacamole ou Oxidized, utilize as sincronizações individuais.` });
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
          className={`status-item clickable-stat ${presenceFilter === 'all' && statusFilter === 'all' && !showOnlyDuplicates && !showOnlyDivergent ? 'active-stat' : ''}`}
          onClick={handleClearFilters}
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
          className={`status-item clickable-stat ${showOnlyDivergent ? 'active-stat' : ''}`}
          onClick={handleToggleDivergentFilter}
          title="Clique para filtrar equipamentos cujo cadastro no IperSoft diverge de Zabbix, Guacamole ou Oxidized"
        >
          <span className="status-label">Cadastros Divergentes</span>
          <span className="status-value" style={{ color: divergentAssetsCount > 0 ? '#f59e0b' : 'var(--color-success)' }}>
            {divergentAssetsCount > 0 && <AlertTriangle size={13} style={{ marginRight: 4, display: 'inline' }} />}
            {divergentAssetsCount}
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

      {/* UNIFIED TOOLBAR: VIEW MODE TABS + SEARCH + FILTERS TRIGGER + DENSITY */}
      <div className="assets-filters-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div className="view-mode-tabs">
          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'unified' ? 'active' : ''}`}
            onClick={() => setViewMode('unified')}
          >
            <Layers size={15} />
            <span>Unificada</span>
            <span className="tab-count">{stats.total}</span>
          </button>

          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'zabbix' ? 'active' : ''}`}
            onClick={() => setViewMode('zabbix')}
          >
            <Server size={15} />
            <span>Zabbix</span>
            <span className="tab-count">{stats.with_zabbix}</span>
          </button>

          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'guacamole' ? 'active' : ''}`}
            onClick={() => setViewMode('guacamole')}
          >
            <Terminal size={15} />
            <span>Guacamole</span>
            <span className="tab-count">{stats.with_guacamole}</span>
          </button>

          <button
            type="button"
            className={`view-mode-tab ${viewMode === 'oxidized' ? 'active' : ''}`}
            onClick={() => setViewMode('oxidized')}
          >
            <HardDrive size={15} />
            <span>Oxidized</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', flex: '1', justifyContent: 'flex-end' }}>
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="search-box-form" style={{ minWidth: '220px', flex: '1', maxWidth: '340px' }}>
            <div className="input-wrapper search-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} className="input-icon" />
              <input
                type="text"
                className="form-input search-input"
                placeholder="Buscar por nome, host, IP ou community..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingRight: searchTerm ? '65px' : '10px' }}
              />
              {searchTerm && (
                <div style={{ position: 'absolute', right: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-tertiary, #1f2430)', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                    {displayedAssets.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    title="Limpar busca"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          </form>

          {/* Botão Gatilho de Filtros Retráteis */}
          <button
            type="button"
            className={`btn-filter-trigger ${activeFilterCount > 0 ? 'has-active' : ''}`}
            onClick={() => {
              const next = !showAdvancedFilters;
              setShowAdvancedFilters(next);
              localStorage.setItem('ipersoft_assets_show_filters', String(next));
            }}
            title="Expandir ou recolher filtros de cliente, status e presença"
          >
            <Filter size={14} />
            <span>Filtros</span>
            {activeFilterCount > 0 && (
              <span className="filter-badge-count">{activeFilterCount}</span>
            )}
            {showAdvancedFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {/* Alternador de Densidade */}
          <DensityToggle
            storageKey="assets_table"
            density={density}
            onChange={setDensity}
          />
        </div>
      </div>

      {/* PAINEL RETRÁTIL DE FILTROS AVANÇADOS */}
      {showAdvancedFilters && (
        <div className="advanced-filters-panel">
          <div className="filter-chip-group">
            <span className="filter-chip-label">Grupo / Cliente</span>
            <select
              className="form-input group-select"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              style={{ minWidth: '180px' }}
            >
              <option value="">Todos os Grupos ({stats.groups_count})</option>
              {(stats.groups_list || []).map((g, idx) => (
                <option key={idx} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div className="filter-chip-group">
            <span className="filter-chip-label">Status do Monitoramento</span>
            <select
              className="form-input group-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ minWidth: '180px' }}
            >
              <option value="all">Todos os Status ({stats.total})</option>
              <option value="monitored">Ativos / Monitorados ({stats.monitored})</option>
              <option value="unmonitored">Inativos / Desativados ({stats.unmonitored})</option>
            </select>
          </div>

          <div className="filter-chip-group">
            <span className="filter-chip-label">Vínculo de Plataformas</span>
            <select
              className="form-input group-select"
              value={presenceFilter}
              onChange={(e) => setPresenceFilter(e.target.value)}
              style={{ minWidth: '180px' }}
            >
              <option value="all">Todas as Integrações</option>
              <option value="both">Ambas (Zabbix & Guacamole)</option>
              <option value="missing_guacamole">Pendente no Guacamole</option>
              <option value="missing_zabbix">Pendente no Zabbix</option>
            </select>
          </div>

          <div className="filter-chip-group" style={{ justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', paddingBottom: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showOnlyDivergent}
                onChange={(e) => setShowOnlyDivergent(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Apenas Cadastros Divergentes</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={showOnlyDuplicates}
                onChange={(e) => setShowOnlyDuplicates(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Apenas IPs Duplicados</span>
            </label>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClearFilters}
              style={{ padding: '6px 12px', fontSize: '0.78rem', height: 'auto', alignSelf: 'flex-end', marginLeft: 'auto' }}
            >
              <X size={13} />
              <span>Limpar Filtros ({activeFilterCount})</span>
            </button>
          )}
        </div>
      )}

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

      {showOnlyDivergent && (
        <div className="duplicate-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} color="#f59e0b" />
            <span>
              Exibindo <strong>{displayedAssets.length} equipamentos</strong> com diferenças entre o IperSoft e Zabbix, Guacamole ou Oxidized. Clique na coluna <strong>Plataformas & Sincronia</strong> de qualquer linha para inspecionar e sincronizar.
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
            onClick={() => setShowOnlyDivergent(false)}
          >
            Ver Todos os Equipamentos
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

            {/* Detecção Inteligente de SO */}
            <div className="bulk-action-group">
              <span className="bulk-group-label">Sistema:</span>
              <button 
                type="button" 
                className="btn-bulk-action"
                style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24' }}
                onClick={handleBulkDetectOS}
                disabled={isBulkLoading}
                title="Detectar automaticamente o SO (RouterOS v6/v7, DmOS, VRP, Cisco, ACOS, Linux) via SNMP/SSH e salvar"
              >
                <Zap size={13} className={isBulkLoading ? 'spin-icon' : ''} /> Detectar SO ({selectedAssetIds.length})
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
          <table className={`users-table assets-table ${density === 'compact' ? 'is-compact' : ''}`}>
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
                    <th>Plataformas & Sincronia</th>
                    <th>Conectividade</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAssets.map((asset) => {
                    const hasGuac = Boolean((asset.guacamole && asset.guacamole.length > 0) || asset.guacamole_connection_id);
                    const cleanIp = asset.ip_address?.trim();
                    const isDup = cleanIp && cleanIp !== '-' && duplicateIpMap[cleanIp] > 1;
                    const audit = auditByAssetId[asset.id]?.integrations || auditAssetIntegrations(asset, vlogsActivity);
                    const conn = auditByAssetId[asset.id]?.connectivity || auditAssetConnectivity(asset);
                    const isPlatOpen = openPopover?.assetId === asset.id && openPopover?.type === 'platforms';
                    const isConnOpen = openPopover?.assetId === asset.id && openPopover?.type === 'connectivity';

                    const platTriggerClass = audit.hasDivergence
                      ? 'has-divergence'
                      : (audit.hasError ? 'has-error' : (audit.okCount > 0 ? 'all-ok' : 'all-disabled'));

                    const connTriggerClass = conn.failCount > 0
                      ? 'has-error'
                      : (conn.totalCount > 0 && conn.okCount === conn.totalCount
                          ? 'all-ok'
                          : (conn.timeoutCount > 0 || conn.okCount > 0 ? 'has-divergence' : 'all-disabled'));

                    return (
                      <tr 
                        key={asset.id} 
                        className={`clickable-asset-row ${isDup ? 'row-duplicate-ip' : ''} ${audit.hasDivergence ? 'row-divergent' : ''} ${selectedAssetIds.includes(asset.id) ? 'row-selected' : ''}`}
                        onClick={(e) => {
                          // Evita disparar se clicou num botão específico, checkbox ou popover
                          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input') || e.target.closest('.status-popover-wrapper')) return;
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className="asset-hostname" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                                {asset.hostname}
                              </span>
                              {asset.snmp_hostname && asset.snmp_hostname.toLowerCase() !== (asset.hostname || '').toLowerCase() && (
                                <span
                                  style={{
                                    fontSize: '0.68rem',
                                    fontFamily: 'var(--font-mono)',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: 'rgba(16, 185, 129, 0.12)',
                                    color: '#10b981',
                                    fontWeight: 500
                                  }}
                                  title="Hostname real obtido via diagnóstico SNMP (sysName)"
                                >
                                  SNMP: {asset.snmp_hostname}
                                </span>
                              )}
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

                        {/* PLATAFORMAS & SINCRONIA (AGRUPADO COM DROPDOWN DE DIVERGÊNCIAS) */}
                        <td>
                          <div className="status-popover-wrapper" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`grouped-status-trigger ${platTriggerClass} ${isPlatOpen ? 'is-open' : ''}`}
                              onClick={(e) => togglePopover(e, asset.id, 'platforms')}
                              title={
                                audit.hasDivergence
                                  ? `${audit.diffs.length} divergência(s) encontrada(s) — clique para comparar e sincronizar`
                                  : 'Clique para inspecionar o status detalhado das integrações'
                              }
                            >
                              <span className="grouped-summary-main">
                                {audit.hasDivergence ? (
                                  <>
                                    <AlertTriangle size={12} />
                                    <span>{audit.diffs.length} {audit.diffs.length === 1 ? 'Diverg.' : 'Divergs.'}</span>
                                  </>
                                ) : audit.hasError ? (
                                  <>
                                    <XCircle size={12} />
                                    <span>Falha</span>
                                  </>
                                ) : audit.okCount > 0 ? (
                                  <>
                                    <CheckCircle2 size={12} />
                                    <span>{audit.okCount}/{audit.activeCount || audit.okCount} OK</span>
                                  </>
                                ) : (
                                  <>
                                    <PowerOff size={12} />
                                    <span>Desativado</span>
                                  </>
                                )}
                              </span>

                              <span className="grouped-mini-tags">
                                {audit.platforms.map((p) => (
                                  <span
                                    key={p.key}
                                    className={`mini-plat-tag mini-plat-${p.status}`}
                                    title={`${p.label}: ${p.statusLabel}`}
                                  >
                                    <span className={`presence-dot ${p.dotColor}`}></span>
                                    {p.short}
                                  </span>
                                ))}
                              </span>

                              <ChevronDown size={12} className={`trigger-chevron ${isPlatOpen ? 'rotated' : ''}`} />
                            </button>

                            {isPlatOpen && (
                              <div
                                className={`status-popover-dropdown ${openPopover.openUpward ? 'open-up' : ''}`}
                                style={{
                                  position: 'fixed',
                                  left: `${openPopover.left}px`,
                                  top: openPopover.top !== undefined ? `${openPopover.top}px` : undefined,
                                  bottom: openPopover.bottom !== undefined ? `${openPopover.bottom}px` : undefined,
                                  width: `${openPopover.width}px`
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="popover-header">
                                  <div className="popover-title-group">
                                    <span className="popover-title">{asset.name}</span>
                                    <span className="popover-subtitle">
                                      Auditoria de Integrações • {asset.ip_address || '-'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="popover-close-btn"
                                    onClick={() => setOpenPopover(null)}
                                    title="Fechar"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>

                                <div className="popover-body">
                                  {audit.platforms.map((plat) => {
                                    const IconComp = plat.key === 'zabbix'
                                      ? Server
                                      : (plat.key === 'guacamole'
                                          ? Terminal
                                          : (plat.key === 'oxidized' ? HardDrive : Radio));
                                    const isPlatSyncing = syncingKey === `${asset.id}:${plat.key}`;
                                    return (
                                      <div key={plat.key} className={`popover-section plat-row-${plat.status}`}>
                                        <div className="popover-section-head">
                                          <div className="popover-section-name">
                                            <IconComp size={13} />
                                            <span>{plat.label}</span>
                                            <span className={`popover-pill pill-${plat.status}`}>
                                              <span className={`presence-dot ${plat.dotColor}`}></span>
                                              {plat.statusLabel}
                                            </span>
                                          </div>
                                          {isAdmin && plat.canSync && (plat.diffs.length > 0 || plat.status === 'error') && (
                                            <button
                                              type="button"
                                              className="popover-inline-sync-btn"
                                              onClick={() => handleQuickSyncPlatform(asset, plat.key)}
                                              disabled={Boolean(syncingKey)}
                                              title={`Enviar dados do IperSoft para ${plat.label}`}
                                            >
                                              <RefreshCw size={11} className={isPlatSyncing ? 'spin-icon' : ''} />
                                              <span>Sincronizar</span>
                                            </button>
                                          )}
                                        </div>

                                        {plat.diffs.length > 0 ? (
                                          <div className="popover-diff-list">
                                            {plat.diffs.map((d, dIdx) => (
                                              <div key={dIdx} className="diff-item-row">
                                                <span className="diff-field-label">{d.field}:</span>
                                                <div className="diff-values-flow">
                                                  <span className="diff-old" title={`Na plataforma (${plat.label})`}>
                                                    {d.platformVal}
                                                  </span>
                                                  <span className="diff-arrow">→</span>
                                                  <span className="diff-new" title="No IperSoft (referência)">
                                                    {d.ipersoftVal}
                                                  </span>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="popover-section-summary">{plat.summary}</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>

                                <div className="popover-footer">
                                  {isAdmin && audit.hasDivergence && (
                                    <button
                                      type="button"
                                      className="btn-primary popover-footer-btn"
                                      onClick={() => handleQuickSyncPlatform(asset, 'all')}
                                      disabled={Boolean(syncingKey)}
                                    >
                                      <RefreshCw size={12} className={syncingKey === `${asset.id}:all` ? 'spin-icon' : ''} />
                                      <span>Sincronizar Tudo</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-secondary popover-footer-btn"
                                    onClick={() => {
                                      setOpenPopover(null);
                                      if (onSelectAsset) onSelectAsset(asset.id);
                                    }}
                                  >
                                    <Edit2 size={12} />
                                    <span>Abrir Detalhes</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* CONECTIVIDADE (AGRUPADO COM DROPDOWN DE TESTES) */}
                        <td>
                          <div className="status-popover-wrapper" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`grouped-status-trigger ${connTriggerClass} ${isConnOpen ? 'is-open' : ''}`}
                              onClick={(e) => togglePopover(e, asset.id, 'connectivity')}
                              title="Clique para ver detalhes de Ping, SNMP e Acesso Remoto"
                            >
                              <span className="grouped-summary-main">
                                {conn.failCount > 0 ? (
                                  <>
                                    <XCircle size={12} />
                                    <span>{conn.failCount} {conn.failCount === 1 ? 'Falha' : 'Falhas'}</span>
                                  </>
                                ) : conn.timeoutCount > 0 ? (
                                  <>
                                    <Clock size={12} />
                                    <span>{conn.timeoutCount} Timeout</span>
                                  </>
                                ) : conn.totalCount > 0 && conn.okCount === conn.totalCount ? (
                                  <>
                                    <CheckCircle2 size={12} />
                                    <span>{conn.okCount}/{conn.totalCount} OK</span>
                                  </>
                                ) : conn.okCount > 0 ? (
                                  <>
                                    <Activity size={12} />
                                    <span>{conn.okCount}/{conn.totalCount} OK</span>
                                  </>
                                ) : (
                                  <>
                                    <Activity size={12} />
                                    <span>Sem teste</span>
                                  </>
                                )}
                              </span>

                              <span className="grouped-mini-tags">
                                {conn.tests.map((t) => (
                                  <span
                                    key={t.key}
                                    className="mini-plat-tag"
                                    title={`${t.label}: ${t.statusLabel}`}
                                  >
                                    <span className={`presence-dot ${t.dotColor}`}></span>
                                    {t.short}
                                  </span>
                                ))}
                              </span>

                              <ChevronDown size={12} className={`trigger-chevron ${isConnOpen ? 'rotated' : ''}`} />
                            </button>

                            {isConnOpen && (
                              <div
                                className={`status-popover-dropdown ${openPopover.openUpward ? 'open-up' : ''}`}
                                style={{
                                  position: 'fixed',
                                  left: `${openPopover.left}px`,
                                  top: openPopover.top !== undefined ? `${openPopover.top}px` : undefined,
                                  bottom: openPopover.bottom !== undefined ? `${openPopover.bottom}px` : undefined,
                                  width: `${openPopover.width}px`
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="popover-header">
                                  <div className="popover-title-group">
                                    <span className="popover-title">Testes de Rede</span>
                                    <span className="popover-subtitle">
                                      {asset.name} • {asset.ip_address || '-'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="popover-close-btn"
                                    onClick={() => setOpenPopover(null)}
                                    title="Fechar"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>

                                <div className="popover-body">
                                  {conn.tests.map((t) => (
                                    <div key={t.key} className="popover-section">
                                      <div className="popover-section-head">
                                        <span className="popover-section-name">{t.label}</span>
                                        <span className={`popover-pill pill-${t.status === 'ok' ? 'ok' : (t.status === 'timeout' ? 'divergent' : (t.status === 'failed' ? 'error' : 'disabled'))}`}>
                                          <span className={`presence-dot ${t.dotColor}`}></span>
                                          {t.statusLabel}
                                        </span>
                                      </div>
                                      <div className="popover-section-summary">{t.detail}</div>
                                    </div>
                                  ))}
                                </div>

                                <div className="popover-footer">
                                  <button
                                    type="button"
                                    className="btn-primary popover-footer-btn"
                                    onClick={() => handleQuickTest(asset)}
                                    disabled={retestingId === asset.id}
                                  >
                                    <Activity size={12} className={retestingId === asset.id ? 'spin-icon' : ''} />
                                    <span>{retestingId === asset.id ? 'Testando...' : 'Testar Conectividade Agora'}</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* AÇÕES */}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            {hasGuac && getGuacamoleLaunchUrl(asset) && (
                              <a
                                href={getGuacamoleLaunchUrl(asset)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="guac-action-icon"
                                title="Abrir terminal remoto Guacamole em nova aba"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Terminal size={13} />
                              </a>
                            )}

                            <button
                              type="button"
                              className="btn-open-detail"
                              onClick={() => onSelectAsset && onSelectAsset(asset.id)}
                              title="Abrir tela de detalhes e sincronização do equipamento"
                            >
                              <Edit2 size={13} />
                              <span>Detalhes</span>
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
                            title={zbxStatus === 'monitored' ? 'Clique para desativar no IperSoft' : 'Clique para reativar no IperSoft'}
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
                            className="btn-open-detail"
                            onClick={() => onSelectAsset && onSelectAsset(asset.id)}
                            title="Abrir detalhes e parâmetros Zabbix"
                          >
                            <Edit2 size={13} />
                            <span>Detalhes</span>
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
                            <button
                              className="btn-open-detail"
                              onClick={() => onSelectAsset && onSelectAsset(asset.id)}
                              title="Abrir detalhes e credenciais do ativo"
                            >
                              <Edit2 size={13} />
                              <span>Detalhes</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}

            {/* 4. ABA OXIDIZED (BACKUP DE CONFIGURAÇÕES) */}
            {viewMode === 'oxidized' && (
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
                    {renderSortHeader('IP Destino', 'ip')}
                    <th>Modelo de SO</th>
                    <th>Grupo / Cliente</th>
                    <th>Timeout (s)</th>
                    <th>Status do Último Backup</th>
                    <th>Última Coleta</th>
                    <th style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAssets.map((asset) => {
                    const ox = asset.oxidized;
                    const oxStatus = ox?.status;
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
                          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                            <code style={{ fontSize: '0.82rem', fontWeight: 600 }}>{asset.ip_address || '-'}</code>
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
                          <span className="mini-badge" style={{ textTransform: 'uppercase', color: '#a855f7' }}>
                            {ox?.model || asset.backup_model || 'RouterOS'}
                          </span>
                        </td>
                        <td>
                          <span className="group-pill-badge">{ox?.group || asset.client_group || 'default'}</span>
                        </td>
                        <td>
                          <span className="port-tag">{asset.backup_timeout || 30}s</span>
                        </td>
                        <td>
                          {asset.backup_enabled === false ? (
                            <span className="status-pill-none">Backup Desabilitado</span>
                          ) : oxStatus === 'success' ? (
                            <span className="status-pill-ok">
                              <CheckCircle2 size={11} /> Sucesso {ox?.backup_time_taken ? `(${ox.backup_time_taken.toFixed(1)}s)` : ''}
                            </span>
                          ) : oxStatus === 'fail' || oxStatus === 'no_connection' ? (
                            <span className="status-pill-fail">
                              <XCircle size={11} /> Falha ({oxStatus})
                            </span>
                          ) : (
                            <span className="status-pill-timeout">
                              <Clock size={11} /> Aguardando / Pendente
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {ox?.last_backup ? new Date(ox.last_backup).toLocaleString('pt-BR') : '-'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn-open-detail"
                            onClick={() => onSelectAsset && onSelectAsset(asset.id)}
                            title="Abrir detalhes e backup do ativo"
                          >
                            <FileCode size={13} />
                            <span>Ver Backup / Detalhes</span>
                          </button>
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
    </div>
  );
};
