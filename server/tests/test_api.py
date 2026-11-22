import base64
import hashlib
import io
import json
from collections.abc import Sequence
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from kmoverlay_server.pipeline.demo_pipeline import (
    ACCENT_COLOR,
    BANNER_TEXT,
    DEMO_PIPELINE_VERSION,
    MIN_BANNER_HEIGHT,
)
from kmoverlay_server.pipeline.page_pipeline import PageResult, PipelineOptions
from kmoverlay_server.settings import ServerSettings
from tests.conftest import TEST_TOKEN, CountingPipeline, make_client, png_bytes

OPTIONS = {"source_lang": "en", "target_lang": "pt-BR"}
COLOR_TOLERANCE = 12


def translate(
    client: TestClient,
    headers: dict[str, str],
    images: Sequence[bytes],
    options: dict[str, Any] | str = OPTIONS,
) -> Any:
    files = [
        ("images", (f"page-{index}.png", data, "image/png")) for index, data in enumerate(images)
    ]
    raw_options = options if isinstance(options, str) else json.dumps(options)
    return client.post("/v1/translate", headers=headers, files=files, data={"options": raw_options})


def error_code(response: Any) -> str:
    return response.json()["error"]["code"]


def test_every_endpoint_requires_the_token(client: TestClient) -> None:
    response = client.get("/v1/health")

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "unauthorized", "message": "Token ausente ou inválido."}
    }
    assert client.get("/v1/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/v1/lookup", json={}).status_code == 401


def test_health_reports_the_pipeline(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/v1/health", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "gpu_name": None, "models_loaded": False}


def test_unknown_host_names_are_refused(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/v1/health", headers={**auth_headers, "Host": "evil.example"})

    assert response.status_code == 400


def test_answers_carry_no_cors_headers(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/v1/health", headers={**auth_headers, "Origin": "https://evil.example"})

    assert "access-control-allow-origin" not in response.headers


def test_translate_returns_the_marked_image(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    original = png_bytes(200, 300)

    response = translate(client, auth_headers, [original])

    assert response.status_code == 200
    body = response.json()
    assert body["pipeline_version"] == DEMO_PIPELINE_VERSION
    assert "total" in body["timings_ms"]
    [result] = body["results"]
    assert result["image_sha256"] == hashlib.sha256(original).hexdigest()
    assert result["regions"][0]["translated_text"] == BANNER_TEXT
    image = Image.open(io.BytesIO(base64.b64decode(result["image_webp_base64"])))
    assert image.format == "WEBP"
    assert image.size == (200, 300)
    pixel = image.convert("RGB").getpixel((100, 5))
    assert all(
        abs(channel - expected) <= COLOR_TOLERANCE
        for channel, expected in zip(pixel, ACCENT_COLOR, strict=True)
    )


def test_translate_can_return_only_the_regions(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = translate(client, auth_headers, [png_bytes()], {**OPTIONS, "output": "regions"})

    [result] = response.json()["results"]
    assert result["image_webp_base64"] is None
    # A 300 px tall image gets the minimum banner height.
    assert result["regions"][0]["polygon"][2] == [200, MIN_BANNER_HEIGHT]


def test_strip_slices_keep_their_order(client: TestClient, auth_headers: dict[str, str]) -> None:
    slices = [png_bytes(200, 300, (250, 250, 250)), png_bytes(200, 400, (10, 10, 10))]

    response = translate(client, auth_headers, slices, {**OPTIONS, "reading_direction": "strip"})

    hashes = [result["image_sha256"] for result in response.json()["results"]]
    assert hashes == [hashlib.sha256(data).hexdigest() for data in slices]


def test_repeated_requests_come_from_the_cache(
    client: TestClient, auth_headers: dict[str, str], pipeline: CountingPipeline
) -> None:
    image = png_bytes()

    first = translate(client, auth_headers, [image])
    # Priority only orders the work, so it must not cause a new translation.
    second = translate(client, auth_headers, [image], {**OPTIONS, "priority": "prefetch"})
    translate(client, auth_headers, [image], {**OPTIONS, "target_lang": "es"})

    assert first.json() == second.json()
    assert pipeline.calls == 2


def test_lookup_returns_only_images_already_translated(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    image = png_bytes()
    lookup_body = {"image_sha256s": [hashlib.sha256(image).hexdigest()], "options": OPTIONS}

    before = client.post("/v1/lookup", headers=auth_headers, json=lookup_body)
    translated = translate(client, auth_headers, [image])
    after = client.post("/v1/lookup", headers=auth_headers, json=lookup_body)

    assert before.status_code == 404
    assert error_code(before) == "not-cached"
    assert after.status_code == 200
    assert after.json() == translated.json()


def test_lookup_rejects_malformed_hashes(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/v1/lookup", headers=auth_headers, json={"image_sha256s": ["../etc"], "options": OPTIONS}
    )

    assert response.status_code == 422
    assert error_code(response) == "invalid-request"


def test_invalid_options_are_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    not_json = translate(client, auth_headers, [png_bytes()], "not json")
    unknown_language = translate(
        client, auth_headers, [png_bytes()], {**OPTIONS, "source_lang": "xx"}
    )
    extra_field = translate(client, auth_headers, [png_bytes()], {**OPTIONS, "debug": True})

    for response in (not_json, unknown_language, extra_field):
        assert response.status_code == 422
        assert error_code(response) == "invalid-request"


def test_files_that_are_not_images_are_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = translate(client, auth_headers, [b"<html>not an image</html>"])

    assert response.status_code == 422
    assert error_code(response) == "invalid-image"


def test_size_limits_are_enforced(auth_headers: dict[str, str]) -> None:
    small_files = make_client(
        ServerSettings(token=TEST_TOKEN, max_image_bytes=100), CountingPipeline()
    )
    few_pixels = make_client(
        ServerSettings(token=TEST_TOKEN, max_image_pixels=1000), CountingPipeline()
    )
    one_image = make_client(
        ServerSettings(token=TEST_TOKEN, max_images_per_request=1), CountingPipeline()
    )

    too_big = translate(small_files, auth_headers, [png_bytes()])
    too_many_pixels = translate(few_pixels, auth_headers, [png_bytes()])
    too_many_images = translate(one_image, auth_headers, [png_bytes(), png_bytes()])

    assert (too_big.status_code, error_code(too_big)) == (413, "image-too-large")
    assert (too_many_pixels.status_code, error_code(too_many_pixels)) == (413, "image-too-large")
    assert (too_many_images.status_code, error_code(too_many_images)) == (413, "too-many-images")


def test_unknown_routes_use_the_error_format(client: TestClient) -> None:
    response = client.get("/nothing-here")

    assert response.status_code == 404
    assert error_code(response) == "not-found"


class FailingPipeline(CountingPipeline):
    def translate(
        self, images: Sequence[Image.Image], options: PipelineOptions
    ) -> list[PageResult]:
        raise RuntimeError("secret internal detail")


def test_unexpected_errors_hide_the_details(auth_headers: dict[str, str]) -> None:
    client = make_client(
        ServerSettings(token=TEST_TOKEN), FailingPipeline(), raise_server_exceptions=False
    )

    response = translate(client, auth_headers, [png_bytes()])

    assert response.status_code == 500
    assert error_code(response) == "internal-error"
    assert "secret" not in response.text
