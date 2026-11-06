import json
import os
import logging
from typing import Iterable
from app.models.weathermap import WeathermapMap

logger = logging.getLogger(__name__)


def _atomic_write_bytes(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp.{os.getpid()}"
    with open(tmp_path, "wb") as f:
        f.write(data)
    os.replace(tmp_path, path)


def publish_map_render(
    render_dir: str,
    wm_map: WeathermapMap,
    svg_str: str,
    png_bytes: bytes,
    html_str: str | None = None,
) -> None:
    """Grava atomicamente o SVG, PNG e HTML por token e, se legacy_enabled, também em /legacy/<name>.(png|html)."""
    m_dir = os.path.join(render_dir, "m")
    legacy_dir = os.path.join(render_dir, "legacy")
    os.makedirs(m_dir, exist_ok=True)
    os.makedirs(legacy_dir, exist_ok=True)

    token = wm_map.public_token
    _atomic_write_bytes(os.path.join(m_dir, f"{token}.svg"), svg_str.encode("utf-8"))
    _atomic_write_bytes(os.path.join(m_dir, f"{token}.png"), png_bytes)
    if html_str is not None:
        _atomic_write_bytes(os.path.join(m_dir, f"{token}.html"), html_str.encode("utf-8"))

    if wm_map.legacy_enabled and wm_map.legacy_name:
        _atomic_write_bytes(os.path.join(legacy_dir, f"{wm_map.legacy_name}.png"), png_bytes)
        if html_str is not None:
            _atomic_write_bytes(os.path.join(legacy_dir, f"{wm_map.legacy_name}.html"), html_str.encode("utf-8"))


def reconcile_render_dir(render_dir: str, active_maps: Iterable[WeathermapMap]) -> None:
    """Remove do volume arquivos órfãos (tokens rotacionados, mapas desativados ou legacy desabilitado)."""
    m_dir = os.path.join(render_dir, "m")
    legacy_dir = os.path.join(render_dir, "legacy")
    os.makedirs(m_dir, exist_ok=True)
    os.makedirs(legacy_dir, exist_ok=True)

    expected_m = set()
    expected_legacy = set()
    for m in active_maps:
        if not m.is_active:
            continue
        expected_m.add(f"{m.public_token}.png")
        expected_m.add(f"{m.public_token}.svg")
        expected_m.add(f"{m.public_token}.html")
        if m.legacy_enabled and m.legacy_name:
            expected_legacy.add(f"{m.legacy_name}.png")
            expected_legacy.add(f"{m.legacy_name}.html")

    for fname in os.listdir(m_dir):
        if fname.endswith(".tmp") or ".tmp." in fname:
            continue
        if fname not in expected_m:
            try:
                os.remove(os.path.join(m_dir, fname))
                logger.info("Arquivo órfão removido de /m/: %s", fname)
            except OSError:
                pass

    for fname in os.listdir(legacy_dir):
        if fname.endswith(".tmp") or ".tmp." in fname:
            continue
        if fname not in expected_legacy:
            try:
                os.remove(os.path.join(legacy_dir, fname))
                logger.info("Arquivo órfão removido de /legacy/: %s", fname)
            except OSError:
                pass


def write_health_file(
    render_dir: str,
    last_cycle_iso: str,
    maps_ok: int,
    maps_error: int,
) -> None:
    payload = {
        "status": "ok" if maps_error == 0 else "degraded",
        "last_cycle": last_cycle_iso,
        "maps_ok": maps_ok,
        "maps_error": maps_error,
    }
    _atomic_write_bytes(
        os.path.join(render_dir, "_health.json"),
        json.dumps(payload, indent=2).encode("utf-8"),
    )
