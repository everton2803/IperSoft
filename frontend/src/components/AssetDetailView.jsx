import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ArrowLeft, 
  Server, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  XCircle, 
  Activity, 
  RefreshCw, 
  Save, 
  Terminal, 
  Shield, 
  Zap, 
  ExternalLink, 
  Eye, 
  EyeOff, 
  Copy, 
  AlertTriangle,
  Layers,
  Radio,
  Cpu, 
  Monitor, 
  Check, 
  Trash2, 
  FileCode,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Search,
  Maximize2,
  Minimize2,
  Info,
  RotateCcw,
  FileText,
  Globe,
  ShieldCheck,
  Archive,
  Folder
} from 'lucide-react';
import { authService, diagnosticsService } from '../services/api';

// =========================================================================
// SUB-COMPONENTE: GRÁFICO INTERATIVO SVG PARA ITENS NUMÉRICOS DO ZABBIX
// =========================================================================
const ZabbixNumericChart = ({ history, units, period, item }) => {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  const points = useMemo(() => {
    if (!history || history.length === 0) return [];
    return history
      .map(h => ({
        clock: parseInt(h.clock, 10),
        val: parseFloat(h.value) || 0
      }))
      .filter(p => !isNaN(p.val) && !isNaN(p.clock))
      .sort((a, b) => a.clock - b.clock);
  }, [history]);

  const stats = useMemo(() => {
    if (points.length === 0) return { min: 0, max: 0, avg: 0, last: 0 };
    const vals = points.map(p => p.val);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const last = vals[vals.length - 1];
    return { min, max, avg, last };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="chart-empty-state">
        <Clock size={24} color="var(--text-muted)" />
        <span>Nenhum dado numérico registrado para este item no período selecionado ({period}).</span>
      </div>
    );
  }

  // Dimensões do SVG
  const width = 640;
  const height = 180;
  const padLeft = 45;
  const padRight = 15;
  const padTop = 15;
  const padBottom = 28;

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const minVal = stats.min === stats.max ? stats.min * 0.9 : stats.min;
  const maxVal = stats.min === stats.max ? (stats.max === 0 ? 1 : stats.max * 1.1) : stats.max;
  const valRange = (maxVal - minVal) || 1;

  const minClock = points[0].clock;
  const maxClock = points[points.length - 1].clock;
  const clockRange = Math.max(1, maxClock - minClock);

  const coords = points.map(p => {
    const x = padLeft + ((p.clock - minClock) / clockRange) * innerW;
    const y = padTop + innerH - ((p.val - minVal) / valRange) * innerH;
    return { x, y, clock: p.clock, val: p.val };
  });

  // Linha contínua
  const pathD = coords.reduce((acc, pt, idx) => {
    return `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }, '');

  // Área com gradiente
  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)},${padTop + innerH} L ${coords[0].x.toFixed(1)},${padTop + innerH} Z`;

  const hoveredPoint = hoverIndex !== null ? coords[hoverIndex] : null;

  const formatClock = (clk) => {
    const d = new Date(clk * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');

    if (period === '7d') {
      return `${day}/${month}`;
    }
    if (period === '24h') {
      return `${day}/${month} ${hours}h`;
    }
    return `${hours}:${mins}`;
  };

  const handleMouseMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;

    // Encontra o ponto mais próximo
    let closestIdx = 0;
    let minDiff = Infinity;
    coords.forEach((pt, idx) => {
      const diff = Math.abs(pt.x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    setHoverIndex(closestIdx);
  };

  return (
    <div className="zbx-chart-container">
      {/* Resumo Estatístico */}
      <div className="zbx-chart-stats-bar">
        <div className="stat-item">
          <span className="stat-label">Último:</span>
          <span className="stat-val highlight">{stats.last.toFixed(2)} {units}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Mínimo:</span>
          <span className="stat-val">{stats.min.toFixed(2)} {units}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Média:</span>
          <span className="stat-val">{stats.avg.toFixed(2)} {units}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Máximo:</span>
          <span className="stat-val">{stats.max.toFixed(2)} {units}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Pontos Coletados:</span>
          <span className="stat-val">{points.length}</span>
        </div>
      </div>

      <div className="zbx-svg-wrapper">
        <svg 
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`} 
          className="zbx-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00bcd4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#00bcd4" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid horizontal */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + innerH / 2} x2={width - padRight} y2={padTop + innerH / 2} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + innerH} x2={width - padRight} y2={padTop + innerH} stroke="rgba(255,255,255,0.15)" />

          {/* Eixo Y Labels */}
          <text x={padLeft - 6} y={padTop + 4} textAnchor="end" fill="var(--text-muted)" fontSize="9">
            {maxVal.toFixed(1)}
          </text>
          <text x={padLeft - 6} y={padTop + innerH / 2 + 3} textAnchor="end" fill="var(--text-muted)" fontSize="9">
            {((maxVal + minVal) / 2).toFixed(1)}
          </text>
          <text x={padLeft - 6} y={padTop + innerH} textAnchor="end" fill="var(--text-muted)" fontSize="9">
            {minVal.toFixed(1)}
          </text>

          {/* Área e Linha */}
          <path d={areaD} fill="url(#chartGradient)" />
          <path d={pathD} fill="none" stroke="#00bcd4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Eixo X Labels (5 marcas de tempo uniformes) */}
          <text x={padLeft} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="start">
            {formatClock(minClock)}
          </text>
          <text x={padLeft + innerW * 0.25} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="middle">
            {formatClock(minClock + clockRange * 0.25)}
          </text>
          <text x={padLeft + innerW * 0.5} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="middle">
            {formatClock(minClock + clockRange * 0.5)}
          </text>
          <text x={padLeft + innerW * 0.75} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="middle">
            {formatClock(minClock + clockRange * 0.75)}
          </text>
          <text x={width - padRight} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="end">
            {formatClock(maxClock)}
          </text>

          {/* Hover Crosshair e Ponto */}
          {hoveredPoint && (
            <g>
              <line 
                x1={hoveredPoint.x} 
                y1={padTop} 
                x2={hoveredPoint.x} 
                y2={padTop + innerH} 
                stroke="#fff" 
                strokeWidth="1" 
                strokeDasharray="2 2" 
                opacity="0.6"
              />
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="4.5" fill="#fff" stroke="#00bcd4" strokeWidth="2.5" />
            </g>
          )}
        </svg>

        {/* Tooltip HTML Fluido */}
        {hoveredPoint && (
          <div 
            className="chart-tooltip-box"
            style={{
              left: `${(hoveredPoint.x / width) * 100}%`,
              top: `${(hoveredPoint.y / height) * 100}%`
            }}
          >
            <div className="tip-time">{new Date(hoveredPoint.clock * 1000).toLocaleString('pt-BR')}</div>
            <div className="tip-val">
              <strong>{hoveredPoint.val.toFixed(2)}</strong> {units}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


// =========================================================================
// SUB-COMPONENTE: LINHA DO TEMPO / TABELA PARA ITENS NÃO-NUMÉRICOS
// =========================================================================
const ZabbixTextTimeline = ({ history, item }) => {
  if (!history || history.length === 0) {
    return (
      <div className="chart-empty-state">
        <Clock size={24} color="var(--text-muted)" />
        <span>Nenhum evento registrado no histórico recente deste item.</span>
      </div>
    );
  }

  // Agrupa ou ordena eventos
  const events = [...history].reverse(); // Do mais recente para o mais antigo

  const isStatusText = (val) => {
    const v = String(val).toLowerCase().trim();
    if (v === 'up' || v === '1' || v === 'active' || v === 'running') return 'up';
    if (v === 'down' || v === '0' || v === 'inactive' || v === 'stopped') return 'down';
    return 'neutral';
  };

  return (
    <div className="zbx-timeline-container">
      <div className="timeline-header-info">
        <Info size={14} color="var(--color-primary)" />
        <span>
          Exibindo histórico de estados e mudanças em ordem cronológica (útil para auditar flaps e falsos alarmes):
        </span>
      </div>

      <div className="timeline-events-list">
        {events.map((ev, idx) => {
          const prevEv = events[idx + 1];
          const hasChanged = prevEv && String(prevEv.value) !== String(ev.value);
          const statusKind = isStatusText(ev.value);

          return (
            <div key={idx} className={`timeline-row ${hasChanged ? 'timeline-row-changed' : ''}`}>
              <div className="timeline-clock">
                <Clock size={12} />
                <span>{new Date(ev.clock * 1000).toLocaleString('pt-BR')}</span>
              </div>

              <div className="timeline-badge-wrapper">
                <span className={`status-pill ${statusKind === 'up' ? 'status-pill-ok' : statusKind === 'down' ? 'status-pill-fail' : 'status-pill-neutral'}`}>
                  {String(ev.value)}
                </span>
                {hasChanged && (
                  <span className="badge-change-indicator" title={`Alterado de "${prevEv.value}"`}>
                    Mudança de estado
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


// =========================================================================
// COMPONENTE PRINCIPAL: ASSET DETAIL VIEW
// =========================================================================
export const AssetDetailView = ({ assetId, onBack, isAdmin }) => {
  const [comparison, setComparison] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showGuacPassword, setShowGuacPassword] = useState(false);
  const [guacBaseUrl, setGuacBaseUrl] = useState('');

  // 1. Aba Ativa na Tela de Detalhes ('operation' | 'config' | 'integrations')
  const [activeTab, setActiveTab] = useState('operation');

  // 2. Estados de Ações e Sincronizações
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncingZbx, setIsSyncingZbx] = useState(false);
  const [isSyncingGuac, setIsSyncingGuac] = useState(false);
  const [isSyncingOx, setIsSyncingOx] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isRemovingGuac, setIsRemovingGuac] = useState(false);
  const [isTogglingZbxStatus, setIsTogglingZbxStatus] = useState(false);
  const [ignoreGuacamole, setIgnoreGuacamole] = useState(false);
  const [isTogglingGuacStatus, setIsTogglingGuacStatus] = useState(false);

  // Estados Oxidized
  const [isTriggeringOxBackup, setIsTriggeringOxBackup] = useState(false);
  const [isLoadingOxConfig, setIsLoadingOxConfig] = useState(false);
  const [isReloadingOx, setIsReloadingOx] = useState(false);
  const [isTogglingOxStatus, setIsTogglingOxStatus] = useState(false);
  const [oxConfigModalOpen, setOxConfigModalOpen] = useState(false);
  const [oxConfigContent, setOxConfigContent] = useState('');
  const [oxConfigNodeName, setOxConfigNodeName] = useState('');
  const [copiedOxConfig, setCopiedOxConfig] = useState(false);

  // 3. Estados de Lazy Loading das Integrações (Carregamento sob Demanda ao Clicar)
  const [zbxDetails, setZbxDetails] = useState(null);
  const [isLoadingZbxDetails, setIsLoadingZbxDetails] = useState(false);

  const [guacDetails, setGuacDetails] = useState(null);
  const [isLoadingGuacDetails, setIsLoadingGuacDetails] = useState(false);

  const [oxDetails, setOxDetails] = useState(null);
  const [isLoadingOxDetails, setIsLoadingOxDetails] = useState(false);

  const [zbxProblems, setZbxProblems] = useState(null);
  const [isLoadingZbxProblems, setIsLoadingZbxProblems] = useState(false);
  const [acknowledgingEvents, setAcknowledgingEvents] = useState({});
  const [closingEvents, setClosingEvents] = useState({});

  // Estados VictoriaLogs (Syslog)
  const [deviceLogs, setDeviceLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsTimeRange, setLogsTimeRange] = useState('5m');
  const [logsLimit, setLogsLimit] = useState(250);
  const [logsSearch, setLogsSearch] = useState('');
  const [logsLevel, setLogsLevel] = useState('');
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(false);
  const [copiedLogIdx, setCopiedLogIdx] = useState(null);

  // Saúde e integridade dos logs (Recepção e Sincronismo de Relógio)
  const [logsHealth, setLogsHealth] = useState(null);
  const [isLoadingLogsHealth, setIsLoadingLogsHealth] = useState(false);

  const fetchLogsHealth = async () => {
    setIsLoadingLogsHealth(true);
    try {
      const data = await authService.getAssetLogsHealth(assetId);
      setLogsHealth(data);
    } catch (err) {
      console.warn('Erro ao verificar saúde dos logs:', err.message);
    } finally {
      setIsLoadingLogsHealth(false);
    }
  };

  const fetchDeviceLogs = async (overrideRange, overrideLevel, overrideSearch, overrideLimit) => {
    setIsLoadingLogs(true);
    try {
      const range = overrideRange !== undefined ? overrideRange : logsTimeRange;
      const lvl = overrideLevel !== undefined ? overrideLevel : logsLevel;
      const srch = overrideSearch !== undefined ? overrideSearch : logsSearch;
      const lim = overrideLimit !== undefined ? overrideLimit : logsLimit;
      const res = await authService.getAssetLogs(assetId, {
        timeRange: range,
        level: lvl,
        search: srch,
        limit: lim
      });
      setDeviceLogs(res.logs || []);
      // Atualiza saúde do fluxo e checagem de relógio em segundo plano
      fetchLogsHealth();
    } catch (err) {
      console.warn('Erro ao carregar logs do VictoriaLogs:', err.message);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Filtro multi-termo instantâneo no cliente (Estilo Bitwarden / Raindrop.io)
  const filteredLogs = useMemo(() => {
    if (!logsSearch || !logsSearch.trim()) return deviceLogs;
    const tokens = logsSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return deviceLogs.filter(log => {
      const fullText = `${log.timestamp || ''} ${log.level || ''} ${log.message || ''} ${log.hostname || ''} ${log.remote_ip || ''}`.toLowerCase();
      // Todas as sequências digitadas devem estar presentes na linha (condição E)
      return tokens.every(token => fullText.includes(token));
    });
  }, [deviceLogs, logsSearch]);

  const renderHighlightedMessage = (message, search) => {
    if (!search || !search.trim()) return message;
    const tokens = search.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return message;

    const escapedTokens = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
    const parts = message.split(regex);

    return parts.map((part, i) => {
      const isMatch = tokens.some(t => t.toLowerCase() === part.toLowerCase());
      return isMatch ? (
        <mark
          key={i}
          style={{
            background: 'rgba(255, 235, 59, 0.35)',
            color: '#fff',
            padding: '1px 3px',
            borderRadius: '2px',
            fontWeight: '600'
          }}
        >
          {part}
        </mark>
      ) : (
        part
      );
    });
  };

  const handleToggleAcknowledge = async (prob) => {
    if (!prob.eventid) {
      setFeedback({ type: 'error', message: 'Este alarme não possui identificador de evento registrado no Zabbix.' });
      return;
    }
    const newStatus = !prob.acknowledged;
    setAcknowledgingEvents(prev => ({ ...prev, [prob.eventid]: true }));
    try {
      await authService.acknowledgeZabbixProblem({
        eventid: prob.eventid,
        triggerid: prob.triggerid,
        acknowledged: newStatus
      });
      setZbxProblems(prev => (prev || []).map(p => 
        p.eventid === prob.eventid ? { ...p, acknowledged: newStatus } : p
      ));
      setFeedback({
        type: 'success',
        message: newStatus 
          ? `Alarme "${prob.description}" marcado como reconhecido no Zabbix.` 
          : `Reconhecimento do alarme "${prob.description}" desmarcado no Zabbix.`
      });
    } catch (err) {
      setFeedback({ type: 'error', message: `Erro ao alterar reconhecimento: ${err.message}` });
    } finally {
      setAcknowledgingEvents(prev => ({ ...prev, [prob.eventid]: false }));
    }
  };

  const handleCloseProblem = async (prob) => {
    if (!prob.eventid && !prob.triggerid) {
      setFeedback({ type: 'error', message: 'Este alarme não possui identificador no Zabbix.' });
      return;
    }
    if (!window.confirm(`Deseja realmente encerrar este alarme no Zabbix?\n\n"${prob.description}"`)) {
      return;
    }

    const targetKey = prob.eventid || prob.triggerid;
    setClosingEvents(prev => ({ ...prev, [targetKey]: true }));
    try {
      const res = await authService.closeZabbixProblem({
        eventid: prob.eventid,
        triggerid: prob.triggerid
      });
      setZbxProblems(prev => (prev || []).map(p => 
        (p.triggerid === prob.triggerid || (p.eventid && p.eventid === prob.eventid))
          ? { ...p, is_closed: true, acknowledged: true, eventid: res.eventid || p.eventid } 
          : p
      ));
      setFeedback({
        type: 'success',
        message: `Alarme "${prob.description}" encerrado com sucesso no Zabbix.`
      });
      // Após breve intervalo (1.2s), remove o alarme encerrado da lista
      setTimeout(() => {
        setZbxProblems(prev => (prev || []).filter(p => 
          !(p.triggerid === prob.triggerid || (p.eventid && p.eventid === prob.eventid))
        ));
      }, 1200);
    } catch (err) {
      setFeedback({ type: 'error', message: `Erro ao encerrar alarme no Zabbix: ${err.message}` });
    } finally {
      setClosingEvents(prev => ({ ...prev, [targetKey]: false }));
    }
  };

  const [zbxItems, setZbxItems] = useState(null);
  const [isLoadingZbxItems, setIsLoadingZbxItems] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  const [selectedItem, setSelectedItem] = useState(null);
  const [itemHistory, setItemHistory] = useState(null);
  const [itemHistoryPeriod, setItemHistoryPeriod] = useState('1h');
  const [isLoadingItemHistory, setIsLoadingItemHistory] = useState(false);

  const [guacLaunchData, setGuacLaunchData] = useState(null);
  const [isLoadingGuacLaunch, setIsLoadingGuacLaunch] = useState(false);
  const [showEmbeddedTerminal, setShowEmbeddedTerminal] = useState(false);

  // Menu Dropdown de Acesso Web (HTTP / HTTPS)
  const [showWebMenu, setShowWebMenu] = useState(false);
  const webMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (webMenuRef.current && !webMenuRef.current.contains(event.target)) {
        setShowWebMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Seleção de testes ativos para este equipamento
  const [enabledTests, setEnabledTests] = useState({
    icmp: true,
    snmp: true,
    remote: true
  });

  const [availableGroups, setAvailableGroups] = useState([]);

  // Formulário editável do IperSoft
  const [formData, setFormData] = useState({
    name: '',
    hostname: '',
    ip_address: '',
    dns: '',
    client_group: '',
    port: '10050',
    snmp_community: 'ipermonitor',
    status: 'monitored',
    zabbix_host: '',
    zabbix_name: '',
    guacamole_connection_name: '',
    remote_protocol: 'ssh',
    remote_port: '22',
    remote_username: '',
    remote_password: '',
    backup_model: 'RouterOS',
    backup_enabled: true,
    backup_timeout: 30,
    web_protocol: 'http',
    web_port: '',
    file_backup_protocol: 'disabled',
    file_backup_folder: '',
    file_backup_pattern: '',
    os_profile: 'generic_ssh'
  });

  const [isDetectingOS, setIsDetectingOS] = useState(false);

  // Status de Ativação por Integração (acessíveis em todo o componente e useEffects)
  const zbxActive = formData.status === 'monitored';
  const guacActive = !ignoreGuacamole;
  const oxActive = formData.backup_enabled !== false;

  // Carregar dados locais canônicos
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [compData, guacCfg, statsData] = await Promise.all([
        authService.getAssetComparison(assetId),
        authService.getGuacamoleConfig().catch(() => null),
        authService.getAssetStats().catch(() => null)
      ]);

      if (statsData?.groups_list) {
        setAvailableGroups(statsData.groups_list);
      }

      setComparison(compData);
      const ipData = compData.ipersoft;

      setFormData({
        name: ipData.name || '',
        hostname: ipData.hostname || '',
        ip_address: ipData.ip_address || '',
        dns: ipData.dns || '',
        client_group: ipData.client_group || (ipData.host_groups?.[0] || ''),
        port: ipData.port || '10050',
        snmp_community: ipData.snmp_community || 'ipermonitor',
        status: ipData.status || 'monitored',
        zabbix_host: compData.zabbix?.host || compData.zabbix?.hostname || ipData.hostname || ipData.name || '',
        zabbix_name: compData.zabbix?.name || ipData.name || '',
        guacamole_connection_name: ipData.name || '',
        remote_protocol: ipData.remote_protocol || 'ssh',
        remote_port: ipData.remote_port || '22',
        remote_username: ipData.remote_username || '',
        remote_password: ipData.remote_password || '',
        backup_model: ipData.backup_model || 'RouterOS',
        backup_enabled: ipData.backup_enabled !== false,
        backup_timeout: ipData.backup_timeout || 30,
        web_protocol: ipData.web_protocol || 'http',
        web_port: ipData.web_port || '',
        file_backup_protocol: ipData.file_backup_protocol || 'disabled',
        file_backup_folder: ipData.file_backup_folder || ipData.client_group || '',
        file_backup_pattern: ipData.file_backup_pattern || '',
        os_profile: ipData.os_profile || 'generic_ssh'
      });

      if (ipData.enabled_tests) {
        setEnabledTests({
          icmp: ipData.enabled_tests.icmp !== false,
          snmp: ipData.enabled_tests.snmp !== false,
          remote: ipData.enabled_tests.remote !== false
        });
      }

      setIgnoreGuacamole(Boolean(compData?.guacamole?.ignore_guacamole));

      const rawPublicGuac = compData?.guacamole?.public_url || guacCfg?.public_url || guacCfg?.url || 'https://guacamoles.iper.net.br/guacamole';
      let clean = rawPublicGuac.trim().replace(/\/+$/, '');
      if (clean.includes('10.10.1.2:8086') || clean.startsWith('http://')) {
        clean = 'https://guacamoles.iper.net.br/guacamole';
      }
      if (!clean.endsWith('/guacamole') && !clean.includes('/guacamole/')) {
        clean = `${clean}/guacamole`;
      }
      setGuacBaseUrl(clean);
      fetchLogsHealth();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao carregar dados do equipamento.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (assetId) {
      loadData();
    }
  }, [assetId]);

  // =========================================================================
  // LAZY LOADERS: DISPARADOS AO EXPANDIR CADA LINHA
  // =========================================================================

  // Linha 2: Dados no Zabbix
  const fetchZabbixDetails = async () => {
    if (isLoadingZbxDetails) return;
    setIsLoadingZbxDetails(true);
    try {
      const data = await authService.getAssetZabbixDetails(assetId);
      setZbxDetails(data);
    } catch (err) {
      setZbxDetails(null);
      // Se não for erro de cadastro inexistente (404), mostra o feedback
      if (!err.message?.includes('não possui cadastro') && !err.message?.includes('404')) {
        setFeedback({ type: 'error', message: `Erro ao buscar detalhes no Zabbix: ${err.message}` });
      }
    } finally {
      setIsLoadingZbxDetails(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'integrations' && !zbxDetails && zbxActive) {
      fetchZabbixDetails();
    }
  }, [activeTab, zbxActive]);

  // Linha 3: Dados no Guacamole
  const fetchGuacamoleDetails = async () => {
    if (isLoadingGuacDetails) return;
    setIsLoadingGuacDetails(true);
    try {
      const data = await authService.getAssetGuacamoleDetails(assetId);
      setGuacDetails(data);
    } catch (err) {
      setGuacDetails(null);
      if (!err.message?.includes('Nenhuma conexão') && !err.message?.includes('404')) {
        setFeedback({ type: 'error', message: `Erro ao buscar detalhes no Guacamole: ${err.message}` });
      }
    } finally {
      setIsLoadingGuacDetails(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'integrations' && !guacDetails && guacActive) {
      fetchGuacamoleDetails();
    }
  }, [activeTab, guacActive]);

  // Linha 4: Dados no Oxidized
  const fetchOxidizedDetails = async () => {
    if (isLoadingOxDetails) return;
    setIsLoadingOxDetails(true);
    try {
      const data = await authService.getAssetOxidizedDetails(assetId);
      setOxDetails(data);
    } catch (err) {
      setFeedback({ type: 'error', message: `Erro ao buscar dados no Oxidized: ${err.message}` });
    } finally {
      setIsLoadingOxDetails(false);
    }
  };

  useEffect(() => {
    if ((activeTab === 'integrations' || activeTab === 'operation') && !oxDetails && oxActive) {
      fetchOxidizedDetails();
    }
  }, [activeTab, oxActive]);

  // Linha 5: Status do Zabbix (Alarmes e Itens)
  const fetchZabbixStatusAndItems = async () => {
    setIsLoadingZbxProblems(true);
    setIsLoadingZbxItems(true);
    try {
      const [probs, items] = await Promise.all([
        authService.getAssetZabbixProblems(assetId).catch(() => []),
        authService.getAssetZabbixItems(assetId).catch(() => [])
      ]);
      setZbxProblems(probs);
      setZbxItems(items);

      if (probs && probs.length > 0 && probs[0].items && probs[0].items.length > 0) {
        handleSelectItem(probs[0].items[0]);
      } else if (items && items.length > 0 && !selectedItem) {
        handleSelectItem(items[0]);
      }
    } catch (err) {
      setFeedback({ type: 'error', message: `Erro ao buscar métricas e alarmes do Zabbix: ${err.message}` });
    } finally {
      setIsLoadingZbxProblems(false);
      setIsLoadingZbxItems(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'operation' && zbxActive && !zbxProblems && !zbxItems && !isLoading) {
      fetchZabbixStatusAndItems();
    }
  }, [activeTab, zbxActive, isLoading]);

  // Linha 6: Conexão Remota (Gerar URL SSO no Guacamole)
  const fetchGuacamoleLaunchSession = async () => {
    if (isLoadingGuacLaunch) return;
    setIsLoadingGuacLaunch(true);
    try {
      const data = await authService.getAssetGuacamoleLaunchUrl(assetId);
      setGuacLaunchData(data);
    } catch (err) {
      console.warn('Sessão Guacamole não pôde ser gerada automaticamente:', err.message);
    } finally {
      setIsLoadingGuacLaunch(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'operation' && !guacLaunchData && comparison?.guacamole?.is_synced) {
      fetchGuacamoleLaunchSession();
    }
  }, [activeTab, comparison?.guacamole?.is_synced]);

  useEffect(() => {
    if (activeTab === 'operation' && deviceLogs.length === 0 && !isLoadingLogs) {
      fetchDeviceLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!logsAutoRefresh || activeTab !== 'operation') return;
    const interval = setInterval(() => {
      fetchDeviceLogs();
    }, 15000);
    return () => clearInterval(interval);
  }, [logsAutoRefresh, activeTab, logsTimeRange, logsLevel, logsSearch, logsLimit]);

  // Carregar histórico de um item específico (gráfico ou timeline)
  const handleSelectItem = async (rawItem, period = itemHistoryPeriod, shouldScroll = false) => {
    // Busca dados complementares em zbxItems se disponível
    const matched = zbxItems?.find(x => String(x.itemid) === String(rawItem.itemid));
    const vType = Number(matched?.value_type ?? rawItem.value_type ?? 0);
    const isNum = (rawItem.is_numeric !== undefined)
      ? Boolean(rawItem.is_numeric)
      : (matched?.is_numeric !== undefined ? Boolean(matched.is_numeric) : (vType === 0 || vType === 3));

    const itemToSet = {
      ...rawItem,
      ...(matched || {}),
      value_type: vType,
      is_numeric: isNum
    };

    setSelectedItem(itemToSet);
    setIsLoadingItemHistory(true);

    if (shouldScroll) {
      setTimeout(() => {
        const el = document.getElementById('zbx-chart-section');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }

    try {
      const histData = await authService.getAssetZabbixItemHistory(
        assetId,
        itemToSet.itemid,
        period,
        vType
      );
      setItemHistory(histData.history || []);
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
    } finally {
      setIsLoadingItemHistory(false);
    }
  };

  const handlePeriodChange = (newPeriod) => {
    setItemHistoryPeriod(newPeriod);
    if (selectedItem) {
      handleSelectItem(selectedItem, newPeriod);
    }
  };

  // Salvar configurações no IperSoft (Apenas banco local, sem sincronização externa automática)
  const handleSaveIpersoft = async (e) => {
    if (e) e.preventDefault();
    if (!assetId || assetId === 'undefined') {
      setFeedback({ type: 'error', message: 'ID do equipamento inválido ou não informado.' });
      return;
    }
    if (!formData.name || !formData.name.trim()) {
      setFeedback({ type: 'error', message: 'O Nome do Equipamento (Visível) é obrigatório.' });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      await authService.updateAsset(assetId, {
        name: formData.name.trim(),
        hostname: (formData.zabbix_host || formData.hostname || '').trim(),
        zabbix_host: (formData.zabbix_host || '').trim(),
        zabbix_name: (formData.zabbix_name || '').trim(),
        guacamole_connection_name: (formData.name || '').trim(),
        ip_address: (formData.ip_address || '').trim(),
        dns: (formData.dns || '').trim(),
        client_group: (formData.client_group || '').trim(),
        port: (formData.port || '').trim(),
        snmp_community: (formData.snmp_community || '').trim(),
        status: formData.status,
        guacamole_protocol: formData.remote_protocol,
        guacamole_port: formData.remote_port,
        guacamole_username: formData.remote_username,
        guacamole_password: formData.remote_password,
        backup_model: formData.backup_model,
        backup_enabled: formData.backup_enabled,
        backup_timeout: parseInt(formData.backup_timeout, 10) || 30,
        enabled_tests: enabledTests,
        ignore_guacamole: ignoreGuacamole,
        web_protocol: formData.web_protocol || 'http',
        web_port: (formData.web_port || '').trim(),
        file_backup_protocol: formData.file_backup_protocol || 'disabled',
        file_backup_folder: (formData.file_backup_folder || '').trim(),
        file_backup_pattern: (formData.file_backup_pattern || '').trim(),
        os_profile: formData.os_profile || 'generic_ssh'
      });

      setFeedback({ 
        type: 'success', 
        message: 'Informações salvas no IperSoft com sucesso! Utilize os botões de sincronização individuais para replicar as alterações no Zabbix, Guacamole ou Oxidized.' 
      });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao salvar alterações no IperSoft.' });
    } finally {
      setIsSaving(false);
    }
  };

  // Detecção Inteligente de SO (SNMP sysDescr com fallback para SSH)
  const handleDetectOS = async () => {
    if (!assetId || isDetectingOS) return;
    setIsDetectingOS(true);
    setFeedback(null);
    try {
      const res = await authService.detectAssetOS(assetId, false);
      if (res && res.success) {
        setFormData(prev => ({
          ...prev,
          os_profile: res.os_profile || prev.os_profile,
          backup_model: res.backup_model || prev.backup_model
        }));
        setFeedback({
          type: 'success',
          message: `SO detectado via ${res.method?.toUpperCase()}: ${res.os_name || res.os_profile}. Os campos foram atualizados no formulário (clique em Salvar para persistir).`
        });
      } else {
        setFeedback({
          type: 'warning',
          message: res?.message || 'Não foi possível identificar o SO. Verifique se o SNMP v2c está habilitado ou se há credenciais SSH cadastradas.'
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Erro ao executar detecção de SO do equipamento.'
      });
    } finally {
      setIsDetectingOS(false);
    }
  };

  // Alternar monitoramento no Zabbix (apenas cadastro local IperSoft)
  const handleToggleZabbixStatus = async (e) => {
    const isChecked = e.target.checked;
    setIsTogglingZbxStatus(true);
    setFeedback(null);
    try {
      const newStatus = isChecked ? 'monitored' : 'unmonitored';
      await authService.updateAsset(assetId, { status: newStatus });
      setFormData(prev => ({ ...prev, status: newStatus }));
      setFeedback({ 
        type: 'success', 
        message: isChecked 
          ? 'Monitoramento Zabbix habilitado no IperSoft. Para refletir no Zabbix Server, clique no botão "Sincronizar Zabbix".' 
          : 'Monitoramento Zabbix desabilitado no IperSoft. Para refletir no Zabbix Server, clique no botão "Sincronizar Zabbix".' 
      });
      await loadData();
      if (activeTab === 'integrations' && isChecked) fetchZabbixDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao alterar status do Zabbix.' });
    } finally {
      setIsTogglingZbxStatus(false);
    }
  };

  // Alternar Guacamole (apenas cadastro local IperSoft)
  const handleToggleGuacamoleStatus = async (e) => {
    const isChecked = e.target.checked;
    const shouldIgnore = !isChecked;
    setIgnoreGuacamole(shouldIgnore);
    setIsTogglingGuacStatus(true);
    setFeedback(null);
    try {
      await authService.updateAsset(assetId, { ignore_guacamole: shouldIgnore });
      setFeedback({ 
        type: 'success', 
        message: isChecked 
          ? 'Acesso remoto Guacamole habilitado no IperSoft. Para sincronizar a conexão, clique no botão "Sincronizar Guacamole".' 
          : 'Acesso remoto Guacamole desativado no IperSoft. Para atualizar ou remover a conexão no Guacamole Server, utilize a sincronização.' 
      });
      await loadData();
      if (activeTab === 'integrations' && isChecked) fetchGuacamoleDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao alterar status do Guacamole.' });
    } finally {
      setIsTogglingGuacStatus(false);
    }
  };

  // Alternar Oxidized (apenas cadastro local IperSoft)
  const handleToggleOxidizedStatus = async (e) => {
    const isChecked = e.target.checked;
    setIsTogglingOxStatus(true);
    setFeedback(null);
    try {
      await authService.updateAsset(assetId, { backup_enabled: isChecked });
      setFormData(prev => ({ ...prev, backup_enabled: isChecked }));
      setFeedback({ 
        type: 'success', 
        message: isChecked 
          ? 'Backup ativado no IperSoft. Para recarregar a lista no daemon do Oxidized, clique no botão "Sincronizar Oxidized".' 
          : 'Backup desativado no IperSoft. Para expurgar o nó do daemon do Oxidized, clique no botão "Sincronizar Oxidized".' 
      });
      await loadData();
      if (activeTab === 'integrations' && isChecked) fetchOxidizedDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao alterar status do Oxidized.' });
    } finally {
      setIsTogglingOxStatus(false);
    }
  };

  // Sincronizar Zabbix
  const handleSyncZabbix = async () => {
    setIsSyncingZbx(true);
    setFeedback(null);
    try {
      const res = await authService.syncAssetToZabbix(assetId);
      setFeedback({ type: 'success', message: res.message || 'Host sincronizado com sucesso no Zabbix!' });
      await loadData();
      fetchZabbixDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao sincronizar com Zabbix.' });
    } finally {
      setIsSyncingZbx(false);
    }
  };

  // Sincronizar Guacamole
  const handleSyncGuacamole = async () => {
    setIsSyncingGuac(true);
    setFeedback(null);
    try {
      const res = await authService.syncAssetToGuacamole(assetId, {
        guacamole_connection_name: (formData.name || '').trim(),
        remote_port: formData.remote_port,
        remote_protocol: formData.remote_protocol,
        remote_username: formData.remote_username,
        remote_password: formData.remote_password
      });
      setFeedback({ type: 'success', message: res.message || 'Conexão sincronizada com sucesso no Guacamole!' });
      await loadData();
      fetchGuacamoleDetails();
      fetchGuacamoleLaunchSession();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao sincronizar com Guacamole.' });
    } finally {
      setIsSyncingGuac(false);
    }
  };

  // Sincronizar Oxidized
  const handleSyncOxidized = async () => {
    setIsSyncingOx(true);
    setFeedback(null);
    try {
      const res = await authService.syncAssetToOxidized(assetId);
      setFeedback({ type: 'success', message: res.message || 'Nó sincronizado e recarregado no Oxidized com sucesso!' });
      await loadData();
      fetchOxidizedDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao sincronizar com Oxidized.' });
    } finally {
      setIsSyncingOx(false);
    }
  };

  // Remover Guacamole
  const handleRemoveGuacamole = async () => {
    if (!window.confirm(`Tem certeza que deseja remover a conexão do Guacamole para "${formData.name}"?`)) return;
    setIsRemovingGuac(true);
    setFeedback(null);
    try {
      const res = await authService.removeAssetFromGuacamole(assetId);
      setFeedback({ type: 'success', message: res.message || 'Conexão removida do Guacamole com sucesso!' });
      setGuacDetails(null);
      setGuacLaunchData(null);
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao remover do Guacamole.' });
    } finally {
      setIsRemovingGuac(false);
    }
  };

  // Disparar backup imediato no Oxidized
  const handleTriggerOxBackup = async () => {
    setIsTriggeringOxBackup(true);
    setFeedback(null);
    try {
      const res = await authService.triggerOxidizedBackup(assetId);
      setFeedback({ type: 'success', message: res.message || 'Backup solicitado no Oxidized!' });
      fetchOxidizedDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao solicitar backup no Oxidized.' });
    } finally {
      setIsTriggeringOxBackup(false);
    }
  };

  // Forçar recarga da lista de nós no Oxidized sob demanda
  const handleReloadOxidized = async () => {
    setIsReloadingOx(true);
    setFeedback(null);
    try {
      const res = await authService.reloadOxidizedNodes();
      setFeedback({ type: 'success', message: res.message || 'Lista de nós recarregada no Oxidized com sucesso!' });
      await fetchOxidizedDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao recarregar nós no Oxidized.' });
    } finally {
      setIsReloadingOx(false);
    }
  };

  // Visualizar configuração do Oxidized
  const handleViewOxConfig = async () => {
    setIsLoadingOxConfig(true);
    setFeedback(null);
    try {
      const data = await authService.getOxidizedConfig(assetId);
      setOxConfigContent(data.config || '');
      setOxConfigNodeName(data.node_name || formData.name);
      setOxConfigModalOpen(true);
      setCopiedOxConfig(false);
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao baixar configuração do Oxidized.' });
    } finally {
      setIsLoadingOxConfig(false);
    }
  };

  const handleCopyOxConfig = () => {
    if (oxConfigContent) {
      navigator.clipboard.writeText(oxConfigContent);
      setCopiedOxConfig(true);
      setTimeout(() => setCopiedOxConfig(false), 2000);
    }
  };

  // Executar testes de conectividade
  const handleRunTests = async () => {
    setIsTesting(true);
    setFeedback(null);
    try {
      await diagnosticsService.testAsset(assetId);
      setFeedback({ type: 'success', message: 'Testes de conectividade concluídos com sucesso!' });
      await loadData();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao executar diagnósticos.' });
    } finally {
      setIsTesting(false);
    }
  };

  // Sincronizar Tudo
  const handleSyncAll = async () => {
    setIsSyncingAll(true);
    setFeedback(null);
    try {
      const res = await authService.syncAssetToAll(assetId);
      setFeedback({ type: 'success', message: res.message || 'Sincronização realizada com sucesso!' });
      await loadData();
      if (activeTab === 'integrations') {
        fetchZabbixDetails();
        fetchGuacamoleDetails();
      }
      if (activeTab === 'operation') {
        fetchGuacamoleLaunchSession();
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao sincronizar plataformas.' });
    } finally {
      setIsSyncingAll(false);
    }
  };

  if (isLoading && !comparison) {
    return (
      <div className="view-container detail-loading-screen">
        <RefreshCw size={32} className="spin-icon" style={{ color: 'var(--color-primary)' }} />
        <p>Carregando dados do equipamento...</p>
      </div>
    );
  }

  const { ipersoft, zabbix, guacamole, diagnostics } = comparison || {};
  const icmpDiag = diagnostics?.icmp;
  const snmpDiag = diagnostics?.snmp;
  const remoteDiag = diagnostics?.[formData.remote_protocol || 'ssh'];

  // Sincronização e Cores por Integração
  const zbxSynced = Boolean(zabbix?.is_synced);
  const zbxColor = !zbxActive ? 'gray' : (zbxSynced ? 'green' : 'red');

  const guacSynced = Boolean(guacamole?.is_synced);
  const guacColor = !guacActive ? 'gray' : (guacSynced ? 'green' : 'red');

  const oxSynced = Boolean(comparison?.oxidized?.is_synced || oxDetails);
  const oxStatus = oxDetails?.status || comparison?.oxidized?.status;
  const oxColor = !oxActive 
    ? 'gray' 
    : (oxStatus === 'success' 
        ? 'green' 
        : (oxStatus && oxStatus !== 'success' && oxStatus !== 'unknown' 
            ? 'red' 
            : (oxSynced ? 'green' : 'yellow')));

  // URL final de lançamento do Guacamole (se tiver token usa ele, senão URL base)
  const directGuacUrl = guacLaunchData?.launch_url || (
    guacBaseUrl && comparison?.guacamole?.connection_id
      ? `${guacBaseUrl}/#/client/${comparison.guacamole.connection_id}`
      : null
  );

  // Filtragem de itens do Zabbix
  const filteredItems = (zbxItems || []).filter(it => {
    if (!itemSearchQuery) return true;
    const q = itemSearchQuery.toLowerCase();
    return (it.name || '').toLowerCase().includes(q) || (it.key || '').toLowerCase().includes(q);
  });

  const differences = comparison?.differences || [];

  // Resolução de URLs para Acesso Web (HTTP / HTTPS)
  const targetIP = formData.ip_address || formData.hostname;
  const webPortCustom = (formData.web_port || '').trim();
  const webPortSuffix = webPortCustom ? `:${webPortCustom}` : '';
  const primaryWebUrl = targetIP ? `${formData.web_protocol || 'http'}://${targetIP}${webPortSuffix}` : null;
  const httpWebUrl = targetIP ? `http://${targetIP}${formData.web_protocol === 'http' && webPortCustom ? `:${webPortCustom}` : ''}` : null;
  const httpsWebUrl = targetIP ? `https://${targetIP}${formData.web_protocol === 'https' && webPortCustom ? `:${webPortCustom}` : ''}` : null;

  return (
    <div className="view-container detail-view-layout">
      {/* 1. CABEÇALHO DO EQUIPAMENTO */}
      <div className="detail-header-bar">
        <div className="detail-header-left">
          <button type="button" className="btn-back" onClick={onBack}>
            <ArrowLeft size={16} /> Voltar para Inventário
          </button>
          <div className="detail-title-wrapper">
            <h1 className="detail-title">{formData.name || 'Equipamento'}</h1>
            <code className="detail-ip-badge">{formData.ip_address || formData.hostname || 'Sem IP'}</code>
            {formData.client_group && (
              <span className="group-pill-badge">{formData.client_group}</span>
            )}
            <span className={`status-pill ${formData.status === 'monitored' ? 'status-pill-ok' : 'status-pill-unmonitored'}`}>
              {formData.status === 'monitored' ? 'Monitorado' : 'Desativado'}
            </span>
          </div>
        </div>

        <div className="detail-header-actions">
          {targetIP && (
            <div className="web-btn-dropdown-container" ref={webMenuRef}>
              <div className="web-btn-group">
                <a 
                  href={primaryWebUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn-action-web"
                  title={`Abrir interface web em nova aba (${primaryWebUrl})`}
                >
                  <Globe size={15} />
                  <span>Acessar Web</span>
                  <span className="web-proto-badge">{(formData.web_protocol || 'http').toUpperCase()}</span>
                </a>
                <button 
                  type="button" 
                  className="btn-action-web-arrow"
                  onClick={() => setShowWebMenu(!showWebMenu)}
                  title="Opções de protocolo Web (HTTP / HTTPS)"
                >
                  <ChevronDown size={14} className={showWebMenu ? 'rotate-180' : ''} />
                </button>
              </div>

              {showWebMenu && (
                <div className="web-dropdown-menu">
                  <div className="web-dropdown-header">
                    <span>Protocolo de Acesso Web</span>
                  </div>
                  <a 
                    href={httpWebUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="web-dropdown-item"
                    onClick={() => setShowWebMenu(false)}
                  >
                    <Globe size={15} color="#00bcd4" />
                    <div className="web-dropdown-item-info">
                      <span className="web-dropdown-item-title">Abrir via HTTP</span>
                      <code className="web-dropdown-item-url">{httpWebUrl}</code>
                    </div>
                    <ExternalLink size={12} className="web-dropdown-item-icon" />
                  </a>
                  <a 
                    href={httpsWebUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="web-dropdown-item"
                    onClick={() => setShowWebMenu(false)}
                  >
                    <ShieldCheck size={15} color="#4caf50" />
                    <div className="web-dropdown-item-info">
                      <span className="web-dropdown-item-title">Abrir via HTTPS</span>
                      <code className="web-dropdown-item-url">{httpsWebUrl}</code>
                    </div>
                    <ExternalLink size={12} className="web-dropdown-item-icon" />
                  </a>
                </div>
              )}
            </div>
          )}

          <button 
            type="button" 
            className="btn-action-test"
            onClick={handleRunTests}
            disabled={isTesting}
          >
            <Activity size={16} className={isTesting ? 'spin-icon' : ''} />
            {isTesting ? 'Testando...' : 'Testar Conectividade'}
          </button>
        </div>
      </div>

      {/* FEEDBACK DE NOTIFICAÇÃO */}
      {feedback && (
        <div className={`notification-banner ${feedback.type === 'error' ? 'banner-error' : 'banner-success'}`}>
          {feedback.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* BARRA DE NAVEGAÇÃO EM 3 ABAS FOCADAS */}
      <div className="detail-tabs-bar">
        <button
          type="button"
          className={`detail-tab-btn ${activeTab === 'operation' ? 'active' : ''}`}
          onClick={() => setActiveTab('operation')}
        >
          <Activity size={16} />
          <span>Operação & Monitoramento</span>
          {zbxActive && zbxProblems && zbxProblems.length > 0 && (
            <span className="detail-tab-badge badge-danger">{zbxProblems.length}</span>
          )}
        </button>

        <button
          type="button"
          className={`detail-tab-btn ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          <Server size={16} />
          <span>Cadastro & Parâmetros (IperSoft)</span>
        </button>

        <button
          type="button"
          className={`detail-tab-btn ${activeTab === 'integrations' ? 'active' : ''}`}
          onClick={() => setActiveTab('integrations')}
        >
          <Layers size={16} />
          <span>Comparativo & Sincronização Externa</span>
          {differences.length > 0 && (
            <span className="detail-tab-badge badge-warning" title="Divergências entre IperSoft e servidores externos">
              {differences.length}
            </span>
          )}
        </button>
      </div>

      {/* =========================================================================
          ABA 1: OPERAÇÃO & MONITORAMENTO (ACESSO IMEDIATO A TERMINAL, BACKUP E ALARMES)
          ========================================================================= */}
      {activeTab === 'operation' && (
        <div className="detail-tab-content">
          {/* BARRA DE RESUMO OPERACIONAL: CONECTIVIDADE + GUACAMOLE + OXIDIZED */}
          <div className="operation-quick-grid">
            {/* CARD 1: SAÚDE DE REDE & TERMINAL REMOTO GUACAMOLE */}
            <div className="operation-quick-card">
              <div className="operation-card-header">
                <div className="operation-card-title">
                  <Terminal size={16} color="#00bcd4" />
                  <span>Conectividade & Terminal Remoto</span>
                </div>
                <div className="acc-test-badges-group">
                  <span className={`acc-test-pill ${!enabledTests.icmp ? 'pill-disabled' : (icmpDiag?.status === 'ok' ? 'pill-ok' : icmpDiag?.status === 'timeout' ? 'pill-timeout' : 'pill-fail')}`}>
                    ICMP: {enabledTests.icmp ? (icmpDiag?.status === 'ok' ? `${icmpDiag.latency_ms || 'OK'}ms` : icmpDiag?.status || 'Pendente') : 'Desat.'}
                  </span>
                  <span className={`acc-test-pill ${!enabledTests.snmp ? 'pill-disabled' : (snmpDiag?.status === 'ok' ? 'pill-ok' : 'pill-fail')}`}>
                    SNMP: {enabledTests.snmp ? (snmpDiag?.status === 'ok' ? 'OK' : snmpDiag?.status || 'Pendente') : 'Desat.'}
                  </span>
                  <span className={`acc-test-pill ${!enabledTests.remote ? 'pill-disabled' : (remoteDiag?.status === 'ok' ? 'pill-ok' : 'pill-fail')}`}>
                    {formData.remote_protocol.toUpperCase()} ({formData.remote_port}): {enabledTests.remote ? (remoteDiag?.status === 'ok' ? 'Aberta' : remoteDiag?.status || 'Pendente') : 'Desat.'}
                  </span>
                  <span 
                    className={`acc-test-pill ${logsHealth?.clock_skew_detected ? 'pill-timeout' : logsHealth?.status === 'active' ? 'pill-ok' : logsHealth?.status === 'idle' ? 'pill-disabled' : 'pill-fail'}`}
                    title={logsHealth?.clock_skew_detected ? `Alerta: ${logsHealth.clock_drift_human}` : `Status do fluxo Syslog no VictoriaLogs (${logsHealth?.last_log_relative || 'Sem logs'})`}
                  >
                    Syslog: {logsHealth?.clock_skew_detected ? '⚠️ Relógio' : logsHealth?.status === 'active' ? 'Ativo' : logsHealth?.status === 'idle' ? 'Inativo' : 'Sem Logs'}
                  </span>
                </div>
              </div>

              <div className="operation-card-body">
                {!guacActive ? (
                  <div className="operation-card-empty">
                    <span className="text-muted">Acesso remoto via Guacamole está desativado para este equipamento.</span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                      {targetIP && (
                        <a 
                          href={primaryWebUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn-secondary"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          title={`Abrir interface web em nova aba (${primaryWebUrl})`}
                        >
                          <Globe size={14} color="#00bcd4" />
                          <span>Acessar Web ({(formData.web_protocol || 'http').toUpperCase()})</span>
                        </a>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => setActiveTab('config')}>
                        Configurar Acesso
                      </button>
                    </div>
                  </div>
                ) : guacSynced && directGuacUrl ? (
                  <div className="operation-card-actions-row">
                    <div className="remote-meta-info">
                      <span className="status-pill-ok" style={{ fontSize: '0.72rem' }}>SSO Pronto</span>
                      <span><code>{formData.ip_address || formData.hostname}:{formData.remote_port}</code> ({formData.remote_protocol.toUpperCase()})</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {targetIP && (
                        <a 
                          href={primaryWebUrl} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn-secondary"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          title={`Abrir interface web em nova aba (${primaryWebUrl})`}
                        >
                          <Globe size={14} color="#00bcd4" />
                          <span>Acessar Web</span>
                        </a>
                      )}
                      <a 
                        href={directGuacUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="btn-launch-terminal"
                      >
                        <ExternalLink size={14} /> Abrir em Nova Aba
                      </a>
                      <button 
                        type="button" 
                        className="btn-secondary"
                        onClick={() => {
                          if (!showEmbeddedTerminal && !guacLaunchData) {
                            fetchGuacamoleLaunchSession();
                          }
                          setShowEmbeddedTerminal(!showEmbeddedTerminal);
                        }}
                      >
                        {showEmbeddedTerminal ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        <span>{showEmbeddedTerminal ? 'Ocultar Terminal' : 'Terminal Embutido'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="operation-card-empty">
                    <span className="text-muted">Conexão ainda não sincronizada no Apache Guacamole.</span>
                    <button 
                      type="button" 
                      className="btn-platform-sync btn-sync-guac"
                      onClick={handleSyncGuacamole}
                      disabled={isSyncingGuac || !isAdmin}
                    >
                      <RefreshCw size={13} className={isSyncingGuac ? 'spin-icon' : ''} />
                      <span>Criar Conexão no Guacamole</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* CARD 2: BACKUP DE CONFIGURAÇÕES (OXIDIZED & FTP/TFTP) */}
            <div className="operation-quick-card">
              <div className="operation-card-header">
                <div className="operation-card-title">
                  <Archive size={16} color="#e91e63" />
                  <span>Backup de Configurações</span>
                </div>
                <span className={`badge-status-pill badge-${oxColor}`}>
                  {!oxActive ? 'Oxidized Desativado' : oxColor === 'green' ? 'Backup em Dia' : oxColor === 'red' ? 'Falha na Coleta' : 'Aguardando Coleta'}
                </span>
              </div>

              <div className="operation-card-body">
                {!oxActive && (!formData.file_backup_protocol || formData.file_backup_protocol === 'disabled') ? (
                  <div className="operation-card-empty">
                    <span className="text-muted">Backup de configurações desabilitado para este ativo.</span>
                    <button type="button" className="btn-secondary" onClick={() => setActiveTab('config')}>
                      Configurar no Cadastro
                    </button>
                  </div>
                ) : (
                  <div className="operation-card-actions-row">
                    <div className="remote-meta-info" style={{ flexWrap: 'wrap', gap: '6px' }}>
                      {oxActive && (
                        <>
                          <span>Oxidized: <code>{oxDetails?.model || formData.backup_model || 'RouterOS'}</code></span>
                          <span className="text-muted">•</span>
                          <span>
                            Último: {oxDetails?.last_backup || comparison?.oxidized?.last_backup
                              ? new Date(oxDetails?.last_backup || comparison?.oxidized?.last_backup).toLocaleString('pt-BR')
                              : 'Pendente'}
                          </span>
                        </>
                      )}
                      {formData.file_backup_protocol && formData.file_backup_protocol !== 'disabled' && (
                        <>
                          {oxActive && <span className="text-muted">•</span>}
                          <span>
                            Servidor: <code>{formData.file_backup_protocol.toUpperCase()}</code> (pasta: <code>{formData.file_backup_folder || 'raiz'}</code>)
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleViewOxConfig}
                        disabled={isLoadingOxConfig}
                      >
                        {isLoadingOxConfig ? <RefreshCw size={14} className="spin-icon" /> : <Eye size={14} />}
                        <span>Ver Configuração</span>
                      </button>
                      <button 
                        type="button" 
                        className="btn-secondary"
                        style={{ borderColor: 'rgba(233, 30, 99, 0.4)', color: '#f48fb1' }}
                        onClick={handleTriggerOxBackup}
                        disabled={isTriggeringOxBackup || !isAdmin}
                      >
                        <RefreshCw size={14} className={isTriggeringOxBackup ? 'spin-icon' : ''} />
                        <span>{isTriggeringOxBackup ? 'Solicitando...' : 'Backup Agora'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* TERMINAL WEB EMBUTIDO SE ABERTO */}
          {showEmbeddedTerminal && (
            <div className="embedded-terminal-frame-container" style={{ marginBottom: '1.25rem', position: 'relative' }}>
              {isLoadingGuacLaunch ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c1017', color: '#00bcd4', zIndex: 10 }}>
                  <RefreshCw size={24} className="spin-icon" style={{ marginBottom: '10px' }} />
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Iniciando sessão remota SSO no Apache Guacamole...</span>
                </div>
              ) : directGuacUrl ? (
                <iframe 
                  src={directGuacUrl} 
                  title={`Console Remoto - ${formData.name}`}
                  className="embedded-terminal-iframe"
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '10px' }}>
                  <span>Não foi possível gerar a sessão remota no Guacamole.</span>
                  <button type="button" className="btn-secondary" onClick={fetchGuacamoleLaunchSession}>
                    <RefreshCw size={14} /> Tentar Novamente
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PAINEL DE MONITORAMENTO ZABBIX: ALARMES E ITENS */}
          <div className="operation-zabbix-section">
            <div className="operation-section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <AlertTriangle size={18} color={zbxActive ? '#ff9800' : 'var(--text-muted)'} />
                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700 }}>
                  Monitoramento Zabbix: Alarmes Ativos & Métricas do Host
                </h3>
                {zbxActive && zbxProblems && (
                  <span className={`badge-alarm-count ${zbxProblems.length > 0 ? 'has-alarms' : 'no-alarms'}`}>
                    {zbxProblems.length} {zbxProblems.length === 1 ? 'alarme ativo' : 'alarmes ativos'}
                  </span>
                )}
              </div>

              {zbxActive && (
                <button 
                  type="button" 
                  className="btn-acc-refresh"
                  onClick={fetchZabbixStatusAndItems}
                  title="Atualizar alarmes e itens agora"
                >
                  <RefreshCw size={13} className={isLoadingZbxProblems || isLoadingZbxItems ? 'spin-icon' : ''} />
                  <span>Atualizar Métricas</span>
                </button>
              )}
            </div>

            {!zbxActive ? (
              <div className="platform-not-synced-box">
                <Radio size={20} color="var(--text-muted)" />
                <div>
                  <strong>Monitoramento Zabbix desativado para este equipamento.</strong>
                  <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Ative o monitoramento na aba "Cadastro & Parâmetros" para acompanhar alarmes e gráficos.
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="zbx-monitor-grid">
                  {/* COLUNA ESQUERDA: SUBCARD ALARMES ATIVOS */}
                  <div className="zbx-panel-card zbx-panel-alarms">
                    <div className="panel-card-header">
                      <div className="panel-card-title">
                        <AlertTriangle size={16} color="#e53935" />
                        <h4>Alarmes Ativos (Triggers em Problema)</h4>
                      </div>
                      {zbxProblems && (
                        <span className="badge-count-pill">{zbxProblems.length}</span>
                      )}
                    </div>

                    <div className="panel-card-content">
                      {isLoadingZbxProblems ? (
                        <div className="lazy-loading-box">
                          <RefreshCw size={20} className="spin-icon" color="#e53935" />
                          <span>Buscando problemas ativos no Zabbix...</span>
                        </div>
                      ) : zbxProblems && zbxProblems.length > 0 ? (
                        <div className="alarms-active-list">
                          {zbxProblems.map((prob) => (
                            <div key={prob.triggerid} className={`alarm-active-item ${prob.is_closed ? 'row-closed' : ''}`} style={{ borderLeftColor: prob.severity_color }}>
                              <div className="alarm-item-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                  <span className="alarm-sev-badge" style={{ backgroundColor: prob.severity_color }}>
                                    {prob.severity_label}
                                  </span>
                                  
                                  <label 
                                    className="alarm-ack-toggle-label"
                                    title={prob.acknowledged ? "Clique para desmarcar o reconhecimento no Zabbix" : "Clique para marcar este alarme como reconhecido no Zabbix"}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(prob.acknowledged)}
                                      disabled={Boolean(acknowledgingEvents[prob.eventid] || !prob.eventid || prob.is_closed)}
                                      onChange={() => handleToggleAcknowledge(prob)}
                                      className="diag-custom-checkbox"
                                    />
                                    <span className={prob.acknowledged ? 'ack-status-pill pill-ack' : 'ack-status-pill pill-unack'}>
                                      {acknowledgingEvents[prob.eventid] ? 'Salvando...' : (prob.acknowledged ? 'Reconhecido' : 'Não Reconhecido')}
                                    </span>
                                  </label>

                                  <label 
                                    className="alarm-close-toggle-label"
                                    title={prob.is_closed ? "Alarme já encerrado no Zabbix" : "Clique para encerrar este alarme no Zabbix"}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(prob.is_closed)}
                                      disabled={Boolean(closingEvents[prob.eventid || prob.triggerid] || (!prob.eventid && !prob.triggerid) || prob.is_closed)}
                                      onChange={() => handleCloseProblem(prob)}
                                      className="diag-custom-checkbox"
                                    />
                                    <span className={prob.is_closed ? 'ack-status-pill pill-closed' : 'ack-status-pill pill-open'}>
                                      {closingEvents[prob.eventid || prob.triggerid] ? 'Encerrando...' : (prob.is_closed ? 'Encerrado' : 'Encerrar')}
                                    </span>
                                  </label>
                                </div>

                                <span className="alarm-time">
                                  <Clock size={11} />
                                  {new Date(prob.lastchange * 1000).toLocaleString('pt-BR')}
                                </span>
                              </div>

                              <div className="alarm-item-desc">{prob.description}</div>

                              {prob.opdata && (
                                <div className="alarm-item-opdata">
                                  <Activity size={11} className="opdata-icon" />
                                  <span className="opdata-label">Dado Operacional:</span>
                                  <strong>{prob.opdata}</strong>
                                </div>
                              )}

                              {prob.items && prob.items.length > 0 && (
                                <div className="alarm-item-actions">
                                  {prob.items.map((it) => (
                                    <button
                                      key={it.itemid}
                                      type="button"
                                      className={`btn-alarm-view-item ${selectedItem?.itemid === it.itemid ? 'active' : ''}`}
                                      onClick={() => handleSelectItem(it, itemHistoryPeriod, true)}
                                      title="Ver histórico e gráfico deste item para validar alarme"
                                    >
                                      <TrendingUp size={12} />
                                      <span>Ver Histórico: {it.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="alarms-empty-box">
                          <CheckCircle2 size={28} color="var(--color-success)" />
                          <strong>Nenhum alarme ativo no momento!</strong>
                          <span>Todos os triggers monitorados no Zabbix estão operando normalmente.</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* COLUNA DIREITA: SUBCARD ITENS DO HOST COM FILTRO */}
                  <div className="zbx-panel-card zbx-panel-items">
                    <div className="panel-card-header">
                      <div className="panel-card-title">
                        <TrendingUp size={16} color="var(--color-primary)" />
                        <h4>Itens de Monitoramento do Host</h4>
                      </div>
                      {zbxItems && (
                        <span className="badge-count-pill">{zbxItems.length}</span>
                      )}
                    </div>

                    <div className="panel-card-content">
                      <div className="items-search-box">
                        <Search size={14} color="var(--text-muted)" />
                        <input 
                          type="text" 
                          placeholder="Pesquisar métricas (ping, cpu, interface, traffic...)"
                          value={itemSearchQuery}
                          onChange={e => setItemSearchQuery(e.target.value)}
                        />
                        {itemSearchQuery && (
                          <button type="button" className="btn-clear-search" onClick={() => setItemSearchQuery('')}>✕</button>
                        )}
                      </div>

                      {isLoadingZbxItems ? (
                        <div className="lazy-loading-box">
                          <RefreshCw size={20} className="spin-icon" color="var(--color-primary)" />
                          <span>Carregando itens monitorados...</span>
                        </div>
                      ) : filteredItems.length > 0 ? (
                        <div className="items-selector-list">
                          {filteredItems.slice(0, 50).map((it) => (
                            <div 
                              key={it.itemid} 
                              className={`item-selector-row ${selectedItem?.itemid === it.itemid ? 'selected' : ''}`}
                              onClick={() => handleSelectItem(it)}
                            >
                              <div className="item-row-left">
                                <span className="item-row-name" title={it.name}>{it.name}</span>
                                <code className="item-row-key" title={it.key}>{it.key}</code>
                              </div>
                              <div className="item-row-right">
                                <span className="item-row-val">
                                  {it.lastvalue !== null && it.lastvalue !== undefined ? `${it.lastvalue} ${it.units || ''}` : '-'}
                                </span>
                                <span className={`item-type-pill ${it.is_numeric ? 'type-num' : 'type-text'}`}>
                                  {it.is_numeric ? 'Numérico' : 'Texto'}
                                </span>
                              </div>
                            </div>
                          ))}
                          {filteredItems.length > 50 && (
                            <small style={{ color: 'var(--text-muted)', textAlign: 'center', display: 'block', padding: '6px' }}>
                              Mostrando 50 de {filteredItems.length} itens. Use a busca acima para refinar.
                            </small>
                          )}
                        </div>
                      ) : (
                        <div className="chart-empty-state">
                          <span>Nenhum item correspondente à busca.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* PAINEL INFERIOR: GRÁFICO OU TIMELINE DO ITEM SELECIONADO */}
                {selectedItem && (
                  <div className="zbx-history-chart-wrapper" id="zbx-chart-section">
                    <div className="chart-wrapper-header">
                      <div className="chart-title-group">
                        <TrendingUp size={16} color="var(--color-primary)" />
                        <div>
                          <strong>{selectedItem.name}</strong>
                          <code className="chart-key-badge">{selectedItem.key}</code>
                        </div>
                      </div>

                      <div className="chart-controls-group">
                        <span className="chart-controls-label">Período:</span>
                        {['1h', '6h', '24h', '7d'].map((per) => (
                          <button
                            key={per}
                            type="button"
                            className={`btn-period-pill ${itemHistoryPeriod === per ? 'active' : ''}`}
                            onClick={() => handlePeriodChange(per)}
                            disabled={isLoadingItemHistory}
                          >
                            {per}
                          </button>
                        ))}

                        <button
                          type="button"
                          className="btn-acc-refresh"
                          onClick={() => handleSelectItem(selectedItem, itemHistoryPeriod)}
                          disabled={isLoadingItemHistory}
                          title="Recarregar dados"
                        >
                          <RefreshCw size={13} className={isLoadingItemHistory ? 'spin-icon' : ''} />
                        </button>
                      </div>
                    </div>

                    <div className="chart-wrapper-body">
                      {isLoadingItemHistory ? (
                        <div className="lazy-loading-box">
                          <RefreshCw size={24} className="spin-icon" color="var(--color-primary)" />
                          <span>Carregando série histórica de dados no Zabbix...</span>
                        </div>
                      ) : (selectedItem.is_numeric ?? (Number(selectedItem.value_type) === 0 || Number(selectedItem.value_type) === 3)) ? (
                        <ZabbixNumericChart 
                          history={itemHistory} 
                          units={selectedItem.units || ''} 
                          period={itemHistoryPeriod}
                          item={selectedItem}
                        />
                      ) : (
                        <ZabbixTextTimeline 
                          history={itemHistory} 
                          item={selectedItem}
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* SEÇÃO 3: SYSLOG & EVENTOS EM TEMPO REAL (VICTORIALOGS) */}
          <div className="operation-full-card" style={{ marginTop: '1.25rem' }}>
            <div className="operation-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div className="operation-card-title">
                <FileText size={16} color="#4caf50" />
                <span>Syslog do Dispositivo (VictoriaLogs)</span>
                <span className="badge-tag-canonical" style={{ background: 'rgba(76, 175, 80, 0.15)', color: '#81c784', marginLeft: '6px' }}>
                  UDP/TCP 514
                </span>
                {logsHealth && (
                  <span 
                    className={`badge-status-pill badge-${logsHealth.clock_skew_detected ? 'yellow' : logsHealth.status === 'active' ? 'green' : logsHealth.status === 'idle' ? 'yellow' : 'gray'}`}
                    style={{ fontSize: '0.72rem', marginLeft: '6px' }}
                    title={logsHealth.clock_skew_detected ? logsHealth.clock_drift_human : `Último log: ${logsHealth.last_log_relative}`}
                  >
                    {logsHealth.clock_skew_detected 
                      ? '⚠️ Relógio Divergente' 
                      : (logsHealth.status === 'active' ? `Logs Ativos (${logsHealth.last_log_relative})` : logsHealth.status === 'idle' ? `Inativo (${logsHealth.last_log_relative})` : 'Sem Logs')}
                  </span>
                )}
                {logsHealth?.logs_count_24h > 0 && (
                  <span className="badge-tag-canonical" style={{ fontSize: '0.7rem', marginLeft: '4px' }}>
                    {logsHealth.logs_count_24h.toLocaleString('pt-BR')} logs em 24h
                  </span>
                )}
              </div>

              {/* Filtros e Controles */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {/* Seletor de Período */}
                <select
                  className="select-filter-compact"
                  value={logsTimeRange}
                  onChange={(e) => {
                    const newRange = e.target.value;
                    setLogsTimeRange(newRange);
                    fetchDeviceLogs(newRange, logsLevel, logsSearch, logsLimit);
                  }}
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.8rem',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="5m" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>Últimos 5 min</option>
                  <option value="15m" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>Últimos 15 min</option>
                  <option value="1h" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>Última 1 hora</option>
                  <option value="6h" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>Últimas 6 horas</option>
                  <option value="24h" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>Últimas 24 horas</option>
                  <option value="7d" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>Últimos 7 dias</option>
                </select>

                {/* Seletor de Limite de Linhas */}
                <select
                  value={logsLimit}
                  onChange={(e) => {
                    const newLim = parseInt(e.target.value, 10);
                    setLogsLimit(newLim);
                    fetchDeviceLogs(logsTimeRange, logsLevel, logsSearch, newLim);
                  }}
                  title="Quantidade máxima de linhas de logs a retornar"
                  style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '0.8rem',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value={100} style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>100 linhas</option>
                  <option value={250} style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>250 linhas</option>
                  <option value={500} style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>500 linhas</option>
                  <option value={1000} style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>1.000 linhas</option>
                  <option value={2500} style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>2.500 linhas</option>
                  <option value={5000} style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>5.000 linhas</option>
                </select>

                {/* Filtro de Severidade */}
                <div className="level-filter-buttons" style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className={`btn-filter-pill ${logsLevel === '' ? 'active' : ''}`}
                    onClick={() => {
                      setLogsLevel('');
                      fetchDeviceLogs(logsTimeRange, '', logsSearch, logsLimit);
                    }}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    className={`btn-filter-pill btn-pill-danger ${logsLevel === 'crit' ? 'active' : ''}`}
                    onClick={() => {
                      setLogsLevel('crit');
                      fetchDeviceLogs(logsTimeRange, 'crit', logsSearch, logsLimit);
                    }}
                  >
                    Erros
                  </button>
                  <button
                    type="button"
                    className={`btn-filter-pill btn-pill-warn ${logsLevel === 'warn' ? 'active' : ''}`}
                    onClick={() => {
                      setLogsLevel('warn');
                      fetchDeviceLogs(logsTimeRange, 'warn', logsSearch, logsLimit);
                    }}
                  >
                    Avisos
                  </button>
                  <button
                    type="button"
                    className={`btn-filter-pill btn-pill-info ${logsLevel === 'info' ? 'active' : ''}`}
                    onClick={() => {
                      setLogsLevel('info');
                      fetchDeviceLogs(logsTimeRange, 'info', logsSearch, logsLimit);
                    }}
                  >
                    Info
                  </button>
                </div>

                {/* Auto-Refresh Toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={logsAutoRefresh}
                    onChange={(e) => setLogsAutoRefresh(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Auto (15s)</span>
                </label>

                {/* Botão Atualizar */}
                <button
                  type="button"
                  className="btn-icon-subtle"
                  onClick={() => fetchDeviceLogs()}
                  disabled={isLoadingLogs}
                  title="Atualizar Logs"
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-main)', cursor: 'pointer' }}
                >
                  <RefreshCw size={14} className={isLoadingLogs ? 'spin-icon' : ''} />
                </button>
              </div>
            </div>

            {/* Alerta de Divergência de Horário / Relógio Descalibrado */}
            {logsHealth?.clock_skew_detected && (
              <div className="notification-banner banner-warning" style={{ margin: '0.75rem 1rem 0.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.82rem' }}>
                  <strong style={{ color: '#fbbf24' }}>Alerta de Sincronismo Temporal (NTP)</strong>
                  <span>{logsHealth.clock_drift_human}. O VictoriaLogs está indexando os eventos pelo horário de chegada no servidor para não perder nenhum registro, mas recomendamos corrigir o relógio/NTP no equipamento para manter a rastreabilidade correta dos eventos.</span>
                </div>
              </div>
            )}

            {/* Barra de Pesquisa de Texto */}
            <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Pesquisar sequências nos logs (ex: rad, auth, down, gpon)..."
                value={logsSearch}
                onChange={(e) => setLogsSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    fetchDeviceLogs(logsTimeRange, logsLevel, logsSearch, logsLimit);
                  }
                }}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-main)',
                  fontSize: '0.82rem'
                }}
              />
              {logsSearch && (
                <button
                  type="button"
                  className="btn-text-subtle"
                  onClick={() => {
                    setLogsSearch('');
                    fetchDeviceLogs(logsTimeRange, logsLevel, '', logsLimit);
                  }}
                  style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Limpar
                </button>
              )}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span>
                  {logsSearch ? `${filteredLogs.length} de ${deviceLogs.length}` : `${deviceLogs.length}`} registro{filteredLogs.length === 1 ? '' : 's'}
                </span>
                {deviceLogs.length >= logsLimit && (
                  <span 
                    title={`Limite de ${logsLimit} linhas atingido para o período selecionado. Aumente o seletor de linhas para carregar mais entradas.`}
                    style={{ 
                      fontSize: '0.68rem', 
                      background: 'rgba(255, 152, 0, 0.15)', 
                      color: '#ff9800', 
                      padding: '1px 5px', 
                      borderRadius: '4px',
                      fontWeight: 600
                    }}
                  >
                    limite de {logsLimit} atingido
                  </span>
                )}
              </span>
            </div>

            {/* Lista de Logs estilo Terminal Monospace */}
            <div className="logs-terminal-viewport" style={{ maxHeight: '380px', overflowY: 'auto', padding: '0.5rem', background: '#0a0d14', fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {isLoadingLogs && deviceLogs.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '2rem', color: 'var(--text-muted)' }}>
                  <RefreshCw size={18} className="spin-icon" color="#4caf50" />
                  <span>Consultando logs no VictoriaLogs...</span>
                </div>
              ) : deviceLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  <p style={{ margin: '0 0 4px 0' }}>Nenhum log registrado para este dispositivo no período selecionado.</p>
                  <small>Filtro aplicado: IP <code>{formData.ip_address}</code> {formData.hostname ? `ou Hostname "${formData.hostname}"` : ''} ({logsTimeRange})</small>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  <p style={{ margin: '0 0 4px 0' }}>Nenhum log encontrado para a sequência pesquisada: <strong>"{logsSearch}"</strong></p>
                  <small>Pressione Enter para consultar o servidor ou tente outros caracteres.</small>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {filteredLogs.map((log, idx) => {
                    const lvl = (log.level || 'info').toLowerCase();
                    const isCrit = lvl.includes('crit') || lvl.includes('err') || log.severity <= 3;
                    const isWarn = lvl.includes('warn') || log.severity === 4;
                    const badgeBg = isCrit ? 'rgba(244, 67, 54, 0.2)' : isWarn ? 'rgba(255, 152, 0, 0.2)' : 'rgba(33, 150, 243, 0.15)';
                    const badgeColor = isCrit ? '#f44336' : isWarn ? '#ff9800' : '#42a5f5';

                    return (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'flex-start',
                          padding: '4px 6px',
                          borderRadius: '4px',
                          background: idx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                          lineHeight: '1.4'
                        }}
                      >
                        {/* Timestamp */}
                        <span style={{ color: '#78909c', flexShrink: 0, fontSize: '0.74rem' }}>
                          {log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
                        </span>

                        {/* Level Badge */}
                        <span
                          style={{
                            background: badgeBg,
                            color: badgeColor,
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontSize: '0.68rem',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            flexShrink: 0
                          }}
                        >
                          {lvl}
                        </span>

                        {/* Message com Destaque dos Termos Pesquisados */}
                        <span style={{ color: '#e0e0e0', wordBreak: 'break-word', flex: 1 }}>
                          {renderHighlightedMessage(log.message, logsSearch)}
                        </span>

                        {/* Copiar Log */}
                        <button
                          type="button"
                          title="Copiar log"
                          onClick={() => {
                            navigator.clipboard.writeText(`${log.timestamp} [${log.level}] ${log.message}`);
                            setCopiedLogIdx(idx);
                            setTimeout(() => setCopiedLogIdx(null), 1500);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: copiedLogIdx === idx ? '#4caf50' : 'rgba(255,255,255,0.2)',
                            cursor: 'pointer',
                            padding: '2px',
                            flexShrink: 0
                          }}
                        >
                          {copiedLogIdx === idx ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ABA 2: CADASTRO & PARÂMETROS NO IPERSOFT (FORMULÁRIO MODULAR 2X2)
          ========================================================================= */}
      {activeTab === 'config' && (
        <div className="detail-tab-content">
          <form onSubmit={handleSaveIpersoft} className="asset-detail-form">
            <div className="config-cards-grid">
              {/* BLOCO 1: IDENTIFICAÇÃO & REDE */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <Server size={16} color="var(--color-primary)" />
                  <h4>1. Identificação Canônica & Rede</h4>
                  <span className="badge-tag-canonical">Master IperSoft</span>
                </div>

                <div className="config-section-body">
                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label>Nome do Equipamento</label>
                    <input 
                      type="text" 
                      value={formData.name} 
                      onChange={e => setFormData({ ...formData, name: e.target.value })} 
                      required 
                      placeholder="Ex: SW-DIST-01"
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-2">
                      <label>Endereço IP Principal</label>
                      <input 
                        type="text" 
                        value={formData.ip_address} 
                        onChange={e => setFormData({ ...formData, ip_address: e.target.value })} 
                        placeholder="Ex: 192.168.1.10"
                      />
                    </div>
                    <div className="form-group flex-2">
                      <label>DNS / Domínio</label>
                      <input 
                        type="text" 
                        value={formData.dns} 
                        onChange={e => setFormData({ ...formData, dns: e.target.value })} 
                        placeholder="Ex: sw-dist-01.rede.local"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Empresa / Grupo do Cliente (Host Group Zabbix & Pasta Guacamole)</label>
                    <input 
                      type="text" 
                      list="client-groups-datalist"
                      value={formData.client_group} 
                      onChange={e => setFormData({ ...formData, client_group: e.target.value })} 
                      placeholder="Ex: athila, atm, diretrix"
                    />
                    <datalist id="client-groups-datalist">
                      {availableGroups.map((grp) => (
                        <option key={grp} value={grp} />
                      ))}
                    </datalist>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label>Protocolo Web (Navegador)</label>
                      <select
                        value={formData.web_protocol || 'http'}
                        onChange={e => setFormData({ ...formData, web_protocol: e.target.value })}
                      >
                        <option value="http">HTTP (porta padrão 80)</option>
                        <option value="https">HTTPS (porta padrão 443)</option>
                      </select>
                    </div>
                    <div className="form-group flex-1">
                      <label>Porta Web Customizada (opcional)</label>
                      <input 
                        type="text" 
                        value={formData.web_port || ''} 
                        onChange={e => setFormData({ ...formData, web_port: e.target.value })} 
                        placeholder="Ex: 8080, 8443, 9443 (vazio = padrão)"
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: '0.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                      Diagnósticos Nativos Aplicáveis (1h):
                    </label>
                    <div className="acc-tests-config-row">
                      <label className="test-checkbox-label">
                        <input 
                          type="checkbox" 
                          className="diag-custom-checkbox"
                          checked={enabledTests.icmp}
                          onChange={e => setEnabledTests({ ...enabledTests, icmp: e.target.checked })}
                        />
                        <span>Ping (ICMP)</span>
                      </label>
                      <label className="test-checkbox-label">
                        <input 
                          type="checkbox" 
                          className="diag-custom-checkbox"
                          checked={enabledTests.snmp}
                          onChange={e => setEnabledTests({ ...enabledTests, snmp: e.target.checked })}
                        />
                        <span>SNMP v2c</span>
                      </label>
                      <label className="test-checkbox-label">
                        <input 
                          type="checkbox" 
                          className="diag-custom-checkbox"
                          checked={enabledTests.remote}
                          onChange={e => setEnabledTests({ ...enabledTests, remote: e.target.checked })}
                        />
                        <span>Porta ({formData.remote_protocol.toUpperCase()})</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* BLOCO 2: PARÂMETROS ZABBIX */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <Radio size={16} color="#e53935" />
                  <h4>2. Monitoramento Zabbix Server</h4>
                  <label className="config-header-toggle">
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={formData.status === 'monitored'}
                      onChange={e => setFormData({ ...formData, status: e.target.checked ? 'monitored' : 'unmonitored' })}
                      disabled={!isAdmin}
                    />
                    <span>{formData.status === 'monitored' ? 'Habilitado' : 'Desativado'}</span>
                  </label>
                </div>

                <div className="config-section-body">
                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label>Host Técnico no Zabbix</label>
                      <input 
                        type="text" 
                        value={formData.zabbix_host} 
                        onChange={e => setFormData({ ...formData, zabbix_host: e.target.value })} 
                        placeholder="Ex: sw-dist-01 ou 192.168.1.10"
                      />
                    </div>
                    <div className="form-group flex-1">
                      <label>Nome Visível no Zabbix</label>
                      <input 
                        type="text" 
                        value={formData.zabbix_name} 
                        onChange={e => setFormData({ ...formData, zabbix_name: e.target.value })} 
                        placeholder="Ex: SW-DIST-01 - Borda"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-2">
                      <label>Community SNMP v2c</label>
                      <input 
                        type="text" 
                        value={formData.snmp_community} 
                        onChange={e => setFormData({ ...formData, snmp_community: e.target.value })} 
                        placeholder="Ex: ipermonitor"
                      />
                    </div>
                    <div className="form-group flex-1">
                      <label>Porta Zabbix / SNMP</label>
                      <input 
                        type="text" 
                        value={formData.port} 
                        onChange={e => setFormData({ ...formData, port: e.target.value })} 
                        placeholder="161 ou 10050"
                      />
                    </div>
                  </div>
                  <p className="config-card-hint">
                    Alterações salvas aqui atualizam o banco local do IperSoft. Para enviar ao Zabbix Server, utilize o botão <strong>Sincronizar Zabbix</strong> no topo.
                  </p>
                </div>
              </div>

              {/* BLOCO 3: PARÂMETROS APACHE GUACAMOLE */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <Terminal size={16} color="#00bcd4" />
                  <h4>3. Acesso Remoto (Apache Guacamole)</h4>
                  <label className="config-header-toggle">
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={!ignoreGuacamole}
                      onChange={e => setIgnoreGuacamole(!e.target.checked)}
                      disabled={!isAdmin}
                    />
                    <span>{!ignoreGuacamole ? 'Habilitado' : 'Ignorado'}</span>
                  </label>
                </div>

                <div className="config-section-body">
                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label>Nome da Conexão no Guacamole</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input 
                        type="text" 
                        value={formData.name || ''} 
                        readOnly 
                        disabled 
                        style={{ opacity: 0.85, cursor: 'not-allowed', backgroundColor: 'var(--bg-tertiary, #1f2430)' }}
                      />
                      <span className="badge-tag-canonical" style={{ whiteSpace: 'nowrap' }}>Espelha IperSoft</span>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label>Protocolo Remoto</label>
                      <select 
                        value={formData.remote_protocol} 
                        onChange={e => {
                          const proto = e.target.value;
                          const defaultP = proto === 'ssh' ? '22' : (proto === 'telnet' ? '23' : '3389');
                          setFormData({ ...formData, remote_protocol: proto, remote_port: defaultP });
                        }}
                      >
                        <option value="ssh">SSH (22)</option>
                        <option value="telnet">Telnet (23)</option>
                        <option value="rdp">RDP (3389)</option>
                      </select>
                    </div>
                    <div className="form-group flex-1">
                      <label>Porta Customizada</label>
                      <input 
                        type="text" 
                        value={formData.remote_port} 
                        onChange={e => setFormData({ ...formData, remote_port: e.target.value })} 
                        placeholder="Ex: 22 ou 2200"
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label>Usuário Remoto</label>
                      <input 
                        type="text" 
                        value={formData.remote_username} 
                        onChange={e => setFormData({ ...formData, remote_username: e.target.value })} 
                        placeholder="Ex: admin, root"
                      />
                    </div>
                    <div className="form-group flex-1">
                      <label>Senha de Acesso Remoto</label>
                      <div className="password-input-wrapper">
                        <input 
                          type={showPassword ? 'text' : 'password'} 
                          value={formData.remote_password} 
                          onChange={e => setFormData({ ...formData, remote_password: e.target.value })} 
                          placeholder={ipersoft?.has_remote_password ? '•••••••• (Preencha para alterar)' : 'Nenhuma senha gravada'}
                        />
                        <button 
                          type="button" 
                          className="btn-toggle-eye" 
                          onClick={() => setShowPassword(!showPassword)}
                          tabIndex="-1"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* BLOCO 4: PARÂMETROS DE BACKUP (OXIDIZED & FTP/TFTP) */}
              <div className="config-section-card">
                <div className="config-section-header">
                  <Archive size={16} color="#e91e63" />
                  <h4>4. Backup de Configurações</h4>
                  <label className="config-header-toggle" title="Habilita ou desativa a inclusão deste ativo no backup automatizado do Oxidized">
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={formData.backup_enabled !== false}
                      onChange={e => setFormData({ ...formData, backup_enabled: e.target.checked })}
                      disabled={!isAdmin}
                    />
                    <span>{formData.backup_enabled !== false ? 'Oxidized Habilitado' : 'Oxidized Desativado'}</span>
                  </label>
                </div>

                <div className="config-section-body">
                  {/* SUB-SEÇÃO 1: OXIDIZED (GIT / PULL) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '5px', marginTop: '2px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileCode size={13} color="#e91e63" />
                      Coleta Automática Oxidized (Git / Pull)
                    </span>
                    <span className="badge-tag-canonical" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                      {formData.backup_enabled !== false ? 'Ativo' : 'Pausado'}
                    </span>
                  </div>

                  <div className="form-group">
                    <label>Nome do Nó no Oxidized</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input 
                        type="text" 
                        value={formData.name || ''} 
                        readOnly 
                        disabled 
                        style={{ opacity: 0.85, cursor: 'not-allowed', backgroundColor: 'var(--bg-tertiary, #1f2430)' }}
                      />
                      <span className="badge-tag-canonical" style={{ whiteSpace: 'nowrap' }}>Espelha IperSoft</span>
                    </div>
                  </div>

                  {/* PERFIL DE SISTEMA OPERACIONAL E BOTÃO DETECTAR SO */}
                  <div className="form-row" style={{ alignItems: 'flex-end', gap: '8px', marginBottom: '4px' }}>
                    <div className="form-group flex-2">
                      <label>Perfil do Sistema Operacional (Automação & Comandos)</label>
                      <select
                        value={formData.os_profile || 'generic_ssh'}
                        onChange={e => {
                          const val = e.target.value;
                          let suggestedOx = formData.backup_model;
                          if (val === 'mikrotik_v7' || val === 'mikrotik_v6') suggestedOx = 'RouterOS';
                          else if (val === 'datacom_dmos') suggestedOx = 'datacom';
                          else if (val === 'huawei_vrp') suggestedOx = 'vrp';
                          else if (val === 'cisco_ios') suggestedOx = 'ios';
                          else if (val === 'a10_acos') suggestedOx = 'acos';
                          else if (val === 'fiberhome_olt') suggestedOx = 'fiberhome';
                          else if (val === 'linux_bash') suggestedOx = 'linux';
                          setFormData({ ...formData, os_profile: val, backup_model: suggestedOx });
                        }}
                      >
                        <option value="mikrotik_v7">MikroTik RouterOS v7</option>
                        <option value="mikrotik_v6">MikroTik RouterOS v6</option>
                        <option value="datacom_dmos">Datacom DmOS</option>
                        <option value="cisco_ios">Cisco IOS / IOS-XE</option>
                        <option value="huawei_vrp">Huawei VRP</option>
                        <option value="a10_acos">A10 Networks (ACOS)</option>
                        <option value="fiberhome_olt">Fiberhome OLT</option>
                        <option value="fortios">Fortinet FortiOS</option>
                        <option value="edgecos">EdgeCore / EdgeOS</option>
                        <option value="junos">Juniper JunOS</option>
                        <option value="linux_bash">Linux (Servidores / VMs)</option>
                        <option value="windows">Windows (Servidor / Desktop)</option>
                        <option value="generic_ssh">Genérico (CLI SSH Livre)</option>
                      </select>
                    </div>
                    <div className="form-group flex-1">
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ height: '38px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap', borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24' }}
                        onClick={handleDetectOS}
                        disabled={isDetectingOS}
                        title="Identifica o SO via SNMP sysDescr (rápido) ou SSH automaticamente"
                      >
                        <Zap size={14} className={isDetectingOS ? 'spin-icon' : ''} />
                        <span>{isDetectingOS ? 'Detectando...' : 'Detectar SO'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-2">
                      <label>Modelo de Backup (Oxidized / ACOS / RouterOS / etc.)</label>
                      <input
                        type="text"
                        list="oxidized-models-datalist"
                        value={formData.backup_model || 'RouterOS'}
                        onChange={e => setFormData({ ...formData, backup_model: e.target.value })}
                        placeholder="Ex: RouterOS, acos, datacom, ios, vrp..."
                        disabled={formData.backup_enabled === false}
                      />
                      <datalist id="oxidized-models-datalist">
                        <option value="RouterOS">MikroTik (RouterOS)</option>
                        <option value="acos">A10 Networks (ACOS)</option>
                        <option value="datacom">Datacom (DmOS)</option>
                        <option value="ios">Cisco (IOS / IOS-XE)</option>
                        <option value="vrp">Huawei (VRP)</option>
                        <option value="fiberhome">Fiberhome OLT</option>
                        <option value="fortios">Fortinet (FortiOS)</option>
                        <option value="edgecos">EdgeCore / EdgeOS</option>
                        <option value="junos">Juniper (JunOS)</option>
                        <option value="linux">Linux (Ubuntu / Debian / CentOS)</option>
                        <option value="panos">Palo Alto (PAN-OS)</option>
                        <option value="vyos">VyOS</option>
                      </datalist>
                    </div>
                    <div className="form-group flex-1">
                      <label title="Tempo limite em segundos para o Oxidized efetuar a leitura completa das configurações">
                        Timeout de Coleta (s)
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="600"
                        step="5"
                        placeholder="30"
                        value={formData.backup_timeout !== undefined ? formData.backup_timeout : 30}
                        onChange={e => setFormData({ ...formData, backup_timeout: e.target.value })}
                        disabled={formData.backup_enabled === false}
                      />
                    </div>
                  </div>

                  {/* SUB-SEÇÃO 2: SERVIDOR DE ARQUIVOS FTP/TFTP (PUSH) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '5px', marginTop: '10px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Folder size={13} color="#3b82f6" />
                      Envio para Servidor de Arquivos (FTP / TFTP / Push)
                    </span>
                    <span className="badge-tag-canonical" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                      {formData.file_backup_protocol && formData.file_backup_protocol !== 'disabled' ? formData.file_backup_protocol.toUpperCase() : 'Desativado'}
                    </span>
                  </div>

                  <div className="form-row">
                    <div className="form-group flex-1">
                      <label>Método / Protocolo</label>
                      <select
                        value={formData.file_backup_protocol || 'disabled'}
                        onChange={e => {
                          const val = e.target.value;
                          setFormData({
                            ...formData,
                            file_backup_protocol: val,
                            file_backup_folder: formData.file_backup_folder || (formData.client_group || '')
                          });
                        }}
                      >
                        <option value="disabled">Desativado / Sem Envio Diário</option>
                        <option value="ftp">FTP (Scripts MikroTik / Cisco / Linux)</option>
                        <option value="tftp">TFTP (Switches Datacom / Huawei / OLTs)</option>
                      </select>
                    </div>

                    <div className="form-group flex-1">
                      <label>Pasta de Destino no Servidor</label>
                      <input
                        type="text"
                        list="backup-server-folders-list"
                        value={formData.file_backup_folder || ''}
                        onChange={e => setFormData({ ...formData, file_backup_folder: e.target.value })}
                        placeholder={formData.client_group ? `Ex: ${formData.client_group}` : 'Ex: atm, inforline, diretrix...'}
                        disabled={formData.file_backup_protocol === 'disabled'}
                      />
                      <datalist id="backup-server-folders-list">
                        {Array.from(new Set([
                          'athila', 'atm', 'bkup', 'diretrix', 'fortaleza', 'infonet',
                          'inforline', 'iper', 'lhtech', 'oestenets', 'rtnet', 'seven', 'taionet',
                          ...(availableGroups || [])
                        ])).filter(Boolean).sort().map(folder => (
                          <option key={folder} value={folder} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Padrão do Nome do Arquivo (Opcional)</label>
                    <input
                      type="text"
                      value={formData.file_backup_pattern || ''}
                      onChange={e => setFormData({ ...formData, file_backup_pattern: e.target.value })}
                      placeholder="Ex: atm-router-aurin* ou *.rsc (vazio = nome do equipamento)"
                      disabled={formData.file_backup_protocol === 'disabled'}
                    />
                  </div>

                  <p className="config-card-hint">
                    Armazena a pasta e padrão de arquivos no servidor de backup para futura auditoria e conferência de backups diários.
                  </p>
                </div>
              </div>
            </div>

            <div className="panel-footer-actions" style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                * Salvar atualiza apenas o banco de dados do IperSoft. Nenhuma alteração externa é disparada automaticamente.
              </span>
              <button type="submit" className="btn-primary" disabled={isSaving}>
                <Save size={16} className={isSaving ? 'spin-icon' : ''} />
                {isSaving ? 'Salvando...' : 'Salvar Cadastro no IperSoft'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          ABA 3: COMPARATIVO & SINCRONIZAÇÃO EXTERNA (3 COLUNAS LADO A LADO)
          ========================================================================= */}
      {activeTab === 'integrations' && (
        <div className="detail-tab-content">
          {differences.length > 0 && (
            <div className="differences-alert-box">
              <AlertTriangle size={18} color="#f59e0b" />
              <div>
                <strong>Divergências detectadas entre o cadastro local (IperSoft) e as integrações:</strong>
                <ul className="differences-list">
                  {differences.map((diff, idx) => (
                    <li key={idx}>
                      <strong>{diff.field}:</strong> IperSoft (<code>{String(diff.ipersoft ?? '-')}</code>) vs Externo (<code>{String(diff.external ?? '-')}</code>)
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="integrations-comparison-grid">
            {/* COLUNA 1: ZABBIX SERVER */}
            <div className={`integration-column-card border-${zbxColor}`}>
              <div className="integration-col-header">
                <div className="integration-col-title">
                  <Radio size={18} color="#e53935" />
                  <h4>Zabbix Server</h4>
                </div>
                <span className={`badge-status-pill badge-${zbxColor}`}>
                  {!zbxActive ? 'Desativado' : zbxSynced ? 'Sincronizado' : 'Pendente'}
                </span>
              </div>

              <div className="integration-col-body">
                {!zbxActive ? (
                  <p className="text-muted">Monitoramento desativado no cadastro do IperSoft.</p>
                ) : isLoadingZbxDetails ? (
                  <div className="lazy-loading-box">
                    <RefreshCw size={20} className="spin-icon" color="#e53935" />
                    <span>Consultando API do Zabbix...</span>
                  </div>
                ) : zbxDetails ? (
                  <div className="integration-kv-list">
                    <div className="kv-row">
                      <span>HostID no Zabbix:</span>
                      <code>{zbxDetails.hostid}</code>
                    </div>
                    <div className="kv-row">
                      <span>Host Técnico:</span>
                      <code>{zbxDetails.host}</code>
                    </div>
                    <div className="kv-row">
                      <span>Nome Visível:</span>
                      <strong>{zbxDetails.name}</strong>
                    </div>
                    <div className="kv-row">
                      <span>Status no Servidor:</span>
                      <span className={`status-pill ${zbxDetails.status === 'monitored' ? 'status-pill-ok' : 'status-pill-disabled'}`}>
                        {zbxDetails.status === 'monitored' ? 'Monitorado' : 'Desativado'}
                      </span>
                    </div>
                    <div className="kv-block">
                      <span>Interfaces:</span>
                      <div className="chips-group" style={{ marginTop: '4px' }}>
                        {(zbxDetails.interfaces || []).map((iface, i) => (
                          <span key={i} className="chip-badge chip-interface">
                            <code>{iface.ip || iface.dns}:{iface.port}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="kv-block">
                      <span>Host Groups:</span>
                      <div className="chips-group" style={{ marginTop: '4px' }}>
                        {(zbxDetails.host_groups || []).map((g, i) => (
                          <span key={i} className="chip-badge chip-group">{g}</span>
                        ))}
                      </div>
                    </div>
                    <div className="kv-block">
                      <span>Templates:</span>
                      <div className="chips-group" style={{ marginTop: '4px' }}>
                        {(zbxDetails.templates || []).map((t, i) => (
                          <span key={i} className="chip-badge chip-template">{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted">Equipamento ainda não cadastrado no Zabbix Server.</p>
                )}
              </div>

              <div className="integration-col-footer">
                <button 
                  type="button" 
                  className="btn-platform-sync btn-sync-zbx"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleSyncZabbix}
                  disabled={isSyncingZbx || !isAdmin}
                >
                  <RefreshCw size={14} className={isSyncingZbx ? 'spin-icon' : ''} />
                  <span>{isSyncingZbx ? 'Sincronizando...' : (zbxDetails ? 'Atualizar no Zabbix Server' : 'Criar Host no Zabbix')}</span>
                </button>
              </div>
            </div>

            {/* COLUNA 2: APACHE GUACAMOLE */}
            <div className={`integration-column-card border-${guacColor}`}>
              <div className="integration-col-header">
                <div className="integration-col-title">
                  <Terminal size={18} color="#00bcd4" />
                  <h4>Apache Guacamole</h4>
                </div>
                <span className={`badge-status-pill badge-${guacColor}`}>
                  {!guacActive ? 'Ignorado' : guacSynced ? 'Conexão Ativa' : 'Pendente'}
                </span>
              </div>

              <div className="integration-col-body">
                {!guacActive ? (
                  <p className="text-muted">Acesso remoto marcado como ignorado no IperSoft.</p>
                ) : isLoadingGuacDetails ? (
                  <div className="lazy-loading-box">
                    <RefreshCw size={20} className="spin-icon" color="#00bcd4" />
                    <span>Consultando API do Guacamole...</span>
                  </div>
                ) : guacDetails ? (
                  <div className="integration-kv-list">
                    <div className="kv-row">
                      <span>ID Conexão:</span>
                      <code>{comparison?.guacamole?.connection_id || '-'}</code>
                    </div>
                    <div className="kv-row">
                      <span>Nome Conexão:</span>
                      <strong>{guacDetails.connection_name || guacDetails.name || '-'}</strong>
                    </div>
                    <div className="kv-row">
                      <span>Pasta / Grupo:</span>
                      <strong style={{ color: '#00bcd4' }}>{guacDetails.folder_name || 'ROOT'}</strong>
                    </div>
                    <div className="kv-row">
                      <span>Host Destino:</span>
                      <code>{guacDetails.hostname || '-'}</code>
                    </div>
                    <div className="kv-row">
                      <span>Protocolo & Porta:</span>
                      <code>{(guacDetails.protocol || 'ssh').toUpperCase()} : {guacDetails.port}</code>
                    </div>
                    <div className="kv-row">
                      <span>Usuário Remoto:</span>
                      <strong>{guacDetails.username || '-'}</strong>
                    </div>
                    <div className="kv-row">
                      <span>Senha no Guacamole:</span>
                      <span>
                        {guacDetails.has_password ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span className="status-pill-ok" style={{ fontSize: '0.7rem' }}>Gravada</span>
                            {guacDetails.password && (
                              <button 
                                type="button" 
                                className="btn-toggle-eye" 
                                onClick={() => setShowGuacPassword(!showGuacPassword)}
                              >
                                {showGuacPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                            )}
                            {showGuacPassword && guacDetails.password && (
                              <code>{guacDetails.password}</code>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted">Ausente</span>
                        )}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted">Nenhuma conexão criada no servidor Guacamole.</p>
                )}
              </div>

              <div className="integration-col-footer" style={{ display: 'flex', gap: '8px' }}>
                <button 
                  type="button" 
                  className="btn-platform-sync btn-sync-guac"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleSyncGuacamole}
                  disabled={isSyncingGuac || !isAdmin}
                >
                  <RefreshCw size={14} className={isSyncingGuac ? 'spin-icon' : ''} />
                  <span>{isSyncingGuac ? 'Enviando...' : (guacDetails ? 'Atualizar Conexão' : 'Criar no Guacamole')}</span>
                </button>
                {guacDetails && (
                  <button
                    type="button"
                    className="btn-delete-guac"
                    onClick={handleRemoveGuacamole}
                    disabled={isRemovingGuac || !isAdmin}
                    title="Excluir conexão do servidor Apache Guacamole"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* COLUNA 3: OXIDIZED DAEMON */}
            <div className={`integration-column-card border-${oxColor}`}>
              <div className="integration-col-header">
                <div className="integration-col-title">
                  <FileCode size={18} color="#e91e63" />
                  <h4>Oxidized Daemon</h4>
                </div>
                <span className={`badge-status-pill badge-${oxColor}`}>
                  {!oxActive ? 'Desativado' : oxColor === 'green' ? 'Sincronizado' : oxColor === 'red' ? 'Erro de Coleta' : 'Aguardando'}
                </span>
              </div>

              <div className="integration-col-body">
                {!oxActive ? (
                  <p className="text-muted">Coleta de backup desabilitada para este equipamento.</p>
                ) : isLoadingOxDetails ? (
                  <div className="lazy-loading-box">
                    <RefreshCw size={20} className="spin-icon" color="#e91e63" />
                    <span>Consultando daemon do Oxidized...</span>
                  </div>
                ) : oxDetails ? (
                  <div className="integration-kv-list">
                    <div className="kv-row">
                      <span>Nome do Nó:</span>
                      <code>{oxDetails.name}</code>
                    </div>
                    <div className="kv-row">
                      <span>Modelo de SO:</span>
                      <code>{oxDetails.model}</code>
                    </div>
                    <div className="kv-row">
                      <span>Grupo Git:</span>
                      <code>{oxDetails.group}</code>
                    </div>
                    <div className="kv-row">
                      <span>Timeout Configurado:</span>
                      <code>{oxDetails.timeout || formData.backup_timeout || 30}s</code>
                    </div>
                    <div className="kv-row">
                      <span>Status da Coleta:</span>
                      <span className={`status-pill ${oxDetails.status === 'success' ? 'status-pill-ok' : 'status-pill-fail'}`}>
                        {oxDetails.status}
                      </span>
                    </div>
                    <div className="kv-row">
                      <span>Último Backup:</span>
                      <span>
                        {oxDetails.last_backup
                          ? `${new Date(oxDetails.last_backup).toLocaleString('pt-BR')}`
                          : 'Pendente'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted">Nó aguardando recarga da lista no daemon do Oxidized.</p>
                )}
              </div>

              <div className="integration-col-footer" style={{ display: 'flex', gap: '8px' }}>
                <button 
                  type="button" 
                  className="btn-platform-sync btn-sync-ox"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleSyncOxidized}
                  disabled={isSyncingOx || !isAdmin}
                >
                  <RefreshCw size={14} className={isSyncingOx ? 'spin-icon' : ''} />
                  <span>{isSyncingOx ? 'Recarregando...' : 'Sincronizar Oxidized (/reload)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL DE VISUALIZAÇÃO DE CONFIGURAÇÃO DO OXIDIZED
          ========================================================================= */}
      {oxConfigModalOpen && (
        <div className="modal-overlay" onClick={() => setOxConfigModalOpen(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: 920, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div className="modal-title-box">
                <FileCode size={18} color="#e91e63" />
                <h2 className="modal-title">Configuração do Ativo: {oxConfigNodeName}</h2>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ height: '30px', fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={handleCopyOxConfig}
                >
                  {copiedOxConfig ? <Check size={13} color="var(--color-success)" /> : <Copy size={13} />}
                  <span>{copiedOxConfig ? 'Copiado!' : 'Copiar Texto'}</span>
                </button>
                <button className="btn-close-modal" onClick={() => setOxConfigModalOpen(false)}>
                  ✕
                </button>
              </div>
            </div>
            <div className="modal-body" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '1rem' }}>
              <pre style={{
                flex: 1,
                overflow: 'auto',
                background: '#0d1117',
                color: '#e6edf3',
                padding: '1rem',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontFamily: 'var(--font-mono)',
                margin: 0,
                lineHeight: 1.5,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                maxHeight: '60vh'
              }}>
                {oxConfigContent}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
