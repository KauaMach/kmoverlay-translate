"""Erases the original text by painting its strokes with the balloon color.

This works for plain balloons, the common case. Text over drawings needs a real
inpainting model (LaMa, Fase 6).
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter

from kmoverlay_server.pipeline.text_blocks import Box, TextBlock

Color = tuple[int, int, int]

# Margin around each line box, so the background sample is taken outside the letters.
LINE_PADDING = 4
# Width of the ring of pixels used to sample the background color.
BORDER_SAMPLE_WIDTH = 2
# A pixel is part of a letter when one channel differs this much from the background.
INK_DISTANCE = 70
# Grows the letter mask to cover anti-aliased edges; must be odd (filter size).
MASK_DILATION = 5
DEFAULT_TEXT_COLOR: Color = (0, 0, 0)


@dataclass(frozen=True)
class BlockColors:
    """Colors measured on a balloon before its text was erased."""

    background: Color
    text: Color


def erase_text(
    image: Image.Image, blocks: Sequence[TextBlock]
) -> tuple[Image.Image, list[BlockColors]]:
    """Returns a copy of `image` without the text of `blocks`, and the colors of each block."""
    erased = image.convert("RGB")
    colors = []
    for block in blocks:
        # Every block has at least one line; its first line gives the colors of the balloon.
        line_colors = [_erase_line(erased, line.box) for line in block.lines]
        colors.append(line_colors[0])
    return erased, colors


def _erase_line(image: Image.Image, box: Box) -> BlockColors:
    region_box = _padded(box, LINE_PADDING, image.size)
    region = np.asarray(image.crop(region_box)).astype(np.int16)
    background = _border_median(region)
    distance = np.abs(region - np.array(background, dtype=np.int16)).max(axis=2)
    ink = distance > INK_DISTANCE
    text_color = _median_color(region[ink]) if ink.any() else DEFAULT_TEXT_COLOR
    mask = Image.fromarray((ink * 255).astype(np.uint8), mode="L").filter(
        ImageFilter.MaxFilter(MASK_DILATION)
    )
    image.paste(background, region_box, mask)
    return BlockColors(background=background, text=text_color)


def _border_median(region: np.ndarray) -> Color:
    width = BORDER_SAMPLE_WIDTH
    border = np.concatenate(
        [
            region[:width].reshape(-1, 3),
            region[-width:].reshape(-1, 3),
            region[:, :width].reshape(-1, 3),
            region[:, -width:].reshape(-1, 3),
        ]
    )
    return _median_color(border)


def _median_color(pixels: np.ndarray) -> Color:
    red, green, blue = (int(channel) for channel in np.median(pixels, axis=0))
    return (red, green, blue)


def _padded(box: Box, padding: int, size: tuple[int, int]) -> Box:
    width, height = size
    return (
        max(0, box[0] - padding),
        max(0, box[1] - padding),
        min(width, box[2] + padding),
        min(height, box[3] + padding),
    )
