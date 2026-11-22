"""Demonstration pipeline: marks each image instead of translating it.

It lets the extension be tested end to end (queue, states, overlay, cache)
before the real models exist.
"""

import time
from collections.abc import Callable, Sequence

from PIL import Image, ImageDraw, ImageFont

from kmoverlay_server.pipeline.page_pipeline import (
    PageResult,
    PipelineOptions,
    TranslatedRegion,
)

DEMO_PIPELINE_VERSION = "demo-1"
# Pillow's built-in font has no accented letters; the real renderer (Fase 1) uses a font that has.
BANNER_TEXT = "KMOverlay · demo"
ACCENT_COLOR = (194, 65, 12)
TEXT_COLOR = (255, 255, 255)
BANNER_HEIGHT_RATIO = 0.05
MIN_BANNER_HEIGHT = 28
MAX_BANNER_HEIGHT = 64
BORDER_WIDTH = 4
TEXT_HEIGHT_RATIO = 0.5
TEXT_PADDING = 12
MILLISECONDS_PER_SECOND = 1000


class DemoPipeline:
    """Draws a banner and a border on each image, after a simulated processing time."""

    version = DEMO_PIPELINE_VERSION
    gpu_name: str | None = None
    # No model is loaded: the options page shows "modelos não carregados", which is the truth.
    models_loaded = False

    def __init__(self, delay_ms: int, sleep: Callable[[float], None] = time.sleep) -> None:
        self._delay_seconds = delay_ms / MILLISECONDS_PER_SECOND
        self._sleep = sleep

    def translate(
        self, images: Sequence[Image.Image], options: PipelineOptions
    ) -> list[PageResult]:
        """Marks every image; the delay makes the "Traduzindo" state visible in the browser."""
        if self._delay_seconds > 0:
            self._sleep(self._delay_seconds)
        return [self._mark(image, options.render_image) for image in images]

    def _mark(self, image: Image.Image, render_image: bool) -> PageResult:
        banner_height = _banner_height(image.height)
        region = TranslatedRegion(
            polygon=((0, 0), (image.width, 0), (image.width, banner_height), (0, banner_height)),
            source_text="",
            translated_text=BANNER_TEXT,
        )
        if not render_image:
            return PageResult(image=None, regions=(region,))
        marked = image.convert("RGB")
        draw = ImageDraw.Draw(marked)
        draw.rectangle(
            (0, 0, marked.width - 1, marked.height - 1), outline=ACCENT_COLOR, width=BORDER_WIDTH
        )
        draw.rectangle((0, 0, marked.width, banner_height), fill=ACCENT_COLOR)
        font = ImageFont.load_default(size=max(1, round(banner_height * TEXT_HEIGHT_RATIO)))
        draw.text(
            (TEXT_PADDING, banner_height / 2), BANNER_TEXT, fill=TEXT_COLOR, font=font, anchor="lm"
        )
        return PageResult(image=marked, regions=(region,))


def _banner_height(image_height: int) -> int:
    return max(MIN_BANNER_HEIGHT, min(MAX_BANNER_HEIGHT, round(image_height * BANNER_HEIGHT_RATIO)))
