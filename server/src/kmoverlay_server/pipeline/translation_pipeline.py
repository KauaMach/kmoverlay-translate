"""The real pipeline: read the text, translate it, erase the original and write the translation."""

from collections.abc import Sequence

from PIL import Image

from kmoverlay_server.pipeline.inpainter import erase_text
from kmoverlay_server.pipeline.ocr_readers import TextReader
from kmoverlay_server.pipeline.page_pipeline import PageResult, PipelineOptions, TranslatedRegion
from kmoverlay_server.pipeline.text_blocks import Box, TextBlock, group_lines
from kmoverlay_server.pipeline.text_renderer import render_translations
from kmoverlay_server.pipeline.translators import TranslationRequest, Translator, TranslatorError

PIPELINE_VERSION = "ocr-1"
WRONG_COUNT_MESSAGE = "O tradutor devolveu um número de traduções diferente do número de balões."


class TranslationPipeline:
    """Reads, translates, erases and renders; implements `PagePipeline`."""

    gpu_name: str | None = None
    models_loaded = True

    def __init__(self, reader: TextReader, translator: Translator) -> None:
        self._reader = reader
        self._translator = translator

    @property
    def translator_name(self) -> str:
        return self._translator.name

    @property
    def version(self) -> str:
        """Changes when the reader or the translator changes, so caches never mix them."""
        return f"{PIPELINE_VERSION}+{self._reader.name}+{self._translator.version}"

    def translate(
        self, images: Sequence[Image.Image], options: PipelineOptions
    ) -> list[PageResult]:
        """Translates the images; consecutive strip slices are joined so no balloon is cut."""
        if options.reading_direction == "strip" and len(images) > 1 and _same_width(images):
            [joined] = self._translate_pages([_stack(images)], options)
            return _split(joined, [image.height for image in images])
        return self._translate_pages(images, options)

    def warm_up(self) -> None:
        """Loads the OCR and the translation model.

        Raises:
            TranslatorError: when the translator is unreachable.
        """
        self._reader.warm_up()
        self._translator.warm_up()

    def _translate_pages(
        self, images: Sequence[Image.Image], options: PipelineOptions
    ) -> list[PageResult]:
        pages = [
            (image, group_lines(self._reader.read(image), options.reading_direction))
            for image in images
        ]
        segments = [block.text for _, blocks in pages for block in blocks]
        translations = self._translate(segments, options)
        results = []
        start = 0
        for image, blocks in pages:
            page_translations = translations[start : start + len(blocks)]
            start += len(blocks)
            results.append(_page_result(image, blocks, page_translations, options.render_image))
        return results

    def _translate(self, segments: list[str], options: PipelineOptions) -> list[str]:
        if not segments:
            return []
        # One call for every balloon of the request, so the translator sees the whole page.
        translations = self._translator.translate(
            segments, TranslationRequest(options.source_language, options.target_language)
        )
        if len(translations) != len(segments):
            raise TranslatorError(WRONG_COUNT_MESSAGE)
        return translations


def _page_result(
    image: Image.Image, blocks: list[TextBlock], translations: list[str], render_image: bool
) -> PageResult:
    regions = tuple(
        TranslatedRegion(
            polygon=_polygon(block.box), source_text=block.text, translated_text=translation
        )
        for block, translation in zip(blocks, translations, strict=True)
    )
    if not render_image:
        return PageResult(image=None, regions=regions)
    erased, colors = erase_text(image, blocks)
    return PageResult(
        image=render_translations(erased, blocks, colors, translations), regions=regions
    )


def _polygon(box: Box) -> tuple[tuple[int, int], ...]:
    left, top, right, bottom = box
    return ((left, top), (right, top), (right, bottom), (left, bottom))


def _same_width(images: Sequence[Image.Image]) -> bool:
    return len({image.width for image in images}) == 1


def _stack(images: Sequence[Image.Image]) -> Image.Image:
    joined = Image.new("RGB", (images[0].width, sum(image.height for image in images)))
    top = 0
    for image in images:
        joined.paste(image.convert("RGB"), (0, top))
        top += image.height
    return joined


def _split(result: PageResult, heights: Sequence[int]) -> list[PageResult]:
    """Cuts a joined result back into slices; a region belongs to the slice of its center."""
    pieces = []
    top = 0
    for height in heights:
        bottom = top + height
        regions = tuple(
            TranslatedRegion(
                polygon=tuple((x, y - top) for x, y in region.polygon),
                source_text=region.source_text,
                translated_text=region.translated_text,
            )
            for region in result.regions
            if top <= _center_y(region) < bottom
        )
        image = (
            None
            if result.image is None
            else result.image.crop((0, top, result.image.width, bottom))
        )
        pieces.append(PageResult(image=image, regions=regions))
        top = bottom
    return pieces


def _center_y(region: TranslatedRegion) -> float:
    ys = [y for _, y in region.polygon]
    return (min(ys) + max(ys)) / 2
