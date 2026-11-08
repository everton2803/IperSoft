import React, { useState, useEffect, useCallback } from 'react';
import {
  Map,
  Plus,
  Search,
  RefreshCw,
  Copy,
  Check,
  Edit3,
  Trash2,
  KeyRound,
  Upload,
  Eye,
  ExternalLink,
  AlertTriangle,
  X,
} from 'lucide-react';
import { weathermapService } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';

function formatRelativeTime(isoStr) {
  if (!isoStr) return 'Nunca renderizado';
  const dt = new Date(isoStr);
  const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (diffSec < 60) return 'Atualizado agora';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `Atualizado há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `Atualizado há ${hrs}h`;
}

function MapSvgThumbnail({ mapId, theme, onClick }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let active = true;
    weathermapService
      .getInteractiveSvg(mapId, theme === 'dark' ? 'dark' : 'light')
      .then((res) => {
        if (active) setSvg(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mapId, theme]);

  return (
    <div
      onClick={onClick}
      style={{
        height: '165px',
        background: theme === 'dark' ? '#090d16' : '#f1f5f9',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
      }}
      title="Clique para abrir o mapa interativo"
    >
      {svg ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
          dangerouslySetInnerHTML={{
            __html: svg.replace(
              /<svg([^>]*?)width="(\d+)"\s+height="(\d+)"/,
              '<svg$1width="100%" height="100%" preserveAspectRatio="xMidYMid meet"'
            ),
          }}
        />
      ) : (
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Carregando miniatura...</span>
      )}
    </div>
  );
}

export const WeathermapList = ({
  isAdmin,
  onSelectMap,
  onEditMap,
}) => {
  const { theme } = useTheme();
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [copiedId, setCopiedId] = useState(null);
  const [busyMapId, setBusyMapId] = useState(null);

  // Create Map Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newMapForm, setNewMapForm] = useState({
    name: '',
    client_group: '',
    width: 1500,
    height: 1000,
    theme: 'light',
  });

  const fetchMaps = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await weathermapService.listMaps();
      setMaps(data || []);
    } catch (err) {
      setError(err.message || 'Erro ao listar mapas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  const groups = Array.from(
    new Set(maps.map((m) => m.client_group).filter(Boolean))
  ).sort();

  const filteredMaps = maps.filter((m) => {
    if (selectedGroup !== 'all' && m.client_group !== selectedGroup) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (m.name || '').toLowerCase().includes(q) ||
      (m.client_group || '').toLowerCase().includes(q) ||
      (m.legacy_name || '').toLowerCase().includes(q)
    );
  });

  const handleCopy = (m, kind = 'png') => {
    const url = kind === 'html' ? (m.public_url_html || m.public_url_png.replace(/\.png$/, '.html')) : m.public_url_png;
    navigator.clipboard.writeText(url);
    setCopiedId(`${m.id}_${kind}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRotateToken = async (m) => {
    if (!window.confirm(`Rotacionar o token público do mapa "${m.name}"? A URL antiga deixará de funcionar.`)) {
      return;
    }
    try {
      setBusyMapId(m.id);
      const updated = await weathermapService.rotateToken(m.id);
      setMaps((prev) => prev.map((item) => (item.id === m.id ? updated : item)));
    } catch (err) {
      alert(err.message || 'Erro ao rotacionar token.');
    } finally {
      setBusyMapId(null);
    }
  };

  const handleDelete = async (m) => {
    if (!window.confirm(`Tem certeza que deseja excluir o mapa "${m.name}"?`)) {
      return;
    }
    try {
      setBusyMapId(m.id);
      await weathermapService.deleteMap(m.id);
      setMaps((prev) => prev.filter((item) => item.id !== m.id));
    } catch (err) {
      alert(err.message || 'Erro ao excluir mapa.');
    } finally {
      setBusyMapId(null);
    }
  };

  const handleCreateMap = async (e) => {
    e.preventDefault();
    if (!newMapForm.name.trim()) return;
    try {
      const created = await weathermapService.createMap({
        name: newMapForm.name.trim(),
        client_group: newMapForm.client_group.trim() || null,
        width: Number(newMapForm.width) || 1500,
        height: Number(newMapForm.height) || 1000,
        theme: newMapForm.theme,
      });
      setIsCreateOpen(false);
      setNewMapForm({ name: '', client_group: '', width: 1500, height: 1000, theme: 'light' });
      await fetchMaps();
      if (onEditMap) {
        onEditMap(created);
      } else {
        onSelectMap(created);
      }
    } catch (err) {
      alert(err.message || 'Erro ao criar mapa.');
    }
  };

  const handleUploadLegacyFiles = async (e) => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;
    try {
      const payload = await Promise.all(
        fileList.map(
          (f) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ filename: f.name, content: String(reader.result || '') });
              reader.onerror = reject;
              reader.readAsText(f);
            })
        )
      );
      await weathermapService.importLegacyConfigs(payload);
      await fetchMaps();
    } catch (err) {
      alert(err.message || 'Erro ao importar arquivos .conf.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div style={{ padding: '6px 0' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '18px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Map size={22} style={{ color: 'var(--color-primary)' }} />
            <span>Mapas de Topologia & Tráfego (Weathermap)</span>
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            Monitoramento visual de enlaces com atualização a cada 5 minutos e exportação PNG para painéis Grafana dos ISPs.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={fetchMaps}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
            <span>Recarregar</span>
          </button>

          {isAdmin && (
            <>
              <label
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}
                title="Importar arquivos .conf do PHP Weathermap"
              >
                <Upload size={15} />
                <span>Importar .conf</span>
                <input
                  type="file"
                  accept=".conf"
                  multiple
                  onChange={handleUploadLegacyFiles}
                  style={{ display: 'none' }}
                />
              </label>

              <button
                className="btn-primary"
                onClick={() => setIsCreateOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={16} />
                <span>Novo Mapa</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '18px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: '420px' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            className="form-input"
            placeholder="Buscar por nome do mapa ou grupo/ISP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%' }}
          />
        </div>

        <select
          className="form-input"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          style={{ width: 'auto', minWidth: '180px' }}
        >
          <option value="all">Todos os Clientes / ISPs ({maps.length})</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              ISP: {g.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            background: 'rgba(239,68,68,0.12)',
            color: '#ef4444',
            marginBottom: '16px',
          }}
        >
          {error}
        </div>
      )}

      {/* Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
          gap: '16px',
        }}
      >
        {filteredMaps.map((m) => (
          <div
            key={m.id}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              transition: 'border-color 0.2s, transform 0.15s',
            }}
          >
            <MapSvgThumbnail mapId={m.id} theme={theme} onClick={() => onSelectMap(m)} />

            <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div>
                  <h3
                    onClick={() => onSelectMap(m)}
                    style={{
                      margin: 0,
                      fontSize: '1.02rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {m.name}
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {m.node_count} nós · {m.link_count} enlaces · {m.width}×{m.height}px
                  </div>
                </div>

                {m.client_group && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '3px 8px',
                      borderRadius: '999px',
                      background: 'rgba(56, 189, 248, 0.14)',
                      color: '#38bdf8',
                    }}
                  >
                    {m.client_group}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.74rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span>{formatRelativeTime(m.last_render_at)}</span>
                {m.last_render_error ? (
                  <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }} title={m.last_render_error}>
                    <AlertTriangle size={13} />
                    <span>Erro de render</span>
                  </span>
                ) : (
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>● Ativo</span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: 'auto',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-subtle)',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  className="btn-primary"
                  onClick={() => onSelectMap(m)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontSize: '0.78rem', padding: '6px 10px' }}
                >
                  <Eye size={14} />
                  <span>Abrir</span>
                </button>

                {isAdmin && onEditMap && (
                  <button
                    className="btn-secondary"
                    onClick={() => onEditMap(m)}
                    title="Abrir Editor Drag-and-Drop"
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem', padding: '6px 10px' }}
                  >
                    <Edit3 size={14} />
                    <span>Editar</span>
                  </button>
                )}

                <button
                  className="btn-secondary"
                  onClick={() => handleCopy(m, 'png')}
                  title="Copiar URL pública do PNG para o Grafana"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', padding: '6px 8px' }}
                >
                  {copiedId === `${m.id}_png` ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                  <span>{copiedId === `${m.id}_png` ? 'Copiado' : 'PNG'}</span>
                </button>

                <button
                  className="btn-secondary"
                  onClick={() => handleCopy(m, 'html')}
                  title="Copiar URL pública do HTML dinâmico interativo para o Grafana (Iframe)"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.76rem', padding: '6px 8px' }}
                >
                  {copiedId === `${m.id}_html` ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
                  <span>{copiedId === `${m.id}_html` ? 'Copiado' : 'HTML'}</span>
                </button>

                <a
                  href={m.public_url_html || m.public_url_png.replace(/\.png$/, '.html')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  title="Abrir HTML dinâmico público em nova guia"
                  style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', textDecoration: 'none' }}
                >
                  <ExternalLink size={14} />
                </a>

                {isAdmin && (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() => handleRotateToken(m)}
                      disabled={busyMapId === m.id}
                      title="Rotacionar token público"
                      style={{ padding: '6px 8px' }}
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => handleDelete(m)}
                      disabled={busyMapId === m.id}
                      title="Excluir mapa"
                      style={{ padding: '6px 8px', color: '#ef4444' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Criar Novo Mapa */}
      {isCreateOpen && (
        <div className="modal-backdrop" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Novo Mapa Weathermap</h3>
              <button className="btn-icon" onClick={() => setIsCreateOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateMap} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Nome do Mapa *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="Ex: Backbone Core Sul"
                  value={newMapForm.name}
                  onChange={(e) => setNewMapForm((p) => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Cliente / ISP (opcional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: atm, diretrix, rtnet"
                  value={newMapForm.client_group}
                  onChange={(e) => setNewMapForm((p) => ({ ...p, client_group: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Largura (px)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={600}
                    max={4000}
                    value={newMapForm.width}
                    onChange={(e) => setNewMapForm((p) => ({ ...p, width: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Altura (px)</label>
                  <input
                    type="number"
                    className="form-input"
                    min={400}
                    max={3000}
                    value={newMapForm.height}
                    onChange={(e) => setNewMapForm((p) => ({ ...p, height: e.target.value }))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Tema PNG</label>
                  <select
                    className="form-input"
                    value={newMapForm.theme}
                    onChange={(e) => setNewMapForm((p) => ({ ...p, theme: e.target.value }))}
                    style={{ width: '100%' }}
                  >
                    <option value="light">Claro</option>
                    <option value="dark">Escuro</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button type="button" className="btn-secondary" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Criar Mapa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
