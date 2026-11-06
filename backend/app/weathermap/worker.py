import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine, Base
from app.models.weathermap import WeathermapMap, WeathermapLink, WeathermapSample
from app.weathermap.collector import collect_weathermap_state, LinkState
from app.weathermap.publisher import publish_map_render, reconcile_render_dir, write_health_file
from app.weathermap.raster import svg_to_png
from app.weathermap.renderer import render_svg, render_interactive_html

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("weathermap.worker")

DEFAULT_RENDER_DIR = os.environ.get("WM_RENDER_DIR", "/renders")
DEFAULT_INTERVAL = int(os.environ.get("WM_INTERVAL_SECONDS", "300"))
RETENTION_DAYS = 30


def _percentile(sorted_vals: List[float], p: float) -> Optional[float]:
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, max(0, int(round((p / 100.0) * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


def build_map_histories_48(db: Session, links: List[WeathermapLink]) -> Dict[str, Any]:
    """
    Constrói o histórico de 24h (48 amostras de 30 em 30 min) para todos os enlaces de um mapa
    em uma única consulta SQL local para embutir no arquivo .html dinâmico.
    """
    if not links:
        return {}
    link_ids = [lnk.id for lnk in links if lnk.id]
    if not link_ids:
        return {}

    num_buckets = 48
    bucket_sec = 1800  # 30 minutos
    now_ts = int(datetime.now(timezone.utc).timestamp())
    current_slot = (now_ts // bucket_sec) * bucket_sec
    slot_clocks = [current_slot - (num_buckets - 1 - i) * bucket_sec for i in range(num_buckets)]
    cutoff_dt = datetime.fromtimestamp(slot_clocks[0], tz=timezone.utc)

    samples = (
        db.query(WeathermapSample)
        .filter(WeathermapSample.link_id.in_(link_ids), WeathermapSample.ts >= cutoff_dt)
        .order_by(WeathermapSample.ts.asc())
        .all()
    )

    by_link: Dict[int, Dict[int, Dict[str, List[float]]]] = {
        lid: {clk: {"in": [], "out": []} for clk in slot_clocks} for lid in link_ids
    }
    has_data_by_link: Dict[int, bool] = {lid: False for lid in link_ids}

    for s in samples:
        lid = s.link_id
        if lid not in by_link:
            continue
        s_ts = int(s.ts.timestamp())
        b_clk = (s_ts // bucket_sec) * bucket_sec
        if b_clk not in by_link[lid]:
            b_clk = min(slot_clocks, key=lambda c: abs(c - s_ts))
        if s.in_bps is not None:
            by_link[lid][b_clk]["in"].append(float(s.in_bps))
            has_data_by_link[lid] = True
        if s.out_bps is not None:
            by_link[lid][b_clk]["out"].append(float(s.out_bps))
            has_data_by_link[lid] = True

    out: Dict[str, Any] = {}
    for lid in link_ids:
        if not has_data_by_link.get(lid):
            out[str(lid)] = {"interval_minutes": 30, "stats": {}, "points": []}
            continue
        pts = []
        in_all: List[float] = []
        out_all: List[float] = []
        for clk in slot_clocks:
            b = by_link[lid][clk]
            avg_in = round(sum(b["in"]) / len(b["in"]), 1) if b["in"] else None
            avg_out = round(sum(b["out"]) / len(b["out"]), 1) if b["out"] else None
            if avg_in is not None:
                in_all.append(avg_in)
            if avg_out is not None:
                out_all.append(avg_out)
            pts.append({"in_bps": avg_in, "out_bps": avg_out})
        in_all.sort()
        out_all.sort()
        out[str(lid)] = {
            "interval_minutes": 30,
            "stats": {
                "peak_in_bps": in_all[-1] if in_all else None,
                "peak_out_bps": out_all[-1] if out_all else None,
                "p95_in_bps": _percentile(in_all, 95.0),
                "p95_out_bps": _percentile(out_all, 95.0),
            },
            "points": pts,
        }
    return out


async def render_and_publish_single_map(
    db: Session,
    wm_map: WeathermapMap,
    render_dir: str = DEFAULT_RENDER_DIR,
) -> None:
    """Coleta e publica imediatamente um único mapa (útil após edição no editor ou rotação de token)."""
    res = await collect_weathermap_state(db, map_id=wm_map.id)
    svg_str = render_svg(
        wm_map,
        wm_map.nodes,
        wm_map.links,
        res.link_states,
        res.node_severities,
        interactive=False,
        rendered_at=res.collected_at,
    )
    svg_interactive = render_svg(
        wm_map,
        wm_map.nodes,
        wm_map.links,
        res.link_states,
        res.node_severities,
        interactive=True,
        rendered_at=res.collected_at,
    )
    png_bytes = svg_to_png(svg_str)
    link_histories = build_map_histories_48(db, wm_map.links)
    html_str = render_interactive_html(wm_map, svg_interactive, link_histories)
    publish_map_render(render_dir, wm_map, svg_str, png_bytes, html_str=html_str)
    wm_map.last_render_at = res.collected_at
    wm_map.last_render_error = None
    db.commit()


async def run_single_cycle(render_dir: str = DEFAULT_RENDER_DIR) -> tuple[int, int]:
    """Executa um ciclo completo: coleta Zabbix -> grava amostras -> renderiza PNG/SVG -> publica."""
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    maps_ok = 0
    maps_err = 0

    try:
        active_maps = db.query(WeathermapMap).filter(WeathermapMap.is_active == True).all()
        if not active_maps:
            write_health_file(render_dir, now.isoformat(), 0, 0)
            return 0, 0

        try:
            res = await collect_weathermap_state(db)
        except Exception as exc:
            logger.error("Erro na coleta global do Zabbix (mantendo PNGs anteriores): %s", exc)
            db.rollback()
            active_maps = db.query(WeathermapMap).filter(WeathermapMap.is_active == True).all()
            for m in active_maps:
                m.last_render_error = f"Falha na coleta Zabbix: {exc}"
            db.commit()
            write_health_file(render_dir, now.isoformat(), 0, len(active_maps))
            return 0, len(active_maps)

        # Gravar amostras históricas (WeathermapSample)
        for link_id, st in res.link_states.items():
            db.add(
                WeathermapSample(
                    link_id=link_id,
                    ts=res.collected_at,
                    in_bps=st.in_bps,
                    out_bps=st.out_bps,
                    status=st.status,
                )
            )
        db.commit()

        # Renderizar e publicar cada mapa ativo isoladamente
        for m in active_maps:
            try:
                svg_str = render_svg(
                    m,
                    m.nodes,
                    m.links,
                    res.link_states,
                    res.node_severities,
                    interactive=False,
                    rendered_at=res.collected_at,
                )
                svg_interactive = render_svg(
                    m,
                    m.nodes,
                    m.links,
                    res.link_states,
                    res.node_severities,
                    interactive=True,
                    rendered_at=res.collected_at,
                )
                png_bytes = svg_to_png(svg_str)
                link_histories = build_map_histories_48(db, m.links)
                html_str = render_interactive_html(m, svg_interactive, link_histories)
                publish_map_render(render_dir, m, svg_str, png_bytes, html_str=html_str)
                m.last_render_at = res.collected_at
                m.last_render_error = None
                maps_ok += 1
            except Exception as exc:
                logger.exception("Falha ao renderizar mapa %s (id=%s): %s", m.name, m.id, exc)
                m.last_render_error = str(exc)
                maps_err += 1
        db.commit()

        reconcile_render_dir(render_dir, active_maps)
        write_health_file(render_dir, res.collected_at.isoformat(), maps_ok, maps_err)
        logger.info("Ciclo concluído: %d mapas OK, %d erros (%d links coletados).", maps_ok, maps_err, len(res.link_states))
        return maps_ok, maps_err
    finally:
        db.close()


def purge_old_samples(retention_days: int = RETENTION_DAYS) -> int:
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        deleted = (
            db.query(WeathermapSample)
            .filter(WeathermapSample.ts < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if deleted:
            logger.info("Expurgo diário: %d amostras antigas removidas (> %d dias).", deleted, retention_days)
        return deleted
    finally:
        db.close()


def _seconds_until_next_slot(interval: int) -> float:
    if interval < 60:
        return float(interval)
    now = time.time()
    # Alinha ao múltiplo de `interval` + 30s (ex: 12:00:30, 12:05:30)
    offset = 30.0
    next_slot = ((int(now - offset) // interval) + 1) * interval + offset
    wait = max(5.0, next_slot - now)
    return wait


async def main_loop() -> None:
    Base.metadata.create_all(bind=engine)
    render_dir = DEFAULT_RENDER_DIR
    interval = DEFAULT_INTERVAL
    logger.info("Iniciando worker do Weathermap v2 (render_dir=%s, interval=%ds)", render_dir, interval)

    last_purge_day: Optional[int] = None
    while True:
        try:
            await run_single_cycle(render_dir=render_dir)
            today = datetime.now(timezone.utc).timetuple().tm_yday
            if last_purge_day != today:
                purge_old_samples()
                last_purge_day = today
        except Exception as exc:
            logger.exception("Erro inesperado no loop principal do worker: %s", exc)

        wait_s = _seconds_until_next_slot(interval)
        logger.info("Próximo ciclo em %.1fs", wait_s)
        await asyncio.sleep(wait_s)


if __name__ == "__main__":
    asyncio.run(main_loop())
