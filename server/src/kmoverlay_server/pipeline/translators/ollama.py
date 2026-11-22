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
DEFAULT_KEEP_ALIVE = "30m"
# The first call also loads the model into memory, which can take a while.
REQUEST_TIMEOUT_SECONDS = 180.0
# Low temperature: the same balloon should get the same translation.
TEMPERATURE = 0.2
HTTP_NOT_FOUND = 404

SYSTEM_PROMPT = """You are a professional comic book translator. Translate the speech balloons
of one comic page from {source} to {target}.
- Translate every segment, keeping their number and order; never merge or split segments.
- The segments come from the same page, in reading order: use them as context for each other
  (who is talking, the scene, the mood).
- The text comes from OCR in capital letters: ignore the capitalization and write in normal
  sentence case.
- Write the way people really talk in {target} comics: natural, informal and short,
  never stiff and never word for word.
- Translate idioms, slang and expressions by their meaning, with a natural equivalent.
- Keep names. Keep the punctuation "...", "!", "?" and "?!".
- Translate sound effects and actions between asterisks too (e.g. *SIGH*).{style}
- Answer only with JSON: {{"translations": ["...", "..."]}}."""

# Extra rules for targets where small models drift to another variety of the language.
TARGET_STYLE = {
    "pt-BR": (
        '\n- Use Brazilian Portuguese as people speak it: "você", "a gente", "tá", "tô", "pra";'
        '\n  never European Portuguese forms such as "protege-me", "estás" or "autocarro".'
    ),
}

# Worked examples per target (not taken from the benchmark samples), sent as earlier chat turns.
FEW_SHOT_EXAMPLES = {
    "pt-BR": [
        (
            ["WATCH OUT!", "IT'S RAINING CATS AND DOGS OUT THERE.", "I'LL BE RIGHT BACK."],
            ["Cuidado!", "Tá chovendo canivete lá fora.", "Já volto."],
        ),
        (
            ["COME ON, HURRY UP!", "WHAT ARE YOU UP TO NOW?", "*YAWN* GIVE ME FIVE MINUTES..."],
            [
                "Anda, vai logo!",
                "O que você tá aprontando agora?",
                "*bocejo* Me dá cinco minutos...",
            ],
        ),
    ],
}

logger = logging.getLogger(__name__)


class OllamaTranslator:
    """Translates a whole page in one chat call, falling back to one call per balloon."""

    def __init__(
        self,
        base_url: str = DEFAULT_OLLAMA_URL,
        model: str = DEFAULT_OLLAMA_MODEL,
        keep_alive: str = DEFAULT_KEEP_ALIVE,
        client: httpx.Client | None = None,
    ) -> None:
        self.name = f"ollama:{model}"
        self._base_url = base_url
        self._model = model
        self._keep_alive = keep_alive
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

    def warm_up(self) -> None:
        """Loads the model into memory now, so the first page does not wait for it.

        Raises:
            TranslatorError: when Ollama is not running or the model is not installed.
        """
        # A generate call without a prompt only loads the model.
        self._post("/api/generate", {"model": self._model, "keep_alive": self._keep_alive})

    def unload(self) -> None:
        """Asks Ollama to free the model now (`keep_alive: 0`), not after the keep-alive time."""
        try:
            response = self._client.post(
                "/api/generate", json={"model": self._model, "keep_alive": 0}
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            # Not fatal: Ollama frees the model by itself after the keep-alive time anyway.
            logger.warning("Could not unload the Ollama model %s: %s", self._model, error)

    def _chat(self, segments: Sequence[str], request: TranslationRequest) -> list[str] | None:
        """One chat call; `None` when the answer does not have one translation per segment."""
        payload = {
            "model": self._model,
            "stream": False,
            # Thinking models would spend minutes reasoning before each answer.
            "think": False,
            "keep_alive": self._keep_alive,
            "format": translations_schema(len(segments)),
            "options": {"temperature": TEMPERATURE},
            "messages": build_messages(segments, request),
        }
        response = self._post("/api/chat", payload)
        return parse_translations(response.json(), len(segments))

    def _post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        """Calls Ollama, turning every failure into a `TranslatorError` the reader understands."""
        try:
            response = self._client.post(path, json=payload)
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
        return response


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


def build_messages(segments: Sequence[str], request: TranslationRequest) -> list[dict[str, str]]:
    """System prompt, worked examples for the target language, then the page to translate."""
    system = SYSTEM_PROMPT.format(
        source=language_name(request.source_language),
        target=language_name(request.target_language),
        style=TARGET_STYLE.get(request.target_language, ""),
    )
    messages = [{"role": "system", "content": system}]
    for example_segments, example_translations in FEW_SHOT_EXAMPLES.get(
        request.target_language, []
    ):
        messages.append({"role": "user", "content": _as_json({"segments": example_segments})})
        messages.append(
            {"role": "assistant", "content": _as_json({"translations": example_translations})}
        )
    messages.append({"role": "user", "content": _as_json(_user_content(segments, request))})
    return messages


def _as_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False)


def _user_content(segments: Sequence[str], request: TranslationRequest) -> dict[str, Any]:
    content: dict[str, Any] = {"segments": list(segments)}
    if request.context:
        content["previous_page"] = list(request.context)
    return content
