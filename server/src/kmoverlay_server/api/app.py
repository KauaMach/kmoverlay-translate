"""Builds the FastAPI application."""

from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware

from kmoverlay_server.api.errors import install_error_handlers
from kmoverlay_server.api.routes import create_api_router
from kmoverlay_server.demo.routes import create_demo_router
from kmoverlay_server.pipeline.page_pipeline import PagePipeline
from kmoverlay_server.result_cache import MemoryResultCache
from kmoverlay_server.settings import ServerSettings


def create_app(settings: ServerSettings, pipeline: PagePipeline) -> FastAPI:
    """Creates the server application.

    - No CORS headers: web pages cannot read the answers, and the extension does
      not need them because its host permissions bypass CORS.
    - Only known Host names are answered, against DNS rebinding.
    - The interactive docs are off to keep the surface small.
    """
    app = FastAPI(title="KMOverlay server", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    install_error_handlers(app)
    app.include_router(create_api_router(settings, pipeline, MemoryResultCache()))
    app.include_router(create_demo_router())
    return app
