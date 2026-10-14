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
  RotateCcw
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
    return history.map(h => ({
      clock: h.clock,
      val: parseFloat(h.value) || 0
    })).filter(p => !isNaN(p.val));
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
  const clockRange = (maxClock - minClock) || 1;

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
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

          {/* Eixo X Labels */}
          <text x={padLeft} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="start">
            {formatClock(minClock)}
          </text>
          <text x={padLeft + innerW / 2} y={height - 8} fill="var(--text-muted)" fontSize="9" textAnchor="middle">
            {formatClock((minClock + maxClock) / 2)}
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

  // 1. Estados de Seções do Accordion (Multi-open independente!)
  const [openSections, setOpenSections] = useState({
    ipersoft: true,
    zabbix: false,
    guacamole: false,
    oxidized: false,
    zabbix_status: false,
    remote: false
  });

  const toggleSection = (key, isDisabled = false) => {
    if (isDisabled) return;
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 2. Estados de Ações e Sincronizações
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncingZbx, setIsSyncingZbx] = useState(false);
  const [isSyncingGuac, setIsSyncingGuac] = useState(false);
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
    remote_protocol: 'ssh',
    remote_port: '22',
    remote_username: '',
    remote_password: '',
    backup_model: 'RouterOS',
    backup_enabled: true
  });

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
        remote_protocol: ipData.remote_protocol || 'ssh',
        remote_port: ipData.remote_port || '22',
        remote_username: ipData.remote_username || '',
        remote_password: ipData.remote_password || '',
        backup_model: ipData.backup_model || 'RouterOS',
        backup_enabled: ipData.backup_enabled !== false
      });

      if (ipData.enabled_tests) {
        setEnabledTests({
          icmp: ipData.enabled_tests.icmp !== false,
          snmp: ipData.enabled_tests.snmp !== false,
          remote: ipData.enabled_tests.remote !== false
        });
      }

      setIgnoreGuacamole(Boolean(compData?.guacamole?.ignore_guacamole));

      if (guacCfg && guacCfg.url) {
        let clean = guacCfg.url.trim().replace(/\/+$/, '');
        if (!clean.endsWith('/guacamole') && !clean.includes('/guacamole/')) {
          clean = `${clean}/guacamole`;
        }
        setGuacBaseUrl(clean);
      }
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
    if (openSections.zabbix && !zbxDetails && zbxActive) {
      fetchZabbixDetails();
    }
  }, [openSections.zabbix, zbxActive]);

  // Linha 3: Dados no Guacamole
  const fetchGuacamoleDetails = async () => {
    if (isLoadingGuacDetails) return;
    setIsLoadingGuacDetails(true);
    try {
      const data = await authService.getAssetGuacamoleDetails(assetId);
      setGuacDetails(data);
    } catch (err) {
      setGuacDetails(null);
      // Se não for erro de cadastro inexistente (404), mostra o feedback
      if (!err.message?.includes('Nenhuma conexão') && !err.message?.includes('404')) {
        setFeedback({ type: 'error', message: `Erro ao buscar detalhes no Guacamole: ${err.message}` });
      }
    } finally {
      setIsLoadingGuacDetails(false);
    }
  };

  useEffect(() => {
    if (openSections.guacamole && !guacDetails && guacActive) {
      fetchGuacamoleDetails();
    }
  }, [openSections.guacamole, guacActive]);

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
    if (openSections.oxidized && !oxDetails && oxActive) {
      fetchOxidizedDetails();
    }
  }, [openSections.oxidized, oxActive]);

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

      // Se há alarme ativo com item, seleciona automaticamente o primeiro item envolvido!
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
    if (openSections.zabbix_status && !zbxProblems && !zbxItems) {
      fetchZabbixStatusAndItems();
    }
  }, [openSections.zabbix_status]);

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
    if (openSections.remote && !guacLaunchData && comparison?.guacamole?.is_synced) {
      fetchGuacamoleLaunchSession();
    }
  }, [openSections.remote]);

  // Carregar histórico de um item específico
  const handleSelectItem = async (item, period = itemHistoryPeriod) => {
    setSelectedItem(item);
    setIsLoadingItemHistory(true);
    try {
      const histData = await authService.getAssetZabbixItemHistory(
        assetId,
        item.itemid,
        period,
        item.value_type ?? 0
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

  // Salvar configurações no IperSoft
  const handleSaveIpersoft = async (e) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    try {
      await authService.updateAsset(assetId, {
        name: formData.name,
        hostname: formData.hostname,
        ip_address: formData.ip_address,
        dns: formData.dns,
        client_group: formData.client_group,
        port: formData.port,
        snmp_community: formData.snmp_community,
        status: formData.status,
        guacamole_protocol: formData.remote_protocol,
        guacamole_port: formData.remote_port,
        guacamole_username: formData.remote_username,
        guacamole_password: formData.remote_password,
        backup_model: formData.backup_model,
        backup_enabled: formData.backup_enabled,
        enabled_tests: enabledTests,
        ignore_guacamole: ignoreGuacamole,
        sync_zabbix: false,
        sync_guacamole: true
      });

      const successMsg = formData.backup_enabled
        ? 'Configurações salvas e sincronizadas (Guacamole & Oxidized)!'
        : 'Configurações do IperSoft salvas e sincronizadas com Guacamole!';
      setFeedback({ type: 'success', message: successMsg });
      await loadData();
      fetchGuacamoleDetails();
      fetchGuacamoleLaunchSession();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao salvar alterações no IperSoft.' });
    } finally {
      setIsSaving(false);
    }
  };

  // Alternar monitoramento no Zabbix
  const handleToggleZabbixStatus = async (e) => {
    const isChecked = e.target.checked;
    setIsTogglingZbxStatus(true);
    setFeedback(null);
    try {
      const newStatus = isChecked ? 'monitored' : 'unmonitored';
      await authService.toggleZabbixHostStatus(assetId, isChecked);
      setFormData(prev => ({ ...prev, status: newStatus }));
      setFeedback({ 
        type: 'success', 
        message: isChecked ? 'Host ativado no Zabbix Server.' : 'Host desativado no Zabbix Server.' 
      });
      await loadData();
      if (openSections.zabbix) fetchZabbixDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao alterar status no Zabbix.' });
    } finally {
      setIsTogglingZbxStatus(false);
    }
  };

  // Alternar Guacamole
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
        message: isChecked ? 'Host ativado no Apache Guacamole.' : 'Host desativado/ignorado no Guacamole.' 
      });
      await loadData();
      if (openSections.guacamole) fetchGuacamoleDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao alterar status no Guacamole.' });
    } finally {
      setIsTogglingGuacStatus(false);
    }
  };

  // Alternar Oxidized
  const handleToggleOxidizedStatus = async (e) => {
    const isChecked = e.target.checked;
    setIsTogglingOxStatus(true);
    setFeedback(null);
    try {
      await authService.updateAsset(assetId, { backup_enabled: isChecked });
      setFormData(prev => ({ ...prev, backup_enabled: isChecked }));
      setFeedback({ 
        type: 'success', 
        message: isChecked ? 'Backup ativado no Oxidized.' : 'Backup desativado no Oxidized.' 
      });
      await loadData();
      if (openSections.oxidized) fetchOxidizedDetails();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Falha ao alterar status no Oxidized.' });
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
      if (openSections.zabbix) fetchZabbixDetails();
      if (openSections.guacamole) fetchGuacamoleDetails();
      if (openSections.remote) fetchGuacamoleLaunchSession();
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

  // Filtragem de itens do Zabbix na Linha 5
  const filteredItems = (zbxItems || []).filter(it => {
    if (!itemSearchQuery) return true;
    const q = itemSearchQuery.toLowerCase();
    return (it.name || '').toLowerCase().includes(q) || (it.key || '').toLowerCase().includes(q);
  });

  return (
    <div className="view-container detail-view-layout">
      {/* 1. CABEÇALHO DO EQUIPAMENTO */}
      <div className="detail-header-bar">
        <div className="detail-header-left">
          <button type="button" className="btn-back" onClick={onBack}>
            <ArrowLeft size={16} /> Voltar para Equipamentos
          </button>
          <div className="detail-title-wrapper">
            <h1 className="detail-title">{formData.name || 'Equipamento'}</h1>
            <code className="detail-ip-badge">{formData.ip_address || formData.hostname || 'Sem IP'}</code>
            <span className={`status-pill ${formData.status === 'monitored' ? 'status-pill-ok' : 'status-pill-unmonitored'}`}>
              {formData.status === 'monitored' ? 'Monitorado' : 'Desativado'}
            </span>
          </div>
        </div>

        <div className="detail-header-actions">
          <button 
            type="button" 
            className="btn-action-test"
            onClick={handleRunTests}
            disabled={isTesting}
          >
            <Activity size={16} className={isTesting ? 'spin-icon' : ''} />
            {isTesting ? 'Testando...' : 'Testar Conectividade'}
          </button>

          <button 
            type="button" 
            className="btn-action-sync-all"
            onClick={handleSyncAll}
            disabled={isSyncingAll || !isAdmin}
            title={!isAdmin ? 'Apenas administradores podem sincronizar' : 'Alinhar IperSoft, Zabbix e Guacamole'}
          >
            <Zap size={16} className={isSyncingAll ? 'spin-icon' : ''} />
            {isSyncingAll ? 'Sincronizando...' : 'Sincronizar Todas as Plataformas'}
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

      {/* =========================================================================
          ESTRUTURA DAS 6 LINHAS RETRÁTEIS (ACCORDION INDEPENDENTE MULTI-OPEN)
          ========================================================================= */}
      <div className="accordion-stack">

        {/* -----------------------------------------------------------------
            LINHA 1: DADOS NO IPERSOFT & DIAGNÓSTICOS / TESTES
            ----------------------------------------------------------------- */}
        <div className={`accordion-card ${openSections.ipersoft ? 'is-open' : ''}`}>
          <div className="accordion-header" onClick={() => toggleSection('ipersoft')}>
            <div className="acc-header-left">
              <span className="acc-chevron">
                {openSections.ipersoft ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              <div className="acc-title-group">
                <Server size={18} color="var(--color-primary)" />
                <span className="acc-title-text">Dados no IperSoft & Diagnósticos/Testes</span>
                <span className="badge-tag-canonical">Canônico Master</span>
              </div>
            </div>

            {/* Ícones de resultado dos testes de conexão no cabeçalho */}
            <div className="acc-header-right">
              <div className="acc-test-badges-group" title="Status dos testes de conectividade do equipamento">
                {/* ICMP / Ping */}
                <span className={`acc-test-pill ${!enabledTests.icmp ? 'pill-disabled' : (icmpDiag?.status === 'ok' ? 'pill-ok' : icmpDiag?.status === 'timeout' ? 'pill-timeout' : 'pill-fail')}`}>
                  ICMP: {enabledTests.icmp ? (icmpDiag?.status === 'ok' ? `${icmpDiag.latency_ms || 'OK'}ms` : icmpDiag?.status || 'Pendente') : 'Desat.'}
                </span>

                {/* SNMP */}
                <span className={`acc-test-pill ${!enabledTests.snmp ? 'pill-disabled' : (snmpDiag?.status === 'ok' ? 'pill-ok' : 'pill-fail')}`}>
                  SNMP: {enabledTests.snmp ? (snmpDiag?.status === 'ok' ? 'OK' : snmpDiag?.status || 'Pendente') : 'Desat.'}
                </span>

                {/* Porta Remota */}
                <span className={`acc-test-pill ${!enabledTests.remote ? 'pill-disabled' : (remoteDiag?.status === 'ok' ? 'pill-ok' : 'pill-fail')}`}>
                  {formData.remote_protocol.toUpperCase()}: {enabledTests.remote ? (remoteDiag?.status === 'ok' ? 'Aberta' : remoteDiag?.status || 'Pendente') : 'Desat.'}
                </span>
              </div>
            </div>
          </div>

          {openSections.ipersoft && (
            <div className="accordion-body">
              <form onSubmit={handleSaveIpersoft} className="asset-detail-form">
                <div className="form-section-title">Identificação Básica</div>
                <div className="form-row">
                  <div className="form-group flex-2">
                    <label>Nome do Equipamento (Visível)</label>
                    <input 
                      type="text" 
                      value={formData.name} 
                      onChange={e => setFormData({ ...formData, name: e.target.value })} 
                      required 
                      placeholder="Ex: SW-DIST-01"
                    />
                  </div>
                  <div className="form-group flex-2">
                    <label>Hostname Técnico</label>
                    <input 
                      type="text" 
                      value={formData.hostname} 
                      onChange={e => setFormData({ ...formData, hostname: e.target.value })} 
                      required 
                      placeholder="Ex: sw-dist-01.local"
                    />
                  </div>
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
                  <div className="form-group flex-2">
                    <label>Empresa / Grupo do Cliente</label>
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
                </div>

                {/* Ativação de Integrações */}
                <div className="form-section-title" style={{ marginTop: '1.25rem' }}>
                  Integrações Habilitadas para este Equipamento
                </div>
                <div className="acc-integrations-toggle-grid">
                  {/* Zabbix Toggle */}
                  <label className={`integration-toggle-card ${zbxActive ? 'is-active is-zbx' : ''}`}>
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={zbxActive}
                      onChange={handleToggleZabbixStatus}
                      disabled={isTogglingZbxStatus || !isAdmin}
                    />
                    <div className="integration-toggle-info">
                      <div className="integration-toggle-header">
                        <Radio size={16} color={zbxActive ? '#e53935' : 'var(--text-muted)'} />
                        <strong>Monitoramento Zabbix</strong>
                      </div>
                      <span className="integration-toggle-desc">
                        {zbxActive ? 'Ativo (Sincronizado no Zabbix Server)' : 'Desativado para este equipamento'}
                      </span>
                    </div>
                    {isTogglingZbxStatus && <RefreshCw size={14} className="spin-icon text-muted" />}
                  </label>

                  {/* Guacamole Toggle */}
                  <label className={`integration-toggle-card ${guacActive ? 'is-active is-guac' : ''}`}>
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={guacActive}
                      onChange={handleToggleGuacamoleStatus}
                      disabled={isTogglingGuacStatus || !isAdmin}
                    />
                    <div className="integration-toggle-info">
                      <div className="integration-toggle-header">
                        <Terminal size={16} color={guacActive ? '#43a047' : 'var(--text-muted)'} />
                        <strong>Acesso Remoto Guacamole</strong>
                      </div>
                      <span className="integration-toggle-desc">
                        {guacActive ? 'Ativo (Conexão SSH/Telnet/RDP)' : 'Ignorado / Sem acesso remoto'}
                      </span>
                    </div>
                    {isTogglingGuacStatus && <RefreshCw size={14} className="spin-icon text-muted" />}
                  </label>

                  {/* Oxidized Toggle */}
                  <label className={`integration-toggle-card ${oxActive ? 'is-active is-ox' : ''}`}>
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={oxActive}
                      onChange={handleToggleOxidizedStatus}
                      disabled={isTogglingOxStatus || !isAdmin}
                    />
                    <div className="integration-toggle-info">
                      <div className="integration-toggle-header">
                        <FileCode size={16} color={oxActive ? '#e91e63' : 'var(--text-muted)'} />
                        <strong>Backup no Oxidized</strong>
                      </div>
                      <span className="integration-toggle-desc">
                        {oxActive ? 'Ativo (Coleta de configs e Git)' : 'Backup desabilitado'}
                      </span>
                    </div>
                    {isTogglingOxStatus && <RefreshCw size={14} className="spin-icon text-muted" />}
                  </label>
                </div>

                <div className="form-section-title" style={{ marginTop: '1.25rem' }}>
                  Parâmetros de Integrações & Acesso
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
                    <label>Porta Zabbix</label>
                    <input 
                      type="text" 
                      value={formData.port} 
                      onChange={e => setFormData({ ...formData, port: e.target.value })} 
                      placeholder="10050"
                    />
                  </div>
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
                    <label>Porta Remota</label>
                    <input 
                      type="text" 
                      value={formData.remote_port} 
                      onChange={e => setFormData({ ...formData, remote_port: e.target.value })} 
                      placeholder="22"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group flex-2">
                    <label>Usuário Remoto</label>
                    <input 
                      type="text" 
                      value={formData.remote_username} 
                      onChange={e => setFormData({ ...formData, remote_username: e.target.value })} 
                      placeholder="Ex: admin, root"
                    />
                  </div>
                  <div className="form-group flex-2">
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
                  <div className="form-group flex-2">
                    <label>Modelo no Oxidized</label>
                    <select
                      value={(() => {
                        const m = (formData.backup_model || '').toLowerCase();
                        if (m === 'dmos' || m === 'datacom') return 'datacom';
                        if (m === 'routeros') return 'RouterOS';
                        return formData.backup_model || 'RouterOS';
                      })()}
                      onChange={e => setFormData({ ...formData, backup_model: e.target.value })}
                    >
                      <option value="RouterOS">MikroTik (RouterOS)</option>
                      <option value="ios">Cisco (IOS / IOS-XE)</option>
                      <option value="datacom">Datacom (DmOS)</option>
                      <option value="vrp">Huawei (VRP)</option>
                      <option value="fortios">Fortinet (FortiOS)</option>
                      <option value="edgecos">EdgeCore / EdgeOS</option>
                      <option value="junos">Juniper (JunOS)</option>
                    </select>
                  </div>
                </div>

                {/* Seleção de Testes de Conectividade Aplicáveis */}
                <div className="form-section-title" style={{ marginTop: '1.25rem' }}>
                  Testes de Conectividade Aplicáveis a este Equipamento
                </div>
                <div className="acc-tests-config-row">
                  <label className="test-checkbox-label">
                    <input 
                      type="checkbox" 
                      className="diag-custom-checkbox"
                      checked={enabledTests.icmp}
                      onChange={e => setEnabledTests({ ...enabledTests, icmp: e.target.checked })}
                    />
                    <span>Habilitar Ping (ICMP)</span>
                  </label>

                  <label className="test-checkbox-label">
                    <input 
                      type="checkbox" 
                      className="diag-custom-checkbox"
                      checked={enabledTests.snmp}
                      onChange={e => setEnabledTests({ ...enabledTests, snmp: e.target.checked })}
                    />
                    <span>Habilitar Consulta SNMP v2c</span>
                  </label>

                  <label className="test-checkbox-label">
                    <input 
                      type="checkbox" 
                      className="diag-custom-checkbox"
                      checked={enabledTests.remote}
                      onChange={e => setEnabledTests({ ...enabledTests, remote: e.target.checked })}
                    />
                    <span>Habilitar Teste de Porta Remota ({formData.remote_protocol.toUpperCase()})</span>
                  </label>
                </div>

                <div className="panel-footer-actions" style={{ marginTop: '1.5rem' }}>
                  <button type="submit" className="btn-primary" disabled={isSaving}>
                    <Save size={16} className={isSaving ? 'spin-icon' : ''} />
                    {isSaving ? 'Salvando...' : 'Salvar no IperSoft'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* -----------------------------------------------------------------
            LINHA 2: DADOS NO ZABBIX (CADASTRO E CONFIGURAÇÃO)
            ----------------------------------------------------------------- */}
        <div className={`accordion-card acc-card-${zbxColor} ${openSections.zabbix ? 'is-open' : ''} ${!zbxActive ? 'is-disabled' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => toggleSection('zabbix', !zbxActive)}
            title={!zbxActive ? 'Monitoramento desativado para este equipamento no Zabbix' : 'Clique para ver dados cadastrados no Zabbix'}
          >
            <div className="acc-header-left">
              <span className="acc-chevron">
                {openSections.zabbix ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              <div className="acc-title-group">
                <Radio size={18} color="#e53935" />
                <span className="acc-title-text">Dados no Zabbix</span>
                <span className={`badge-status-pill badge-${zbxColor}`}>
                  {zbxColor === 'green' ? 'Ativo & Sincronizado' : zbxColor === 'red' ? 'Pendente de Cadastro' : 'Desativado'}
                </span>
              </div>
            </div>

            <div className="acc-header-right">
              {zbxActive && zabbix?.hostid && (
                <span className="acc-header-hint font-mono">HostID: {zabbix.hostid}</span>
              )}
            </div>
          </div>

          {openSections.zabbix && zbxActive && (
            <div className="accordion-body">
              {isLoadingZbxDetails ? (
                <div className="lazy-loading-box">
                  <RefreshCw size={22} className="spin-icon" color="#e53935" />
                  <span>Consultando dados cadastrais diretamente na API do Zabbix...</span>
                </div>
              ) : zbxDetails ? (
                <div className="platform-details-view">
                  <div className="detail-meta-grid">
                    <div className="meta-box">
                      <span className="meta-label">Nome Técnico (host):</span>
                      <span className="meta-val font-mono">{zbxDetails.host}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Nome Visível (name):</span>
                      <span className="meta-val font-bold">{zbxDetails.name}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">HostID:</span>
                      <span className="meta-val font-mono">{zbxDetails.hostid}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Status no Zabbix:</span>
                      <span className="meta-val">
                        <span className={`status-pill ${zbxDetails.status === 'monitored' ? 'status-pill-ok' : 'status-pill-disabled'}`}>
                          {zbxDetails.status === 'monitored' ? 'Monitorado' : 'Desativado'}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Templates Associados */}
                  <div className="detail-chips-section">
                    <span className="chips-section-title">Templates Associados no Zabbix:</span>
                    <div className="chips-group">
                      {zbxDetails.templates && zbxDetails.templates.length > 0 ? (
                        zbxDetails.templates.map((tpl, idx) => (
                          <span key={idx} className="chip-badge chip-template">
                            <Layers size={12} /> {tpl}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted">Nenhum template associado.</span>
                      )}
                    </div>
                  </div>

                  {/* Host Groups */}
                  <div className="detail-chips-section">
                    <span className="chips-section-title">Host Groups (Grupos de Hosts):</span>
                    <div className="chips-group">
                      {zbxDetails.host_groups && zbxDetails.host_groups.length > 0 ? (
                        zbxDetails.host_groups.map((grp, idx) => (
                          <span key={idx} className="chip-badge chip-group">
                            {grp}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted">Nenhum grupo associado.</span>
                      )}
                    </div>
                  </div>

                  {/* Interfaces */}
                  <div className="detail-chips-section">
                    <span className="chips-section-title">Interfaces Cadastradas no Zabbix:</span>
                    <div className="chips-group">
                      {zbxDetails.interfaces && zbxDetails.interfaces.length > 0 ? (
                        zbxDetails.interfaces.map((iface, idx) => (
                          <span key={idx} className="chip-badge chip-interface">
                            <code>{iface.ip || iface.dns}:{iface.port}</code> 
                            <small>({iface.type === 2 ? 'SNMP' : 'Agente'}{iface.community ? ` - ${iface.community}` : ''})</small>
                          </span>
                        ))
                      ) : (
                        <span className="text-muted">Nenhuma interface listada.</span>
                      )}
                    </div>
                  </div>

                  {/* Ações da Linha */}
                  <div className="acc-body-footer">
                    <button 
                      type="button" 
                      className="btn-platform-sync btn-sync-zbx"
                      style={{ marginLeft: 'auto' }}
                      onClick={handleSyncZabbix}
                      disabled={isSyncingZbx || !isAdmin}
                    >
                      <RefreshCw size={14} className={isSyncingZbx ? 'spin-icon' : ''} />
                      {isSyncingZbx ? 'Atualizando...' : 'Atualizar Cadastro no Zabbix'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="platform-not-synced-box">
                  <AlertCircle size={20} color="var(--color-danger)" />
                  <div>
                    <strong>Equipamento não cadastrado no Zabbix Server.</strong>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Clique no botão abaixo para criar este host com interfaces e grupos no Zabbix.
                    </span>
                  </div>
                  <button 
                    type="button" 
                    className="btn-platform-sync btn-sync-zbx" 
                    style={{ marginLeft: 'auto' }}
                    onClick={handleSyncZabbix}
                    disabled={isSyncingZbx || !isAdmin}
                  >
                    <RefreshCw size={14} className={isSyncingZbx ? 'spin-icon' : ''} />
                    Cadastrar no Zabbix
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* -----------------------------------------------------------------
            LINHA 3: DADOS NO GUACAMOLE (CADASTRO E CONFIGURAÇÃO)
            ----------------------------------------------------------------- */}
        <div className={`accordion-card acc-card-${guacColor} ${openSections.guacamole ? 'is-open' : ''} ${!guacActive ? 'is-disabled' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => toggleSection('guacamole', !guacActive)}
            title={!guacActive ? 'Acesso remoto desativado/ignorado no Apache Guacamole' : 'Clique para ver dados da conexão no Guacamole'}
          >
            <div className="acc-header-left">
              <span className="acc-chevron">
                {openSections.guacamole ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              <div className="acc-title-group">
                <Terminal size={18} color="#00bcd4" />
                <span className="acc-title-text">Dados no Guacamole</span>
                <span className={`badge-status-pill badge-${guacColor}`}>
                  {guacColor === 'green' ? 'Ativo & Conexão Pronta' : guacColor === 'red' ? 'Pendente de Conexão' : 'Desativado'}
                </span>
              </div>
            </div>

            <div className="acc-header-right">
              {guacActive && comparison?.guacamole?.connection_id && (
                <span className="acc-header-hint font-mono">ID: {comparison.guacamole.connection_id}</span>
              )}
            </div>
          </div>

          {openSections.guacamole && guacActive && (
            <div className="accordion-body">
              {isLoadingGuacDetails ? (
                <div className="lazy-loading-box">
                  <RefreshCw size={22} className="spin-icon" color="#00bcd4" />
                  <span>Consultando dados da conexão diretamente no Apache Guacamole...</span>
                </div>
              ) : guacDetails ? (
                <div className="platform-details-view">
                  <div className="detail-meta-grid">
                    <div className="meta-box">
                      <span className="meta-label">Pasta / Grupo no Guacamole:</span>
                      <span className="meta-val font-bold" style={{ color: '#00bcd4' }}>{guacDetails.folder_name || 'ROOT'}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Host Remoto (IP / Hostname):</span>
                      <span className="meta-val font-mono">{guacDetails.hostname || '-'}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Protocolo & Porta:</span>
                      <span className="meta-val uppercase"><code>{guacDetails.protocol} : {guacDetails.port}</code></span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Usuário Cadastrado:</span>
                      <span className="meta-val">{guacDetails.username || <span className="text-muted">Não configurado</span>}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Senha no Guacamole:</span>
                      <span className="meta-val">
                        {guacDetails.has_password ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span className="status-pill-ok" style={{ fontSize: '0.72rem' }}>Gravada</span>
                            {guacDetails.password && (
                              <button 
                                type="button" 
                                className="btn-toggle-eye" 
                                onClick={() => setShowGuacPassword(!showGuacPassword)}
                                title="Visualizar senha"
                              >
                                {showGuacPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            )}
                            {showGuacPassword && guacDetails.password && (
                              <code style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>{guacDetails.password}</code>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">Nenhuma senha gravada</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Ações da Linha */}
                  <div className="acc-body-footer">
                    <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                      <button 
                        type="button" 
                        className="btn-platform-sync btn-sync-guac"
                        onClick={handleSyncGuacamole}
                        disabled={isSyncingGuac || !isAdmin}
                      >
                        <RefreshCw size={14} className={isSyncingGuac ? 'spin-icon' : ''} />
                        {isSyncingGuac ? 'Sincronizando...' : 'Atualizar no Guacamole'}
                      </button>

                      <button
                        type="button"
                        className="btn-delete-guac"
                        onClick={handleRemoveGuacamole}
                        disabled={isRemovingGuac || !isAdmin}
                      >
                        <Trash2 size={14} className={isRemovingGuac ? 'spin-icon' : ''} />
                        Excluir Conexão
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="platform-not-synced-box">
                  <Terminal size={20} color="var(--color-danger)" />
                  <div>
                    <strong>Nenhuma conexão cadastrada no Apache Guacamole.</strong>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Clique abaixo para criar o acesso remoto SSH/Telnet/RDP automaticamente no Guacamole.
                    </span>
                  </div>
                  <button 
                    type="button" 
                    className="btn-platform-sync btn-sync-guac" 
                    style={{ marginLeft: 'auto' }}
                    onClick={handleSyncGuacamole}
                    disabled={isSyncingGuac || !isAdmin}
                  >
                    <RefreshCw size={14} className={isSyncingGuac ? 'spin-icon' : ''} />
                    Criar no Guacamole
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* -----------------------------------------------------------------
            LINHA 4: DADOS NO OXIDIZED (BACKUP DE CONFIGURAÇÕES)
            ----------------------------------------------------------------- */}
        <div className={`accordion-card acc-card-${oxColor} ${openSections.oxidized ? 'is-open' : ''} ${!oxActive ? 'is-disabled' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => toggleSection('oxidized', !oxActive)}
            title={!oxActive ? 'Backup desativado para este equipamento no Oxidized' : 'Clique para ver dados de backup no Oxidized'}
          >
            <div className="acc-header-left">
              <span className="acc-chevron">
                {openSections.oxidized ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              <div className="acc-title-group">
                <FileCode size={18} color="#e91e63" />
                <span className="acc-title-text">Dados no Oxidized (Backup de Configurações)</span>
                <span className={`badge-status-pill badge-${oxColor}`}>
                  {oxColor === 'green' ? 'Ativo & Backup em Dia' : oxColor === 'yellow' ? 'Ativo (Aguardando Coleta)' : oxColor === 'red' ? 'Pendente / Falha' : 'Desativado'}
                </span>
              </div>
            </div>

            <div className="acc-header-right">
              {oxActive && comparison?.oxidized?.last_backup && (
                <span className="acc-header-hint font-mono">
                  Último: {new Date(comparison.oxidized.last_backup).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          </div>

          {openSections.oxidized && oxActive && (
            <div className="accordion-body">
              {isLoadingOxDetails ? (
                <div className="lazy-loading-box">
                  <RefreshCw size={22} className="spin-icon" color="#e91e63" />
                  <span>Consultando status do nó diretamente no Oxidized...</span>
                </div>
              ) : oxDetails ? (
                <div className="platform-details-view">
                  <div className="detail-meta-grid">
                    <div className="meta-box">
                      <span className="meta-label">Nó no Oxidized:</span>
                      <span className="meta-val font-mono">{oxDetails.name}</span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Modelo / SO:</span>
                      <span className="meta-val"><code>{oxDetails.model}</code></span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Pasta / Grupo Git:</span>
                      <span className="meta-val"><code>{oxDetails.group}</code></span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Status da Última Coleta:</span>
                      <span className="meta-val">
                        <span className={`status-pill ${oxDetails.status === 'success' ? 'status-pill-ok' : 'status-pill-fail'}`}>
                          {oxDetails.status}
                        </span>
                      </span>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Último Backup Realizado:</span>
                      <span className="meta-val">
                        {oxDetails.last_backup ? (
                          `${new Date(oxDetails.last_backup).toLocaleString('pt-BR')} ${oxDetails.time_taken ? `(${oxDetails.time_taken}s)` : ''}`
                        ) : (
                          <span className="text-muted">Pendente</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Ações da Linha */}
                  <div className="acc-body-footer">
                    <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                      <button 
                        type="button" 
                        className="btn-platform-sync"
                        style={{ borderColor: 'rgba(233, 30, 99, 0.4)', color: '#f48fb1' }}
                        onClick={handleTriggerOxBackup}
                        disabled={isTriggeringOxBackup || !isAdmin}
                      >
                        <RefreshCw size={14} className={isTriggeringOxBackup ? 'spin-icon' : ''} />
                        {isTriggeringOxBackup ? 'Solicitando...' : 'Fazer Backup Agora'}
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleReloadOxidized}
                        disabled={isReloadingOx || !isAdmin}
                        title="Força o Oxidized a recarregar as credenciais e nós a partir do IperSoft (/reload)"
                      >
                        {isReloadingOx ? <RefreshCw size={14} className="spin-icon" /> : <RotateCcw size={14} />}
                        <span>{isReloadingOx ? 'Recarregando...' : 'Recarregar no Oxidized'}</span>
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleViewOxConfig}
                        disabled={isLoadingOxConfig}
                      >
                        {isLoadingOxConfig ? <RefreshCw size={14} className="spin-icon" /> : <Eye size={14} />}
                        <span>Ver Configuração Atual</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="platform-not-synced-box">
                  <FileCode size={20} color="var(--color-danger)" />
                  <div>
                    <strong>Nenhum nó vinculado no Oxidized para este equipamento.</strong>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      O dispositivo será importado dinamicamente pelo Oxidized ou sincronizado nas integrações.
                    </span>
                  </div>
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    style={{ marginLeft: 'auto' }}
                    onClick={fetchOxidizedDetails}
                  >
                    <RefreshCw size={14} /> Recarregar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* -----------------------------------------------------------------
            LINHA 5: STATUS DO ZABBIX (ALARMES E ITENS COM GRÁFICO / TIMELINE)
            ----------------------------------------------------------------- */}
        <div className={`accordion-card acc-card-${zbxActive ? 'cyan' : 'gray'} ${openSections.zabbix_status ? 'is-open' : ''} ${!zbxActive ? 'is-disabled' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => toggleSection('zabbix_status', !zbxActive)}
            title={!zbxActive ? 'Habilite o monitoramento no Zabbix para visualizar alarmes e métricas' : 'Clique para ver alarmes ativos, itens e gráficos'}
          >
            <div className="acc-header-left">
              <span className="acc-chevron">
                {openSections.zabbix_status ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              <div className="acc-title-group">
                <AlertTriangle size={18} color={zbxActive ? '#ff9800' : 'var(--text-muted)'} />
                <span className="acc-title-text">Status do Zabbix: Alarmes Ativos & Itens do Host</span>
                {zbxActive && zbxProblems && (
                  <span className={`badge-alarm-count ${zbxProblems.length > 0 ? 'has-alarms' : 'no-alarms'}`}>
                    {zbxProblems.length} {zbxProblems.length === 1 ? 'alarme ativo' : 'alarmes ativos'}
                  </span>
                )}
                {!zbxActive && (
                  <span className="badge-status-pill badge-gray">Monitoramento Desativado</span>
                )}
              </div>
            </div>

            <div className="acc-header-right">
              {zbxActive && openSections.zabbix_status && (
                <button 
                  type="button" 
                  className="btn-acc-refresh"
                  onClick={(e) => { e.stopPropagation(); fetchZabbixStatusAndItems(); }}
                  title="Atualizar alarmes e itens agora"
                >
                  <RefreshCw size={13} className={isLoadingZbxProblems || isLoadingZbxItems ? 'spin-icon' : ''} />
                  <span>Atualizar</span>
                </button>
              )}
            </div>
          </div>

          {openSections.zabbix_status && zbxActive && (
            <div className="accordion-body">
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

                            {/* Itens vinculados ao alarme */}
                            {prob.items && prob.items.length > 0 && (
                              <div className="alarm-item-actions">
                                {prob.items.map((it) => (
                                  <button
                                    key={it.itemid}
                                    type="button"
                                    className={`btn-alarm-view-item ${selectedItem?.itemid === it.itemid ? 'active' : ''}`}
                                    onClick={() => handleSelectItem(it)}
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
                    {/* Campo de Busca Rápida de Itens */}
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

              {/* PAINEL INFERIOR: VISUALIZAÇÃO DO GRÁFICO OU TIMELINE DO ITEM SELECIONADO */}
              {selectedItem && (
                <div className="zbx-history-chart-wrapper">
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
                        onClick={() => handleSelectItem(selectedItem)}
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
                    ) : selectedItem.is_numeric ? (
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
            </div>
          )}
        </div>

        {/* -----------------------------------------------------------------
            LINHA 6: CONEXÃO REMOTA (GUACAMOLE SSO AUTOMATIZADO)
            ----------------------------------------------------------------- */}
        <div className={`accordion-card acc-card-${guacActive ? 'cyan' : 'gray'} ${openSections.remote ? 'is-open' : ''} ${!guacActive ? 'is-disabled' : ''}`}>
          <div 
            className="accordion-header" 
            onClick={() => toggleSection('remote', !guacActive)}
            title={!guacActive ? 'Acesso remoto desativado para este equipamento' : 'Clique para abrir terminal remoto'}
          >
            <div className="acc-header-left">
              <span className="acc-chevron">
                {openSections.remote ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </span>
              <div className="acc-title-group">
                <Terminal size={18} color={guacActive ? '#00bcd4' : 'var(--text-muted)'} />
                <span className="acc-title-text">Conexão Remota (Apache Guacamole SSO)</span>
                <span className={`badge-status-pill badge-${guacColor}`}>
                  {guacActive ? (guacSynced ? 'Sessão Pronta (Zero Login)' : 'Pendente de Conexão') : 'Acesso Desativado'}
                </span>
              </div>
            </div>

            <div className="acc-header-right">
              {guacActive && (
                <span className="acc-header-hint uppercase">
                  {formData.remote_protocol} : {formData.remote_port}
                </span>
              )}
            </div>
          </div>

          {openSections.remote && guacActive && (
            <div className="accordion-body">
              {isLoadingGuacLaunch ? (
                <div className="lazy-loading-box">
                  <RefreshCw size={22} className="spin-icon" color="#00bcd4" />
                  <span>Gerando sessão autenticada com token SSO no Apache Guacamole...</span>
                </div>
              ) : guacSynced && directGuacUrl ? (
                <div className="remote-session-panel">
                  <div className="remote-session-toolbar">
                    <div className="remote-meta-info">
                      <span className="status-pill-ok" style={{ fontSize: '0.72rem' }}>Token SSO Ativo</span>
                      <span>Host: <code>{formData.ip_address || formData.hostname}</code> ({formData.remote_protocol.toUpperCase()})</span>
                    </div>

                    <div className="remote-toolbar-actions">
                      {/* Botão de Abrir Nova Aba com Token SSO */}
                      <a 
                        href={directGuacUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="btn-launch-terminal"
                        title="Abrir terminal em nova aba sem pedir senha"
                      >
                        <ExternalLink size={15} /> Abrir Sessão em Nova Aba
                      </a>

                      {/* Botão de Alternar Terminal Embutido na Tela */}
                      <button 
                        type="button" 
                        className="btn-secondary"
                        onClick={() => setShowEmbeddedTerminal(!showEmbeddedTerminal)}
                      >
                        {showEmbeddedTerminal ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        <span>{showEmbeddedTerminal ? 'Ocultar Terminal Embutido' : 'Abrir Terminal Embutido'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Terminal Web Embutido (iFrame com SSO) */}
                  {showEmbeddedTerminal && (
                    <div className="embedded-terminal-frame-container">
                      <iframe 
                        src={directGuacUrl} 
                        title={`Console Remoto - ${formData.name}`}
                        className="embedded-terminal-iframe"
                        allow="clipboard-read; clipboard-write"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="platform-not-synced-box">
                  <Terminal size={20} color="var(--color-danger)" />
                  <div>
                    <strong>Nenhuma conexão remota ativa no Apache Guacamole.</strong>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Para habilitar a conexão remota automatizada, certifique-se de que a conexão esteja cadastrada e sincronizada.
                    </span>
                  </div>
                  <button 
                    type="button" 
                    className="btn-platform-sync btn-sync-guac" 
                    style={{ marginLeft: 'auto' }}
                    onClick={handleSyncGuacamole}
                    disabled={isSyncingGuac || !isAdmin}
                  >
                    <RefreshCw size={14} className={isSyncingGuac ? 'spin-icon' : ''} />
                    Sincronizar Conexão
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

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
