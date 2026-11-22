"""Translators: every engine (Ollama, NLLB…) translates a list of segments the same way."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

LANGUAGE_NAMES = {
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "es": "Spanish",
    "ru": "Russian",
    "pt-BR": "Brazilian Portuguese",
}


class TranslatorError(RuntimeError):
    """The translator could not answer; the message is shown to the reader (Portuguese)."""


@dataclass(frozen=True)
class TranslationRequest:
    """Languages of a request and, optionally, earlier lines that give context."""

    source_language: str
    target_language: str
    context: tuple[str, ...] = ()


class Translator(Protocol):
    """Translates segments (balloons) in one call, keeping their number and order."""

    name: str
    """Part of the pipeline version, so each translator has its own cache entries."""

    def translate(self, segments: Sequence[str], request: TranslationRequest) -> list[str]:
        """One translation per segment, in the same order.

        Raises:
            TranslatorError: when the engine is unreachable or keeps answering badly.
        """
        ...

    def warm_up(self) -> None:
        """Loads the model now, so the first page does not wait for it.

        Raises:
            TranslatorError: when the engine is unreachable.
        """
        ...

    def unload(self) -> None:
        """Frees the memory (VRAM) of the model; the next call loads it again."""
        ...


def language_name(code: str) -> str:
    """English name of a language code, for prompts."""
    return LANGUAGE_NAMES.get(code, code)
