import logging
import threading
from collections.abc import Sequence

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from kmoverlay_server.api.app import create_app
from kmoverlay_server.pipeline.ocr_readers.rapidocr_reader import RapidOcrReader
from kmoverlay_server.pipeline.page_pipeline import PageResult, PipelineOptions
from kmoverlay_server.pipeline.text_blocks import TextLine
from kmoverlay_server.pipeline.translation_pipeline import TranslationPipeline
from kmoverlay_server.pipeline.translators import TranslationRequest, TranslatorError
from kmoverlay_server.settings import ServerSettings, load_settings
from kmoverlay_server.warm_up import start_warm_up, warm_up
from tests.conftest import LOCAL_BASE_URL, TEST_TOKEN, CountingPipeline

WAIT_SECONDS = 5


class WarmUpSpyPipeline(CountingPipeline):
    def __init__(self, error: Exception | None = None) -> None:
        super().__init__()
        self.warmed_up = threading.Event()
        self._error = error

    def warm_up(self) -> None:
        self.warmed_up.set()
        if self._error is not None:
            raise self._error


class RecordingReader:
    name = "recording"

    def __init__(self, events: list[str]) -> None:
        self._events = events

    def warm_up(self) -> None:
        self._events.append("reader")

    def read(self, image: Image.Image) -> list[TextLine]:
        return []


class RecordingTranslator:
    name = "recording"

    def __init__(self, events: list[str]) -> None:
        self._events = events

    def translate(self, segments: Sequence[str], request: TranslationRequest) -> list[str]:
        return list(segments)

    def warm_up(self) -> None:
        self._events.append("translator")

    def unload(self) -> None:
        """Nothing to free."""


def test_the_server_loads_the_models_when_it_starts() -> None:
    pipeline = WarmUpSpyPipeline()

    with TestClient(
        create_app(ServerSettings(token=TEST_TOKEN), pipeline), base_url=LOCAL_BASE_URL
    ):
        assert pipeline.warmed_up.wait(WAIT_SECONDS)


def test_the_warm_up_runs_in_the_background() -> None:
    pipeline = WarmUpSpyPipeline()

    thread = start_warm_up(pipeline)
    thread.join(WAIT_SECONDS)

    assert thread.daemon
    assert pipeline.warmed_up.is_set()


def test_an_unavailable_translator_only_logs_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    pipeline = WarmUpSpyPipeline(
        TranslatorError("O Ollama não está rodando em http://127.0.0.1:11434.")
    )

    with caplog.at_level(logging.INFO):
        warm_up(pipeline)

    warnings = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert [record.getMessage() for record in warnings] == [
        "Não foi possível carregar o tradutor: O Ollama não está rodando em http://127.0.0.1:11434."
    ]


def test_unexpected_failures_are_logged_with_the_traceback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    pipeline = WarmUpSpyPipeline(RuntimeError("disk error"))

    with caplog.at_level(logging.INFO):
        warm_up(pipeline)

    [failure] = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert failure.exc_info is not None


def test_a_successful_warm_up_logs_its_duration(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        warm_up(WarmUpSpyPipeline())

    assert any("Modelos carregados em" in record.getMessage() for record in caplog.records)


def test_the_translation_pipeline_loads_the_ocr_and_the_translator() -> None:
    events: list[str] = []

    TranslationPipeline(RecordingReader(events), RecordingTranslator(events)).warm_up()

    assert events == ["reader", "translator"]


def test_the_ocr_reader_loads_its_engine_once() -> None:
    created: list[bool] = []

    def factory():
        created.append(True)
        return lambda _image: None

    reader = RapidOcrReader(engine_factory=factory)
    reader.warm_up()
    reader.warm_up()

    assert created == [True]


def test_the_keep_alive_of_the_model_can_be_configured() -> None:
    settings = load_settings({"KMOVERLAY_TOKEN": TEST_TOKEN, "KMOVERLAY_OLLAMA_KEEP_ALIVE": "2h"})

    assert settings.ollama_keep_alive == "2h"
    assert load_settings({"KMOVERLAY_TOKEN": TEST_TOKEN}).ollama_keep_alive == "30m"


def test_the_demo_pipeline_has_nothing_to_load() -> None:
    pipeline = CountingPipeline()

    pipeline.warm_up()

    [result] = pipeline.translate(
        [Image.fromarray(np.zeros((40, 40, 3), dtype=np.uint8))],
        PipelineOptions("en", "pt-BR", "ltr", render_image=False),
    )
    assert isinstance(result, PageResult)
