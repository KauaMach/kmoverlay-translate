"""OCR with RapidOCR: PaddleOCR models on ONNX Runtime, bundled with the package."""

from collections.abc import Callable, Sequence
from statistics import median
from threading import Lock
from typing import Any

import numpy as np
from PIL import Image

from kmoverlay_server.pipeline.text_blocks import Box, TextLine

READER_NAME = "rapidocr-1"
# RapidOCR shrinks images whose longest side passes 2000 px, which makes the
# text of tall webtoon strips unreadable; they are read in overlapping tiles.
TILE_HEIGHT = 1600
# Larger than any text line, so every line is whole in at least one tile.
TILE_OVERLAP = 240
MIN_SCORE = 0.6
# Lines this much taller than the typical line are art (a head read as "O").
OUTLIER_HEIGHT_RATIO = 2.5
# A line found in two tiles: the copy mostly inside the other one is dropped.
DUPLICATE_CONTAINMENT = 0.6
ENGINE_PARAMS = {
    "Global.log_level": "warning",
    # Comic text is upright; the angle classifier only costs time.
    "Global.use_cls": False,
}

EngineFactory = Callable[[], Callable[[np.ndarray], Any]]


def _create_rapidocr_engine() -> Callable[[np.ndarray], Any]:
    # Imported here so tests that do not run the OCR do not load the models.
    from rapidocr import RapidOCR

    return RapidOCR(params=ENGINE_PARAMS)


class RapidOcrReader:
    """Reads text lines with RapidOCR; the models load on first use and stay loaded."""

    name = READER_NAME

    def __init__(self, engine_factory: EngineFactory = _create_rapidocr_engine) -> None:
        self._engine_factory = engine_factory
        self._engine: Callable[[np.ndarray], Any] | None = None
        self._lock = Lock()

    def warm_up(self) -> None:
        """Loads the OCR models now instead of on the first page."""
        self._get_engine()

    def read(self, image: Image.Image) -> list[TextLine]:
        """Reads the whole image, tile by tile when it is tall."""
        engine = self._get_engine()
        rgb = image.convert("RGB")
        lines: list[TextLine] = []
        for top in tile_tops(rgb.height):
            tile = rgb.crop((0, top, rgb.width, min(rgb.height, top + TILE_HEIGHT)))
            lines.extend(_shift(_lines_from_result(engine(np.asarray(tile))), top))
        return drop_artwork(drop_duplicates(lines))

    def _get_engine(self) -> Callable[[np.ndarray], Any]:
        with self._lock:
            if self._engine is None:
                self._engine = self._engine_factory()
            return self._engine


def tile_tops(height: int) -> list[int]:
    """Top of every tile needed to cover `height`, overlapping by `TILE_OVERLAP`."""
    if height <= TILE_HEIGHT:
        return [0]
    step = TILE_HEIGHT - TILE_OVERLAP
    tops = list(range(0, height - TILE_HEIGHT, step))
    tops.append(height - TILE_HEIGHT)
    return tops


def drop_duplicates(lines: Sequence[TextLine]) -> list[TextLine]:
    """Removes lines read twice in the overlap of two tiles, keeping the bigger copy."""
    kept: list[TextLine] = []
    for line in sorted(lines, key=lambda item: item.width * item.height, reverse=True):
        if not any(_containment(line.box, other.box) > DUPLICATE_CONTAINMENT for other in kept):
            kept.append(line)
    return kept


def drop_artwork(lines: Sequence[TextLine]) -> list[TextLine]:
    """Removes low-confidence reads, symbols and drawings taken for letters."""
    candidates = [
        line
        for line in lines
        if line.score >= MIN_SCORE and any(character.isalnum() for character in line.text)
    ]
    typical = [line.height for line in candidates if len(line.text.strip()) >= 3]
    if not typical:
        return candidates
    limit = OUTLIER_HEIGHT_RATIO * median(typical)
    return [line for line in candidates if line.height <= limit]


def _lines_from_result(result: Any) -> list[TextLine]:
    if result.boxes is None or result.txts is None or result.scores is None:
        return []
    lines = []
    for polygon, text, score in zip(result.boxes, result.txts, result.scores, strict=True):
        xs = [float(point[0]) for point in polygon]
        ys = [float(point[1]) for point in polygon]
        box = (round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys)))
        lines.append(TextLine(box=box, text=str(text), score=float(score)))
    return lines


def _shift(lines: Sequence[TextLine], top: int) -> list[TextLine]:
    return [
        TextLine(
            box=(line.box[0], line.box[1] + top, line.box[2], line.box[3] + top),
            text=line.text,
            score=line.score,
        )
        for line in lines
    ]


def _containment(box: Box, other: Box) -> float:
    """Fraction of `box` that lies inside `other`."""
    width = min(box[2], other[2]) - max(box[0], other[0])
    height = min(box[3], other[3]) - max(box[1], other[1])
    area = (box[2] - box[0]) * (box[3] - box[1])
    if width <= 0 or height <= 0 or area <= 0:
        return 0.0
    return width * height / area
