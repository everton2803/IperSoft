import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Save,
  Undo2,
  Plus,
  Cloud,
  Server,
  Settings,
  CheckCircle2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Link2,
  List,
  Activity,
} from 'lucide-react';
import { weathermapService } from '../../services/api';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { LinkPropertiesPanel } from './LinkPropertiesPanel';
import { useTheme } from '../../context/ThemeContext';

function resolveCompassOffset(offsetStr, radius = 25) {
  if (!offsetStr) return [0, 0];
  const s = String(offsetStr).trim().toUpperCase().replace(/^:/, '');
  const m = s.match(/^(NE|SE|NW|SW|N|S|E|W|C)(\d+)?$/);
  if (!m) return [0, 0];
  const dir = m[1];
  const pct = m[2] !== undefined ? Number(m[2]) : 100;
  const dist = radius * (pct / 100);
  let dx = 0;
  let dy = 0;
  if (dir.includes('N')) dy -= dist;
  if (dir.includes('S')) dy += dist;
  if (dir.includes('E')) dx += dist;
  if (dir.includes('W')) dx -= dist;
  return [dx, dy];
}

function catmullRomSvgPath(points) {
  if (!points || !points.length) return '';
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  if (points.length === 2) {
    return `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)} L ${points[1][0].toFixed(1)} ${points[1][1].toFixed(1)}`;
  }
  const d = [`M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6.0;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6.0;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6.0;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6.0;
    d.push(`C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`);
  }
  return d.join(' ');
}

function polylineMidpoint(points, posPct = 50) {
  if (!points || !points.length) return [0, 0];
  if (points.length === 1) return points[0];
  let total = 0;
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    segs.push([len, x0, y0, x1, y1]);
    total += len;
  }
  if (total <= 1e-6) return points[0];
  const clamped = Math.max(10, Math.min(90, Number(posPct ?? 50)));
  const target = total * (clamped / 100);
  let acc = 0;
  for (const [len, x0, y0, x1, y1] of segs) {
    if (acc + len >= target && len > 0) {
      const t = (target - acc) / len;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    acc += len;
  }
  const last = segs[segs.length - 1];
  return [(last[1] + last[3]) / 2, (last[2] + last[4]) / 2];
}

function fmtShortBps(bps) {
  if (bps === null || bps === undefined || bps === '') return '-';
  const v = Number(bps);
  if (Number.isNaN(v) || v <= 0) return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 100e9 ? 0 : 1)}G`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 100e6 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${Math.round(v)}`;
}

function NodeVectorIcon({ icon, stroke }) {
  const ic = (icon || 'router').toLowerCase();
  if (ic === 'cloud') {
    return (
      <path
        d="M-9,5 H8 A5,5 0 0 0 9,-5 A7,7 0 0 0 -4,-7 A6,6 0 0 0 -9,5 Z"
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    );
  }
  if (ic === 'switch' || ic === 'switch_l2' || ic === 'switch_l3') {
    return (
      <>
        <rect x="-11" y="-6" width="22" height="12" rx="2.5" fill="none" stroke={stroke} strokeWidth="1.8" />
        <path
          d="M-7,-2 H5 M2,-4.5 L5,-2 L2,0.5 M7,2 H-5 M-2,-0.5 L-5,2 L-2,4.5"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    );
  }
  if (ic === 'olt') {
    return (
      <>
        <rect x="-11" y="-7" width="22" height="14" rx="2" fill="none" stroke={stroke} strokeWidth="1.8" />
        <circle cx="-6" cy="0" r="1.6" fill={stroke} />
        <circle cx="-1" cy="0" r="1.6" fill={stroke} />
        <path d="M4,-3 L9,0 L4,3" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  }
  if (ic === 'server' || ic === 'storage') {
    return (
      <>
        <rect x="-9" y="-9" width="18" height="7" rx="1.5" fill="none" stroke={stroke} strokeWidth="1.7" />
        <rect x="-9" y="2" width="18" height="7" rx="1.5" fill="none" stroke={stroke} strokeWidth="1.7" />
        <circle cx="-5" cy="-5.5" r="1.2" fill={stroke} />
        <circle cx="-5" cy="5.5" r="1.2" fill={stroke} />
      </>
    );
  }
  return (
    <>
      <circle cx="0" cy="0" r="11" fill="none" stroke={stroke} strokeWidth="1.6" />
      <path
        d="M-7,0 H7 M4,-3 L7,0 L4,3 M0,-7 V7 M-3,-4 L0,-7 L3,-4"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export const WeathermapEditor = ({
  mapId,
  onBack,
  onSaved,
}) => {
  const { theme: appTheme } = useTheme();
  const [mapMeta, setMapMeta] = useState({
    name: '',
    client_group: '',
    width: 1500,
    height: 1000,
    theme: 'light',
    legacy_name: '',
    legacy_enabled: false,
    is_active: true,
    scale: [],
  });
  const [nodesList, setNodesList] = useState([]);
  const [linksList, setLinksList] = useState([]);
  const [liveState, setLiveState] = useState({});
  const [zabbixHosts, setZabbixHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState('');

  // Selection state: { type: 'map' | 'list' | 'node' | 'link', uid?: string }
  const [selection, setSelection] = useState({ type: 'map' });

  // Connect mode ('idle' | { sourceUid: string })
  const [connectMode, setConnectMode] = useState(null);
  const [mouseSvgPos, setMouseSvgPos] = useState({ x: 0, y: 0 });

  // Zoom / Pan / Drag state
  const [zoom, setZoom] = useState(0.75);
  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [dragAction, setDragAction] = useState(null);
  // dragAction:
  //   { kind: 'pan', startClientX, startClientY, startPanX, startPanY }
  //   { kind: 'node', uid, startClientX, startClientY, origX, origY }
  //   { kind: 'via', linkUid, viaIdx, startClientX, startClientY, origX, origY }

  const viewportRef = useRef(null);
  const [undoStack, setUndoStack] = useState([]);

  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [
      ...prev.slice(-19),
      {
        nodes: JSON.parse(JSON.stringify(nodesList)),
        links: JSON.parse(JSON.stringify(linksList)),
      },
    ]);
  }, [nodesList, linksList]);

  const handleUndo = () => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setNodesList(last.nodes);
    setLinksList(last.links);
    setUndoStack((prev) => prev.slice(0, -1));
  };

  const fitCanvasToViewport = useCallback((w, h) => {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scaleX = (rect.width - 48) / w;
    const scaleY = (rect.height - 48) / h;
    const bestZoom = Math.min(1.2, Math.max(0.25, Number(Math.min(scaleX, scaleY).toFixed(2))));
    setZoom(bestZoom);
    setPan({
      x: Math.round((rect.width - w * bestZoom) / 2),
      y: Math.round((rect.height - h * bestZoom) / 2),
    });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      weathermapService.getMap(mapId),
      weathermapService.getMapState(mapId).catch(() => ({ links: {} })),
      weathermapService.listZabbixHosts().catch(() => []),
    ])
      .then(([fullMap, stRes, hosts]) => {
        if (!active) return;
        const w = fullMap.width || 1500;
        const h = fullMap.height || 1000;
        setMapMeta({
          name: fullMap.name || '',
          client_group: fullMap.client_group || '',
          width: w,
          height: h,
          theme: fullMap.theme || 'light',
          legacy_name: fullMap.legacy_name || '',
          legacy_enabled: Boolean(fullMap.legacy_enabled),
          is_active: Boolean(fullMap.is_active),
          scale: fullMap.scale || [],
        });
        setNodesList(
          (fullMap.nodes || []).map((n) => ({
            ...n,
            _uid: String(n.id || n.key),
          }))
        );
        setLinksList(
          (fullMap.links || []).map((l, idx) => ({
            ...l,
            _uid: String(l.id || `lnk_${idx}`),
            node_a_uid: String(l.node_a_id),
            node_b_uid: String(l.node_b_id),
          }))
        );
        setLiveState(stRes?.links || {});
        setZabbixHosts(hosts || []);
        setTimeout(() => fitCanvasToViewport(w, h), 50);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Erro ao carregar mapa para edição.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mapId, fitCanvasToViewport]);

  const clientToSvgCoords = useCallback(
    (clientX, clientY) => {
      if (!viewportRef.current) return { x: 0, y: 0 };
      const rect = viewportRef.current.getBoundingClientRect();
      const x = (clientX - rect.left - pan.x) / zoom;
      const y = (clientY - rect.top - pan.y) / zoom;
      return { x, y };
    },
    [pan.x, pan.y, zoom]
  );

  const createLinkBetween = useCallback(
    (sourceUid, targetUid) => {
      if (!sourceUid || !targetUid || sourceUid === targetUid) return;
      const na = nodesList.find((n) => n._uid === sourceUid);
      const nb = nodesList.find((n) => n._uid === targetUid);
      if (!na || !nb) return;
      pushUndo();
      const newUid = `new_lnk_${Date.now()}`;
      const newLink = {
        id: null,
        _uid: newUid,
        node_a_uid: na._uid,
        node_b_uid: nb._uid,
        label: `${na.label}-${nb.label}`,
        zabbix_host: null,
        itemid_in: null,
        itemid_out: null,
        itemid_status: null,
        capacity_bps: 1_000_000_000,
        via_points: [],
        offset_a: null,
        offset_b: null,
        width: null,
        label_pos_pct: 50,
      };
      setLinksList((prev) => [...prev, newLink]);
      setSelection({ type: 'link', uid: newUid });
      setConnectMode(null);
    },
    [nodesList, pushUndo]
  );

  const handleViewportWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom((z) => Math.min(3.5, Math.max(0.2, Number((z * factor).toFixed(3)))));
  };

  const handleViewportMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-editor-interactive="true"]')) return;
    if (connectMode) {
      setConnectMode(null);
      return;
    }
    setDragAction({
      kind: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    });
  };

  const handleViewportMouseMove = (e) => {
    if (connectMode) {
      setMouseSvgPos(clientToSvgCoords(e.clientX, e.clientY));
    }
    if (!dragAction) return;

    const dxScreen = e.clientX - dragAction.startClientX;
    const dyScreen = e.clientY - dragAction.startClientY;

    if (dragAction.kind === 'pan') {
      setPan({
        x: dragAction.startPanX + dxScreen,
        y: dragAction.startPanY + dyScreen,
      });
    } else if (dragAction.kind === 'node') {
      const rawX = dragAction.origX + dxScreen / zoom;
      const rawY = dragAction.origY + dyScreen / zoom;
      const snappedX = Math.max(20, Math.min(mapMeta.width - 20, Math.round(rawX / 10) * 10));
      const snappedY = Math.max(20, Math.min(mapMeta.height - 20, Math.round(rawY / 10) * 10));
      setNodesList((prev) =>
        prev.map((n) => (n._uid === dragAction.uid ? { ...n, x: snappedX, y: snappedY } : n))
      );
    } else if (dragAction.kind === 'via') {
      const rawX = dragAction.origX + dxScreen / zoom;
      const rawY = dragAction.origY + dyScreen / zoom;
      const snappedX = Math.round(rawX / 10) * 10;
      const snappedY = Math.round(rawY / 10) * 10;
      setLinksList((prev) =>
        prev.map((l) => {
          if (l._uid !== dragAction.linkUid) return l;
          const nextVia = Array.isArray(l.via_points) ? [...l.via_points] : [];
          nextVia[dragAction.viaIdx] = [snappedX, snappedY];
          return { ...l, via_points: nextVia };
        })
      );
    }
  };

  const handleViewportMouseUp = () => {
    setDragAction(null);
  };

  const handleNodeMouseDown = (e, node) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    if (connectMode) {
      if (connectMode.sourceUid && connectMode.sourceUid !== node._uid) {
        createLinkBetween(connectMode.sourceUid, node._uid);
      } else {
        setConnectMode({ sourceUid: node._uid });
        setMouseSvgPos({ x: node.x, y: node.y });
      }
      return;
    }

    pushUndo();
    setSelection({ type: 'node', uid: node._uid });
    setDragAction({
      kind: 'node',
      uid: node._uid,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: Number(node.x || 0),
      origY: Number(node.y || 0),
    });
  };

  const handleViaMouseDown = (e, link, viaIdx, pt) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    pushUndo();
    setSelection({ type: 'link', uid: link._uid });
    setDragAction({
      kind: 'via',
      linkUid: link._uid,
      viaIdx,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: Number(pt[0] || 0),
      origY: Number(pt[1] || 0),
    });
  };

  const handleAddNode = (iconType = 'router') => {
    pushUndo();
    const seq = nodesList.length + 1;
    const newUid = `new_nd_${Date.now()}`;
    const baseKey = iconType === 'cloud' ? `nuvem-${seq}` : `novo-no-${seq}`;
    const newNode = {
      id: null,
      _uid: newUid,
      asset_id: null,
      zabbix_hostid: null,
      key: baseKey,
      label: baseKey,
      x: Math.round((mapMeta.width / 2 + ((seq % 5) - 2) * 40) / 10) * 10,
      y: Math.round((mapMeta.height / 2 + ((seq % 3) - 1) * 40) / 10) * 10,
      icon: iconType,
      label_pos: 'S',
    };
    setNodesList((prev) => [...prev, newNode]);
    setSelection({ type: 'node', uid: newUid });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSaveSuccess(false);

      const payload = {
        name: mapMeta.name.trim() || 'Mapa sem nome',
        client_group: mapMeta.client_group.trim() || null,
        width: Number(mapMeta.width) || 1500,
        height: Number(mapMeta.height) || 1000,
        theme: mapMeta.theme,
        scale: mapMeta.scale,
        legacy_name: mapMeta.legacy_name.trim() || null,
        legacy_enabled: Boolean(mapMeta.legacy_enabled),
        is_active: Boolean(mapMeta.is_active),
        nodes: nodesList.map((n) => ({
          id: n.id || null,
          temp_id: n._uid,
          asset_id: n.asset_id || null,
          key: (n.key || n.label || 'node').trim(),
          label: (n.label || n.key || 'node').trim(),
          x: Math.round(Number(n.x || 0)),
          y: Math.round(Number(n.y || 0)),
          icon: n.icon || 'router',
          label_pos: n.label_pos || 'S',
          zabbix_hostid: n.zabbix_hostid || null,
        })),
        links: linksList.map((l) => ({
          id: l.id || null,
          node_a_id: Number.isInteger(Number(l.node_a_uid)) ? Number(l.node_a_uid) : null,
          node_b_id: Number.isInteger(Number(l.node_b_uid)) ? Number(l.node_b_uid) : null,
          node_a_ref: String(l.node_a_uid),
          node_b_ref: String(l.node_b_uid),
          label: l.label || null,
          zabbix_host: l.zabbix_host || null,
          itemid_in: l.itemid_in || null,
          itemid_out: l.itemid_out || null,
          itemid_status: l.itemid_status || null,
          capacity_bps: Number(l.capacity_bps) || 1_000_000_000,
          via_points: Array.isArray(l.via_points) ? l.via_points : [],
          offset_a: l.offset_a || null,
          offset_b: l.offset_b || null,
          width: l.width || null,
          label_pos_pct: Number(l.label_pos_pct ?? 50),
        })),
      };

      const saved = await weathermapService.saveMap(mapId, payload);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      if (onSaved) {
        onSaved(saved);
      }
    } catch (err) {
      setError(err.message || 'Erro ao salvar mapa.');
    } finally {
      setSaving(false);
    }
  };

  const nodesByUid = {};
  for (const n of nodesList) {
    nodesByUid[n._uid] = n;
  }

  // Agrupar links paralelos entre o mesmo par de nós
  const pairGroups = {};
  for (const lnk of linksList) {
    const a = String(lnk.node_a_uid);
    const b = String(lnk.node_b_uid);
    const keyPair = a < b ? `${a}__${b}` : `${b}__${a}`;
    if ((!lnk.via_points || !lnk.via_points.length) && !lnk.offset_a && !lnk.offset_b) {
      if (!pairGroups[keyPair]) pairGroups[keyPair] = [];
      pairGroups[keyPair].push(lnk._uid);
    }
  }

  const selectedNode =
    selection.type === 'node' ? nodesList.find((n) => n._uid === selection.uid) : null;
  const selectedLink =
    selection.type === 'link' ? linksList.find((l) => l._uid === selection.uid) : null;

  const isCanvasDark = appTheme === 'dark' || mapMeta.theme === 'dark';
  const canvasBg = isCanvasDark ? '#0f172a' : '#f8fafc';
  const textPrimary = isCanvasDark ? '#f1f5f9' : '#0f172a';
  const cardBg = isCanvasDark ? '#1e293b' : '#ffffff';
  const cardBorder = isCanvasDark ? '#334155' : '#cbd5e1';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 96px)',
        background: 'var(--bg-surface)',
        borderRadius: '12px',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn-secondary" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} />
            <span>Visualizador</span>
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>
              Editor: {mapMeta.name} ({nodesList.length} nós · {linksList.length} enlaces)
            </h2>
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
              {connectMode
                ? connectMode.sourceUid
                  ? 'Modo Conexão: clique no nó de destino para criar o enlace (ou ESC/clique no fundo para cancelar)'
                  : 'Modo Conexão: clique no nó de origem (Nó A)'
                : 'Clique e arraste qualquer nó para mover · Clique em um nó ou enlace para editar suas propriedades à direita'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleAddNode('router')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}
          >
            <Plus size={14} />
            <Server size={14} />
            <span>+ Equipamento</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleAddNode('cloud')}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}
          >
            <Plus size={14} />
            <Cloud size={14} />
            <span>+ Nuvem</span>
          </button>

          <button
            type="button"
            className={connectMode ? 'btn-primary' : 'btn-secondary'}
            onClick={() => {
              if (connectMode) {
                setConnectMode(null);
              } else if (selectedNode) {
                setConnectMode({ sourceUid: selectedNode._uid });
                setMouseSvgPos({ x: selectedNode.x, y: selectedNode.y });
              } else {
                setConnectMode({ sourceUid: null });
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}
            title="Conectar dois nós criando um novo enlace"
          >
            <Link2 size={14} />
            <span>{connectMode ? 'Cancelar Conexão' : '+ Conectar Nós'}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setZoom((z) => Math.min(3.5, Number((z * 1.2).toFixed(2))))}
            title="Aumentar Zoom"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setZoom((z) => Math.max(0.2, Number((z / 1.2).toFixed(2))))}
            title="Reduzir Zoom"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={() => fitCanvasToViewport(mapMeta.width, mapMeta.height)}
            className="btn-secondary"
            title="Enquadrar Mapa na Tela"
          >
            <RotateCcw size={14} />
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleUndo}
            disabled={!undoStack.length}
            title="Desfazer última alteração"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}
          >
            <Undo2 size={14} />
            <span>Desfazer ({undoStack.length})</span>
          </button>

          <button
            type="button"
            className={selection.type === 'list' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setSelection({ type: 'list' })}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}
            title="Ver lista de todos os nós e enlaces do mapa"
          >
            <List size={14} />
            <span>Lista</span>
          </button>

          <button
            type="button"
            className={selection.type === 'map' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setSelection({ type: 'map' })}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem' }}
          >
            <Settings size={14} />
            <span>Config.</span>
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
          >
            {saveSuccess ? <CheckCircle2 size={15} /> : <Save size={15} />}
            <span>{saving ? 'Salvando...' : saveSuccess ? 'Salvo!' : 'Salvar Mapa'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.14)', color: '#ef4444', fontSize: '0.82rem' }}>
          {error}
        </div>
      )}

      {/* Main Editor Body: Interactive SVG Canvas + Right Inspector Sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          ref={viewportRef}
          onWheel={handleViewportWheel}
          onMouseDown={handleViewportMouseDown}
          onMouseMove={handleViewportMouseMove}
          onMouseUp={handleViewportMouseUp}
          onMouseLeave={handleViewportMouseUp}
          style={{
            flex: 1,
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
            background: '#090d16',
            cursor: connectMode
              ? 'crosshair'
              : dragAction?.kind === 'pan'
              ? 'grabbing'
              : 'grab',
            userSelect: 'none',
          }}
        >
          {loading ? (
            <div style={{ color: 'var(--text-muted)', padding: '32px' }}>Carregando editor...</div>
          ) : (
            <svg
              width="100%"
              height="100%"
              style={{ display: 'block', width: '100%', height: '100%' }}
            >
              <defs>
                <pattern id="wm-editor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path
                    d="M 20 0 L 0 0 0 20"
                    fill="none"
                    stroke={isCanvasDark ? 'rgba(148,163,184,0.1)' : 'rgba(15,23,42,0.07)'}
                    strokeWidth="1"
                  />
                </pattern>
              </defs>

              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {/* Canvas Boundary matching exact PNG dimensions */}
                <rect
                  x={0}
                  y={0}
                  width={mapMeta.width}
                  height={mapMeta.height}
                  fill={canvasBg}
                  stroke="#38bdf8"
                  strokeWidth={2}
                  strokeDasharray="8 5"
                  rx={6}
                />
                <rect
                  x={0}
                  y={0}
                  width={mapMeta.width}
                  height={mapMeta.height}
                  fill="url(#wm-editor-grid)"
                />
                <text
                  x={mapMeta.width - 14}
                  y={22}
                  textAnchor="end"
                  fontSize="12"
                  fontWeight="bold"
                  fill="#64748b"
                >
                  {mapMeta.name} ({mapMeta.width}×{mapMeta.height}px)
                </text>

                {/* Links */}
                {linksList.map((lnk) => {
                  const na = nodesByUid[lnk.node_a_uid];
                  const nb = nodesByUid[lnk.node_b_uid];
                  if (!na || !nb) return null;

                  const [dxa, dya] = resolveCompassOffset(lnk.offset_a);
                  const [dxb, dyb] = resolveCompassOffset(lnk.offset_b);
                  const ax = Number(na.x) + dxa;
                  const ay = Number(na.y) + dya;
                  const bx = Number(nb.x) + dxb;
                  const by = Number(nb.y) + dyb;

                  const pts = [[ax, ay]];
                  if (Array.isArray(lnk.via_points) && lnk.via_points.length > 0) {
                    for (const vp of lnk.via_points) {
                      pts.push([Number(vp[0]), Number(vp[1])]);
                    }
                  } else {
                    const a = String(lnk.node_a_uid);
                    const b = String(lnk.node_b_uid);
                    const keyPair = a < b ? `${a}__${b}` : `${b}__${a}`;
                    const siblings = pairGroups[keyPair] || [];
                    if (siblings.length > 1) {
                      const idx = siblings.indexOf(lnk._uid);
                      const shift = (idx - (siblings.length - 1) / 2) * 26;
                      const vx = bx - ax;
                      const vy = by - ay;
                      const dist = Math.hypot(vx, vy) || 1;
                      const nx = -vy / dist;
                      const ny = vx / dist;
                      pts.push([(ax + bx) / 2 + nx * shift, (ay + by) / 2 + ny * shift]);
                    }
                  }
                  pts.push([bx, by]);

                  const pathD = catmullRomSvgPath(pts);
                  const [mx, my] = polylineMidpoint(pts, lnk.label_pos_pct ?? 50);
                  const isSelected = selection.type === 'link' && selection.uid === lnk._uid;
                  const hasItems = Boolean(lnk.itemid_in || lnk.itemid_out);
                  const st = lnk.id ? liveState[String(lnk.id)] : null;

                  let strokeCol = hasItems ? '#0ea5e9' : '#94a3b8';
                  if (st && st.status === 'ok' && st.pct !== null && st.pct !== undefined) {
                    if (st.pct >= 85) strokeCol = '#ef4444';
                    else if (st.pct >= 55) strokeCol = '#eab308';
                    else if (st.pct >= 25) strokeCol = '#00d64f';
                    else if (st.pct > 0) strokeCol = '#00c0ff';
                  }
                  if (isSelected) strokeCol = '#f59e0b';

                  const capStr = fmtShortBps(lnk.capacity_bps);
                  const pillText =
                    st && st.status === 'ok'
                      ? `↑${fmtShortBps(st.out_bps)} ↓${fmtShortBps(st.in_bps)} (${capStr})`
                      : `${capStr} ${hasItems ? '● Zabbix' : '○ Sem Item'}`;
                  const pw = Math.max(82, pillText.length * 6.2 + 14);

                  return (
                    <g
                      key={lnk._uid}
                      data-editor-interactive="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelection({ type: 'link', uid: lnk._uid });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        pushUndo();
                        const coords = clientToSvgCoords(e.clientX, e.clientY);
                        const vx = Math.round(coords.x / 10) * 10;
                        const vy = Math.round(coords.y / 10) * 10;
                        setLinksList((prev) =>
                          prev.map((item) =>
                            item._uid === lnk._uid
                              ? { ...item, via_points: [...(item.via_points || []), [vx, vy]] }
                              : item
                          )
                        );
                        setSelection({ type: 'link', uid: lnk._uid });
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Hit area invisível larga para facilitar o clique */}
                      <path d={pathD} fill="none" stroke="transparent" strokeWidth={18} />
                      {/* Linha do enlace */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={strokeCol}
                        strokeWidth={isSelected ? 6.5 : 4.5}
                        strokeDasharray={hasItems ? undefined : '7 5'}
                        strokeLinecap="round"
                      />
                      {/* Pílula central clicável */}
                      <g transform={`translate(${mx.toFixed(1)}, ${my.toFixed(1)})`}>
                        <rect
                          x={-pw / 2}
                          y={-9}
                          width={pw}
                          height={18}
                          rx={9}
                          fill={cardBg}
                          stroke={strokeCol}
                          strokeWidth={isSelected ? 2 : 1.3}
                        />
                        <text
                          x={0}
                          y={3.5}
                          fontSize="9.5"
                          fontWeight="bold"
                          textAnchor="middle"
                          fill={textPrimary}
                        >
                          {pillText}
                        </text>
                      </g>

                      {/* Alças arrastáveis dos pontos de curva (via_points) */}
                      {(lnk.via_points || []).map((vp, vIdx) => (
                        <circle
                          key={vIdx}
                          cx={vp[0]}
                          cy={vp[1]}
                          r={isSelected ? 7 : 5}
                          fill="#f59e0b"
                          stroke="#ffffff"
                          strokeWidth={2}
                          onMouseDown={(e) => handleViaMouseDown(e, lnk, vIdx, vp)}
                          style={{ cursor: 'move' }}
                        >
                          <title>Arraste para curvar o enlace</title>
                        </circle>
                      ))}
                    </g>
                  );
                })}

                {/* Linha elástica durante o Modo Conexão */}
                {connectMode?.sourceUid && nodesByUid[connectMode.sourceUid] && (
                  <line
                    x1={nodesByUid[connectMode.sourceUid].x}
                    y1={nodesByUid[connectMode.sourceUid].y}
                    x2={mouseSvgPos.x}
                    y2={mouseSvgPos.y}
                    stroke="#f59e0b"
                    strokeWidth={3}
                    strokeDasharray="6 4"
                    pointerEvents="none"
                  />
                )}

                {/* Nodes */}
                {nodesList.map((nd) => {
                  const isSelected = selection.type === 'node' && selection.uid === nd._uid;
                  const isConnectSource = connectMode?.sourceUid === nd._uid;
                  const strokeCol =
                    isSelected || isConnectSource
                      ? '#f59e0b'
                      : nd.asset_id
                      ? '#22c55e'
                      : '#0284c7';

                  const lpos = (nd.label_pos || 'S').toUpperCase();
                  let lx = 0;
                  let ly = 32;
                  let anchor = 'middle';
                  if (lpos.startsWith('N')) {
                    lx = 0;
                    ly = -26;
                    anchor = 'middle';
                  } else if (lpos.startsWith('E')) {
                    lx = 26;
                    ly = 4;
                    anchor = 'start';
                  } else if (lpos.startsWith('W')) {
                    lx = -26;
                    ly = 4;
                    anchor = 'end';
                  }
                  const lblText = String(nd.label || nd.key || 'node');
                  const lw = Math.max(44, lblText.length * 6.5 + 12);
                  const rxBox =
                    anchor === 'middle' ? -lw / 2 : anchor === 'start' ? lx - 6 : lx - lw + 6;

                  return (
                    <g
                      key={nd._uid}
                      data-editor-interactive="true"
                      transform={`translate(${Number(nd.x || 0).toFixed(1)}, ${Number(nd.y || 0).toFixed(1)})`}
                      onMouseDown={(e) => handleNodeMouseDown(e, nd)}
                      style={{ cursor: connectMode ? 'crosshair' : 'move' }}
                    >
                      {(isSelected || isConnectSource) && (
                        <circle
                          cx={0}
                          cy={0}
                          r={25}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth={2.5}
                          strokeDasharray="4 3"
                        />
                      )}
                      <circle
                        cx={0}
                        cy={0}
                        r={19}
                        fill={cardBg}
                        stroke={strokeCol}
                        strokeWidth={2.2}
                      />
                      <NodeVectorIcon icon={nd.icon} stroke={strokeCol} />
                      <rect
                        x={rxBox}
                        y={ly - 12}
                        width={lw}
                        height={17}
                        rx={4}
                        fill={cardBg}
                        stroke={isSelected ? '#f59e0b' : cardBorder}
                        strokeWidth={isSelected ? 1.5 : 0.8}
                      />
                      <text
                        x={lx}
                        y={ly}
                        fontSize="10"
                        fontWeight="bold"
                        textAnchor={anchor}
                        fill={textPrimary}
                      >
                        {lblText}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        {/* Right Inspector Sidebar */}
        <div
          style={{
            width: '350px',
            borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            padding: '14px',
            overflowY: 'auto',
          }}
        >
          {selectedNode ? (
            <>
              <div style={{ marginBottom: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setConnectMode({ sourceUid: selectedNode._uid });
                    setMouseSvgPos({ x: selectedNode.x, y: selectedNode.y });
                  }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.78rem' }}
                >
                  <Link2 size={14} />
                  <span>Criar Enlace a partir deste Nó</span>
                </button>
              </div>
              <NodePropertiesPanel
                node={selectedNode}
                zabbixHosts={zabbixHosts}
                onChange={(updatedNode) => {
                  setNodesList((prev) =>
                    prev.map((n) => (n._uid === updatedNode._uid ? updatedNode : n))
                  );
                }}
                onDelete={(nd) => {
                  pushUndo();
                  setNodesList((prev) => prev.filter((n) => n._uid !== nd._uid));
                  setLinksList((prev) =>
                    prev.filter((l) => l.node_a_uid !== nd._uid && l.node_b_uid !== nd._uid)
                  );
                  setSelection({ type: 'map' });
                }}
              />
            </>
          ) : selectedLink ? (
            <LinkPropertiesPanel
              link={selectedLink}
              nodeA={nodesList.find((n) => n._uid === selectedLink.node_a_uid)}
              nodeB={nodesList.find((n) => n._uid === selectedLink.node_b_uid)}
              zabbixHosts={zabbixHosts}
              onChange={(updatedLink) => {
                setLinksList((prev) =>
                  prev.map((l) => (l._uid === updatedLink._uid ? updatedLink : l))
                );
              }}
              onDelete={(lnk) => {
                pushUndo();
                setLinksList((prev) => prev.filter((l) => l._uid !== lnk._uid));
                setSelection({ type: 'map' });
              }}
            />
          ) : selection.type === 'list' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <List size={16} color="#38bdf8" />
                <span>Elementos do Mapa</span>
              </h4>

              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-muted)' }}>
                  NÓS ({nodesList.length})
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {nodesList.map((n) => (
                    <button
                      key={n._uid}
                      type="button"
                      className="btn-secondary"
                      onClick={() => setSelection({ type: 'node', uid: n._uid })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        fontSize: '0.76rem',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{n.label}</span>
                      <span style={{ fontSize: '0.68rem', color: n.asset_id ? '#22c55e' : 'var(--text-muted)' }}>
                        {n.asset_id ? '● Asset' : n.icon}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-muted)' }}>
                  ENLACES ({linksList.length})
                </div>
                <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {linksList.map((l) => {
                    const na = nodesByUid[l.node_a_uid];
                    const nb = nodesByUid[l.node_b_uid];
                    const hasIt = Boolean(l.itemid_in || l.itemid_out);
                    return (
                      <button
                        key={l._uid}
                        type="button"
                        className="btn-secondary"
                        onClick={() => setSelection({ type: 'link', uid: l._uid })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {na?.label || '?'} ↔ {nb?.label || '?'}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: hasIt ? '#38bdf8' : '#ef4444', marginLeft: '6px' }}>
                          {hasIt ? 'Zabbix' : 'Sem Item'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Settings size={16} color="#38bdf8" />
                <span>Configurações do Mapa</span>
              </h4>

              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  fontSize: '0.74rem',
                  lineHeight: 1.4,
                }}
              >
                <strong>Dica rápida:</strong> Clique em qualquer <strong>nó</strong> ou <strong>enlace</strong> no mapa ao lado (ou no botão <strong>Lista</strong> acima) para editar suas propriedades, escolher a interface do Zabbix ou arrastar sua posição.
              </div>

              <div>
                <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Nome do Mapa
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={mapMeta.name}
                  onChange={(e) => setMapMeta((p) => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Grupo / Cliente (ISP)
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={mapMeta.client_group}
                  onChange={(e) => setMapMeta((p) => ({ ...p, client_group: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Largura (px)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={mapMeta.width}
                    onChange={(e) => setMapMeta((p) => ({ ...p, width: Number(e.target.value) || 1500 }))}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Altura (px)
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={mapMeta.height}
                    onChange={(e) => setMapMeta((p) => ({ ...p, height: Number(e.target.value) || 1000 }))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Tema da Imagem Pública (PNG)
                </label>
                <select
                  className="form-input"
                  value={mapMeta.theme}
                  onChange={(e) => setMapMeta((p) => ({ ...p, theme: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  <option value="light">Claro (Fundo Branco)</option>
                  <option value="dark">Escuro (Fundo Slate NOC)</option>
                </select>
              </div>

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
                <span style={{ fontSize: '0.76rem', fontWeight: 700 }}>
                  Compatibilidade de Virada (URL Legada)
                </span>
                <div>
                  <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                    Nome legado (ex: atm → /atm.png)
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={mapMeta.legacy_name}
                    onChange={(e) => setMapMeta((p) => ({ ...p, legacy_name: e.target.value }))}
                    style={{ width: '100%', fontSize: '0.76rem' }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.76rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={mapMeta.legacy_enabled}
                    onChange={(e) => setMapMeta((p) => ({ ...p, legacy_enabled: e.target.checked }))}
                  />
                  <span>Publicar também em /{mapMeta.legacy_name || '<legado>'}.png</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
