import io
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from kmoverlay_server import cli
from kmoverlay_server.demo.demo_pages import DIALOGUES, demo_page_png
from kmoverlay_server.pipeline.ocr_readers.rapidocr_reader import RapidOcrReader
from kmoverlay_server.pipeline.page_pipeline import PipelineOptions
from kmoverlay_server.pipeline.text_blocks import TextLine
from kmoverlay_server.pipeline.translation_pipeline import TranslationPipeline
from kmoverlay_server.pipeline.translators import TranslationRequest, TranslatorError

LTR = PipelineOptions("en", "pt-BR", "ltr", render_image=True)


class NumberingTranslator:
    """Fake translator that answers "TRADUÇÃO 1", "TRADUÇÃO 2"… and records its calls."""

    name = "numbering"
    version = "numbering"

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def translate(self, segments: Sequence[str], request: TranslationRequest) -> list[str]:
        self.calls.append(list(segments))
        return [f"TRADUÇÃO {number}" for number in range(1, len(segments) + 1)]

    def unload(self) -> None:
        """Nothing to free."""


class FixedReader:
    """Fake OCR returning the same lines for every image."""

    name = "fixed"

    def __init__(self, lines: list[TextLine]) -> None:
        self._lines = lines

    def read(self, image: Image.Image) -> list[TextLine]:
        return self._lines


class WrongCountTranslator(NumberingTranslator):
    def translate(self, segments: Sequence[str], request: TranslationRequest) -> list[str]:
        return []


def demo_page(number: int) -> Image.Image:
    return Image.open(io.BytesIO(demo_page_png(number))).convert("RGB")


@pytest.fixture(scope="module")
def reader() -> RapidOcrReader:
    return RapidOcrReader()


def test_translates_a_demo_page_in_one_call(reader: RapidOcrReader) -> None:
    translator = NumberingTranslator()
    page = demo_page(1)

    [result] = TranslationPipeline(reader, translator).translate([page], LTR)

    assert translator.calls == [list(DIALOGUES[0])]
    assert [region.translated_text for region in result.regions] == [
        f"TRADUÇÃO {n}" for n in range(1, 5)
    ]
    assert result.image is not None
    assert result.image.size == page.size
    assert not np.array_equal(np.asarray(result.image), np.asarray(page))


def test_regions_only_skips_erasing_and_rendering() -> None:
    lines = [TextLine((10, 10, 110, 34), "HELLO", 0.99)]
    pipeline = TranslationPipeline(FixedReader(lines), NumberingTranslator())

    [result] = pipeline.translate(
        [Image.new("RGB", (200, 100), "white")], PipelineOptions("en", "pt-BR", "ltr", False)
    )

    assert result.image is None
    assert result.regions[0].polygon == ((10, 10), (110, 10), (110, 34), (10, 34))
    assert result.regions[0].source_text == "HELLO"


def test_strip_slices_are_joined_and_split_back() -> None:
    # One line in the first slice, one in the second (y 150 of the joined image = 50 of slice 2).
    lines = [
        TextLine((10, 20, 110, 44), "TOP", 0.99),
        TextLine((10, 150, 110, 174), "BOTTOM", 0.99),
    ]
    translator = NumberingTranslator()
    slices = [Image.new("RGB", (200, 100), "white"), Image.new("RGB", (200, 100), "white")]

    results = TranslationPipeline(FixedReader(lines), translator).translate(
        slices, PipelineOptions("en", "pt-BR", "strip", True)
    )

    assert translator.calls == [["TOP", "BOTTOM"]]
    assert [region.source_text for region in results[0].regions] == ["TOP"]
    assert [region.source_text for region in results[1].regions] == ["BOTTOM"]
    assert results[1].regions[0].polygon[0] == (10, 50)
    assert all(result.image is not None and result.image.size == (200, 100) for result in results)


def test_pages_without_text_do_not_call_the_translator() -> None:
    translator = NumberingTranslator()

    [result] = TranslationPipeline(FixedReader([]), translator).translate(
        [Image.new("RGB", (50, 50))], LTR
    )

    assert translator.calls == []
    assert result.regions == ()


def test_a_translator_that_loses_balloons_is_an_error() -> None:
    pipeline = TranslationPipeline(
        FixedReader([TextLine((0, 0, 50, 20), "HI", 0.99)]), WrongCountTranslator()
    )

    with pytest.raises(TranslatorError):
        pipeline.translate([Image.new("RGB", (100, 50), "white")], LTR)


def test_the_version_names_the_reader_and_the_translator() -> None:
    pipeline = TranslationPipeline(FixedReader([]), NumberingTranslator())

    assert pipeline.version == "ocr-1+fixed+numbering"


def test_the_translate_command_writes_the_image(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "page.png"
    output = tmp_path / "translated.png"
    source.write_bytes(demo_page_png(2))

    exit_code = cli.main(["translate", str(source), "-o", str(output), "--translator", "none"])

    assert exit_code == cli.EXIT_OK
    assert Image.open(output).size == (800, 1200)
    printed = capsys.readouterr().out
    assert "DID YOU BRING THE MAP?" in printed
    assert "4 balões" in printed


def test_the_translate_command_reports_a_missing_file(tmp_path: Path) -> None:
    exit_code = cli.main(
        ["translate", str(tmp_path / "missing.png"), "-o", str(tmp_path / "out.png")]
    )

    assert exit_code == cli.EXIT_CONFIGURATION_ERROR
