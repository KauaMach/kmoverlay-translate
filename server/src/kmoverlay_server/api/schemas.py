"""Request and response bodies of the API contract."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

SourceLanguage = Literal["en", "ja", "ko", "zh", "es", "ru"]
TargetLanguage = Literal["pt-BR", "en", "es"]
SHA256_PATTERN = r"^[0-9a-f]{64}$"
MAX_SERIES_ID_LENGTH = 200

Sha256 = Annotated[str, StringConstraints(pattern=SHA256_PATTERN)]
"""Lowercase hexadecimal SHA-256 digest of the original image bytes."""


class TranslateOptions(BaseModel):
    """Options of `POST /v1/translate` and `POST /v1/lookup`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source_lang: SourceLanguage
    target_lang: TargetLanguage
    reading_direction: Literal["ltr", "rtl", "strip"] = "ltr"
    output: Literal["image", "regions"] = "image"
    # Only orders the work; it never changes the result, so it is left out of cache keys.
    priority: Literal["visible", "prefetch"] = "visible"
    series_id: str | None = Field(default=None, max_length=MAX_SERIES_ID_LENGTH)

    def cache_fields(self) -> dict[str, str | None]:
        """Options that change the result, for the cache key."""
        return self.model_dump(exclude={"priority"})


class Region(BaseModel):
    """A translated text area; the polygon uses pixels of the original image."""

    polygon: list[tuple[int, int]]
    source_text: str
    translated_text: str


class ImageResult(BaseModel):
    """Result for one image, in the order the images were sent."""

    image_sha256: str
    image_webp_base64: str | None = None
    regions: list[Region]


class TranslateResponse(BaseModel):
    """Body of `POST /v1/translate` and `POST /v1/lookup`."""

    pipeline_version: str
    results: list[ImageResult]
    timings_ms: dict[str, int]


class LookupRequest(BaseModel):
    """Body of `POST /v1/lookup`: the hashes of images already translated once."""

    model_config = ConfigDict(extra="forbid")

    image_sha256s: list[Sha256] = Field(min_length=1)
    options: TranslateOptions


class HealthResponse(BaseModel):
    """Body of `GET /v1/health`."""

    status: Literal["ok"]
    gpu_name: str | None
    models_loaded: bool
    translator: str
    pipeline_version: str
    """Same as in the translations: a client cache entry with another version is stale."""
