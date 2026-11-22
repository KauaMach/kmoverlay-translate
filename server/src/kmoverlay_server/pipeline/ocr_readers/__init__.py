"""OCR engines that find and read the text lines of an image."""

from collections.abc import Sequence
from typing import Protocol

from PIL import Image

from kmoverlay_server.pipeline.text_blocks import TextLine


class TextReader(Protocol):
    """Finds the text lines of an image and reads them."""

    name: str
    """Part of the pipeline version (and so of the cache keys)."""

    def read(self, image: Image.Image) -> Sequence[TextLine]:
        """Lines in pixels of `image`, in no particular order."""
        ...
