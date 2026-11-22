"""Command line: `kmoverlay serve` starts the server."""

import argparse
import os
import sys
from collections.abc import Sequence
from pathlib import Path

import uvicorn

from kmoverlay_server.api.app import create_app
from kmoverlay_server.pipeline.demo_pipeline import DemoPipeline
from kmoverlay_server.settings import SettingsError, apply_env_file, load_settings

DEFAULT_ENV_FILE = Path(".env")
EXIT_OK = 0
EXIT_CONFIGURATION_ERROR = 2


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
    arguments = parser.parse_args(argv)
    return serve_command(arguments.env_file)


def serve_command(env_file: Path) -> int:
    """Loads the configuration and runs the server until it is stopped."""
    apply_env_file(env_file, os.environ)
    try:
        settings = load_settings(os.environ)
    except SettingsError as error:
        print(f"Configuração inválida: {error}.", file=sys.stderr)
        return EXIT_CONFIGURATION_ERROR
    # The real pipeline replaces the demonstration one in Fase 1.
    app = create_app(settings, DemoPipeline(settings.demo_delay_ms))
    uvicorn.run(app, host=settings.host, port=settings.port)
    return EXIT_OK
