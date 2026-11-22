import numpy as np
from PIL import Image, ImageDraw, ImageFont

from kmoverlay_server.pipeline.inpainter import erase_text
from kmoverlay_server.pipeline.text_blocks import TextBlock, TextLine
from kmoverlay_server.pipeline.text_renderer import (
    MIN_FONT_SIZE,
    fit_text,
    load_font,
    render_translations,
    text_area,
    wrap_words,
)

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
BALLOON = (100, 50, 500, 250)


def balloon_page() -> tuple[Image.Image, TextBlock]:
    """A white oval balloon with two lines of black text on a gray panel."""
    image = Image.new("RGB", (600, 320), (220, 220, 220))
    draw = ImageDraw.Draw(image)
    draw.ellipse(BALLOON, fill=WHITE, outline=BLACK, width=3)
    font = ImageFont.load_default(size=24)
    draw.text((230, 118), "HELLO", fill=BLACK, font=font)
    draw.text((220, 150), "THERE!", fill=BLACK, font=font)
    block = TextBlock(
        (
            TextLine((226, 116, 312, 144), "HELLO", 0.99),
            TextLine((216, 148, 316, 176), "THERE!", 0.99),
        )
    )
    return image, block


def dark_pixels(image: Image.Image, box: tuple[int, int, int, int]) -> int:
    region = np.asarray(image.crop(box).convert("L"))
    return int((region < 128).sum())


def test_erasing_removes_the_letters_and_keeps_the_balloon() -> None:
    image, block = balloon_page()

    erased, [colors] = erase_text(image, [block])

    assert colors.background == WHITE
    assert colors.text == BLACK
    assert dark_pixels(image, block.box) > 0
    assert dark_pixels(erased, block.box) == 0
    # The outline of the balloon is outside the text and stays.
    assert dark_pixels(erased, (BALLOON[0], 140, BALLOON[0] + 6, 160)) > 0


def test_the_text_area_is_the_inside_of_the_balloon() -> None:
    image, block = balloon_page()
    erased, [colors] = erase_text(image, [block])

    left, top, right, bottom = text_area(erased, block, colors.background)

    assert left < block.box[0] and right > block.box[2]
    assert left > BALLOON[0] and right < BALLOON[2]
    assert top >= BALLOON[1] and bottom <= BALLOON[3]


def test_text_on_an_open_background_stays_near_its_box() -> None:
    image = Image.new("RGB", (400, 300), WHITE)
    block = TextBlock((TextLine((150, 140, 250, 164), "CAPTION", 0.99),))

    left, top, right, bottom = text_area(image, block, WHITE)

    assert left >= 130 and right <= 270


def test_fitting_shrinks_long_text_and_wraps_between_words() -> None:
    short = fit_text("OI!", (0, 0, 300, 100), max_font_size=28)
    long = fit_text(
        "UMA FRASE BEM MAIS LONGA QUE PRECISA QUEBRAR EM VÁRIAS LINHAS", (0, 0, 200, 100), 28
    )

    assert short.font_size == 28
    assert short.lines == ("OI!",)
    assert MIN_FONT_SIZE <= long.font_size < 28
    assert len(long.lines) > 1
    assert all(load_font(long.font_size).getlength(line) <= 200 for line in long.lines)


def test_words_are_never_split() -> None:
    assert wrap_words("UM DOIS TRÊS", load_font(20), max_width=1) == ["UM", "DOIS", "TRÊS"]


def test_translations_are_written_in_capitals_inside_the_balloon() -> None:
    image, block = balloon_page()
    erased, colors = erase_text(image, [block])

    rendered = render_translations(erased, [block], colors, ["Olá, você!"])

    assert dark_pixels(rendered, BALLOON) > dark_pixels(erased, BALLOON)
    # Nothing is drawn outside the balloon.
    assert dark_pixels(rendered, (0, 0, 90, 320)) == dark_pixels(erased, (0, 0, 90, 320))
