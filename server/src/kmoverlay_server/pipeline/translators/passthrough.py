"""Translator that keeps the original text: checks reading, erasing and writing without a model."""

from collections.abc import Sequence

from kmoverlay_server.pipeline.translators import TranslationRequest

PASSTHROUGH_NAME = "none"


class PassthroughTranslator:
    """Returns every segment unchanged."""

    name = PASSTHROUGH_NAME
    version = PASSTHROUGH_NAME

    def translate(self, segments: Sequence[str], request: TranslationRequest) -> list[str]:
        return list(segments)

    def warm_up(self) -> None:
        """Nothing to load."""

    def unload(self) -> None:
        """Nothing is loaded."""
