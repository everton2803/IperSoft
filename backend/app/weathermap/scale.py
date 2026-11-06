import re
from typing import Optional, List, Dict, Any

DEFAULT_SCALE: List[Dict[str, Any]] = [
    {"min": 0.0, "max": 0.0, "color": "#c0c0c0", "label": "0%"},
    {"min": 0.0, "max": 1.0, "color": "#94a3b8", "label": "0-1%"},
    {"min": 1.0, "max": 10.0, "color": "#8c00ff", "label": "1-10%"},
    {"min": 10.0, "max": 25.0, "color": "#2020ff", "label": "10-25%"},
    {"min": 25.0, "max": 40.0, "color": "#00c0ff", "label": "25-40%"},
    {"min": 40.0, "max": 55.0, "color": "#00d64f", "label": "40-55%"},
    {"min": 55.0, "max": 70.0, "color": "#eab308", "label": "55-70%"},
    {"min": 70.0, "max": 85.0, "color": "#ff9f0a", "label": "70-85%"},
    {"min": 85.0, "max": 100.0, "color": "#ef4444", "label": "85-100%"},
]


def color_for(pct: Optional[float], scale: Optional[List[Dict[str, Any]]] = None) -> str:
    """Retorna a cor hexadecimal correspondente ao percentual de utilização (0..100+)."""
    if pct is None:
        return "#9ca3af"
    active_scale = scale if scale else DEFAULT_SCALE
    clamped = max(0.0, min(100.0, float(pct)))

    if clamped == 0.0:
        for entry in active_scale:
            if float(entry.get("min", 0)) == 0.0 and float(entry.get("max", 0)) == 0.0:
                return entry.get("color", "#c0c0c0")

    for entry in active_scale:
        low = float(entry.get("min", 0))
        high = float(entry.get("max", 100))
        if low == 0.0 and high == 0.0:
            continue
        if low <= clamped <= high:
            return entry.get("color", "#3b82f6")

    return active_scale[-1].get("color", "#ef4444")


def fmt_bps(bps: Optional[float]) -> str:
    """Formata bits/s em string compacta (ex: 830M, 1.4G, 450K, 0)."""
    if bps is None:
        return "-"
    val = float(bps)
    if val <= 0:
        return "0"
    units = [
        (1_000_000_000_000.0, "T"),
        (1_000_000_000.0, "G"),
        (1_000_000.0, "M"),
        (1_000.0, "K"),
    ]
    for factor, suffix in units:
        if val >= factor:
            scaled = val / factor
            if scaled >= 100 or abs(scaled - round(scaled)) < 0.05:
                return f"{int(round(scaled))}{suffix}"
            return f"{scaled:.1f}{suffix}"
    return f"{int(round(val))}"


def parse_bandwidth(val: Any, default_bps: int = 10_000_000_000) -> int:
    """Converte strings como '1000M', '10000M', '10G', '100M' em bits/s inteiro."""
    if val is None:
        return default_bps
    if isinstance(val, (int, float)):
        return int(val) if val > 0 else default_bps
    s = str(val).strip().upper()
    if not s:
        return default_bps
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([KMGT])?B?(?:PS)?", s)
    if not m:
        return default_bps
    num = float(m.group(1))
    unit = m.group(2) or ""
    mult = {
        "": 1,
        "K": 1_000,
        "M": 1_000_000,
        "G": 1_000_000_000,
        "T": 1_000_000_000_000,
    }[unit]
    res = int(num * mult)
    return res if res > 0 else default_bps


def width_for_capacity(capacity_bps: int, explicit_width: Optional[int] = None) -> float:
    """Determina a espessura do enlace em px conforme a capacidade."""
    if explicit_width and explicit_width > 0:
        return float(explicit_width)
    cap = int(capacity_bps or 0)
    if cap <= 100_000_000:
        return 3.0
    if cap <= 1_000_000_000:
        return 5.0
    if cap <= 10_000_000_000:
        return 7.5
    if cap <= 40_000_000_000:
        return 9.5
    return 11.5
