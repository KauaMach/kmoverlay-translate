import io
import re

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from kmoverlay_server.demo.demo_pages import PAGE_COUNT, PAGE_HEIGHT, PAGE_WIDTH, demo_page_png
from kmoverlay_server.pipeline.demo_pipeline import BANNER_TEXT, DemoPipeline
from kmoverlay_server.pipeline.page_pipeline import PipelineOptions

REGIONS_ONLY = PipelineOptions("en", "pt-BR", "ltr", render_image=False)


def test_the_reader_lists_every_page_without_a_token(client: TestClient) -> None:
    response = client.get("/demo")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    sources = re.findall(r'src="(/demo/pages/\d+\.png)"', response.text)
    assert sources == [f"/demo/pages/{number}.png" for number in range(1, PAGE_COUNT + 1)]
    assert response.text.count('loading="lazy"') == PAGE_COUNT - 2


def test_pages_are_png_images_of_the_announced_size(client: TestClient) -> None:
    response = client.get("/demo/pages/1.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(response.content)).size == (PAGE_WIDTH, PAGE_HEIGHT)


@pytest.mark.parametrize("page_number", [0, PAGE_COUNT + 1])
def test_pages_out_of_range_do_not_exist(client: TestClient, page_number: int) -> None:
    response = client.get(f"/demo/pages/{page_number}.png")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not-found"
    with pytest.raises(ValueError):
        demo_page_png(page_number)


def test_every_page_is_different() -> None:
    assert len({demo_page_png(number) for number in range(1, PAGE_COUNT + 1)}) == PAGE_COUNT


def test_the_demo_pipeline_waits_the_configured_time() -> None:
    waits: list[float] = []
    pipeline = DemoPipeline(delay_ms=250, sleep=waits.append)

    [result] = pipeline.translate([Image.new("RGB", (100, 100))], REGIONS_ONLY)

    assert waits == [0.25]
    assert result.image is None
    assert result.regions[0].translated_text == BANNER_TEXT
