"""Loads the models when the server starts, so the first page is not slow."""

import logging
import threading
import time

from kmoverlay_server.pipeline.page_pipeline import PagePipeline
from kmoverlay_server.pipeline.translators import TranslatorError

logger = logging.getLogger(__name__)


def start_warm_up(pipeline: PagePipeline) -> threading.Thread:
    """Loads the pipeline models in a background thread; the server answers meanwhile.

    A request that arrives before the models are loaded simply waits for them,
    as it would without the warm-up.
    """
    thread = threading.Thread(
        target=warm_up, args=(pipeline,), name="kmoverlay-warm-up", daemon=True
    )
    thread.start()
    return thread


def warm_up(pipeline: PagePipeline) -> None:
    """Loads the models and logs how long it took, or why it failed (never raises)."""
    started = time.perf_counter()
    logger.info("Carregando os modelos (%s)...", pipeline.translator_name)
    try:
        pipeline.warm_up()
    except TranslatorError as error:
        # The server still runs: the reader sees this same message when a page fails.
        logger.warning("Não foi possível carregar o tradutor: %s", error)
        return
    except Exception:
        # A thread that dies silently would hide the problem until the first page.
        logger.exception("Falha inesperada ao carregar os modelos")
        return
    logger.info("Modelos carregados em %.1f s.", time.perf_counter() - started)
