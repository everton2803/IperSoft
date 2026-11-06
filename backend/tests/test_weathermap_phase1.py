import unittest
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from app.models.weathermap import WeathermapMap, WeathermapNode, WeathermapLink
from app.weathermap.collector import LinkState
from app.weathermap.import_legacy import parse_legacy_conf_text
from app.weathermap.raster import svg_to_png, read_png_dimensions
from app.weathermap.renderer import render_svg
from app.weathermap.scale import DEFAULT_SCALE, color_for, fmt_bps, parse_bandwidth, width_for_capacity


class TestWeathermapPhase1(unittest.TestCase):
    def test_scale_and_formatting(self):
        self.assertEqual(fmt_bps(None), "-")
        self.assertEqual(fmt_bps(0), "0")
        self.assertEqual(fmt_bps(830_000_000), "830M")
        self.assertEqual(fmt_bps(1_450_000_000), "1.4G")
        self.assertEqual(parse_bandwidth("1000M"), 1_000_000_000)
        self.assertEqual(parse_bandwidth("10000M"), 10_000_000_000)
        self.assertEqual(parse_bandwidth("40G"), 40_000_000_000)
        self.assertEqual(color_for(0.0, DEFAULT_SCALE), "#c0c0c0")
        self.assertEqual(color_for(45.0, DEFAULT_SCALE), "#00d64f")
        self.assertEqual(color_for(95.0, DEFAULT_SCALE), "#ef4444")
        self.assertGreater(width_for_capacity(10_000_000_000), width_for_capacity(1_000_000_000))

    def test_legacy_conf_parser(self):
        sample_conf = """
WIDTH 1500
HEIGHT 1000
TITLE atm
SET zabbix_auth_token SHOULD_BE_IGNORED

NODE DEFAULT
\tLABELOFFSET S

LINK DEFAULT
\tBANDWIDTH 10000M

NODE bkup
\tLABEL bkup
\tLABELOFFSET N
\tICON images/iper-cloud-40px.png
\tPOSITION 520 40

NODE atm-router-servers-1
\tLABEL atm-router-servers-1
\tICON images/iper-router-40px.png
\tPOSITION 320 520

NODE atm-sw-videira
\tLABEL atm-sw-videira
\tICON images/iper-switch-l2-40px.png
\tPOSITION 480 620

LINK atm-router-servers-1-atm-sw-videira
\tTARGET zabbix:itemid:atm-router-servers-1:67782:68043
\tNODES atm-router-servers-1:w40 atm-sw-videira:s40
\tBANDWIDTH 1000M
\tVIA 400 570
"""
        parsed = parse_legacy_conf_text(sample_conf, legacy_name="atm")
        self.assertEqual(parsed.title, "atm")
        self.assertEqual((parsed.width, parsed.height), (1500, 1000))
        self.assertEqual(len(parsed.nodes), 3)
        self.assertEqual(parsed.nodes[0].icon, "cloud")
        self.assertEqual(parsed.nodes[0].label_pos, "N")
        self.assertEqual((parsed.nodes[1].x, parsed.nodes[1].y), (320, 520))
        self.assertEqual(len(parsed.links), 1)
        lnk = parsed.links[0]
        self.assertEqual(lnk.node_a_key, "atm-router-servers-1")
        self.assertEqual(lnk.node_b_key, "atm-sw-videira")
        self.assertEqual(lnk.offset_a, "W40")
        self.assertEqual(lnk.offset_b, "S40")
        self.assertEqual(lnk.itemid_in, "67782")
        self.assertEqual(lnk.itemid_out, "68043")
        self.assertEqual(lnk.capacity_bps, 1_000_000_000)
        self.assertEqual(lnk.via_points, [[400, 570]])

    def test_renderer_and_rasterizer(self):
        wm_map = WeathermapMap(
            id=1,
            name="ATM & Borda <Teste>",
            width=1200,
            height=800,
            theme="light",
            scale=DEFAULT_SCALE,
            public_token="tok123",
        )
        n1 = WeathermapNode(id=10, map_id=1, asset_id=5, key="r1", label="R1 & Core", x=200, y=300, icon="router", label_pos="N")
        n2 = WeathermapNode(id=11, map_id=1, asset_id=None, key="c1", label="Unifique <BGP>", x=700, y=300, icon="cloud", label_pos="S")
        l1 = WeathermapLink(
            id=100,
            map_id=1,
            node_a_id=10,
            node_b_id=11,
            label="r1-c1",
            capacity_bps=10_000_000_000,
            via_points=[],
            offset_a="N40",
            offset_b="N40",
        )
        now = datetime.now(timezone.utc)
        states = {
            100: LinkState(in_bps=830_000_000.0, out_bps=4_200_000_000.0, pct=42.0, status="ok", ts=now),
        }
        sevs = {10: 4, 11: 0}

        for interactive in (False, True):
            svg = render_svg(wm_map, [n1, n2], [l1], states, sevs, interactive=interactive, rendered_at=now)
            root = ET.fromstring(svg)
            self.assertTrue(root.tag.endswith("svg"))

        png = svg_to_png(svg)
        self.assertEqual(read_png_dimensions(png), (1200, 800))


if __name__ == "__main__":
    unittest.main()
