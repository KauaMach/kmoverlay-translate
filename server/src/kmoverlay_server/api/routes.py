"""Endpoints of the `/v1` API."""

import json
import time
from collections.abc import Sequence
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from kmoverlay_server.api.auth import create_token_dependency
from kmoverlay_server.api.errors import INVALID_REQUEST_CODE, ApiError
from kmoverlay_server.api.images import (
    UploadedImage,
    encode_webp_base64,
    read_uploaded_image,
)
from kmoverlay_server.api.schemas import (
    HealthResponse,
    ImageResult,
    LookupRequest,
    Region,
    TranslateOptions,
    TranslateResponse,
)
from kmoverlay_server.job_queue import (
    PRIORITY_PREFETCH,
    PRIORITY_VISIBLE,
    PriorityGate,
    QueueFullError,
)
from kmoverlay_server.pipeline.page_pipeline import PagePipeline, PageResult, PipelineOptions
from kmoverlay_server.pipeline.translators import TranslatorError
from kmoverlay_server.result_cache import ResultCache
from kmoverlay_server.settings import ServerSettings

TOO_MANY_IMAGES_CODE = "too-many-images"
TRANSLATOR_UNAVAILABLE_CODE = "translator-unavailable"
QUEUE_FULL_CODE = "queue-full"
QUEUE_FULL_MESSAGE = "Muitas páginas na fila; tente de novo em instantes."
# Nginx convention for "the client went away"; nobody reads the answer anyway.
CLIENT_CLOSED_REQUEST = 499
JSON_MEDIA_TYPE = "application/json"
PRIORITIES = {"visible": PRIORITY_VISIBLE, "prefetch": PRIORITY_PREFETCH}
NOT_CACHED_CODE = "not-cached"
NOT_CACHED_MESSAGE = "Estas imagens ainda não foram traduzidas com estas opções."
INVALID_OPTIONS_MESSAGE = "As opções não seguem o contrato da API."
MILLISECONDS_PER_SECOND = 1000


def create_api_router(
    settings: ServerSettings, pipeline: PagePipeline, cache: ResultCache
) -> APIRouter:
    """Builds the `/v1` routes; every one of them requires the token."""
    router = APIRouter(
        prefix="/v1", dependencies=[Depends(create_token_dependency(settings.token))]
    )
    # One job at a time, because the models share a single GPU; pages on screen go first.
    gate = PriorityGate()

    @router.get("/health")
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            gpu_name=pipeline.gpu_name,
            models_loaded=pipeline.models_loaded,
            translator=pipeline.translator_name,
            pipeline_version=pipeline.version,
        )

    @router.post("/translate", response_model=TranslateResponse)
    async def translate(
        request: Request,
        images: Annotated[list[UploadFile], File()],
        options: Annotated[str, Form()],
    ) -> Response:
        parsed_options = parse_options(options)
        check_image_count(len(images), settings.max_images_per_request)
        uploaded = [
            await read_uploaded_image(upload, settings.max_image_bytes, settings.max_image_pixels)
            for upload in images
        ]
        key = cache_key([image.sha256 for image in uploaded], parsed_options, pipeline.version)
        cached = cache.get(key)
        if cached is not None:
            return json_response(cached)
        started = time.perf_counter()
        try:
            async with gate.turn(PRIORITIES[parsed_options.priority]):
                # The reader scrolled away or the page closed while this waited.
                if await request.is_disconnected():
                    return Response(status_code=CLIENT_CLOSED_REQUEST)
                results = await run_in_threadpool(run_pipeline, pipeline, uploaded, parsed_options)
        except QueueFullError as error:
            raise ApiError(
                HTTPStatus.TOO_MANY_REQUESTS, QUEUE_FULL_CODE, QUEUE_FULL_MESSAGE
            ) from error
        except TranslatorError as error:
            raise ApiError(
                HTTPStatus.SERVICE_UNAVAILABLE, TRANSLATOR_UNAVAILABLE_CODE, str(error)
            ) from error
        elapsed_ms = round((time.perf_counter() - started) * MILLISECONDS_PER_SECOND)
        body = (
            TranslateResponse(
                pipeline_version=pipeline.version, results=results, timings_ms={"total": elapsed_ms}
            )
            .model_dump_json()
            .encode("utf-8")
        )
        cache.put(key, body)
        return json_response(body)

    @router.post("/lookup", response_model=TranslateResponse)
    async def lookup(request: LookupRequest) -> Response:
        check_image_count(len(request.image_sha256s), settings.max_images_per_request)
        cached = cache.get(cache_key(request.image_sha256s, request.options, pipeline.version))
        if cached is None:
            raise ApiError(HTTPStatus.NOT_FOUND, NOT_CACHED_CODE, NOT_CACHED_MESSAGE)
        return json_response(cached)

    return router


def json_response(body: bytes) -> Response:
    """Sends cached JSON as it is, without decoding and encoding it again."""
    return Response(content=body, media_type=JSON_MEDIA_TYPE)


def parse_options(raw: str) -> TranslateOptions:
    """Parses the `options` form field (JSON).

    Raises:
        ApiError: 422 when it is not valid JSON or does not follow the contract.
    """
    try:
        return TranslateOptions.model_validate_json(raw)
    except ValidationError as error:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY, INVALID_REQUEST_CODE, INVALID_OPTIONS_MESSAGE
        ) from error


def check_image_count(count: int, maximum: int) -> None:
    """Raises a 413 `ApiError` when a request carries more images than allowed."""
    if count > maximum:
        raise ApiError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            TOO_MANY_IMAGES_CODE,
            f"Envie no máximo {maximum} imagens por vez.",
        )


def cache_key(
    image_sha256s: Sequence[str], options: TranslateOptions, pipeline_version: str
) -> str:
    """Key of a result: the original images, the options that change it and the pipeline version."""
    return json.dumps(
        {
            "images": list(image_sha256s),
            "options": options.cache_fields(),
            "pipeline": pipeline_version,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def run_pipeline(
    pipeline: PagePipeline, uploaded: Sequence[UploadedImage], options: TranslateOptions
) -> list[ImageResult]:
    """Runs the pipeline and encodes the results; CPU-bound, so it runs in a worker thread."""
    page_results = pipeline.translate(
        [image.image for image in uploaded], to_pipeline_options(options)
    )
    return [
        to_image_result(image.sha256, result)
        for image, result in zip(uploaded, page_results, strict=True)
    ]


def to_pipeline_options(options: TranslateOptions) -> PipelineOptions:
    """Converts API options into what the pipeline needs."""
    return PipelineOptions(
        source_language=options.source_lang,
        target_language=options.target_lang,
        reading_direction=options.reading_direction,
        render_image=options.output == "image",
    )


def to_image_result(image_sha256: str, result: PageResult) -> ImageResult:
    """Converts a pipeline result into the response format."""
    return ImageResult(
        image_sha256=image_sha256,
        image_webp_base64=None if result.image is None else encode_webp_base64(result.image),
        regions=[
            Region(
                polygon=list(region.polygon),
                source_text=region.source_text,
                translated_text=region.translated_text,
            )
            for region in result.regions
        ],
    )
