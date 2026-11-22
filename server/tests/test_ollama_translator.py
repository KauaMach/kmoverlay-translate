import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from kmoverlay_server.pipeline.translators import TranslationRequest, TranslatorError
from kmoverlay_server.pipeline.translators.ollama import (
    DEFAULT_KEEP_ALIVE,
    OllamaTranslator,
    build_messages,
    parse_translations,
    translations_schema,
)

REQUEST = TranslationRequest("en", "pt-BR")
MODEL = "gemma3:4b"


def chat_answer(translations: list[str] | str) -> httpx.Response:
    content = (
        translations
        if isinstance(translations, str)
        else json.dumps({"translations": translations})
    )
    return httpx.Response(
        200, json={"message": {"role": "assistant", "content": content}, "done": True}
    )


def translator_with(
    handler: Callable[[httpx.Request], httpx.Response],
) -> tuple[OllamaTranslator, list[Any]]:
    sent: list[Any] = []

    def record(request: httpx.Request) -> httpx.Response:
        sent.append((request.url.path, json.loads(request.content)))
        return handler(request)

    client = httpx.Client(base_url="http://ollama.test", transport=httpx.MockTransport(record))
    return OllamaTranslator(base_url="http://ollama.test", model=MODEL, client=client), sent


def test_translates_the_whole_page_in_one_call() -> None:
    translator, sent = translator_with(
        lambda _request: chat_answer(["Você chegou atrasado!", "O trem atrasou!"])
    )

    result = translator.translate(["YOU ARE LATE!", "THE TRAIN WAS DELAYED!"], REQUEST)

    assert result == ["Você chegou atrasado!", "O trem atrasou!"]
    [(path, payload)] = sent
    assert path == "/api/chat"
    assert payload["model"] == MODEL
    assert payload["stream"] is False
    assert payload["keep_alive"] == DEFAULT_KEEP_ALIVE
    assert payload["think"] is False
    assert payload["format"] == translations_schema(2)
    assert "English" in payload["messages"][0]["content"]
    assert "Brazilian Portuguese" in payload["messages"][0]["content"]
    assert json.loads(payload["messages"][-1]["content"]) == {
        "segments": ["YOU ARE LATE!", "THE TRAIN WAS DELAYED!"]
    }


def test_falls_back_to_one_balloon_at_a_time_when_the_count_is_wrong() -> None:
    answers = iter([chat_answer(["só uma"]), chat_answer(["primeira"]), chat_answer("not json")])
    translator, sent = translator_with(lambda _request: next(answers))

    result = translator.translate(["FIRST", "SECOND"], REQUEST)

    # The second balloon keeps failing, so it stays in the original instead of losing the page.
    assert result == ["primeira", "SECOND"]
    assert len(sent) == 3


def test_explains_when_ollama_is_not_running() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    translator, _ = translator_with(refuse)

    with pytest.raises(TranslatorError, match="não está rodando"):
        translator.translate(["HELLO"], REQUEST)


def test_explains_how_to_install_a_missing_model() -> None:
    translator, _ = translator_with(
        lambda _request: httpx.Response(404, json={"error": "model not found"})
    )

    with pytest.raises(TranslatorError, match=f"ollama pull {MODEL}"):
        translator.translate(["HELLO"], REQUEST)


def test_other_http_errors_are_reported() -> None:
    translator, _ = translator_with(lambda _request: httpx.Response(500, json={"error": "boom"}))

    with pytest.raises(TranslatorError, match="HTTP 500"):
        translator.translate(["HELLO"], REQUEST)


def test_previous_page_lines_go_as_context() -> None:
    translator, sent = translator_with(lambda _request: chat_answer(["Oi"]))

    translator.translate(["HI"], TranslationRequest("en", "pt-BR", context=("EARLIER LINE",)))

    assert json.loads(sent[0][1]["messages"][-1]["content"])["previous_page"] == ["EARLIER LINE"]


def test_nothing_to_translate_makes_no_call() -> None:
    translator, sent = translator_with(lambda _request: chat_answer([]))

    assert translator.translate([], REQUEST) == []
    assert sent == []


def test_unload_frees_the_model() -> None:
    translator, sent = translator_with(lambda _request: httpx.Response(200, json={"done": True}))

    translator.unload()

    assert sent == [("/api/generate", {"model": MODEL, "keep_alive": 0})]


def test_parsing_rejects_malformed_answers() -> None:
    assert parse_translations({"message": {"content": '{"translations": [" Oi "]}'}}, 1) == ["Oi"]
    assert parse_translations({"message": {"content": '{"translations": [1]}'}}, 1) is None
    assert parse_translations({"message": {"content": "{}"}}, 1) is None
    assert parse_translations({"error": "x"}, 1) is None


def test_warm_up_loads_the_model_without_a_prompt() -> None:
    translator, sent = translator_with(lambda _request: httpx.Response(200, json={"done": True}))

    translator.warm_up()

    assert sent == [("/api/generate", {"model": MODEL, "keep_alive": DEFAULT_KEEP_ALIVE})]


def test_warm_up_reports_a_missing_model() -> None:
    translator, _ = translator_with(
        lambda _request: httpx.Response(404, json={"error": "not found"})
    )

    with pytest.raises(TranslatorError, match="ollama pull"):
        translator.warm_up()


def test_keep_alive_can_be_changed() -> None:
    sent: list[Any] = []

    def record(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"done": True})

    client = httpx.Client(base_url="http://ollama.test", transport=httpx.MockTransport(record))
    OllamaTranslator(model=MODEL, keep_alive="2h", client=client).warm_up()

    assert sent[0]["keep_alive"] == "2h"


def test_brazilian_portuguese_gets_style_rules_and_worked_examples() -> None:
    messages = build_messages(["HI"], REQUEST)

    assert '"tá"' in messages[0]["content"]
    assert [message["role"] for message in messages[1:]] == ["user", "assistant"] * 2 + ["user"]
    for user, assistant in zip(messages[1:-1:2], messages[2:-1:2], strict=True):
        examples = json.loads(user["content"])["segments"]
        assert len(json.loads(assistant["content"])["translations"]) == len(examples)


def test_other_targets_get_no_brazilian_rules() -> None:
    messages = build_messages(["HI"], TranslationRequest("en", "es"))

    assert '"tá"' not in messages[0]["content"]
    assert "Spanish" in messages[0]["content"]
    assert len(messages) == 2
