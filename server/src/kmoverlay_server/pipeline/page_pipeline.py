"""Interface shared by every image pipeline (the demonstration one now, the real one in Fase 1)."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from PIL import Image

ReadingDirection = Literal["ltr", "rtl", "strip"]
Point = tuple[int, int]


@dataclass(frozen=True)
class PipelineOptions:
    """What the pipeline needs to know about a request."""

    source_language: str
    target_language: str
    reading_direction: ReadingDirection
    render_image: bool


@dataclass(frozen=True)
class TranslatedRegion:
    """A translated text area, in pixels of the original image."""

    polygon: tuple[Point, ...]
    source_text: str
    translated_text: str


@dataclass(frozen=True)
class PageResult:
    """Result for one image; `image` is `None` when only the regions were asked for."""

    image: Image.Image | None
    regions: tuple[TranslatedRegion, ...]


class PagePipeline(Protocol):
    """Translates the text of a sequence of images (one page, or consecutive strip slices)."""

    version: str
    """Part of every cache key, so a new pipeline never serves old results."""

    gpu_name: str | None
    models_loaded: bool
    translator_name: str
    """Shown in `/v1/health`, e.g. `ollama:gemma3:4b`."""

    def translate(
        self, images: Sequence[Image.Image], options: PipelineOptions
    ) -> list[PageResult]:
        """Returns one result per image, in the same order."""
        ...

    def warm_up(self) -> None:
        """Loads every model now, so the first page does not wait for them."""
        ...
