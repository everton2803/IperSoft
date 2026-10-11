import React, { useState, useEffect, useCallback } from 'react';
import { 
  AlertTriangle, 
  Activity, 
  RefreshCw, 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Search, 
  Terminal, 
  Radio, 
  Cpu, 
  Monitor, 
  ShieldAlert,
  SlidersHorizontal,
  Save,
  Check,
  X
} from 'lucide-react';
import { diagnosticsService, authService } from '../services/api';

export const AlarmsView = ({ isAdmin }) => {
  const [stats, setStats] = useState({
    total_alarms: 0,
    icmp_alarms: 0,
    snmp_alarms: 0,
    ssh_alarms: 0,
    telnet_alarms: 0,
    rdp_alarms: 0,
    total_monitored_services: 0,
    is_running: false,
    current_progress: 0,
    total_assets: 0,
    last_run_started: null,
    last_run_finished: null
  });

  const [alarms, setAlarms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'icmp' | 'snmp' | 'ssh' | 'telnet' | 'rdp'
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(true);
  const [retestingAssetId, setRetestingAssetId] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  // Estado do Modal de Opções de Teste por Ativo
  const [modalAsset, setModalAsset] = useState(null);
  const [isSavingModal, setIsSavingModal] = useState(false);
  const [isTestingModal, setIsTestingModal] = useState(false);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const [statsData, alarmsData] = await Promise.all([
        diagnosticsService.getStats(),
        diagnosticsService.getAlarms({
          testType: activeFilter,
          search: searchQuery,
          onlyFailures: onlyFailures
        })
      ]);
      setStats(statsData);
      setAlarms(alarmsData);
    } catch (err) {
      console.error('Erro ao carregar dados de diagnóstico:', err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [activeFilter, searchQuery, onlyFailures]);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Polling automático caso uma varredura esteja em execução
  useEffect(() => {
    let interval = null;
    if (stats.is_running) {
      interval = setInterval(() => {
        loadData(false);
      }, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [stats.is_running, loadData]);

  const handleTriggerRun = async () => {
    if (stats.is_running || isTriggering) return;
    setIsTriggering(true);
    try {
      await diagnosticsService.runBatch();
      setFeedbackMsg({
        type: 'success',
        text: 'Diagnóstico geral disparado! Testando equipamentos em segundo plano...'
      });
      loadData(false);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: err.message || 'Erro ao disparar varredura de diagnósticos.'
      });
    } finally {
      setIsTriggering(false);
    }
  };

  const handleRetestSingleAsset = async (assetId, assetName) => {
    setRetestingAssetId(assetId);
    try {
      const res = await diagnosticsService.testAsset(assetId);
      setFeedbackMsg({
        type: 'success',
        text: `Diagnóstico atualizado para "${assetName}".`
      });
      loadData(false);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: `Erro ao testar "${assetName}": ${err.message}`
      });
    } finally {
      setRetestingAssetId(null);
    }
  };

  // Abrir Modal de Opções de Testes
  const handleOpenConfigModal = async (item) => {
    setModalAsset({
      assetId: item.asset_id,
      assetName: item.asset_name,
      targetHost: item.target_host,
      remoteProto: (item.test_type !== 'icmp' && item.test_type !== 'snmp') ? item.test_type : 'ssh',
      remotePort: item.target_port || '22',
      enabledTests: { icmp: true, snmp: true, remote: true },
      isLoadingDetails: true
    });

    try {
      const comp = await authService.getAssetComparison(item.asset_id);
      const ip = comp?.ipersoft || {};
      const saved = ip.enabled_tests || {};
      setModalAsset(prev => prev && prev.assetId === item.asset_id ? {
        ...prev,
        remoteProto: ip.remote_protocol || prev.remoteProto,
        remotePort: ip.remote_port || prev.remotePort,
        enabledTests: {
          icmp: saved.icmp !== false,
          snmp: saved.snmp !== false,
          remote: saved.remote !== false
        },
        isLoadingDetails: false
      } : prev);
    } catch {
      setModalAsset(prev => prev ? { ...prev, isLoadingDetails: false } : null);
    }
  };

  // Salvar opções de teste configuradas no modal
  const handleSaveModalConfig = async () => {
    if (!modalAsset) return;
    setIsSavingModal(true);
    try {
      await authService.updateAsset(modalAsset.assetId, {
        enabled_tests: modalAsset.enabledTests
      });
      setFeedbackMsg({
        type: 'success',
        text: `Opções de teste salvas para "${modalAsset.assetName}". Alarmes atualizados!`
      });
      setModalAsset(null);
      await loadData(false);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: `Erro ao salvar opções de teste: ${err.message}`
      });
    } finally {
      setIsSavingModal(false);
    }
  };

  // Testar diretamente a partir do modal
  const handleRetestInModal = async () => {
    if (!modalAsset) return;
    setIsTestingModal(true);
    try {
      await authService.updateAsset(modalAsset.assetId, {
        enabled_tests: modalAsset.enabledTests
      });
      const res = await diagnosticsService.testAsset(modalAsset.assetId, {
        include_icmp: modalAsset.enabledTests.icmp,
        include_snmp: modalAsset.enabledTests.snmp,
        include_remote: modalAsset.enabledTests.remote
      });
      setFeedbackMsg({
        type: 'success',
        text: res.message || `Testes executados para "${modalAsset.assetName}".`
      });
      await loadData(false);
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: `Erro ao executar teste: ${err.message}`
      });
    } finally {
      setIsTestingModal(false);
    }
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return 'Nunca';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  const getTestTypeBadge = (type, port) => {
    const p = port ? ` : ${port}` : '';
    switch (type.toLowerCase()) {
      case 'icmp':
        return (
          <span className="diag-type-badge diag-type-icmp">
            <Radio size={12} /> Ping (ICMP)
          </span>
        );
      case 'snmp':
        return (
          <span className="diag-type-badge diag-type-snmp">
            <Cpu size={12} /> SNMP{p || ' : 161'}
          </span>
        );
      case 'ssh':
        return (
          <span className="diag-type-badge diag-type-ssh">
            <Terminal size={12} /> SSH{p || ' : 22'}
          </span>
        );
      case 'telnet':
        return (
          <span className="diag-type-badge diag-type-telnet">
            <Terminal size={12} /> Telnet{p || ' : 23'}
          </span>
        );
      case 'rdp':
        return (
          <span className="diag-type-badge diag-type-rdp">
            <Monitor size={12} /> RDP{p || ' : 3389'}
          </span>
        );
      default:
        return (
          <span className="diag-type-badge">
            <Activity size={12} /> {type.toUpperCase()}{p}
          </span>
        );
    }
  };

  return (
    <div className="alarms-view-container">
      {/* Top Header */}
      <div className="assets-header-bar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 className="section-title">Central de Alarmes & Diagnósticos</h2>
            {stats.total_alarms > 0 && (
              <span className="alarms-counter-pill">
                <AlertTriangle size={13} /> {stats.total_alarms} Alertas Ativos
              </span>
            )}
          </div>
          <p className="dashboard-sub">
            Monitoramento de alcance ICMP, SNMP e portas de gerenciamento remoto (SSH, Telnet, RDP)
          </p>
        </div>

        <div className="assets-header-actions">
          <button
            className="btn-primary"
            onClick={handleTriggerRun}
            disabled={stats.is_running || isTriggering}
            title="Disparar testes para todos os equipamentos cadastrados"
          >
            <Play size={14} className={stats.is_running || isTriggering ? 'spin-icon' : ''} />
            <span>{stats.is_running ? 'Testando Dispositivos...' : 'Disparar Diagnóstico Agora'}</span>
          </button>

          <button
            className="btn-secondary"
            onClick={() => loadData(true)}
            disabled={isLoading}
            title="Atualizar lista de alarmes"
          >
            <RefreshCw size={14} className={isLoading ? 'spin-icon' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Scheduler Info & Running Progress Banner */}
      <div className="diag-info-banner">
        <div className="diag-info-left">
          <Clock size={16} color="var(--color-primary)" />
          <span>
            <strong>Rotina Automática:</strong> Varredura programada a cada <strong>1 hora</strong>.
          </span>
          <span className="diag-separator">•</span>
          <span>
            Última execução: <strong>{formatDateTime(stats.last_run_finished || stats.last_run_started)}</strong>
          </span>
        </div>

        {stats.is_running && (
          <div className="diag-progress-box">
            <span className="diag-progress-label">
              Progresso: {stats.current_progress} / {stats.total_assets} dispositivos
            </span>
            <div className="diag-progress-bar-container">
              <div 
                className="diag-progress-bar-fill" 
                style={{ 
                  width: `${stats.total_assets > 0 ? (stats.current_progress / stats.total_assets) * 100 : 0}%` 
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Feedback Alert Toast */}
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

      {/* KPI Cards (Cards clicáveis que filtram a lista diretamente) */}
      <div className="diag-kpi-grid">
        <div 
          className={`diag-kpi-card ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
          title="Clique para filtrar todos os serviços"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Todos os Alarmes</span>
            <ShieldAlert size={18} className="diag-kpi-icon icon-danger" />
          </div>
          <div className="diag-kpi-value value-danger">{stats.total_alarms}</div>
          <div className="diag-kpi-hint">Serviços com falha ou timeout</div>
        </div>

        <div 
          className={`diag-kpi-card ${activeFilter === 'icmp' ? 'active' : ''}`}
          onClick={() => setActiveFilter('icmp')}
          title="Clique para filtrar alarmes de Ping"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">ICMP (Ping)</span>
            <Radio size={18} className="diag-kpi-icon icon-orange" />
          </div>
          <div className="diag-kpi-value">{stats.icmp_alarms}</div>
          <div className="diag-kpi-hint">Sem resposta de Ping</div>
        </div>

        <div 
          className={`diag-kpi-card ${activeFilter === 'snmp' ? 'active' : ''}`}
          onClick={() => setActiveFilter('snmp')}
          title="Clique para filtrar alarmes de SNMP"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">SNMP v2c</span>
            <Cpu size={18} className="diag-kpi-icon icon-yellow" />
          </div>
          <div className="diag-kpi-value">{stats.snmp_alarms}</div>
          <div className="diag-kpi-hint">Timeout na community SNMP</div>
        </div>

        <div 
          className={`diag-kpi-card ${activeFilter === 'ssh' ? 'active' : ''}`}
          onClick={() => setActiveFilter('ssh')}
          title="Clique para filtrar alarmes de SSH"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">SSH (Porta 22)</span>
            <Terminal size={18} className="diag-kpi-icon icon-blue" />
          </div>
          <div className="diag-kpi-value">{stats.ssh_alarms}</div>
          <div className="diag-kpi-hint">Porta SSH inacessível</div>
        </div>

        <div 
          className={`diag-kpi-card ${activeFilter === 'telnet' ? 'active' : ''}`}
          onClick={() => setActiveFilter('telnet')}
          title="Clique para filtrar alarmes de Telnet"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">Telnet (Porta 23)</span>
            <Terminal size={18} className="diag-kpi-icon icon-purple" />
          </div>
          <div className="diag-kpi-value">{stats.telnet_alarms}</div>
          <div className="diag-kpi-hint">Porta Telnet inacessível</div>
        </div>

        <div 
          className={`diag-kpi-card ${activeFilter === 'rdp' ? 'active' : ''}`}
          onClick={() => setActiveFilter('rdp')}
          title="Clique para filtrar alarmes de RDP"
        >
          <div className="diag-kpi-header">
            <span className="diag-kpi-title">RDP (Porta 3389)</span>
            <Monitor size={18} className="diag-kpi-icon icon-cyan" />
          </div>
          <div className="diag-kpi-value">{stats.rdp_alarms}</div>
          <div className="diag-kpi-hint">Porta RDP inacessível</div>
        </div>
      </div>

      {/* Filter and Search Bar (Padronizada com CSS global) */}
      <div className="filter-controls-row" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
        <div className="input-wrapper search-wrapper" style={{ flex: 1, minWidth: '280px' }}>
          <Search size={15} className="input-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="Buscar por nome do equipamento, IP ou mensagem..."
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

        <label className="toggle-failures-label" title="Alternar entre ver somente falhas ou todos os testes realizados">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(e) => setOnlyFailures(e.target.checked)}
          />
          <span>Apenas Falhas / Alarmes</span>
        </label>
      </div>

      {/* Alarms Table (Enxuta, legível e clicável para abrir o modal de testes) */}
      <div className="assets-table-container">
        <table className="assets-table">
          <thead>
            <tr>
              <th>Equipamento</th>
              <th>Serviço Testado</th>
              <th>Status</th>
              <th>Diagnóstico / Mensagem</th>
              <th>Último Teste</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem' }}>
                  <RefreshCw size={24} className="spin-icon" style={{ color: 'var(--color-primary)', margin: '0 auto 0.5rem' }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Carregando dados de diagnósticos...</p>
                </td>
              </tr>
            ) : alarms.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3.5rem' }}>
                  <CheckCircle2 size={36} color="var(--color-success)" style={{ margin: '0 auto 0.75rem' }} />
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                    Nenhum alarme encontrado!
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {onlyFailures 
                      ? 'Todos os serviços monitorados correspondentes a este filtro estão operacionais e respondendo normalmente.' 
                      : 'Nenhum resultado corresponde aos critérios de pesquisa.'}
                  </p>
                </td>
              </tr>
            ) : (
              alarms.map((item) => (
                <tr 
                  key={item.id} 
                  className={`clickable-alarm-row ${item.status !== 'ok' ? 'row-alarm' : ''}`}
                  onClick={() => handleOpenConfigModal(item)}
                  title="Clique para configurar as opções de teste deste equipamento"
                >
                  {/* EQUIPAMENTO */}
                  <td>
                    <div className="asset-name-cell">
                      <span className="asset-visible-name">{item.asset_name}</span>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {item.target_host}
                      </code>
                    </div>
                  </td>

                  {/* SERVIÇO / TESTE */}
                  <td>
                    {getTestTypeBadge(item.test_type, item.target_port)}
                  </td>

                  {/* STATUS */}
                  <td>
                    {item.status === 'ok' ? (
                      <span className="diag-status-badge status-ok">
                        <CheckCircle2 size={12} /> OK
                      </span>
                    ) : item.status === 'timeout' ? (
                      <span className="diag-status-badge status-timeout">
                        <Clock size={12} /> TIMEOUT
                      </span>
                    ) : (
                      <span className="diag-status-badge status-failed">
                        <XCircle size={12} /> FALHA
                      </span>
                    )}
                  </td>

                  {/* DIAGNÓSTICO / MENSAGEM */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="diag-message-cell" title={item.message || ''}>
                        {item.message || '-'}
                      </span>
                      {item.latency_ms !== null && (
                        <span className="latency-pill">
                          {item.latency_ms} ms
                        </span>
                      )}
                    </div>
                  </td>

                  {/* DATA / HORA */}
                  <td>
                    <span className="tested-at-text" title={item.tested_at}>
                      {formatDateTime(item.tested_at)}
                    </span>
                  </td>

                  {/* AÇÕES (Sem texto feio, com ícone idêntico à tela de equipamentos) */}
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => handleRetestSingleAsset(item.asset_id, item.asset_name)}
                        disabled={retestingAssetId === item.asset_id}
                        title="Executar teste de conectividade agora"
                        style={{ display: 'inline-flex', padding: '0.35rem 0.5rem' }}
                      >
                        <Activity 
                          size={13} 
                          className={retestingAssetId === item.asset_id ? 'spin-icon' : ''} 
                          color="var(--color-primary)" 
                        />
                      </button>

                      <button
                        type="button"
                        className="btn-open-detail"
                        onClick={() => handleOpenConfigModal(item)}
                        title="Configurar quais testes executar para este equipamento"
                        style={{ padding: '0.35rem 0.55rem' }}
                      >
                        <SlidersHorizontal size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL: CONFIGURAÇÃO DE OPÇÕES DE TESTE DO ATIVO */}
      {modalAsset && (
        <div className="modal-overlay" onClick={() => setModalAsset(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <div className="modal-title-box">
                <SlidersHorizontal size={18} className="modal-title-icon" />
                <div>
                  <h3 className="modal-title" style={{ fontSize: '1.05rem', margin: 0 }}>
                    Opções de Teste: {modalAsset.assetName}
                  </h3>
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    Alvo: <code>{modalAsset.targetHost}</code>
                  </small>
                </div>
              </div>
              <button 
                type="button" 
                className="btn-close-modal" 
                onClick={() => setModalAsset(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', marginTop: 0 }}>
                Desmarque os testes que não forem pertinentes para este equipamento. Ao desmarcar e salvar, os alarmes correspondentes serão removidos.
              </p>

              <div className="test-config-modal-body">
                {/* 1. TESTE ICMP / PING */}
                <div 
                  className={`test-option-card ${!modalAsset.enabledTests.icmp ? 'option-disabled' : ''}`}
                  onClick={() => setModalAsset({
                    ...modalAsset,
                    enabledTests: { ...modalAsset.enabledTests, icmp: !modalAsset.enabledTests.icmp }
                  })}
                >
                  <div className="test-option-left">
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={modalAsset.enabledTests.icmp}
                      onChange={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalAsset({
                          ...modalAsset,
                          enabledTests: { ...modalAsset.enabledTests, icmp: e.target.checked }
                        });
                      }}
                    />
                    <div className="diag-icon-badge icmp-badge">ICMP</div>
                    <div className="test-option-meta">
                      <strong>Ping (ICMP)</strong>
                      <span>Conectividade IP básica e latência em milissegundos</span>
                    </div>
                  </div>
                  <div>
                    <span className={modalAsset.enabledTests.icmp ? 'status-pill-ok' : 'status-pill-disabled'}>
                      {modalAsset.enabledTests.icmp ? 'Ativo' : 'Desativado'}
                    </span>
                  </div>
                </div>

                {/* 2. TESTE SNMP */}
                <div 
                  className={`test-option-card ${!modalAsset.enabledTests.snmp ? 'option-disabled' : ''}`}
                  onClick={() => setModalAsset({
                    ...modalAsset,
                    enabledTests: { ...modalAsset.enabledTests, snmp: !modalAsset.enabledTests.snmp }
                  })}
                >
                  <div className="test-option-left">
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={modalAsset.enabledTests.snmp}
                      onChange={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalAsset({
                          ...modalAsset,
                          enabledTests: { ...modalAsset.enabledTests, snmp: e.target.checked }
                        });
                      }}
                    />
                    <div className="diag-icon-badge snmp-badge">SNMP</div>
                    <div className="test-option-meta">
                      <strong>SNMP v2c (Porta 161)</strong>
                      <span>Desmarque caso o equipamento não suporte ou não utilize SNMP</span>
                    </div>
                  </div>
                  <div>
                    <span className={modalAsset.enabledTests.snmp ? 'status-pill-ok' : 'status-pill-disabled'}>
                      {modalAsset.enabledTests.snmp ? 'Ativo' : 'Desativado'}
                    </span>
                  </div>
                </div>

                {/* 3. TESTE ACESSO REMOTO */}
                <div 
                  className={`test-option-card ${!modalAsset.enabledTests.remote ? 'option-disabled' : ''}`}
                  onClick={() => setModalAsset({
                    ...modalAsset,
                    enabledTests: { ...modalAsset.enabledTests, remote: !modalAsset.enabledTests.remote }
                  })}
                >
                  <div className="test-option-left">
                    <input 
                      type="checkbox"
                      className="diag-custom-checkbox"
                      checked={modalAsset.enabledTests.remote}
                      onChange={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModalAsset({
                          ...modalAsset,
                          enabledTests: { ...modalAsset.enabledTests, remote: e.target.checked }
                        });
                      }}
                    />
                    <div className="diag-icon-badge remote-badge uppercase">
                      {(modalAsset.remoteProto || 'ssh').slice(0, 4)}
                    </div>
                    <div className="test-option-meta">
                      <strong className="uppercase">
                        Acesso Remoto ({modalAsset.remoteProto} : {modalAsset.remotePort})
                      </strong>
                      <span>Abertura de porta TCP de gerenciamento remoto</span>
                    </div>
                  </div>
                  <div>
                    <span className={modalAsset.enabledTests.remote ? 'status-pill-ok' : 'status-pill-disabled'}>
                      {modalAsset.enabledTests.remote ? 'Ativo' : 'Desativado'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRetestInModal}
                disabled={isTestingModal || isSavingModal}
                title="Executar testes agora para este equipamento"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Activity size={14} className={isTestingModal ? 'spin-icon' : ''} color="var(--color-primary)" />
                <span>{isTestingModal ? 'Testando...' : 'Testar Agora'}</span>
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setModalAsset(null)}
                  disabled={isSavingModal}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveModalConfig}
                  disabled={isSavingModal || isTestingModal}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Save size={14} className={isSavingModal ? 'spin-icon' : ''} />
                  <span>{isSavingModal ? 'Salvando...' : 'Salvar Opções'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
