"""Reading uploaded images safely and encoding results."""

import base64
import hashlib
import io
from dataclasses import dataclass
from http import HTTPStatus

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from kmoverlay_server.api.errors import ApiError

IMAGE_TOO_LARGE_CODE = "image-too-large"
INVALID_IMAGE_CODE = "invalid-image"
INVALID_IMAGE_MESSAGE = "O arquivo enviado não é uma imagem válida."
RESULT_FORMAT = "WEBP"
RESULT_QUALITY = 90


@dataclass(frozen=True)
class UploadedImage:
    """An uploaded image, decoded, with the hash of its original bytes."""

    sha256: str
    image: Image.Image


async def read_uploaded_image(upload: UploadFile, max_bytes: int, max_pixels: int) -> UploadedImage:
    """Reads and decodes an upload, rejecting files too big to process.

    The pixel count is checked before decoding, so a small file that expands
    into a huge image (decompression bomb) is refused cheaply.

    Raises:
        ApiError: 413 when the file or the image is too large, 422 when it is not an image.
    """
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ApiError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            IMAGE_TOO_LARGE_CODE,
            f"A imagem passa de {max_bytes // (1024 * 1024)} MB.",
        )
    sha256 = hashlib.sha256(data).hexdigest()
    try:
        with Image.open(io.BytesIO(data)) as opened:
            width, height = opened.size
            if width * height > max_pixels:
                raise _too_many_pixels(max_pixels)
            opened.load()
            image = opened.convert("RGB")
    except Image.DecompressionBombError as error:
        raise _too_many_pixels(max_pixels) from error
    except (UnidentifiedImageError, OSError) as error:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY, INVALID_IMAGE_CODE, INVALID_IMAGE_MESSAGE
        ) from error
    return UploadedImage(sha256=sha256, image=image)


def encode_webp_base64(image: Image.Image) -> str:
    """Encodes a result image as base64 WebP, the format of the contract."""
    buffer = io.BytesIO()
    image.save(buffer, format=RESULT_FORMAT, quality=RESULT_QUALITY)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _too_many_pixels(max_pixels: int) -> ApiError:
    return ApiError(
        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        IMAGE_TOO_LARGE_CODE,
        f"A imagem passa de {max_pixels // 1_000_000} megapixels.",
    )
