"""Routes of the demonstration reader (`/demo`). They need no token: the content is synthetic."""

from http import HTTPStatus
from string import Template

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, Response

from kmoverlay_server.api.errors import ApiError
from kmoverlay_server.demo.demo_pages import PAGE_COUNT, PAGE_HEIGHT, PAGE_WIDTH, demo_page_png

PAGE_NOT_FOUND_CODE = "not-found"
PAGE_NOT_FOUND_MESSAGE = "Página de demonstração inexistente."
# The first pages load at once; the others lazily, as on real reader sites.
EAGER_PAGE_COUNT = 2
PAGE_CACHE_CONTROL = "public, max-age=3600"

READER_TEMPLATE = Template("""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leitor de demonstração — KMOverlay</title>
<style>
body { margin: 0; background: #1f1f23; color: #ffffff; font-family: system-ui, sans-serif; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px;
  padding: 14px 24px; font-size: 15px; }
header span { color: #d6d4cd; font-size: 14px; }
main { display: flex; flex-direction: column; align-items: center; gap: 24px;
  padding: 8px 16px 48px; }
img { display: block; width: 100%; max-width: ${page_width}px; height: auto; background: #ffffff; }
</style>
</head>
<body>
<header>
<strong>Leitor de demonstração</strong><span>Capítulo 1 · ${page_count} páginas</span>
</header>
<main>
${pages}
</main>
</body>
</html>
""")


def render_demo_reader() -> str:
    """HTML of the demonstration reader, with every page in order."""
    pages = "\n".join(
        f'<img src="/demo/pages/{number}.png" alt="Página {number}" width="{PAGE_WIDTH}" '
        f'height="{PAGE_HEIGHT}" loading="{"eager" if number <= EAGER_PAGE_COUNT else "lazy"}">'
        for number in range(1, PAGE_COUNT + 1)
    )
    return READER_TEMPLATE.substitute(page_width=PAGE_WIDTH, page_count=PAGE_COUNT, pages=pages)


def create_demo_router() -> APIRouter:
    """Builds the `/demo` routes."""
    router = APIRouter(prefix="/demo")

    @router.get("")
    async def demo_reader() -> HTMLResponse:
        return HTMLResponse(render_demo_reader())

    @router.get("/pages/{page_number}.png")
    async def demo_page(page_number: int) -> Response:
        if not 1 <= page_number <= PAGE_COUNT:
            raise ApiError(HTTPStatus.NOT_FOUND, PAGE_NOT_FOUND_CODE, PAGE_NOT_FOUND_MESSAGE)
        return Response(
            content=demo_page_png(page_number),
            media_type="image/png",
            headers={"Cache-Control": PAGE_CACHE_CONTROL},
        )

    return router
