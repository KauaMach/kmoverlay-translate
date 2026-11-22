import io
from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from kmoverlay_server.api.app import create_app
from kmoverlay_server.pipeline.demo_pipeline import DemoPipeline
from kmoverlay_server.pipeline.page_pipeline import PageResult, PipelineOptions
from kmoverlay_server.settings import ServerSettings

TEST_TOKEN = "test-token-0123456789"
LOCAL_BASE_URL = "http://127.0.0.1:8000"


class CountingPipeline(DemoPipeline):
    """Demonstration pipeline without delay that counts how often it runs."""

    def __init__(self) -> None:
        super().__init__(delay_ms=0)
        self.calls = 0

    def translate(
        self, images: Sequence[Image.Image], options: PipelineOptions
    ) -> list[PageResult]:
        self.calls += 1
        return super().translate(images, options)


def make_client(settings: ServerSettings, pipeline: DemoPipeline, **kwargs: bool) -> TestClient:
    return TestClient(create_app(settings, pipeline), base_url=LOCAL_BASE_URL, **kwargs)


def png_bytes(
    width: int = 200, height: int = 300, color: tuple[int, int, int] = (240, 240, 240)
) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def settings() -> ServerSettings:
    return ServerSettings(token=TEST_TOKEN)


@pytest.fixture
def pipeline() -> CountingPipeline:
    return CountingPipeline()


@pytest.fixture
def client(settings: ServerSettings, pipeline: CountingPipeline) -> TestClient:
    return make_client(settings, pipeline)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_TOKEN}"}
