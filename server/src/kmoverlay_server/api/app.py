"""Builds the FastAPI application."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware

from kmoverlay_server.api.errors import install_error_handlers
from kmoverlay_server.api.routes import create_api_router
from kmoverlay_server.demo.routes import create_demo_router
from kmoverlay_server.pipeline.page_pipeline import PagePipeline
from kmoverlay_server.result_cache import MemoryResultCache
from kmoverlay_server.settings import ServerSettings
from kmoverlay_server.warm_up import start_warm_up


def create_app(settings: ServerSettings, pipeline: PagePipeline) -> FastAPI:
    """Creates the server application.

    - No CORS headers: web pages cannot read the answers, and the extension does
      not need them because its host permissions bypass CORS.
    - Only known Host names are answered, against DNS rebinding.
    - The interactive docs are off to keep the surface small.
    - The models load in the background as soon as the server starts.
    """

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        start_warm_up(pipeline)
        yield

    app = FastAPI(
        title="KMOverlay server",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    install_error_handlers(app)
    app.include_router(create_api_router(settings, pipeline, MemoryResultCache()))
    app.include_router(create_demo_router())
    return app
