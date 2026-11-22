"""Writes the translated text inside the balloon, as large as it fits."""

from dataclasses import dataclass
from functools import cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from kmoverlay_server.pipeline.inpainter import BlockColors, Color
from kmoverlay_server.pipeline.text_blocks import Box, TextBlock

# Comic Neue (OFL, see assets/fonts/OFL-ComicNeue.txt) has the Portuguese accents.
FONT_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "ComicNeue-Bold.ttf"
MIN_FONT_SIZE = 10
# The translation starts at the size of the original letters and only shrinks.
FONT_SIZE_PER_LINE_HEIGHT = 1.15
LINE_SPACING_RATIO = 0.12
# The balloon is searched up to this fraction of the block size around it.
BALLOON_SEARCH_RATIO = 0.8
# Pixels this close to the balloon color count as balloon when flooding it.
FLOOD_THRESHOLD = 40
# Rectangle inside an oval balloon where text can go (1/√2 ≈ 0.71, a bit more for rounder text).
INSCRIBED_RATIO = 0.78
# Without a closed balloon (caption on a drawing), the text may spread a little.
OPEN_AREA_PADDING_RATIO = 0.1
FLOOD_MARKER: Color = (1, 254, 3)


@dataclass(frozen=True)
class FittedText:
    """Text broken into lines with the font size that fits the area."""

    lines: tuple[str, ...]
    font_size: int


def render_translations(
    image: Image.Image,
    blocks: list[TextBlock],
    colors: list[BlockColors],
    translations: list[str],
) -> Image.Image:
    """Draws each translation in the balloon of its block (the image must be already erased)."""
    rendered = image.copy()
    draw = ImageDraw.Draw(rendered)
    for block, block_colors, translation in zip(blocks, colors, translations, strict=True):
        text = translation.upper() if block.is_uppercase else translation
        area = text_area(image, block, block_colors.background)
        fitted = fit_text(
            text, area, max_font_size=round(block.line_height * FONT_SIZE_PER_LINE_HEIGHT)
        )
        _draw_centered(draw, area, fitted, block_colors.text)
    return rendered


def text_area(image: Image.Image, block: TextBlock, background: Color) -> Box:
    """Where the translation may go: the inside of the balloon around the block.

    The balloon is found by flooding the (erased) area around the block with its
    color. When the flood reaches the edge of the search window the text is not
    in a closed balloon, so only the block box, slightly enlarged, is used.
    """
    left, top, right, bottom = block.box
    # The same margin on both axes: a one-line balloon is much taller than its text.
    margin = round(max(right - left, bottom - top) * BALLOON_SEARCH_RATIO)
    window = (
        max(0, left - margin),
        max(0, top - margin),
        min(image.width, right + margin),
        min(image.height, bottom + margin),
    )
    crop = image.crop(window).convert("RGB")
    seed = ((left + right) // 2 - window[0], (top + bottom) // 2 - window[1])
    if crop.getpixel(seed) != background:
        crop.putpixel(seed, background)
    ImageDraw.floodfill(crop, seed, FLOOD_MARKER, thresh=FLOOD_THRESHOLD)
    flooded = np.all(np.asarray(crop) == np.array(FLOOD_MARKER), axis=2)
    rows = np.flatnonzero(flooded.any(axis=1))
    columns = np.flatnonzero(flooded.any(axis=0))
    touches_edge = (
        rows[0] == 0
        or columns[0] == 0
        or rows[-1] == crop.height - 1
        or columns[-1] == crop.width - 1
    )
    if touches_edge:
        return _grown(block.box, OPEN_AREA_PADDING_RATIO, image.size)
    balloon = (
        window[0] + int(columns[0]),
        window[1] + int(rows[0]),
        window[0] + int(columns[-1]) + 1,
        window[1] + int(rows[-1]) + 1,
    )
    inner = _shrunk(balloon, INSCRIBED_RATIO)
    return (
        min(inner[0], left),
        min(inner[1], top),
        max(inner[2], right),
        max(inner[3], bottom),
    )


def fit_text(text: str, area: Box, max_font_size: int) -> FittedText:
    """Largest font size (down to `MIN_FONT_SIZE`) whose word-wrapped text fits `area`."""
    width = area[2] - area[0]
    height = area[3] - area[1]
    start = max(MIN_FONT_SIZE, max_font_size)
    for size in range(start, MIN_FONT_SIZE - 1, -1):
        font = load_font(size)
        lines = wrap_words(text, font, width)
        if _text_height(font, len(lines)) <= height and all(
            font.getlength(line) <= width for line in lines
        ):
            return FittedText(tuple(lines), size)
    font = load_font(MIN_FONT_SIZE)
    # Nothing fits: the smallest size is used and the text may overflow the balloon a little.
    return FittedText(tuple(wrap_words(text, font, width)), MIN_FONT_SIZE)


def wrap_words(text: str, font: ImageFont.FreeTypeFont, max_width: float) -> list[str]:
    """Breaks the text between words so each line is at most `max_width` wide when possible."""
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and font.getlength(candidate) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


@cache
def load_font(size: int) -> ImageFont.FreeTypeFont:
    """The comic font at `size` pixels (cached: the same sizes repeat on every page)."""
    return ImageFont.truetype(str(FONT_PATH), size)


def _text_height(font: ImageFont.FreeTypeFont, line_count: int) -> float:
    ascent, descent = font.getmetrics()
    line_height = ascent + descent
    return line_count * line_height + (line_count - 1) * line_height * LINE_SPACING_RATIO


def _draw_centered(draw: ImageDraw.ImageDraw, area: Box, fitted: FittedText, color: Color) -> None:
    font = load_font(fitted.font_size)
    ascent, descent = font.getmetrics()
    center = ((area[0] + area[2]) / 2, (area[1] + area[3]) / 2)
    draw.multiline_text(
        center,
        "\n".join(fitted.lines),
        fill=color,
        font=font,
        anchor="mm",
        align="center",
        spacing=round((ascent + descent) * LINE_SPACING_RATIO),
    )


def _shrunk(box: Box, ratio: float) -> Box:
    center_x = (box[0] + box[2]) / 2
    center_y = (box[1] + box[3]) / 2
    half_width = (box[2] - box[0]) * ratio / 2
    half_height = (box[3] - box[1]) * ratio / 2
    return (
        round(center_x - half_width),
        round(center_y - half_height),
        round(center_x + half_width),
        round(center_y + half_height),
    )


def _grown(box: Box, ratio: float, size: tuple[int, int]) -> Box:
    padding_x = round((box[2] - box[0]) * ratio)
    padding_y = round((box[3] - box[1]) * ratio)
    return (
        max(0, box[0] - padding_x),
        max(0, box[1] - padding_y),
        min(size[0], box[2] + padding_x),
        min(size[1], box[3] + padding_y),
    )
