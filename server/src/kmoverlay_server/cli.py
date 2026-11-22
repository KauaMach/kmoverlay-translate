"""Command line: `kmoverlay serve` starts the server, `kmoverlay translate` translates one image."""

import argparse
import logging
import os
import sys
import time
from collections.abc import Sequence
from pathlib import Path

import uvicorn
from PIL import Image, UnidentifiedImageError

from kmoverlay_server.api.app import create_app
from kmoverlay_server.pipeline.demo_pipeline import DemoPipeline
from kmoverlay_server.pipeline.ocr_readers.rapidocr_reader import RapidOcrReader
from kmoverlay_server.pipeline.page_pipeline import PagePipeline, PipelineOptions
from kmoverlay_server.pipeline.translation_pipeline import TranslationPipeline
from kmoverlay_server.pipeline.translators import Translator, TranslatorError
from kmoverlay_server.pipeline.translators.ollama import (
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_OLLAMA_URL,
    OllamaTranslator,
)
from kmoverlay_server.pipeline.translators.passthrough import PassthroughTranslator
from kmoverlay_server.settings import (
    ServerSettings,
    SettingsError,
    apply_env_file,
    load_settings,
)

DEFAULT_ENV_FILE = Path(".env")
EXIT_OK = 0
EXIT_TRANSLATION_ERROR = 1
EXIT_CONFIGURATION_ERROR = 2
TRANSLATOR_CHOICES = ("ollama", "none")
SOURCE_CHOICES = ("en", "ja", "ko", "zh", "es", "ru")
TARGET_CHOICES = ("pt-BR", "en", "es")
DIRECTION_CHOICES = ("ltr", "rtl", "strip")
MILLISECONDS_PER_SECOND = 1000
LOG_FORMAT = "%(levelname)s:     %(message)s"


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point of the `kmoverlay` command."""
    parser = argparse.ArgumentParser(
        prog="kmoverlay", description="Servidor local do KMOverlay Translate."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser("serve", help="inicia o servidor HTTP")
    serve.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help="arquivo com as variáveis KMOVERLAY_* (padrão: .env)",
    )

    translate = commands.add_parser("translate", help="traduz uma imagem e salva o resultado")
    translate.add_argument("input", type=Path, help="imagem de entrada")
    translate.add_argument("-o", "--output", type=Path, required=True, help="imagem de saída")
    translate.add_argument(
        "--source", choices=SOURCE_CHOICES, default="en", help="idioma do texto (padrão: en)"
    )
    translate.add_argument(
        "--target", choices=TARGET_CHOICES, default="pt-BR", help="idioma da tradução"
    )
    translate.add_argument(
        "--direction", choices=DIRECTION_CHOICES, default="ltr", help="ordem de leitura"
    )
    translate.add_argument(
        "--translator",
        choices=TRANSLATOR_CHOICES,
        default="ollama",
        help='"none" mantém o texto original (testa leitura, apagamento e escrita sem modelo)',
    )
    translate.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    translate.add_argument("--ollama-model", default=DEFAULT_OLLAMA_MODEL)

    arguments = parser.parse_args(argv)
    if arguments.command == "translate":
        return translate_command(arguments)
    return serve_command(arguments.env_file)


def serve_command(env_file: Path) -> int:
    """Loads the configuration and runs the server until it is stopped."""
    apply_env_file(env_file, os.environ)
    try:
        settings = load_settings(os.environ)
    except SettingsError as error:
        print(f"Configuração inválida: {error}.", file=sys.stderr)
        return EXIT_CONFIGURATION_ERROR
    # Same style as uvicorn's lines, so the warm-up messages read as part of the server log.
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    # httpx logs every call to Ollama at INFO, one line per page: only its warnings matter.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    app = create_app(settings, create_server_pipeline(settings))
    uvicorn.run(app, host=settings.host, port=settings.port)
    return EXIT_OK


def create_server_pipeline(settings: ServerSettings) -> PagePipeline:
    """The pipeline chosen in `KMOVERLAY_PIPELINE`: the real one, or the demonstration one."""
    if settings.pipeline == "demo":
        return DemoPipeline(settings.demo_delay_ms)
    translator = OllamaTranslator(
        base_url=settings.ollama_url,
        model=settings.ollama_model,
        keep_alive=settings.ollama_keep_alive,
    )
    return TranslationPipeline(RapidOcrReader(), translator)


def translate_command(arguments: argparse.Namespace) -> int:
    """Translates one image and prints each balloon with its translation."""
    try:
        with Image.open(arguments.input) as opened:
            image = opened.convert("RGB")
    except (FileNotFoundError, UnidentifiedImageError) as error:
        print(f"Não foi possível abrir {arguments.input}: {error}", file=sys.stderr)
        return EXIT_CONFIGURATION_ERROR
    pipeline = TranslationPipeline(RapidOcrReader(), create_translator(arguments))
    options = PipelineOptions(
        source_language=arguments.source,
        target_language=arguments.target,
        reading_direction=arguments.direction,
        render_image=True,
    )
    started = time.perf_counter()
    try:
        [result] = pipeline.translate([image], options)
    except TranslatorError as error:
        print(f"Falha na tradução: {error}", file=sys.stderr)
        return EXIT_TRANSLATION_ERROR
    elapsed_ms = round((time.perf_counter() - started) * MILLISECONDS_PER_SECOND)
    if result.image is not None:
        result.image.save(arguments.output)
    for number, region in enumerate(result.regions, start=1):
        print(f"{number}. {region.source_text}\n   → {region.translated_text}")
    print(f"{len(result.regions)} balões em {elapsed_ms} ms → {arguments.output}")
    return EXIT_OK


def create_translator(arguments: argparse.Namespace) -> Translator:
    """The translator chosen on the command line."""
    if arguments.translator == "none":
        return PassthroughTranslator()
    return OllamaTranslator(base_url=arguments.ollama_url, model=arguments.ollama_model)
