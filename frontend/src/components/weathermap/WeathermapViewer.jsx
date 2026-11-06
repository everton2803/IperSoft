import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Edit3,
  RotateCcw,
  ExternalLink,
  Activity,
} from 'lucide-react';
import { weathermapService } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';

function formatBps(bps) {
  if (bps === null || bps === undefined || bps === '') return '-';
  const num = Number(bps);
  if (Number.isNaN(num) || num <= 0) return '0 bps';
  const units = [
    [1e12, 'Tbps'],
    [1e9, 'Gbps'],
    [1e6, 'Mbps'],
    [1e3, 'Kbps'],
  ];
  for (const [factor, label] of units) {
    if (num >= factor) {
      const v = num / factor;
      return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${label}`;
    }
  }
  return `${Math.round(num)} bps`;
}

function MiniHistoryChart({ historyData, loading, isDark }) {
  if (loading) {
    return (
      <div style={{ fontSize: '0.75rem', color: isDark ? '#94a3b8' : '#64748b', padding: '12px 0', textAlign: 'center' }}>
        Carregando histórico 24h (48 amostras · 30/30m)...
      </div>
    );
  }
  const points = historyData?.points || [];
  if (!points.length) {
    return (
      <div style={{ fontSize: '0.75rem', color: isDark ? '#94a3b8' : '#64748b', padding: '8px 0' }}>
        Sem amostras históricas nas últimas 24h.
      </div>
    );
  }

  const w = 310;
  const h = 94;
  const padX = 6;
  const padTop = 8;
  const padBottom = 18;
  const innerW = w - padX * 2;
  const innerH = h - padTop - padBottom;

  let maxVal = 1;
  for (const p of points) {
    if (p.in_bps && p.in_bps > maxVal) maxVal = p.in_bps;
    if (p.out_bps && p.out_bps > maxVal) maxVal = p.out_bps;
  }

  const n = points.length;
  const stepX = n > 1 ? innerW / (n - 1) : innerW;
  const barW = Math.max(2.5, Math.min(5, innerW / Math.max(1, n) - 1.2));

  const buildPolyline = (key) => {
    if (n === 1) {
      const y = padTop + innerH - ((points[0][key] || 0) / maxVal) * innerH;
      return `${padX},${y.toFixed(1)} ${padX + innerW},${y.toFixed(1)}`;
    }
    return points
      .map((p, idx) => {
        const x = padX + idx * stepX;
        const val = Math.max(0, Number(p[key] || 0));
        const y = padTop + innerH - (val / maxVal) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const outLine = buildPolyline('out_bps');
  const inLine = buildPolyline('in_bps');
  const stats = historyData?.stats || {};
  const intervalMin = historyData?.interval_minutes || 30;
  const baseY = padTop + innerH;

  return (
    <div style={{ marginTop: '10px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.7rem',
          color: isDark ? '#cbd5e1' : '#475569',
          marginBottom: '5px',
          fontWeight: 600,
        }}
      >
        <span>Últimas 24h ({n} amostras · {intervalMin}/30m)</span>
        <span>Pico: {formatBps(Math.max(stats.peak_in_bps || 0, stats.peak_out_bps || 0))}</span>
      </div>
      <svg
        width={w}
        height={h}
        style={{
          background: isDark ? '#090d16' : '#f1f5f9',
          borderRadius: '6px',
          border: isDark ? '1px solid #334155' : '1px solid #cbd5e1',
          display: 'block',
        }}
      >
        {/* Linhas horizontais de grade (25%, 50%, 75%) */}
        {[0.25, 0.5, 0.75].map((ratio) => {
          const gy = padTop + innerH * ratio;
          return (
            <line
              key={ratio}
              x1={padX}
              y1={gy}
              x2={padX + innerW}
              y2={gy}
              stroke={isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)'}
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          );
        })}

        {/* Barras discretas de 30 em 30 min para leitura das 48 amostras */}
        {points.map((p, idx) => {
          const cx = padX + idx * stepX;
          const vOut = Math.max(0, Number(p.out_bps || 0));
          const vIn = Math.max(0, Number(p.in_bps || 0));
          const hOut = (vOut / maxVal) * innerH;
          const hIn = (vIn / maxVal) * innerH;
          return (
            <g key={idx}>
              {hOut > 0.5 && (
                <rect
                  x={cx - barW / 2}
                  y={baseY - hOut}
                  width={barW}
                  height={hOut}
                  fill="rgba(56, 189, 248, 0.25)"
                  rx="1"
                />
              )}
              {hIn > 0.5 && (
                <rect
                  x={cx - barW / 2}
                  y={baseY - hIn}
                  width={barW}
                  height={hIn}
                  fill="rgba(34, 197, 94, 0.22)"
                  rx="1"
                />
              )}
            </g>
          );
        })}

        {/* Curvas de Out e In sobrepostas às 48 barras */}
        <polyline fill="none" stroke="#38bdf8" strokeWidth="1.8" points={outLine} />
        <polyline fill="none" stroke="#22c55e" strokeWidth="1.8" points={inLine} />

        {/* Eixo de tempo (24h em fatias de 6h) */}
        {[
          { label: '-24h', frac: 0 },
          { label: '-18h', frac: 0.25 },
          { label: '-12h', frac: 0.5 },
          { label: '-6h', frac: 0.75 },
          { label: 'Agora', frac: 1 },
        ].map((tick) => {
          const tx = padX + tick.frac * innerW;
          const anchor = tick.frac === 0 ? 'start' : tick.frac === 1 ? 'end' : 'middle';
          return (
            <text
              key={tick.label}
              x={tx}
              y={h - 4}
              fontSize="8.5"
              textAnchor={anchor}
              fill={isDark ? '#94a3b8' : '#64748b'}
            >
              {tick.label}
            </text>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '5px' }}>
        <span style={{ color: '#38bdf8', fontWeight: 700 }}>
          ↑ P95 Out: {formatBps(stats.p95_out_bps)}
        </span>
        <span style={{ color: '#22c55e', fontWeight: 700 }}>
          ↓ P95 In: {formatBps(stats.p95_in_bps)}
        </span>
      </div>
    </div>
  );
}

export const WeathermapViewer = ({
  mapSummary,
  isAdmin,
  onBack,
  onEdit,
  onSelectAsset,
}) => {
  const { theme } = useTheme();
  const [svgContent, setSvgContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);
  const [useAppTheme, setUseAppTheme] = useState(true);

  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Tooltip state
  const [hoveredLink, setHoveredLink] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [historyCache, setHistoryCache] = useState({});
  const [loadingHistoryId, setLoadingHistoryId] = useState(null);

  const loadSvg = useCallback(async () => {
    try {
      setError('');
      const targetTheme = useAppTheme ? (theme === 'dark' ? 'dark' : 'light') : null;
      const svg = await weathermapService.getInteractiveSvg(mapSummary.id, targetTheme);
      setSvgContent(svg);
    } catch (err) {
      setError(err.message || 'Erro ao carregar mapa.');
    } finally {
      setLoading(false);
    }
  }, [mapSummary.id, theme, useAppTheme]);

  useEffect(() => {
    setLoading(true);
    loadSvg();
    const timer = setInterval(loadSvg, 60000);
    return () => clearInterval(timer);
  }, [loadSvg]);

  const handleRefreshNow = async () => {
    try {
      setRefreshing(true);
      await weathermapService.refreshMap(mapSummary.id);
      await loadSvg();
    } catch (err) {
      setError(err.message || 'Erro ao atualizar mapa.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopyUrl = (kind = 'png') => {
    const htmlUrl = mapSummary.public_url_html || mapSummary.public_url_png.replace(/\.png$/, '.html');
    navigator.clipboard.writeText(kind === 'html' ? htmlUrl : mapSummary.public_url_png);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setScale((prev) => Math.min(4, Math.max(0.25, Number((prev * factor).toFixed(3)))));
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.wm-node')) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    const linkEl = e.target.closest('.wm-link');
    if (linkEl) {
      const linkId = Number(linkEl.getAttribute('data-link-id'));
      const info = {
        id: linkId,
        label: linkEl.getAttribute('data-label') || `Link #${linkId}`,
        in_bps: linkEl.getAttribute('data-in'),
        out_bps: linkEl.getAttribute('data-out'),
        pct: linkEl.getAttribute('data-pct'),
        status: linkEl.getAttribute('data-status') || 'ok',
        capacity_bps: linkEl.getAttribute('data-capacity'),
      };
      setHoveredLink(info);
      setTooltipPos({ x: e.clientX + 16, y: e.clientY + 16 });

      if (linkId && !historyCache[linkId] && loadingHistoryId !== linkId) {
        setLoadingHistoryId(linkId);
        weathermapService
          .getLinkHistory(linkId, 24)
          .then((res) => {
            setHistoryCache((prev) => ({ ...prev, [linkId]: res }));
          })
          .catch(() => {})
          .finally(() => setLoadingHistoryId(null));
      }
    } else if (hoveredLink) {
      setHoveredLink(null);
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleSvgClick = (e) => {
    const nodeEl = e.target.closest('.wm-node');
    if (nodeEl) {
      const assetId = nodeEl.getAttribute('data-asset-id');
      if (assetId && onSelectAsset) {
        onSelectAsset(Number(assetId));
      }
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: isFullscreen ? '100vh' : 'calc(100vh - 96px)',
        background: 'var(--bg-surface)',
        borderRadius: isFullscreen ? 0 : '12px',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      {/* Top Action Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-secondary" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} />
            <span>Mapas</span>
          </button>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{mapSummary.name}</span>
              {mapSummary.client_group && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    fontWeight: 600,
                  }}
                >
                  {mapSummary.client_group}
                </span>
              )}
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {mapSummary.node_count} nós · {mapSummary.link_count} enlaces · {mapSummary.width}×{mapSummary.height}px
              {' · '}Clique em um nó vinculado para abrir o ativo
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={() => setUseAppTheme((v) => !v)}
            title="Alternar entre tema do IperSoft e tema fixo do PNG"
            style={{ fontSize: '0.78rem', padding: '6px 10px' }}
          >
            {useAppTheme ? 'Tema: Automático' : `Tema PNG (${mapSummary.theme})`}
          </button>

          <button
            className="btn-secondary"
            onClick={() => setScale((s) => Math.min(4, Number((s * 1.2).toFixed(2))))}
            title="Aumentar Zoom"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="btn-secondary"
            onClick={() => setScale((s) => Math.max(0.25, Number((s / 1.2).toFixed(2))))}
            title="Reduzir Zoom"
          >
            <ZoomOut size={15} />
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setScale(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Resetar Zoom/Posição"
          >
            <RotateCcw size={15} />
          </button>

          <button className="btn-secondary" onClick={toggleFullscreen} title="Modo NOC (Tela Cheia)">
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          <button
            className="btn-secondary"
            onClick={() => handleCopyUrl('png')}
            title="Copiar URL pública do PNG para usar no painel do Grafana"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
          >
            {copied === 'png' ? <Check size={15} color="#22c55e" /> : <Copy size={15} />}
            <span>{copied === 'png' ? 'PNG Copiado!' : 'URL PNG'}</span>
          </button>

          <button
            className="btn-secondary"
            onClick={() => handleCopyUrl('html')}
            title="Copiar URL pública do HTML dinâmico interativo para usar em Iframe no Grafana"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
          >
            {copied === 'html' ? <Check size={15} color="#22c55e" /> : <Copy size={15} />}
            <span>{copied === 'html' ? 'HTML Copiado!' : 'URL HTML (Dinâmico)'}</span>
          </button>

          <a
            href={mapSummary.public_url_html || mapSummary.public_url_png.replace(/\.png$/, '.html')}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            title="Abrir HTML dinâmico público em nova aba"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none', fontSize: '0.8rem' }}
          >
            <ExternalLink size={14} />
            <span>HTML</span>
          </a>

          <a
            href={mapSummary.public_url_png}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            title="Abrir PNG público em nova aba"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', textDecoration: 'none', fontSize: '0.8rem' }}
          >
            <ExternalLink size={14} />
            <span>PNG</span>
          </a>

          <button
            className="btn-secondary"
            onClick={handleRefreshNow}
            disabled={refreshing}
            title="Coletar tráfego no Zabbix e atualizar imagem agora"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
          >
            <RefreshCw size={15} className={refreshing ? 'spin-icon' : ''} />
            <span>{refreshing ? 'Atualizando...' : 'Atualizar'}</span>
          </button>

          {isAdmin && onEdit && (
            <button
              className="btn-primary"
              onClick={onEdit}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
            >
              <Edit3 size={15} />
              <span>Editar Mapa</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Interactive SVG Canvas */}
      <div
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setIsPanning(false);
          setHoveredLink(null);
        }}
        onClick={handleSvgClick}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          cursor: isPanning ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme === 'dark' ? '#090d16' : '#f1f5f9',
        }}
      >
        {loading ? (
          <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={18} className="spin-icon" />
            <span>Renderizando topologia...</span>
          </div>
        ) : (
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.08s ease-out',
              boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}

        {/* Floating Link Tooltip with 24h Traffic Chart */}
        {hoveredLink && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(window.innerWidth - 350, tooltipPos.x),
              top: Math.min(window.innerHeight - 250, tooltipPos.y),
              width: '336px',
              background: theme === 'dark' ? 'rgba(15, 23, 42, 0.97)' : 'rgba(255, 255, 255, 0.98)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: theme === 'dark' ? '1px solid #334155' : '1px solid #cbd5e1',
              borderRadius: '10px',
              padding: '12px',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55)',
              color: theme === 'dark' ? '#f8fafc' : '#0f172a',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <strong style={{ fontSize: '0.84rem', color: theme === 'dark' ? '#f8fafc' : '#0f172a' }}>
                {hoveredLink.label}
              </strong>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: hoveredLink.status === 'ok' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                  color: hoveredLink.status === 'ok' ? '#22c55e' : '#ef4444',
                }}
              >
                {hoveredLink.pct !== '' ? `${Number(hoveredLink.pct).toFixed(1)}%` : hoveredLink.status.toUpperCase()}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', fontSize: '0.75rem' }}>
              <div>
                <div style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b', fontSize: '0.68rem' }}>↑ Out (A→B)</div>
                <div style={{ fontWeight: 700, color: '#38bdf8' }}>{formatBps(hoveredLink.out_bps)}</div>
              </div>
              <div>
                <div style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b', fontSize: '0.68rem' }}>↓ In (B→A)</div>
                <div style={{ fontWeight: 700, color: '#22c55e' }}>{formatBps(hoveredLink.in_bps)}</div>
              </div>
              <div>
                <div style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b', fontSize: '0.68rem' }}>Capacidade</div>
                <div style={{ fontWeight: 600, color: theme === 'dark' ? '#e2e8f0' : '#1e293b' }}>
                  {formatBps(hoveredLink.capacity_bps)}
                </div>
              </div>
            </div>

            <MiniHistoryChart
              historyData={historyCache[hoveredLink.id]}
              loading={loadingHistoryId === hoveredLink.id && !historyCache[hoveredLink.id]}
              isDark={theme === 'dark'}
            />
          </div>
        )}
      </div>
    </div>
  );
};
