import io
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from kmoverlay_server.demo.demo_pages import DIALOGUES, demo_page_png
from kmoverlay_server.pipeline.ocr_readers.rapidocr_reader import (
    TILE_HEIGHT,
    TILE_OVERLAP,
    RapidOcrReader,
    drop_artwork,
    drop_duplicates,
    tile_tops,
)
from kmoverlay_server.pipeline.text_blocks import TextLine


def demo_page(number: int) -> Image.Image:
    return Image.open(io.BytesIO(demo_page_png(number))).convert("RGB")


@pytest.fixture(scope="module")
def reader() -> RapidOcrReader:
    # One reader for the module: loading the models is the slow part.
    return RapidOcrReader()


def test_reads_every_balloon_of_a_demo_page_and_ignores_the_drawings(
    reader: RapidOcrReader,
) -> None:
    lines = reader.read(demo_page(1))

    text = " ".join(
        line.text for line in sorted(lines, key=lambda item: (item.box[1], item.box[0]))
    )
    for sentence in DIALOGUES[0]:
        for word in sentence.split():
            assert word in text
    assert all(any(character.isalpha() for character in line.text) for line in lines)
    assert all(line.height < 60 for line in lines)


def test_tall_strips_are_read_in_tiles_without_duplicates(reader: RapidOcrReader) -> None:
    pages = [demo_page(1), demo_page(2)]
    strip = Image.new("RGB", (pages[0].width, sum(page.height for page in pages)))
    strip.paste(pages[0], (0, 0))
    strip.paste(pages[1], (0, pages[0].height))

    lines = reader.read(strip)

    texts = [line.text for line in lines]
    assert len(texts) == len(set(texts))
    assert any("MAP" in text for text in texts)
    assert any("AGAIN" in text for text in texts)


def test_tiles_cover_the_image_with_overlap() -> None:
    assert tile_tops(1200) == [0]
    tops = tile_tops(4000)
    assert tops[0] == 0
    assert tops[-1] + TILE_HEIGHT == 4000
    assert all(
        second - first <= TILE_HEIGHT - TILE_OVERLAP
        for first, second in zip(tops, tops[1:], strict=False)
    )


def test_lines_read_twice_in_the_overlap_are_kept_once() -> None:
    whole = TextLine((10, 100, 200, 124), "HELLO THERE", 0.99)
    cut = TextLine((10, 100, 200, 112), "HELLO", 0.7)
    other = TextLine((10, 130, 200, 154), "GENERAL", 0.99)

    assert drop_duplicates([cut, whole, other]) == [whole, other]


def test_symbols_low_scores_and_huge_letters_are_dropped() -> None:
    lines = [
        TextLine((0, 0, 100, 24), "HELLO", 0.99),
        TextLine((0, 30, 100, 54), "WORLD", 0.99),
        TextLine((0, 60, 100, 84), "BLURRY", 0.3),
        TextLine((0, 90, 100, 114), "●", 0.9),
        TextLine((0, 120, 180, 350), "O", 0.8),
    ]

    assert [line.text for line in drop_artwork(lines)] == ["HELLO", "WORLD"]


def test_the_engine_is_created_once() -> None:
    created = []

    def factory():
        created.append(True)
        return lambda _image: SimpleNamespace(boxes=None, txts=None, scores=None)

    reader = RapidOcrReader(engine_factory=factory)
    reader.read(Image.fromarray(np.zeros((50, 50, 3), dtype=np.uint8)))
    reader.read(Image.fromarray(np.zeros((50, 50, 3), dtype=np.uint8)))

    assert created == [True]
