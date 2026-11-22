"""Text lines found by the OCR, grouped into balloons and put in reading order."""

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

from kmoverlay_server.pipeline.page_pipeline import ReadingDirection

Box = tuple[int, int, int, int]
"""Left, top, right, bottom, in pixels of the image."""

# Two lines belong to the same balloon when the gap between them is at most
# this fraction of the smaller line height...
MAX_LINE_GAP_RATIO = 0.8
# ...and their heights are similar (a title next to a balloon is not merged).
MAX_LINE_HEIGHT_RATIO = 1.6
# Blocks whose vertical ranges overlap by more than this fraction of the
# smaller one are on the same row, read side by side.
ROW_OVERLAP_RATIO = 0.3
HYPHENS = ("-", "‐", "‑")


@dataclass(frozen=True)
class TextLine:
    """One line of text read by the OCR."""

    box: Box
    text: str
    score: float

    @property
    def width(self) -> int:
        return self.box[2] - self.box[0]

    @property
    def height(self) -> int:
        return self.box[3] - self.box[1]


@dataclass(frozen=True)
class TextBlock:
    """A balloon (or caption): lines that are read together, top to bottom."""

    lines: tuple[TextLine, ...]

    @property
    def box(self) -> Box:
        return union_box([line.box for line in self.lines])

    @property
    def text(self) -> str:
        """The lines as one sentence; a word split with a hyphen at the line end is joined."""
        text = ""
        for line in self.lines:
            content = line.text.strip()
            if text.endswith(HYPHENS) and content[:1].isalpha():
                text = text[:-1] + content
            else:
                text = f"{text} {content}".strip()
        return text

    @property
    def line_height(self) -> float:
        return median(line.height for line in self.lines)

    @property
    def is_uppercase(self) -> bool:
        """Comics usually letter in capitals; the translation keeps that style."""
        letters = [character for character in self.text if character.isalpha()]
        return bool(letters) and all(character.isupper() for character in letters)


def union_box(boxes: Sequence[Box]) -> Box:
    """Smallest box that contains all the boxes."""
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def group_lines(lines: Sequence[TextLine], direction: ReadingDirection) -> list[TextBlock]:
    """Groups lines into balloons and returns them in reading order."""
    parents = list(range(len(lines)))

    def root(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for first in range(len(lines)):
        for second in range(first + 1, len(lines)):
            if _same_balloon(lines[first], lines[second]):
                parents[root(first)] = root(second)

    groups: dict[int, list[TextLine]] = {}
    for index, line in enumerate(lines):
        groups.setdefault(root(index), []).append(line)
    blocks = [
        TextBlock(tuple(sorted(group, key=lambda line: (line.box[1], line.box[0]))))
        for group in groups.values()
    ]
    return sort_blocks(blocks, direction)


def sort_blocks(blocks: Sequence[TextBlock], direction: ReadingDirection) -> list[TextBlock]:
    """Reading order: rows from top to bottom, and inside a row left to right
    (`ltr`), right to left (`rtl`, manga) or simply top to bottom (`strip`)."""
    by_top = sorted(blocks, key=lambda block: (block.box[1], block.box[0]))
    if direction == "strip":
        return by_top
    rows: list[list[TextBlock]] = []
    for block in by_top:
        if rows and _overlaps_row(block, rows[-1]):
            rows[-1].append(block)
        else:
            rows.append([block])
    ordered: list[TextBlock] = []
    for row in rows:
        if direction == "rtl":
            ordered.extend(sorted(row, key=lambda block: -block.box[2]))
        else:
            ordered.extend(sorted(row, key=lambda block: block.box[0]))
    return ordered


def _same_balloon(first: TextLine, second: TextLine) -> bool:
    smaller = min(first.height, second.height)
    larger = max(first.height, second.height)
    if smaller <= 0 or larger / smaller > MAX_LINE_HEIGHT_RATIO:
        return False
    vertical_gap = max(first.box[1], second.box[1]) - min(first.box[3], second.box[3])
    horizontal_overlap = min(first.box[2], second.box[2]) - max(first.box[0], second.box[0])
    return vertical_gap <= MAX_LINE_GAP_RATIO * smaller and horizontal_overlap > 0


def _overlaps_row(block: TextBlock, row: list[TextBlock]) -> bool:
    top, bottom = block.box[1], block.box[3]
    for other in row:
        overlap = min(bottom, other.box[3]) - max(top, other.box[1])
        smaller = min(bottom - top, other.box[3] - other.box[1])
        if smaller > 0 and overlap / smaller > ROW_OVERLAP_RATIO:
            return True
    return False
