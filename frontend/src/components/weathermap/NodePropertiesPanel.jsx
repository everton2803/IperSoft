import React, { useState, useMemo } from 'react';
import { Trash2, Server, Cloud, Search, Link2Off } from 'lucide-react';

const ICON_OPTIONS = [
  { value: 'router', label: 'Roteador (Router / BGP)' },
  { value: 'switch', label: 'Switch L2' },
  { value: 'switch_l3', label: 'Switch L3 / Core' },
  { value: 'olt', label: 'OLT GPON / EPON' },
  { value: 'server', label: 'Servidor / VM' },
  { value: 'storage', label: 'Storage / Banco de Dados' },
  { value: 'cloud', label: 'Nuvem / Operadora / Trânsito' },
  { value: 'radio', label: 'Rádio Enlace' },
  { value: 'ups', label: 'Fonte / Nobreak / Voltímetro' },
  { value: 'pop', label: 'POP / Site' },
];

const LABEL_POS_OPTIONS = [
  { value: 'S', label: 'Abaixo (Sul)' },
  { value: 'N', label: 'Acima (Norte)' },
  { value: 'E', label: 'Direita (Leste)' },
  { value: 'W', label: 'Esquerda (Oeste)' },
];

export const NodePropertiesPanel = ({
  node,
  zabbixHosts = [],
  onChange,
  onDelete,
}) => {
  const [hostSearch, setHostSearch] = useState('');

  const filteredHosts = useMemo(() => {
    const q = hostSearch.trim().toLowerCase();
    if (!q) return zabbixHosts.slice(0, 60);
    return zabbixHosts
      .filter(
        (h) =>
          (h.name || '').toLowerCase().includes(q) ||
          (h.host || '').toLowerCase().includes(q) ||
          (h.client_group || '').toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [zabbixHosts, hostSearch]);

  if (!node) return null;

  const handleSelectHost = (hostObj) => {
    if (!hostObj) {
      onChange({
        ...node,
        asset_id: null,
        zabbix_hostid: null,
      });
      return;
    }
    const suggestedLabel = hostObj.host || hostObj.name || node.label;
    onChange({
      ...node,
      asset_id: hostObj.asset_id || null,
      zabbix_hostid: hostObj.hostid || null,
      label: node.label.startsWith('novo-no') ? suggestedLabel : node.label,
      key: node.key.startsWith('novo-no') ? suggestedLabel : node.key,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {node.icon === 'cloud' ? <Cloud size={16} color="#38bdf8" /> : <Server size={16} color="#38bdf8" />}
          <span>Propriedades do Nó</span>
        </h4>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onDelete(node)}
          style={{ color: '#ef4444', padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Trash2 size={13} />
          <span>Remover</span>
        </button>
      </div>

      <div>
        <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Rótulo Visível (Label)
        </label>
        <input
          type="text"
          className="form-input"
          value={node.label || ''}
          onChange={(e) => onChange({ ...node, label: e.target.value })}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Ícone
          </label>
          <select
            className="form-input"
            value={node.icon || 'router'}
            onChange={(e) => onChange({ ...node, icon: e.target.value })}
            style={{ width: '100%' }}
          >
            {ICON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Posição do Rótulo
          </label>
          <select
            className="form-input"
            value={node.label_pos || 'S'}
            onChange={(e) => onChange({ ...node, label_pos: e.target.value })}
            style={{ width: '100%' }}
          >
            {LABEL_POS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Posição X (px)
          </label>
          <input
            type="number"
            className="form-input"
            value={Math.round(node.x || 0)}
            onChange={(e) => onChange({ ...node, x: Number(e.target.value) || 0 })}
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Posição Y (px)
          </label>
          <input
            type="number"
            className="form-input"
            value={Math.round(node.y || 0)}
            onChange={(e) => onChange({ ...node, y: Number(e.target.value) || 0 })}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {/* Vínculo com Ativo / Host do Zabbix */}
      <div
        style={{
          padding: '10px',
          borderRadius: '8px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>
            Vínculo com Inventário / Zabbix
          </span>
          {(node.asset_id || node.zabbix_hostid) && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleSelectHost(null)}
              style={{ padding: '2px 6px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              title="Desvincular ativo (tornar nó livre/nuvem)"
            >
              <Link2Off size={11} />
              <span>Desvincular</span>
            </button>
          )}
        </div>

        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
          {node.asset_id ? (
            <span style={{ color: '#22c55e', fontWeight: 600 }}>
              ● Vinculado ao Asset #{node.asset_id} (Zabbix hostid: {node.zabbix_hostid || 'auto'})
            </span>
          ) : node.zabbix_hostid ? (
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>
              ● Host Zabbix #{node.zabbix_hostid}
            </span>
          ) : (
            <span>Nó livre (ex: Nuvem / Operadora sem host próprio)</span>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <Search
            size={13}
            style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            className="form-input"
            placeholder="Filtrar ativo/host Zabbix..."
            value={hostSearch}
            onChange={(e) => setHostSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '28px', fontSize: '0.76rem' }}
          />
        </div>

        <select
          className="form-input"
          value={node.zabbix_hostid || ''}
          onChange={(e) => {
            const h = zabbixHosts.find((item) => String(item.hostid) === e.target.value);
            handleSelectHost(h || null);
          }}
          style={{ width: '100%', fontSize: '0.76rem' }}
        >
          <option value="">— Selecionar equipamento ({filteredHosts.length}) —</option>
          {filteredHosts.map((h) => (
            <option key={h.hostid} value={h.hostid}>
              {h.client_group ? `[${h.client_group.toUpperCase()}] ` : ''}
              {h.name || h.host} ({h.host})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
