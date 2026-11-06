import os
import struct
from typing import Tuple
import resvg_py

FONTS_DIR = "/usr/share/fonts"


def svg_to_png(svg: str) -> bytes:
    """Renderiza uma string SVG em bytes PNG usando resvg_py e as fontes do sistema."""
    resources_dir = FONTS_DIR if os.path.isdir(FONTS_DIR) else None
    if resources_dir:
        return bytes(resvg_py.svg_to_bytes(svg, resources_dir=resources_dir))
    return bytes(resvg_py.svg_to_bytes(svg))


def read_png_dimensions(png_bytes: bytes) -> Tuple[int, int]:
    """Lê largura e altura (width, height) do cabeçalho IHDR de um arquivo PNG."""
    if len(png_bytes) < 24 or png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Bytes inválidos de PNG")
    width, height = struct.unpack(">II", png_bytes[16:24])
    return int(width), int(height)
