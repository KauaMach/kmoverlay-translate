"""Translation with a local LLM served by Ollama (https://ollama.com)."""

import json
import logging
from collections.abc import Sequence
from typing import Any

import httpx

from kmoverlay_server.pipeline.translators import TranslationRequest, TranslatorError, language_name

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "gemma3:4b"
# Ollama unloads an idle model after 5 minutes by default; reading pauses are often longer.
KEEP_ALIVE = "30m"
# The first call also loads the model into memory, which can take a while.
REQUEST_TIMEOUT_SECONDS = 180.0
# Low temperature: the same balloon should get the same translation.
TEMPERATURE = 0.2
HTTP_NOT_FOUND = 404

SYSTEM_PROMPT = """You translate the speech balloons of a comic page from {source} to {target}.
- Translate every segment, keeping their number and order; never merge or split segments.
- The segments are in reading order and come from the same page;
  use them as context for each other.
- Keep the meaning, tone and register. Write natural, colloquial {target},
  as a professional comic translator would.
- Keep names, and punctuation such as "...", "!" and "?".
- Answer only with JSON: {{"translations": ["...", "..."]}}."""

logger = logging.getLogger(__name__)


class OllamaTranslator:
    """Translates a whole page in one chat call, falling back to one call per balloon."""

    def __init__(
        self,
        base_url: str = DEFAULT_OLLAMA_URL,
        model: str = DEFAULT_OLLAMA_MODEL,
        client: httpx.Client | None = None,
    ) -> None:
        self.name = f"ollama:{model}"
        self._base_url = base_url
        self._model = model
        self._client = client or httpx.Client(base_url=base_url, timeout=REQUEST_TIMEOUT_SECONDS)

    def translate(self, segments: Sequence[str], request: TranslationRequest) -> list[str]:
        """Translates the page; a balloon the model keeps failing on stays in the original."""
        if not segments:
            return []
        page = self._chat(segments, request)
        if page is not None:
            return page
        # Texts are not logged: they come from the pages the user reads.
        logger.warning(
            "Ollama answered badly for %d segments; translating one by one", len(segments)
        )
        translations = []
        for segment in segments:
            single = self._chat([segment], request)
            translations.append(single[0] if single is not None else segment)
        return translations

    def unload(self) -> None:
        """Asks Ollama to free the model now (`keep_alive: 0`) instead of after `KEEP_ALIVE`."""
        try:
            response = self._client.post(
                "/api/generate", json={"model": self._model, "keep_alive": 0}
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            # Not fatal: Ollama frees the model by itself after KEEP_ALIVE anyway.
            logger.warning("Could not unload the Ollama model %s: %s", self._model, error)

    def _chat(self, segments: Sequence[str], request: TranslationRequest) -> list[str] | None:
        """One chat call; `None` when the answer does not have one translation per segment."""
        payload = {
            "model": self._model,
            "stream": False,
            "keep_alive": KEEP_ALIVE,
            "format": translations_schema(len(segments)),
            "options": {"temperature": TEMPERATURE},
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT.format(
                        source=language_name(request.source_language),
                        target=language_name(request.target_language),
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(_user_content(segments, request), ensure_ascii=False),
                },
            ],
        }
        try:
            response = self._client.post("/api/chat", json=payload)
        except httpx.ConnectError as error:
            raise TranslatorError(f"O Ollama não está rodando em {self._base_url}.") from error
        except httpx.TimeoutException as error:
            raise TranslatorError("O Ollama demorou demais para responder.") from error
        if response.status_code == HTTP_NOT_FOUND:
            raise TranslatorError(
                f"O modelo {self._model} não está instalado no Ollama; "
                f"rode: ollama pull {self._model}"
            )
        if response.is_error:
            raise TranslatorError(f"O Ollama respondeu com erro (HTTP {response.status_code}).")
        return parse_translations(response.json(), len(segments))


def translations_schema(count: int) -> dict[str, Any]:
    """JSON schema Ollama uses to constrain the answer: exactly `count` strings."""
    return {
        "type": "object",
        "properties": {
            "translations": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": count,
                "maxItems": count,
            }
        },
        "required": ["translations"],
    }


def parse_translations(body: Any, expected: int) -> list[str] | None:
    """Translations from an Ollama chat answer.

    Returns `None` when the answer is malformed or has the wrong number of translations.
    """
    message = body.get("message") if isinstance(body, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str):
        return None
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return None
    translations = parsed.get("translations") if isinstance(parsed, dict) else None
    if (
        not isinstance(translations, list)
        or len(translations) != expected
        or not all(isinstance(item, str) for item in translations)
    ):
        return None
    return [item.strip() for item in translations]


def _user_content(segments: Sequence[str], request: TranslationRequest) -> dict[str, Any]:
    content: dict[str, Any] = {"segments": list(segments)}
    if request.context:
        content["previous_page"] = list(request.context)
    return content
