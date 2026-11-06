import React, { useState, useEffect } from 'react';
import { Trash2, ArrowLeftRight, Plus, X, Activity } from 'lucide-react';
import { weathermapService } from '../../services/api';

const CAPACITY_PRESETS = [
  { label: '100M', bps: 100_000_000 },
  { label: '1G', bps: 1_000_000_000 },
  { label: '10G', bps: 10_000_000_000 },
  { label: '40G', bps: 40_000_000_000 },
  { label: '100G', bps: 100_000_000_000 },
];

const OFFSET_PRESETS = [
  { label: 'Centro (Padrão)', value: '' },
  { label: 'Norte 40% (N40)', value: 'N40' },
  { label: 'Sul 40% (S40)', value: 'S40' },
  { label: 'Oeste 40% (W40)', value: 'W40' },
  { label: 'Leste 40% (E40)', value: 'E40' },
  { label: 'Norte 80% (N80)', value: 'N80' },
  { label: 'Sul 80% (S80)', value: 'S80' },
  { label: 'Oeste 80% (W80)', value: 'W80' },
  { label: 'Leste 80% (E80)', value: 'E80' },
];

function fmtShortBps(bps) {
  if (!bps || Number(bps) <= 0) return '0';
  const v = Number(bps);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${Math.round(v)}`;
}

export const LinkPropertiesPanel = ({
  link,
  nodeA,
  nodeB,
  zabbixHosts = [],
  onChange,
  onDelete,
}) => {
  const defaultHostId =
    nodeA?.zabbix_hostid ||
    nodeB?.zabbix_hostid ||
    zabbixHosts.find((h) => h.host === link?.zabbix_host)?.hostid ||
    '';

  const [selectedHostId, setSelectedHostId] = useState(defaultHostId);
  const [interfaces, setInterfaces] = useState([]);
  const [loadingIfaces, setLoadingIfaces] = useState(false);

  useEffect(() => {
    const nextDefault =
      nodeA?.zabbix_hostid ||
      nodeB?.zabbix_hostid ||
      zabbixHosts.find((h) => h.host === link?.zabbix_host)?.hostid ||
      '';
    setSelectedHostId(nextDefault);
  }, [link?.id, nodeA?.zabbix_hostid, nodeB?.zabbix_hostid, link?.zabbix_host, zabbixHosts]);

  useEffect(() => {
    if (!selectedHostId) {
      setInterfaces([]);
      return;
    }
    let active = true;
    setLoadingIfaces(true);
    weathermapService
      .listHostInterfaces(selectedHostId)
      .then((res) => {
        if (active) setInterfaces(res || []);
      })
      .catch(() => {
        if (active) setInterfaces([]);
      })
      .finally(() => {
        if (active) setLoadingIfaces(false);
      });
    return () => {
      active = false;
    };
  }, [selectedHostId]);

  if (!link) return null;

  const handleSelectInterface = (ifname) => {
    const iface = interfaces.find((i) => i.ifname === ifname);
    if (!iface) return;
    const hostObj = zabbixHosts.find((h) => String(h.hostid) === String(selectedHostId));
    onChange({
      ...link,
      zabbix_host: hostObj?.host || link.zabbix_host,
      itemid_in: iface.itemid_in || '',
      itemid_out: iface.itemid_out || '',
      itemid_status: iface.itemid_status || '',
      capacity_bps: iface.speed_bps || link.capacity_bps || 1_000_000_000,
    });
  };

  const handleSwapInOut = () => {
    onChange({
      ...link,
      itemid_in: link.itemid_out || '',
      itemid_out: link.itemid_in || '',
    });
  };

  const handleAddViaPoint = () => {
    const ax = Number(nodeA?.x || 200);
    const ay = Number(nodeA?.y || 200);
    const bx = Number(nodeB?.x || 400);
    const by = Number(nodeB?.y || 400);
    const mx = Math.round((ax + bx) / 2);
    const my = Math.round((ay + by) / 2 - 30);
    const current = Array.isArray(link.via_points) ? link.via_points : [];
    onChange({
      ...link,
      via_points: [...current, [mx, my]],
    });
  };

  const handleUpdateViaPoint = (idx, coordIdx, val) => {
    const current = Array.isArray(link.via_points) ? [...link.via_points] : [];
    const pt = [...(current[idx] || [0, 0])];
    pt[coordIdx] = Number(val) || 0;
    current[idx] = pt;
    onChange({ ...link, via_points: current });
  };

  const handleRemoveViaPoint = (idx) => {
    const current = Array.isArray(link.via_points) ? link.via_points : [];
    onChange({
      ...link,
      via_points: current.filter((_, i) => i !== idx),
    });
  };

  const selectedIface = interfaces.find(
    (i) =>
      String(i.itemid_in || '') === String(link.itemid_in || '') &&
      String(i.itemid_out || '') === String(link.itemid_out || '')
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={16} color="#22c55e" />
          <span>Propriedades do Enlace</span>
        </h4>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onDelete(link)}
          style={{ color: '#ef4444', padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Trash2 size={13} />
          <span>Remover</span>
        </button>
      </div>

      <div
        style={{
          padding: '8px 10px',
          borderRadius: '8px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.76rem',
        }}
      >
        <div>
          <strong>Nó A:</strong> {nodeA?.label || link.node_a_id}
        </div>
        <div>
          <strong>Nó B:</strong> {nodeB?.label || link.node_b_id}
        </div>
      </div>

      <div>
        <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Identificador / Rótulo do Enlace
        </label>
        <input
          type="text"
          className="form-input"
          value={link.label || ''}
          onChange={(e) => onChange({ ...link, label: e.target.value })}
          style={{ width: '100%' }}
        />
      </div>

      {/* Zabbix Interface Picker */}
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
          <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>Coleta de Interface (Zabbix)</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSwapInOut}
            title="Inverter sentido de tráfego (In ↔ Out)"
            style={{ padding: '3px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <ArrowLeftRight size={12} />
            <span>Inverter In/Out</span>
          </button>
        </div>

        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
            Equipamento coletado no Zabbix
          </label>
          <select
            className="form-input"
            value={selectedHostId}
            onChange={(e) => setSelectedHostId(e.target.value)}
            style={{ width: '100%', fontSize: '0.76rem' }}
          >
            <option value="">— Selecionar host Zabbix —</option>
            {nodeA?.zabbix_hostid && (
              <option value={nodeA.zabbix_hostid}>
                [Nó A] {nodeA.label}
              </option>
            )}
            {nodeB?.zabbix_hostid && nodeB.zabbix_hostid !== nodeA?.zabbix_hostid && (
              <option value={nodeB.zabbix_hostid}>
                [Nó B] {nodeB.label}
              </option>
            )}
            {zabbixHosts.map((h) => (
              <option key={h.hostid} value={h.hostid}>
                {h.client_group ? `[${h.client_group.toUpperCase()}] ` : ''}
                {h.name || h.host}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
            Interface descoberta ({loadingIfaces ? 'carregando...' : `${interfaces.length} disponíveis`})
          </label>
          <select
            className="form-input"
            value={selectedIface?.ifname || ''}
            onChange={(e) => handleSelectInterface(e.target.value)}
            disabled={loadingIfaces || !interfaces.length}
            style={{ width: '100%', fontSize: '0.76rem' }}
          >
            <option value="">— Escolher interface para preencher ItemIDs —</option>
            {interfaces.map((iface) => (
              <option key={iface.ifname} value={iface.ifname}>
                {iface.ifname} (↑{fmtShortBps(iface.out_bps)} ↓{fmtShortBps(iface.in_bps)}
                {iface.speed_bps ? ` · ${fmtShortBps(iface.speed_bps)}bps` : ''})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>ItemID IN (↓)</label>
            <input
              type="text"
              className="form-input"
              value={link.itemid_in || ''}
              onChange={(e) => onChange({ ...link, itemid_in: e.target.value.trim() || null })}
              placeholder="Ex: 80267"
              style={{ width: '100%', fontSize: '0.75rem' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>ItemID OUT (↑)</label>
            <input
              type="text"
              className="form-input"
              value={link.itemid_out || ''}
              onChange={(e) => onChange({ ...link, itemid_out: e.target.value.trim() || null })}
              placeholder="Ex: 80393"
              style={{ width: '100%', fontSize: '0.75rem' }}
            />
          </div>
        </div>
      </div>

      {/* Capacidade */}
      <div>
        <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          Capacidade do Enlace (Mbps)
        </label>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' }}>
          {CAPACITY_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={Number(link.capacity_bps) === p.bps ? 'btn-primary' : 'btn-secondary'}
              onClick={() => onChange({ ...link, capacity_bps: p.bps })}
              style={{ padding: '3px 8px', fontSize: '0.72rem' }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="number"
          className="form-input"
          min={1}
          value={Math.round((Number(link.capacity_bps) || 1_000_000_000) / 1_000_000)}
          onChange={(e) =>
            onChange({
              ...link,
              capacity_bps: Math.max(1, Number(e.target.value) || 1000) * 1_000_000,
            })
          }
          style={{ width: '100%' }}
        />
      </div>

      {/* Posição das Informações de Tráfego na Linha */}
      <div
        style={{
          padding: '10px',
          borderRadius: '8px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ fontSize: '0.76rem', fontWeight: 700 }}>
            Posição do Tráfego na Linha ({link.label_pos_pct ?? 50}%)
          </label>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            Evita sobreposição no centro
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {[
            { label: '20% (Nó A)', val: 20 },
            { label: '35%', val: 35 },
            { label: '50% (Centro)', val: 50 },
            { label: '65%', val: 65 },
            { label: '80% (Nó B)', val: 80 },
          ].map((preset) => (
            <button
              key={preset.val}
              type="button"
              className={Number(link.label_pos_pct ?? 50) === preset.val ? 'btn-primary' : 'btn-secondary'}
              onClick={() => onChange({ ...link, label_pos_pct: preset.val })}
              style={{ padding: '3px 7px', fontSize: '0.7rem', flex: 1 }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Nó A</span>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={Number(link.label_pos_pct ?? 50)}
            onChange={(e) => onChange({ ...link, label_pos_pct: Number(e.target.value) })}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Nó B</span>
        </div>
      </div>

      {/* Offsets para links paralelos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={{ fontSize: '0.74rem', fontWeight: 600, display: 'block', marginBottom: '3px' }}>
            Offset Nó A
          </label>
          <select
            className="form-input"
            value={link.offset_a || ''}
            onChange={(e) => onChange({ ...link, offset_a: e.target.value || null })}
            style={{ width: '100%', fontSize: '0.74rem' }}
          >
            {OFFSET_PRESETS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.74rem', fontWeight: 600, display: 'block', marginBottom: '3px' }}>
            Offset Nó B
          </label>
          <select
            className="form-input"
            value={link.offset_b || ''}
            onChange={(e) => onChange({ ...link, offset_b: e.target.value || null })}
            style={{ width: '100%', fontSize: '0.74rem' }}
          >
            {OFFSET_PRESETS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pontos de Curva (VIA) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <label style={{ fontSize: '0.76rem', fontWeight: 600 }}>Pontos de Curva (Via Points)</label>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleAddViaPoint}
            style={{ padding: '2px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Plus size={12} />
            <span>Ponto</span>
          </button>
        </div>
        {(link.via_points || []).map((pt, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <input
              type="number"
              className="form-input"
              value={pt[0]}
              onChange={(e) => handleUpdateViaPoint(idx, 0, e.target.value)}
              style={{ width: '100%', fontSize: '0.74rem' }}
              placeholder="X"
            />
            <input
              type="number"
              className="form-input"
              value={pt[1]}
              onChange={(e) => handleUpdateViaPoint(idx, 1, e.target.value)}
              style={{ width: '100%', fontSize: '0.74rem' }}
              placeholder="Y"
            />
            <button
              type="button"
              className="btn-icon"
              onClick={() => handleRemoveViaPoint(idx)}
              style={{ color: '#ef4444' }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
