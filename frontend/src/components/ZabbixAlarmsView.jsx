import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  AlertTriangle, 
  ShieldAlert, 
  RefreshCw, 
  Search, 
  Clock, 
  CheckCircle2, 
  Server, 
  Tag, 
  Layers,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown
} from 'lucide-react';
import { authService } from '../services/api';

export const ZabbixAlarmsView = ({ onSelectAsset, isAdmin }) => {
  const [data, setData] = useState({
    stats: {
      total: 0,
      disaster: 0,
      high: 0,
      average: 0,
      warning: 0,
      info: 0,
      not_classified: 0,
      acknowledged: 0,
      unacknowledged: 0
    },
    problems: []
  });

  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all'); // 'all' | '5' | '4' | '3' | '2' | '1'
  const [ackFilter, setAckFilter] = useState('all'); // 'all' | 'unacknowledged' | 'acknowledged'
  const [matchedFilter, setMatchedFilter] = useState('all'); // 'all' | 'matched' | 'unmatched'
  
  // Ordenação (padrão: mais recentes primeiro)
  const [sortField, setSortField] = useState('duration'); // 'duration' | 'priority' | 'asset_name' | 'description' | 'acknowledged'
  const [sortDirection, setSortDirection] = useState('desc'); // 'desc' (mais recente) | 'asc' (mais antigo)

  // Acknowledge em andamento por identificador
  const [acknowledgingEvents, setAcknowledgingEvents] = useState({});
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadProblems = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const res = await authService.getZabbixProblems();
      setData(res || { stats: {}, problems: [] });
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Erro ao buscar alarmes do Zabbix:', err);
      setFeedbackMsg({
        type: 'error',
        text: err.message || 'Erro ao carregar alarmes do Zabbix.'
      });
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProblems(true);
    // Auto-refresh a cada 30 segundos
    const interval = setInterval(() => {
      loadProblems(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [loadProblems]);

  // Toggle de Reconhecimento de Trigger
  const handleToggleAcknowledge = async (prob, e) => {
    if (e) e.stopPropagation();
    if (!prob.eventid && !prob.triggerid) {
      setFeedbackMsg({
        type: 'error',
        text: 'Alarme sem identificador de evento no Zabbix.'
      });
      return;
    }

    const newStatus = !prob.acknowledged;
    const targetKey = prob.eventid || prob.triggerid;
    setAcknowledgingEvents(prev => ({ ...prev, [targetKey]: true }));

    try {
      const res = await authService.acknowledgeZabbixProblem({
        eventid: prob.eventid,
        triggerid: prob.triggerid,
        acknowledged: newStatus
      });

      // Atualiza o estado local imediatamente
      setData(prev => {
        const nextProblems = (prev.problems || []).map(p => 
          (p.triggerid === prob.triggerid || (p.eventid && p.eventid === prob.eventid))
            ? { ...p, acknowledged: newStatus, eventid: res.eventid || p.eventid } 
            : p
        );
        const nextStats = { ...prev.stats };
        if (newStatus) {
          nextStats.acknowledged = (nextStats.acknowledged || 0) + 1;
          nextStats.unacknowledged = Math.max(0, (nextStats.unacknowledged || 1) - 1);
        } else {
          nextStats.acknowledged = Math.max(0, (nextStats.acknowledged || 1) - 1);
          nextStats.unacknowledged = (nextStats.unacknowledged || 0) + 1;
        }
        return { ...prev, problems: nextProblems, stats: nextStats };
      });

      setFeedbackMsg({
        type: 'success',
        text: newStatus 
          ? `Alarme "${prob.description}" marcado como reconhecido no Zabbix.` 
          : `Reconhecimento do alarme "${prob.description}" desmarcado no Zabbix.`
      });
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: `Erro ao atualizar reconhecimento: ${err.message}`
      });
    } finally {
      setAcknowledgingEvents(prev => ({ ...prev, [targetKey]: false }));
    }
  };

  // Alternar ordenação ao clicar no cabeçalho
  const handleHeaderSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // Padrões intuitivos ao trocar de coluna:
      // duration: asc (mais antigos / maior duração primeiro)
      // priority: desc (desastre / alto primeiro)
      setSortDirection(field === 'priority' ? 'desc' : 'asc');
    }
  };

  // Renderizar ícone de ordenação no cabeçalho
  const renderSortIcon = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} style={{ opacity: 0.35, marginLeft: '5px' }} />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp size={13} style={{ color: 'var(--color-primary)', marginLeft: '5px' }} />
      : <ArrowDown size={13} style={{ color: 'var(--color-primary)', marginLeft: '5px' }} />;
  };

  // Cálculo de tempo relativo amigável
  const formatTimeAgo = (unixSeconds) => {
    if (!unixSeconds) return '-';
    const seconds = Math.floor(Date.now() / 1000 - unixSeconds);
    if (seconds < 60) return `${seconds}s atrás`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m atrás`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h atrás`;
    const days = Math.floor(hours / 24);
    return `${days}d atrás`;
  };

  const formatFullDate = (unixSeconds) => {
    if (!unixSeconds) return '-';
    return new Date(unixSeconds * 1000).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Filtragem e Ordenação no cliente
  const displayedProblems = useMemo(() => {
    const list = data.problems || [];
    
    // 1. Filtragem
    const filtered = list.filter(p => {
      // Filtro de severidade
      if (severityFilter !== 'all' && String(p.priority) !== severityFilter) {
        return false;
      }
      // Filtro de reconhecimento
      if (ackFilter === 'unacknowledged' && p.acknowledged) {
        return false;
      }
      if (ackFilter === 'acknowledged' && !p.acknowledged) {
        return false;
      }
      // Filtro de vínculo com IperSoft
      if (matchedFilter === 'matched' && !p.is_matched) {
        return false;
      }
      if (matchedFilter === 'unmatched' && p.is_matched) {
        return false;
      }
      // Busca por texto
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const desc = (p.description || '').toLowerCase();
        const hostTech = (p.host_technical || '').toLowerCase();
        const hostName = (p.host_name || '').toLowerCase();
        const assetName = (p.asset_name || '').toLowerCase();
        const assetIp = (p.asset_ip || '').toLowerCase();
        const group = (p.asset_group || '').toLowerCase();
        const tagsStr = (p.tags || []).map(t => `${t.tag}:${t.value}`).join(' ').toLowerCase();

        if (
          !desc.includes(q) &&
          !hostTech.includes(q) &&
          !hostName.includes(q) &&
          !assetName.includes(q) &&
          !assetIp.includes(q) &&
          !group.includes(q) &&
          !tagsStr.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

    // 2. Ordenação
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'duration') {
        // asc = menor timestamp (disparou há mais tempo / maior tempo ativo)
        // desc = maior timestamp (mais recente)
        comparison = (a.lastchange || 0) - (b.lastchange || 0);
      } else if (sortField === 'priority') {
        comparison = (a.priority || 0) - (b.priority || 0);
      } else if (sortField === 'asset_name') {
        comparison = (a.asset_name || '').localeCompare(b.asset_name || '', 'pt-BR');
      } else if (sortField === 'description') {
        comparison = (a.description || '').localeCompare(b.description || '', 'pt-BR');
      } else if (sortField === 'acknowledged') {
        comparison = (a.acknowledged === b.acknowledged ? 0 : a.acknowledged ? 1 : -1);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data.problems, severityFilter, ackFilter, matchedFilter, searchQuery, sortField, sortDirection]);

  return (
    <div className="alarms-view-container">
      {/* Top Header */}
      <div className="assets-header-bar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 className="section-title">Central de Alarmes Zabbix</h2>
            {data.stats.total > 0 && (
              <span className="alarms-counter-pill zabbix-pill">
                <AlertTriangle size={13} /> {data.stats.total} Triggers Disparadas
              </span>
            )}
          </div>
          <p className="dashboard-sub">
            Monitoramento em tempo real de eventos ativos do Zabbix com reconhecimento e integração direta ao inventário
          </p>
        </div>

        <div className="assets-header-actions">
          <button
            className="btn-secondary"
            onClick={() => loadProblems(true)}
            disabled={isLoading}
            title="Atualizar lista de alarmes do Zabbix"
          >
            <RefreshCw size={14} className={isLoading ? 'spin-icon' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Info Banner & Auto-sync */}
      <div className="diag-info-banner">
        <div className="diag-info-left">
          <Clock size={16} color="var(--color-primary)" />
          <span>
            <strong>Sincronização em Tempo Real:</strong> Atualização automática da API Zabbix a cada <strong>30 segundos</strong>.
          </span>
          {lastUpdated && (
            <>
              <span className="diag-separator">•</span>
              <span>
                Última consulta: <strong>{lastUpdated.toLocaleTimeString('pt-BR')}</strong>
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-danger)' }} />
            Não Reconhecidos: <strong>{data.stats.unacknowledged || 0}</strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
            Reconhecidos: <strong>{data.stats.acknowledged || 0}</strong>
          </span>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedbackMsg && (
        <div className={`feedback-banner ${feedbackMsg.type === 'error' ? 'banner-error' : 'banner-success'}`}>
          <span>{feedbackMsg.text}</span>
          <button 
            type="button" 
            className="btn-close-banner" 
            onClick={() => setFeedbackMsg(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* KPI Cards (Cards clicáveis para filtrar por severidade e reconhecimento) */}
      <div className="diag-kpi-grid zabbix-kpi-grid">
        {/* TODOS */}
        <div 
          className={`diag-kpi-card ${severityFilter === 'all' && ackFilter === 'all' ? 'active' : ''}`}
          onClick={() => { setSeverityFilter('all'); setAckFilter('all'); }}
          title="Ver todos os alarmes do Zabbix"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Todos os Alarmes</span>
            <Layers size={18} className="diag-kpi-icon" />
          </div>
          <div className="diag-kpi-value">{data.stats.total || 0}</div>
          <div className="diag-kpi-hint">Total de triggers ativas</div>
        </div>

        {/* NÃO RECONHECIDOS (Destaque crítico) */}
        <div 
          className={`diag-kpi-card ${ackFilter === 'unacknowledged' ? 'active' : ''}`}
          onClick={() => { setAckFilter('unacknowledged'); setSeverityFilter('all'); }}
          title="Filtrar alarmes pendentes de reconhecimento"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Não Reconhecidos</span>
            <ShieldAlert size={18} className="diag-kpi-icon icon-danger" />
          </div>
          <div className="diag-kpi-value value-danger">{data.stats.unacknowledged || 0}</div>
          <div className="diag-kpi-hint">Requerem atenção imediata</div>
        </div>

        {/* DESASTRE (5) */}
        <div 
          className={`diag-kpi-card ${severityFilter === '5' ? 'active' : ''}`}
          onClick={() => { setSeverityFilter('5'); }}
          title="Filtrar alarmes de Desastre"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Desastre</span>
            <span className="kpi-bullet" style={{ backgroundColor: '#b71c1c' }} />
          </div>
          <div className="diag-kpi-value" style={{ color: '#b71c1c' }}>{data.stats.disaster || 0}</div>
          <div className="diag-kpi-hint">Severidade máxima</div>
        </div>

        {/* ALTO (4) */}
        <div 
          className={`diag-kpi-card ${severityFilter === '4' ? 'active' : ''}`}
          onClick={() => { setSeverityFilter('4'); }}
          title="Filtrar alarmes de prioridade Alta"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Alto</span>
            <span className="kpi-bullet" style={{ backgroundColor: '#e53935' }} />
          </div>
          <div className="diag-kpi-value" style={{ color: '#e53935' }}>{data.stats.high || 0}</div>
          <div className="diag-kpi-hint">Incidentes graves</div>
        </div>

        {/* MÉDIO (3) */}
        <div 
          className={`diag-kpi-card ${severityFilter === '3' ? 'active' : ''}`}
          onClick={() => { setSeverityFilter('3'); }}
          title="Filtrar alarmes Médios"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Médio</span>
            <span className="kpi-bullet" style={{ backgroundColor: '#f57c00' }} />
          </div>
          <div className="diag-kpi-value" style={{ color: '#f57c00' }}>{data.stats.average || 0}</div>
          <div className="diag-kpi-hint">Avisos importantes</div>
        </div>

        {/* AVISO (2) */}
        <div 
          className={`diag-kpi-card ${severityFilter === '2' ? 'active' : ''}`}
          onClick={() => { setSeverityFilter('2'); }}
          title="Filtrar Avisos"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Aviso</span>
            <span className="kpi-bullet" style={{ backgroundColor: '#ff9800' }} />
          </div>
          <div className="diag-kpi-value" style={{ color: '#ff9800' }}>{data.stats.warning || 0}</div>
          <div className="diag-kpi-hint">Alertas operacionais</div>
        </div>

        {/* INFORMAÇÃO (1) */}
        <div 
          className={`diag-kpi-card ${severityFilter === '1' ? 'active' : ''}`}
          onClick={() => { setSeverityFilter('1'); }}
          title="Filtrar Informativos"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Informação</span>
            <span className="kpi-bullet" style={{ backgroundColor: '#2196f3' }} />
          </div>
          <div className="diag-kpi-value" style={{ color: '#2196f3' }}>{data.stats.info || 0}</div>
          <div className="diag-kpi-hint">Logs e notas informativas</div>
        </div>
      </div>

      {/* Filter and Search Bar (Busca + Filtros lado a lado na mesma linha) */}
      <div className="zabbix-filters-bar">
        <div className="input-wrapper search-wrapper zabbix-search-wrapper">
          <Search size={15} className="input-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="Buscar por descrição, equipamento, IP, cliente ou tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              type="button" 
              className="clear-search-btn" 
              onClick={() => setSearchQuery('')}
            >
              ×
            </button>
          )}
        </div>

        <div className="zabbix-filters-inline-group">
          {/* Seletor de Ordenação */}
          <div className="filter-select-group">
            <label className="filter-select-label">Ordenar Por:</label>
            <select 
              className="filter-select"
              value={`${sortField}_${sortDirection}`}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'duration_desc') {
                  setSortField('duration');
                  setSortDirection('desc');
                } else if (val === 'duration_asc') {
                  setSortField('duration');
                  setSortDirection('asc');
                } else if (val === 'priority_desc') {
                  setSortField('priority');
                  setSortDirection('desc');
                } else if (val === 'priority_asc') {
                  setSortField('priority');
                  setSortDirection('asc');
                } else if (val === 'name_asc') {
                  setSortField('asset_name');
                  setSortDirection('asc');
                } else if (val === 'name_desc') {
                  setSortField('asset_name');
                  setSortDirection('desc');
                } else if (val === 'ack_asc') {
                  setSortField('acknowledged');
                  setSortDirection('asc');
                }
              }}
            >
              <option value="duration_desc">Tempo Ativo: Mais Recentes Primeiro</option>
              <option value="duration_asc">Tempo Ativo: Mais Antigos Primeiro (Maior Duração)</option>
              <option value="priority_desc">Severidade: Mais Críticos Primeiro</option>
              <option value="priority_asc">Severidade: Menos Críticos Primeiro</option>
              <option value="name_asc">Equipamento: A - Z</option>
              <option value="name_desc">Equipamento: Z - A</option>
              <option value="ack_asc">Não Reconhecidos Primeiro</option>
            </select>
          </div>

          {/* Filtro de Reconhecimento */}
          <div className="filter-select-group">
            <label className="filter-select-label">Reconhecimento:</label>
            <select 
              className="filter-select"
              value={ackFilter}
              onChange={(e) => setAckFilter(e.target.value)}
            >
              <option value="all">Todos ({data.stats.total || 0})</option>
              <option value="unacknowledged">Apenas Não Reconhecidos ({data.stats.unacknowledged || 0})</option>
              <option value="acknowledged">Apenas Reconhecidos ({data.stats.acknowledged || 0})</option>
            </select>
          </div>

          {/* Filtro de Severidade */}
          <div className="filter-select-group">
            <label className="filter-select-label">Severidade:</label>
            <select 
              className="filter-select"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="5">Desastre ({data.stats.disaster || 0})</option>
              <option value="4">Alto ({data.stats.high || 0})</option>
              <option value="3">Médio ({data.stats.average || 0})</option>
              <option value="2">Aviso ({data.stats.warning || 0})</option>
              <option value="1">Informação ({data.stats.info || 0})</option>
            </select>
          </div>

          {/* Filtro de Vínculo IperSoft */}
          <div className="filter-select-group">
            <label className="filter-select-label">Inventário:</label>
            <select 
              className="filter-select"
              value={matchedFilter}
              onChange={(e) => setMatchedFilter(e.target.value)}
            >
              <option value="all">Todos os Hosts</option>
              <option value="matched">Apenas no IperSoft</option>
              <option value="unmatched">Apenas no Zabbix</option>
            </select>
          </div>
        </div>
      </div>

      {/* Alarms Table */}
      <div className="assets-table-container">
        <table className="assets-table zabbix-alarms-table">
          <thead>
            <tr>
              <th 
                style={{ width: '135px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => handleHeaderSort('acknowledged')}
                title="Clique para ordenar por status de reconhecimento"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span>Reconhecido</span>
                  {renderSortIcon('acknowledged')}
                </div>
              </th>

              <th 
                style={{ width: '125px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => handleHeaderSort('priority')}
                title="Clique para ordenar por nível de severidade"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span>Severidade</span>
                  {renderSortIcon('priority')}
                </div>
              </th>

              <th 
                style={{ minWidth: '220px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => handleHeaderSort('asset_name')}
                title="Clique para ordenar por nome do equipamento"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span>Equipamento / Host</span>
                  {renderSortIcon('asset_name')}
                </div>
              </th>

              <th 
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => handleHeaderSort('description')}
                title="Clique para ordenar pela descrição do alarme"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span>Problema (Trigger)</span>
                  {renderSortIcon('description')}
                </div>
              </th>

              <th 
                style={{ width: '150px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => handleHeaderSort('duration')}
                title="Clique para alternar entre mais antigos (maior duração) e mais recentes"
              >
                <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span>Tempo Ativo / Duração</span>
                  {renderSortIcon('duration')}
                </div>
              </th>

              <th style={{ width: '120px', textAlign: 'right' }}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3.5rem' }}>
                  <RefreshCw size={26} className="spin-icon" style={{ color: 'var(--color-primary)', margin: '0 auto 0.5rem' }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Carregando alarmes em tempo real do Zabbix...</p>
                </td>
              </tr>
            ) : displayedProblems.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '4rem' }}>
                  <CheckCircle2 size={40} color="var(--color-success)" style={{ margin: '0 auto 0.75rem' }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                    Nenhuma trigger em estado de problema!
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {searchQuery || severityFilter !== 'all' || ackFilter !== 'all'
                      ? 'Nenhum alarme corresponde aos filtros selecionados.'
                      : 'Todos os equipamentos monitorados pelo Zabbix Server estão operando normalmente sem problemas ativos.'}
                  </p>
                </td>
              </tr>
            ) : (
              displayedProblems.map((prob) => {
                const targetKey = prob.eventid || prob.triggerid;
                const isAckPending = acknowledgingEvents[targetKey];
                const canNavigate = Boolean(prob.asset_id && onSelectAsset);

                return (
                  <tr 
                    key={prob.triggerid}
                    className={`zabbix-alarm-row ${prob.acknowledged ? 'row-acknowledged' : 'row-unacknowledged'}`}
                    onClick={() => {
                      if (canNavigate) {
                        onSelectAsset(prob.asset_id);
                      }
                    }}
                    style={{ cursor: canNavigate ? 'pointer' : 'default' }}
                    title={canNavigate ? `Clique para abrir o equipamento "${prob.asset_name}" no inventário` : undefined}
                  >
                    {/* CHECKBOX RECONHECIMENTO */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <label 
                        className="alarm-ack-toggle-label"
                        title={prob.acknowledged ? "Desmarcar reconhecimento no Zabbix" : "Marcar como reconhecido no Zabbix"}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(prob.acknowledged)}
                          disabled={Boolean(isAckPending)}
                          onChange={(e) => handleToggleAcknowledge(prob, e)}
                          className="diag-custom-checkbox"
                        />
                        <span className={prob.acknowledged ? 'ack-status-pill pill-ack' : 'ack-status-pill pill-unack'}>
                          {isAckPending ? 'Salvando...' : (prob.acknowledged ? 'Reconhecido' : 'Não Reconhecido')}
                        </span>
                      </label>
                    </td>

                    {/* SEVERIDADE */}
                    <td>
                      <span 
                        className="alarm-sev-badge" 
                        style={{ backgroundColor: prob.severity_color }}
                      >
                        {prob.severity_label}
                      </span>
                    </td>

                    {/* EQUIPAMENTO */}
                    <td>
                      <div className="asset-name-cell">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span className={`asset-visible-name ${canNavigate ? 'name-link' : ''}`}>
                            {prob.asset_name}
                          </span>
                          {canNavigate && (
                            <ArrowUpRight size={13} className="link-arrow-icon" />
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '2px' }}>
                          {prob.asset_ip ? (
                            <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {prob.asset_ip}
                            </code>
                          ) : (
                            <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {prob.host_technical}
                            </code>
                          )}

                          {prob.asset_group && (
                            <span className="client-group-badge-sub">
                              {prob.asset_group}
                            </span>
                          )}

                          {!prob.is_matched && (
                            <span className="host-unmatched-badge" title="Host encontrado no Zabbix mas sem vínculo direto no inventário">
                              Apenas no Zabbix
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* PROBLEMA (TRIGGER) */}
                    <td>
                      <div className="zbx-trigger-content">
                        <span className="zbx-trigger-desc">
                          {prob.description}
                        </span>

                        {/* Tags e Itens vinculados */}
                        <div className="zbx-trigger-meta-row">
                          {prob.items && prob.items.length > 0 && prob.items[0].lastvalue !== null && (
                            <span className="zbx-lastval-pill">
                              Último valor: <strong>{prob.items[0].lastvalue} {prob.items[0].units}</strong>
                            </span>
                          )}

                          {prob.tags && prob.tags.slice(0, 3).map((t, idx) => (
                            <span key={idx} className="zbx-tag-pill">
                              <Tag size={10} /> {t.tag}{t.value ? `: ${t.value}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>

                    {/* DURAÇÃO / DISPARADO EM */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className="zbx-time-ago" title={formatFullDate(prob.lastchange)}>
                          <Clock size={11} style={{ marginRight: '4px' }} />
                          {formatTimeAgo(prob.lastchange)}
                        </span>
                        <small style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {new Date(prob.lastchange * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </div>
                    </td>

                    {/* AÇÕES */}
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {canNavigate ? (
                        <button
                          type="button"
                          className="btn-open-detail"
                          onClick={() => onSelectAsset(prob.asset_id)}
                          title="Abrir tela de detalhes e diagnósticos deste equipamento"
                          style={{ padding: '0.35rem 0.65rem' }}
                        >
                          <Server size={13} />
                          <span>Ver Ativo</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
