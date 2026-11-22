from kmoverlay_server.pipeline.text_blocks import TextBlock, TextLine, group_lines, union_box


def line(left: int, top: int, right: int, text: str, height: int = 24) -> TextLine:
    return TextLine(box=(left, top, right, top + height), text=text, score=0.99)


# Layout of the first demonstration page: two balloons above, two side by side below.
DEMO_LINES = [
    line(480, 642, 705, "THIS TIME IT IS TRUE!"),
    line(386, 124, 463, "AGAIN!"),
    line(530, 247, 699, "THE TRAIN WAS"),
    line(106, 629, 310, "ALWAYS THE SAME"),
    line(348, 99, 501, "YOU ARE LATE"),
    line(570, 298, 657, "SWEAR!"),
    line(156, 655, 260, "EXCUSE..."),
    line(554, 272, 675, "DELAYED, I"),
]


def texts(blocks: list[TextBlock]) -> list[str]:
    return [block.text for block in blocks]


def test_lines_become_balloons_in_left_to_right_reading_order() -> None:
    assert texts(group_lines(DEMO_LINES, "ltr")) == [
        "YOU ARE LATE AGAIN!",
        "THE TRAIN WAS DELAYED, I SWEAR!",
        "ALWAYS THE SAME EXCUSE...",
        "THIS TIME IT IS TRUE!",
    ]


def test_manga_reads_balloons_of_a_row_from_right_to_left() -> None:
    blocks = group_lines(DEMO_LINES, "rtl")

    assert texts(blocks)[2:] == ["THIS TIME IT IS TRUE!", "ALWAYS THE SAME EXCUSE..."]


def test_strips_are_read_from_top_to_bottom() -> None:
    blocks = group_lines(DEMO_LINES, "strip")

    assert texts(blocks)[2:] == ["ALWAYS THE SAME EXCUSE...", "THIS TIME IT IS TRUE!"]


def test_lines_far_apart_or_of_different_sizes_stay_separate() -> None:
    title = TextLine(box=(100, 0, 400, 80), text="CHAPTER 3", score=0.99)
    balloon = line(150, 90, 350, "HELLO")
    far_below = line(150, 300, 350, "BYE")

    assert len(group_lines([title, balloon, far_below], "ltr")) == 3


def test_a_word_split_with_a_hyphen_is_joined() -> None:
    block = TextBlock((line(0, 0, 100, "UNBELIEV-"), line(0, 26, 100, "ABLE STUFF")))

    assert block.text == "UNBELIEVABLE STUFF"
    assert block.is_uppercase
    assert block.box == (0, 0, 100, 50)


def test_mixed_case_text_is_not_uppercase() -> None:
    assert not TextBlock((line(0, 0, 100, "Hello there"),)).is_uppercase


def test_union_box() -> None:
    assert union_box([(10, 20, 30, 40), (0, 25, 15, 50)]) == (0, 20, 30, 50)
