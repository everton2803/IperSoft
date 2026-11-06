import json
import math
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape, quoteattr
from zoneinfo import ZoneInfo

from app.models.weathermap import WeathermapMap, WeathermapNode, WeathermapLink
from app.weathermap.collector import LinkState
from app.weathermap.scale import DEFAULT_SCALE, color_for, fmt_bps, width_for_capacity

TZ_SP = ZoneInfo("America/Sao_Paulo")

SEVERITY_COLORS: Dict[int, str] = {
    1: "#7499ff",  # Information
    2: "#ffc859",  # Warning
    3: "#ffa059",  # Average
    4: "#e97659",  # High
    5: "#e45959",  # Disaster
}


def _resolve_offset(offset_str: Optional[str], base_radius: float = 25.0) -> Tuple[float, float]:
    """
    Converte offset estilo PHP Weathermap (ex: 'N40', 's80', 'w40', 'e50', 'n200')
    em deslocamento (dx, dy) em pixels. No PHP Weathermap o número é percentual do raio do ícone.
    """
    if not offset_str:
        return 0.0, 0.0
    s = str(offset_str).strip().upper()
    if s.startswith(":"):
        s = s[1:]
    m = re.fullmatch(r"(NE|SE|NW|SW|N|S|E|W|C)(\d+)?", s)
    if not m:
        return 0.0, 0.0
    direction = m.group(1)
    pct = float(m.group(2)) if m.group(2) is not None else 100.0
    dist = base_radius * (pct / 100.0)

    dx, dy = 0.0, 0.0
    if "N" in direction:
        dy -= dist
    if "S" in direction:
        dy += dist
    if "E" in direction:
        dx += dist
    if "W" in direction:
        dx -= dist
    return dx, dy


def _catmull_rom_svg_path(points: List[Tuple[float, float]]) -> str:
    """Gera um path SVG suave (Cubic Bézier) passando pela lista de pontos."""
    if not points:
        return ""
    if len(points) == 1:
        x, y = points[0]
        return f"M {x:.1f} {y:.1f}"
    if len(points) == 2:
        (x0, y0), (x1, y1) = points
        return f"M {x0:.1f} {y0:.1f} L {x1:.1f} {y1:.1f}"

    d = [f"M {points[0][0]:.1f} {points[0][1]:.1f}"]
    n = len(points)
    for i in range(n - 1):
        p0 = points[max(0, i - 1)]
        p1 = points[i]
        p2 = points[i + 1]
        p3 = points[min(n - 1, i + 2)]

        c1x = p1[0] + (p2[0] - p0[0]) / 6.0
        c1y = p1[1] + (p2[1] - p0[1]) / 6.0
        c2x = p2[0] - (p3[0] - p1[0]) / 6.0
        c2y = p2[1] - (p3[1] - p1[1]) / 6.0
        d.append(f"C {c1x:.1f} {c1y:.1f}, {c2x:.1f} {c2y:.1f}, {p2[0]:.1f} {p2[1]:.1f}")
    return " ".join(d)


def _polyline_midpoint_and_angle(
    points: List[Tuple[float, float]],
    pos_pct: float = 50.0,
) -> Tuple[float, float, float]:
    """Calcula o ponto (mx, my) na posição pos_pct (10..90%) ao longo da polilinha e o ângulo (graus) de A->B."""
    if not points:
        return 0.0, 0.0, 0.0
    if len(points) == 1:
        return points[0][0], points[0][1], 0.0

    segs = []
    total = 0.0
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        length = math.hypot(x1 - x0, y1 - y0)
        segs.append((length, x0, y0, x1, y1))
        total += length

    if total <= 1e-6:
        x0, y0 = points[0]
        return x0, y0, 0.0

    clamped_pct = max(10.0, min(90.0, float(pos_pct if pos_pct is not None else 50.0)))
    target_dist = total * (clamped_pct / 100.0)
    acc = 0.0
    for length, x0, y0, x1, y1 in segs:
        if acc + length >= target_dist and length > 0:
            t = (target_dist - acc) / length
            mx = x0 + (x1 - x0) * t
            my = y0 + (y1 - y0) * t
            ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
            return mx, my, ang
        acc += length

    _, x0, y0, x1, y1 = segs[-1]
    ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0, ang


def _node_icon_svg(icon: str, stroke_color: str) -> str:
    """Retorna os elementos SVG vetoriais (centrados em 0,0) para o ícone do nó."""
    ic = (icon or "router").lower()
    if ic == "cloud":
        return (
            f'<path d="M-9,5 H8 A5,5 0 0 0 9,-5 A7,7 0 0 0 -4,-7 A6,6 0 0 0 -9,5 Z" '
            f'fill="none" stroke="{stroke_color}" stroke-width="1.8" stroke-linejoin="round"/>'
        )
    if ic in ("switch", "switch_l2", "switch_l3"):
        return (
            f'<rect x="-11" y="-6" width="22" height="12" rx="2.5" fill="none" stroke="{stroke_color}" stroke-width="1.8"/>'
            f'<path d="M-7,-2 H5 M2,-4.5 L5,-2 L2,0.5 M7,2 H-5 M-2,-0.5 L-5,2 L-2,4.5" '
            f'fill="none" stroke="{stroke_color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    if ic == "olt":
        return (
            f'<rect x="-11" y="-7" width="22" height="14" rx="2" fill="none" stroke="{stroke_color}" stroke-width="1.8"/>'
            f'<circle cx="-6" cy="0" r="1.6" fill="{stroke_color}"/>'
            f'<circle cx="-1" cy="0" r="1.6" fill="{stroke_color}"/>'
            f'<path d="M4,-3 L9,0 L4,3" fill="none" stroke="{stroke_color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    if ic in ("server", "storage"):
        return (
            f'<rect x="-9" y="-9" width="18" height="7" rx="1.5" fill="none" stroke="{stroke_color}" stroke-width="1.7"/>'
            f'<rect x="-9" y="2" width="18" height="7" rx="1.5" fill="none" stroke="{stroke_color}" stroke-width="1.7"/>'
            f'<circle cx="-5" cy="-5.5" r="1.2" fill="{stroke_color}"/>'
            f'<circle cx="-5" cy="5.5" r="1.2" fill="{stroke_color}"/>'
        )
    if ic == "radio":
        return (
            f'<circle cx="0" cy="0" r="2.2" fill="{stroke_color}"/>'
            f'<path d="M-5,-5 A7,7 0 0 1 5,-5 M-8,-8 A11,11 0 0 1 8,-8 M0,2 V9 M-4,9 H4" '
            f'fill="none" stroke="{stroke_color}" stroke-width="1.6" stroke-linecap="round"/>'
        )
    if ic == "ups":
        return (
            f'<path d="M1,-9 L-6,1 H0 L-1,9 L6,-1 H0 Z" '
            f'fill="none" stroke="{stroke_color}" stroke-width="1.8" stroke-linejoin="round"/>'
        )
    if ic == "pop":
        return (
            f'<path d="M-10,1 L0,-8 L10,1 M-7,-1 V8 H7 V-1" '
            f'fill="none" stroke="{stroke_color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    # Default: router (setas cruzadas internas)
    return (
        f'<circle cx="0" cy="0" r="11" fill="none" stroke="{stroke_color}" stroke-width="1.6"/>'
        f'<path d="M-7,0 H7 M4,-3 L7,0 L4,3 M0,-7 V7 M-3,-4 L0,-7 L3,-4" '
        f'fill="none" stroke="{stroke_color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def render_svg(
    wm_map: WeathermapMap,
    nodes: List[WeathermapNode],
    links: List[WeathermapLink],
    link_states: Optional[Dict[int, LinkState]] = None,
    node_severities: Optional[Dict[int, int]] = None,
    *,
    interactive: bool = False,
    rendered_at: Optional[datetime] = None,
) -> str:
    """
    Função pura que renderiza o mapa Weathermap v2 em SVG vetorial válido.
    Suporta modo estático (para PNG do Grafana) e modo interativo (para o IperSoft).
    """
    link_states = link_states or {}
    node_severities = node_severities or {}
    now_sp = (rendered_at or datetime.now(TZ_SP)).astimezone(TZ_SP)

    width = max(400, int(wm_map.width or 1500))
    height = max(300, int(wm_map.height or 1000))
    is_dark = (wm_map.theme or "light").lower() == "dark"

    bg_color = wm_map.background if (wm_map.background and wm_map.background.startswith("#")) else (
        "#0f172a" if is_dark else "#f8fafc"
    )
    text_primary = "#f1f5f9" if is_dark else "#0f172a"
    text_muted = "#94a3b8" if is_dark else "#475569"
    card_bg = "#1e293b" if is_dark else "#ffffff"
    card_border = "#334155" if is_dark else "#cbd5e1"
    node_fill = "#1e293b" if is_dark else "#ffffff"
    node_stroke = "#38bdf8" if is_dark else "#0284c7"
    link_casing = "#020617" if is_dark else "#334155"

    scale = wm_map.scale if wm_map.scale else DEFAULT_SCALE
    nodes_by_id: Dict[int, WeathermapNode] = {n.id: n for n in nodes}

    out: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" font-family="DejaVu Sans, sans-serif">',
        "<defs>",
        '<filter id="wm-shadow" x="-15%" y="-15%" width="130%" height="130%">',
        '<feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.18"/>',
        "</filter>",
    ]
    if interactive:
        out.append(
            "<style>"
            ".wm-link { cursor: pointer; } "
            ".wm-node { cursor: pointer; } "
            ".wm-flow { stroke-dasharray: 6 10; animation: wm-dash 1.2s linear infinite; pointer-events: none; } "
            "@keyframes wm-dash { to { stroke-dashoffset: -16; } }"
            "</style>"
        )
    out.append("</defs>")

    # Background
    out.append(f'<rect x="0" y="0" width="{width}" height="{height}" fill={quoteattr(bg_color)}/>')

    # Header & Scale Legend Card
    title_str = escape(str(wm_map.name or "Weathermap"))
    ts_str = escape(now_sp.strftime("Atualizado: %d/%m/%Y %H:%M:%S"))
    out.append(
        f'<g id="wm-header">'
        f'<rect x="12" y="10" width="520" height="58" rx="8" fill={quoteattr(card_bg)} '
        f'stroke={quoteattr(card_border)} stroke-width="1"/>'
        f'<text x="24" y="31" font-size="15" font-weight="bold" fill={quoteattr(text_primary)}>{title_str}</text>'
        f'<text x="200" y="31" font-size="11" fill={quoteattr(text_muted)}>{ts_str}</text>'
    )
    # Scale swatches inside header card
    sx = 24
    sy = 40
    sw = 52
    sh = 14
    for idx, entry in enumerate(scale):
        c = str(entry.get("color", "#cccccc"))
        lbl = str(entry.get("label") or f'{int(entry.get("min", 0))}-{int(entry.get("max", 100))}%')
        bx = sx + idx * (sw + 3)
        out.append(
            f'<rect x="{bx}" y="{sy}" width="{sw}" height="{sh}" rx="2" fill={quoteattr(c)} '
            f'stroke={quoteattr(card_border)} stroke-width="0.6"/>'
            f'<text x="{bx + sw / 2:.1f}" y="{sy + 10.5:.1f}" font-size="8.5" font-weight="bold" '
            f'text-anchor="middle" fill="#0f172a">{escape(lbl)}</text>'
        )
    out.append("</g>")

    # Agrupar links paralelos entre o mesmo par de nós (sem via_points e sem offset explícito)
    pair_groups: Dict[Tuple[int, int], List[int]] = {}
    for lnk in links:
        key_pair = (min(lnk.node_a_id, lnk.node_b_id), max(lnk.node_a_id, lnk.node_b_id))
        if not lnk.via_points and not lnk.offset_a and not lnk.offset_b:
            pair_groups.setdefault(key_pair, []).append(lnk.id)

    link_paths_svg: List[str] = []
    link_labels_svg: List[str] = []

    for lnk in links:
        na = nodes_by_id.get(lnk.node_a_id)
        nb = nodes_by_id.get(lnk.node_b_id)
        if not na or not nb:
            continue

        dxa, dya = _resolve_offset(lnk.offset_a)
        dxb, dyb = _resolve_offset(lnk.offset_b)
        ax, ay = float(na.x) + dxa, float(na.y) + dya
        bx, by = float(nb.x) + dxb, float(nb.y) + dyb

        pts: List[Tuple[float, float]] = [(ax, ay)]
        if lnk.via_points:
            for vp in lnk.via_points:
                if isinstance(vp, (list, tuple)) and len(vp) >= 2:
                    pts.append((float(vp[0]), float(vp[1])))
        else:
            key_pair = (min(lnk.node_a_id, lnk.node_b_id), max(lnk.node_a_id, lnk.node_b_id))
            siblings = pair_groups.get(key_pair, [])
            if len(siblings) > 1 and lnk.id in siblings:
                idx = siblings.index(lnk.id)
                shift = (idx - (len(siblings) - 1) / 2.0) * 26.0
                vx, vy = bx - ax, by - ay
                dist = math.hypot(vx, vy) or 1.0
                nx, ny = -vy / dist, vx / dist
                pts.append(((ax + bx) / 2.0 + nx * shift, (ay + by) / 2.0 + ny * shift))
        pts.append((bx, by))

        path_d = _catmull_rom_svg_path(pts)
        label_pos_pct = getattr(lnk, "label_pos_pct", 50)
        mx, my, ang = _polyline_midpoint_and_angle(pts, pos_pct=label_pos_pct if label_pos_pct is not None else 50)

        st = link_states.get(lnk.id)
        in_bps = st.in_bps if st else None
        out_bps = st.out_bps if st else None
        pct = st.pct if st else None
        status = st.status if st else "no_data"

        stroke_w = width_for_capacity(lnk.capacity_bps, lnk.width)
        if status == "down":
            stroke_col = "#dc2626"
            dash_attr = ' stroke-dasharray="6 4"'
            opacity_attr = ""
            pill_text = "DOWN"
        elif status == "no_data" or pct is None:
            stroke_col = "#9ca3af"
            dash_attr = ' stroke-dasharray="7 5"'
            opacity_attr = ""
            pill_text = f"↑ {fmt_bps(out_bps)}  ↓ {fmt_bps(in_bps)}"
        else:
            stroke_col = color_for(pct, scale)
            dash_attr = ""
            opacity_attr = ' opacity="0.45"' if status == "stale" else ""
            pill_text = f"↑ {fmt_bps(out_bps)}  ↓ {fmt_bps(in_bps)} · {pct:.0f}%"

        # Direção dominante para a seta (A->B se out >= in, senão B->A)
        dominant_ab = (out_bps or 0.0) >= (in_bps or 0.0)
        arrow_ang = ang if dominant_ab else (ang + 180.0)

        g_attrs = f'id="link-{lnk.id}"'
        if interactive:
            g_attrs += (
                f' class="wm-link"'
                f' data-link-id="{lnk.id}"'
                f' data-in="{in_bps if in_bps is not None else ""}"'
                f' data-out="{out_bps if out_bps is not None else ""}"'
                f' data-pct="{f"{pct:.2f}" if pct is not None else ""}"'
                f' data-status={quoteattr(status)}'
                f' data-capacity="{lnk.capacity_bps}"'
                f' data-label={quoteattr(str(lnk.label or f"{na.label} - {nb.label}"))}'
            )

        flow_overlay = ""
        if interactive and status == "ok":
            flow_pts = pts if dominant_ab else list(reversed(pts))
            flow_d = _catmull_rom_svg_path(flow_pts)
            flow_overlay = (
                f'<path class="wm-flow" d="{flow_d}" fill="none" stroke="#ffffff" '
                f'stroke-width="2" stroke-opacity="0.75" stroke-linecap="round"/>'
            )

        # Seta discreta na direção dominante (deslocada ao longo do link para não ficar sob a pílula)
        rad = math.radians(ang)
        arrow_dist = 28.0
        ax_pos = mx + math.cos(rad) * (arrow_dist if dominant_ab else -arrow_dist)
        ay_pos = my + math.sin(rad) * (arrow_dist if dominant_ab else -arrow_dist)
        arrow_svg = (
            f'<g transform="translate({ax_pos:.1f},{ay_pos:.1f}) rotate({arrow_ang:.1f})">'
            f'<polygon points="-5,-4.5 6,0 -5,4.5" fill={quoteattr(stroke_col)} '
            f'stroke={quoteattr(link_casing)} stroke-width="0.8"/>'
            f"</g>"
        )

        link_paths_svg.append(
            f"<g {g_attrs}{opacity_attr}>"
            f'<path d="{path_d}" fill="none" stroke={quoteattr(link_casing)} '
            f'stroke-width="{stroke_w + 2.0:.1f}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.35"/>'
            f'<path d="{path_d}" fill="none" stroke={quoteattr(stroke_col)} '
            f'stroke-width="{stroke_w:.1f}" stroke-linecap="round" stroke-linejoin="round"{dash_attr}/>'
            f"{flow_overlay}"
            f"{arrow_svg}"
            f"</g>"
        )

        # Pílula de rótulo do link
        pw = max(84.0, len(pill_text) * 6.1 + 14.0)
        ph = 18.0
        link_labels_svg.append(
            f'<g transform="translate({mx:.1f},{my:.1f})" pointer-events="none">'
            f'<rect x="{-pw / 2:.1f}" y="{-ph / 2:.1f}" width="{pw:.1f}" height="{ph:.1f}" rx="9" '
            f'fill={quoteattr(card_bg)} fill-opacity="0.92" stroke={quoteattr(stroke_col)} stroke-width="1.4"/>'
            f'<text x="0" y="3.5" font-size="9.5" font-weight="bold" text-anchor="middle" '
            f'fill={quoteattr(text_primary)}>{escape(pill_text)}</text>'
            f"</g>"
        )

    out.append('<g id="wm-links">')
    out.extend(link_paths_svg)
    out.append("</g>")

    out.append('<g id="wm-link-labels">')
    out.extend(link_labels_svg)
    out.append("</g>")

    # Nodes & Node Labels
    out.append('<g id="wm-nodes">')
    for nd in nodes:
        nx, ny = float(nd.x), float(nd.y)
        sev = int(node_severities.get(nd.id, 0) or 0)
        sev_col = SEVERITY_COLORS.get(sev)

        n_attrs = f'id="node-{nd.id}" transform="translate({nx:.1f},{ny:.1f})"'
        if interactive:
            n_attrs += (
                f' class="wm-node"'
                f' data-node-id="{nd.id}"'
                f' data-asset-id="{nd.asset_id or ""}"'
                f' data-severity="{sev}"'
                f' data-label={quoteattr(str(nd.label))}'
            )

        ring_svg = ""
        active_stroke = node_stroke
        if sev_col:
            active_stroke = sev_col
            ring_svg = (
                f'<circle cx="0" cy="0" r="24" fill="none" stroke={quoteattr(sev_col)} '
                f'stroke-width="2.5" stroke-opacity="0.85"/>'
            )

        # Posição do label conforme N|S|E|W
        lpos = (nd.label_pos or "S").upper()
        lx, ly, anchor = 0.0, 32.0, "middle"
        if lpos.startswith("N"):
            lx, ly, anchor = 0.0, -26.0, "middle"
        elif lpos.startswith("E"):
            lx, ly, anchor = 26.0, 4.0, "start"
        elif lpos.startswith("W"):
            lx, ly, anchor = -26.0, 4.0, "end"

        lbl_esc = escape(str(nd.label or nd.key))
        lw = max(44.0, len(str(nd.label or nd.key)) * 6.4 + 12.0)
        lh = 17.0
        if anchor == "middle":
            rx_box = -lw / 2.0
        elif anchor == "start":
            rx_box = lx - 6.0
        else:
            rx_box = lx - lw + 6.0

        icon_inner = _node_icon_svg(nd.icon, active_stroke)
        out.append(
            f"<g {n_attrs}>"
            f"{ring_svg}"
            f'<circle cx="0" cy="0" r="19" fill={quoteattr(node_fill)} '
            f'stroke={quoteattr(active_stroke)} stroke-width="2" filter="url(#wm-shadow)"/>'
            f"{icon_inner}"
            f'<rect x="{rx_box:.1f}" y="{ly - 12.0:.1f}" width="{lw:.1f}" height="{lh:.1f}" rx="4" '
            f'fill={quoteattr(card_bg)} fill-opacity="0.9" stroke={quoteattr(card_border)} stroke-width="0.8"/>'
            f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="10" font-weight="bold" '
            f'text-anchor={quoteattr(anchor)} fill={quoteattr(text_primary)}>{lbl_esc}</text>'
            f"</g>"
        )
    out.append("</g>")
    out.append("</svg>")
    return "\n".join(out)


def render_interactive_html(
    wm_map: WeathermapMap,
    interactive_svg_str: str,
    link_histories: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Gera uma página HTML5 interativa e autocontida (para embed via <iframe> no Grafana ou uso direto em TV/NOC),
    contendo o SVG vetorial interativo, zoom/pan, auto-refresh transparente a cada 60s e tooltip opaco com
    gráfico de 24h (48 amostras de 30 em 30 min) embutido sem expor o backend do IperSoft.
    """
    is_dark = (wm_map.theme or "light").lower() == "dark"
    bg_color = wm_map.background if (wm_map.background and wm_map.background.startswith("#")) else (
        "#090d16" if is_dark else "#f1f5f9"
    )
    title_esc = escape(str(wm_map.name or "Weathermap"))
    hist_json = json.dumps(link_histories or {}, separators=(",", ":")).replace("</", "<\\/")

    # Ajustar tag <svg> raiz para ser 100% responsiva dentro do palco
    responsive_svg = re.sub(
        r'<svg([^>]*?)\s+width="\d+"\s+height="\d+"',
        r'<svg\1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet"',
        interactive_svg_str,
        count=1,
    )

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{title_esc} — Weathermap</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: {bg_color};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
    user-select: none;
  }}
  #wm-viewport {{
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  #wm-viewport.panning {{ cursor: grabbing; }}
  #wm-stage {{
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    transform-origin: center center;
    transition: transform 0.06s ease-out;
  }}
  #wm-viewport.panning #wm-stage {{ transition: none; }}
  #wm-controls {{
    position: fixed;
    top: 12px;
    right: 12px;
    display: flex;
    gap: 6px;
    z-index: 100;
    opacity: 0.78;
    transition: opacity 0.2s;
  }}
  #wm-controls:hover {{ opacity: 1; }}
  .wm-btn {{
    background: {"rgba(15, 23, 42, 0.92)" if is_dark else "rgba(255, 255, 255, 0.94)"};
    color: {"#f8fafc" if is_dark else "#0f172a"};
    border: 1px solid {"#334155" if is_dark else "#cbd5e1"};
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }}
  .wm-btn:hover {{ border-color: #38bdf8; }}
  #wm-tooltip {{
    position: fixed;
    display: none;
    width: 336px;
    background: {"rgba(15, 23, 42, 0.97)" if is_dark else "rgba(255, 255, 255, 0.98)"};
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid {"#334155" if is_dark else "#cbd5e1"};
    border-radius: 10px;
    padding: 12px;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
    color: {"#f8fafc" if is_dark else "#0f172a"};
    pointer-events: none;
    z-index: 9999;
  }}
</style>
</head>
<body>
<div id="wm-controls">
  <button class="wm-btn" id="btn-zoom-in" title="Aumentar Zoom">+</button>
  <button class="wm-btn" id="btn-zoom-out" title="Reduzir Zoom">−</button>
  <button class="wm-btn" id="btn-reset" title="Resetar Zoom">100%</button>
</div>
<div id="wm-viewport">
  <div id="wm-stage">{responsive_svg}</div>
</div>
<div id="wm-tooltip"></div>
<script id="wm-history-data" type="application/json">{hist_json}</script>
<script>
(function() {{
  var IS_DARK = {"true" if is_dark else "false"};
  var historyData = {{}};
  try {{
    historyData = JSON.parse(document.getElementById('wm-history-data').textContent || '{{}}');
  }} catch (e) {{}}

  var scale = 1;
  var panX = 0, panY = 0;
  var isPanning = false;
  var startX = 0, startY = 0;
  var viewport = document.getElementById('wm-viewport');
  var stage = document.getElementById('wm-stage');
  var tooltip = document.getElementById('wm-tooltip');

  function applyTransform() {{
    stage.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')';
  }}

  document.getElementById('btn-zoom-in').onclick = function() {{
    scale = Math.min(4, +(scale * 1.2).toFixed(2));
    applyTransform();
  }};
  document.getElementById('btn-zoom-out').onclick = function() {{
    scale = Math.max(0.25, +(scale / 1.2).toFixed(2));
    applyTransform();
  }};
  document.getElementById('btn-reset').onclick = function() {{
    scale = 1; panX = 0; panY = 0;
    applyTransform();
  }};

  viewport.addEventListener('wheel', function(e) {{
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.12 : 0.89;
    scale = Math.min(4, Math.max(0.25, +(scale * factor).toFixed(3)));
    applyTransform();
  }}, {{ passive: false }});

  viewport.addEventListener('mousedown', function(e) {{
    if (e.button !== 0) return;
    isPanning = true;
    viewport.classList.add('panning');
    startX = e.clientX - panX;
    startY = e.clientY - panY;
  }});

  window.addEventListener('mouseup', function() {{
    isPanning = false;
    viewport.classList.remove('panning');
  }});

  function fmtBps(bps) {{
    if (bps === null || bps === undefined || bps === '') return '-';
    var num = Number(bps);
    if (isNaN(num) || num <= 0) return '0 bps';
    var units = [[1e12,'Tbps'],[1e9,'Gbps'],[1e6,'Mbps'],[1e3,'Kbps']];
    for (var i = 0; i < units.length; i++) {{
      if (num >= units[i][0]) {{
        var v = num / units[i][0];
        return (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i][1];
      }}
    }}
    return Math.round(num) + ' bps';
  }}

  function escHtml(s) {{
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }}

  function renderChartSvg(hist) {{
    var pts = (hist && hist.points) ? hist.points : [];
    if (!pts.length) {{
      return '<div style="font-size:11.5px;color:' + (IS_DARK ? '#94a3b8' : '#64748b') + ';padding:8px 0;">Sem amostras históricas nas últimas 24h.</div>';
    }}
    var w = 310, h = 94, padX = 6, padTop = 8, padBottom = 18;
    var innerW = w - padX * 2, innerH = h - padTop - padBottom;
    var baseY = padTop + innerH;
    var maxVal = 1;
    for (var i = 0; i < pts.length; i++) {{
      if (pts[i].in_bps && pts[i].in_bps > maxVal) maxVal = pts[i].in_bps;
      if (pts[i].out_bps && pts[i].out_bps > maxVal) maxVal = pts[i].out_bps;
    }}
    var n = pts.length;
    var stepX = n > 1 ? innerW / (n - 1) : innerW;
    var barW = Math.max(2.5, Math.min(5, innerW / Math.max(1, n) - 1.2));
    var outPts = [], inPts = [], barsSvg = '';

    for (var j = 0; j < n; j++) {{
      var cx = padX + j * stepX;
      var vOut = Math.max(0, Number(pts[j].out_bps || 0));
      var vIn = Math.max(0, Number(pts[j].in_bps || 0));
      var hOut = (vOut / maxVal) * innerH;
      var hIn = (vIn / maxVal) * innerH;
      if (hOut > 0.5) {{
        barsSvg += '<rect x="' + (cx - barW/2).toFixed(1) + '" y="' + (baseY - hOut).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + hOut.toFixed(1) + '" fill="rgba(56,189,248,0.25)" rx="1"/>';
      }}
      if (hIn > 0.5) {{
        barsSvg += '<rect x="' + (cx - barW/2).toFixed(1) + '" y="' + (baseY - hIn).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + hIn.toFixed(1) + '" fill="rgba(34,197,94,0.22)" rx="1"/>';
      }}
      outPts.push(cx.toFixed(1) + ',' + (baseY - hOut).toFixed(1));
      inPts.push(cx.toFixed(1) + ',' + (baseY - hIn).toFixed(1));
    }}

    var gridSvg = '';
    [0.25, 0.5, 0.75].forEach(function(r) {{
      var gy = (padTop + innerH * r).toFixed(1);
      gridSvg += '<line x1="' + padX + '" y1="' + gy + '" x2="' + (padX + innerW) + '" y2="' + gy + '" stroke="' + (IS_DARK ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)') + '" stroke-dasharray="3 3" stroke-width="1"/>';
    }});

    var ticks = [['-24h',0,'start'],['-18h',0.25,'middle'],['-12h',0.5,'middle'],['-6h',0.75,'middle'],['Agora',1,'end']];
    var ticksSvg = '';
    for (var k = 0; k < ticks.length; k++) {{
      var tx = (padX + ticks[k][1] * innerW).toFixed(1);
      ticksSvg += '<text x="' + tx + '" y="' + (h - 4) + '" font-size="8.5" text-anchor="' + ticks[k][2] + '" fill="' + (IS_DARK ? '#94a3b8' : '#64748b') + '">' + ticks[k][0] + '</text>';
    }}

    var st = hist.stats || {{}};
    var peak = Math.max(st.peak_in_bps || 0, st.peak_out_bps || 0);
    return (
      '<div style="margin-top:10px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:' + (IS_DARK ? '#cbd5e1' : '#475569') + ';margin-bottom:5px;font-weight:600;">' +
      '<span>Últimas 24h (' + n + ' amostras · 30/30m)</span>' +
      '<span>Pico: ' + fmtBps(peak) + '</span>' +
      '</div>' +
      '<svg width="' + w + '" height="' + h + '" style="background:' + (IS_DARK ? '#090d16' : '#f1f5f9') + ';border-radius:6px;border:1px solid ' + (IS_DARK ? '#334155' : '#cbd5e1') + ';display:block;">' +
      gridSvg + barsSvg +
      '<polyline fill="none" stroke="#38bdf8" stroke-width="1.8" points="' + outPts.join(' ') + '"/>' +
      '<polyline fill="none" stroke="#22c55e" stroke-width="1.8" points="' + inPts.join(' ') + '"/>' +
      ticksSvg +
      '</svg>' +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:5px;">' +
      '<span style="color:#38bdf8;font-weight:700;">↑ P95 Out: ' + fmtBps(st.p95_out_bps) + '</span>' +
      '<span style="color:#22c55e;font-weight:700;">↓ P95 In: ' + fmtBps(st.p95_in_bps) + '</span>' +
      '</div></div>'
    );
  }}

  viewport.addEventListener('mousemove', function(e) {{
    if (isPanning) {{
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
      return;
    }}
    var linkEl = e.target.closest ? e.target.closest('.wm-link') : null;
    if (!linkEl) {{
      tooltip.style.display = 'none';
      return;
    }}
    var lid = linkEl.getAttribute('data-link-id');
    var label = linkEl.getAttribute('data-label') || ('Link #' + lid);
    var inBps = linkEl.getAttribute('data-in');
    var outBps = linkEl.getAttribute('data-out');
    var pct = linkEl.getAttribute('data-pct');
    var status = linkEl.getAttribute('data-status') || 'ok';
    var cap = linkEl.getAttribute('data-capacity');
    var hist = historyData[String(lid)];

    var badgeText = (pct !== null && pct !== '') ? (Number(pct).toFixed(1) + '%') : status.toUpperCase();
    var badgeOk = status === 'ok';
    var mutedCol = IS_DARK ? '#94a3b8' : '#64748b';

    tooltip.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
      '<strong style="font-size:13.5px;">' + escHtml(label) + '</strong>' +
      '<span style="font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;background:' + (badgeOk ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)') + ';color:' + (badgeOk ? '#22c55e' : '#ef4444') + ';">' + escHtml(badgeText) + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:12px;">' +
      '<div><div style="color:' + mutedCol + ';font-size:10.5px;">↑ Out (A→B)</div><div style="font-weight:700;color:#38bdf8;">' + fmtBps(outBps) + '</div></div>' +
      '<div><div style="color:' + mutedCol + ';font-size:10.5px;">↓ In (B→A)</div><div style="font-weight:700;color:#22c55e;">' + fmtBps(inBps) + '</div></div>' +
      '<div><div style="color:' + mutedCol + ';font-size:10.5px;">Capacidade</div><div style="font-weight:600;">' + fmtBps(cap) + '</div></div>' +
      '</div>' +
      renderChartSvg(hist);

    tooltip.style.display = 'block';
    tooltip.style.left = Math.min(window.innerWidth - 350, e.clientX + 16) + 'px';
    tooltip.style.top = Math.min(window.innerHeight - 250, e.clientY + 16) + 'px';
  }});

  viewport.addEventListener('mouseleave', function() {{
    tooltip.style.display = 'none';
  }});

  // Auto-refresh em segundo plano a cada 60s sem piscar a página
  setInterval(function() {{
    fetch(window.location.href, {{ cache: 'no-store' }})
      .then(function(r) {{ return r.ok ? r.text() : null; }})
      .then(function(html) {{
        if (!html) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var newStage = doc.getElementById('wm-stage');
        var newHist = doc.getElementById('wm-history-data');
        if (newStage) stage.innerHTML = newStage.innerHTML;
        if (newHist) {{
          try {{ historyData = JSON.parse(newHist.textContent || '{{}}'); }} catch (e) {{}}
        }}
      }})
      .catch(function() {{}});
  }}, 60000);
}})();
</script>
</body>
</html>"""
