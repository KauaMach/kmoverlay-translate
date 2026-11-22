"""Server configuration, read from environment variables and an optional `.env` file."""

from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from kmoverlay_server.pipeline.translators.ollama import (
    DEFAULT_KEEP_ALIVE,
    DEFAULT_OLLAMA_MODEL,
    DEFAULT_OLLAMA_URL,
)

TOKEN_VARIABLE = "KMOVERLAY_TOKEN"
HOST_VARIABLE = "KMOVERLAY_HOST"
PORT_VARIABLE = "KMOVERLAY_PORT"
ALLOWED_HOSTS_VARIABLE = "KMOVERLAY_ALLOWED_HOSTS"
DEMO_DELAY_VARIABLE = "KMOVERLAY_DEMO_DELAY_MS"
PIPELINE_VARIABLE = "KMOVERLAY_PIPELINE"
OLLAMA_URL_VARIABLE = "KMOVERLAY_OLLAMA_URL"
OLLAMA_MODEL_VARIABLE = "KMOVERLAY_OLLAMA_MODEL"
OLLAMA_KEEP_ALIVE_VARIABLE = "KMOVERLAY_OLLAMA_KEEP_ALIVE"
CACHE_DIR_VARIABLE = "KMOVERLAY_CACHE_DIR"
CACHE_MAX_MB_VARIABLE = "KMOVERLAY_CACHE_MAX_MB"
XDG_CACHE_HOME_VARIABLE = "XDG_CACHE_HOME"
CACHE_FOLDER_NAME = "kmoverlay-translate"
DEFAULT_CACHE_MAX_MB = 1024

PipelineName = Literal["translate", "demo"]
PIPELINE_NAMES: tuple[PipelineName, ...] = ("translate", "demo")
DEFAULT_PIPELINE: PipelineName = "translate"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_DEMO_DELAY_MS = 800
MIN_TOKEN_LENGTH = 16
MAX_PORT = 65535
MAX_IMAGE_BYTES = 20 * 1024 * 1024
# Webtoon slices are tall; 50 megapixels still rejects decompression bombs.
MAX_IMAGE_PIXELS = 50_000_000
MAX_IMAGES_PER_REQUEST = 8
LOCAL_HOSTNAMES = ("127.0.0.1", "localhost")
WILDCARD_BIND_ADDRESSES = ("0.0.0.0", "::")
TOKEN_HINT = 'gere um com: python -c "import secrets; print(secrets.token_urlsafe(32))"'


class SettingsError(ValueError):
    """The configuration is missing a value or has an invalid one."""


@dataclass(frozen=True)
class ServerSettings:
    """Validated server configuration."""

    token: str
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    extra_allowed_hosts: tuple[str, ...] = ()
    pipeline: PipelineName = DEFAULT_PIPELINE
    """`translate` reads and translates; `demo` only marks the images (no models needed)."""
    ollama_url: str = DEFAULT_OLLAMA_URL
    ollama_model: str = DEFAULT_OLLAMA_MODEL
    ollama_keep_alive: str = DEFAULT_KEEP_ALIVE
    """How long Ollama keeps the model in memory after the last page (e.g. `30m`, `2h`)."""
    cache_dir: Path | None = None
    """Folder of the translation cache; `None` keeps it in memory (tests)."""
    cache_max_mb: int = DEFAULT_CACHE_MAX_MB
    demo_delay_ms: int = DEFAULT_DEMO_DELAY_MS
    max_image_bytes: int = MAX_IMAGE_BYTES
    max_image_pixels: int = MAX_IMAGE_PIXELS
    max_images_per_request: int = MAX_IMAGES_PER_REQUEST

    @property
    def allowed_hosts(self) -> list[str]:
        """Host header values the server answers, against DNS rebinding attacks.

        Local names always work; a specific bind address is added; listening on
        all interfaces requires the network names (IP, Tailscale) to be listed.
        """
        hosts = [*LOCAL_HOSTNAMES, *self.extra_allowed_hosts]
        if self.host not in WILDCARD_BIND_ADDRESSES and self.host not in hosts:
            hosts.append(self.host)
        return hosts


def load_settings(environment: Mapping[str, str]) -> ServerSettings:
    """Builds the settings from environment variables.

    Raises:
        SettingsError: when the token is missing or a value is invalid.
    """
    token = environment.get(TOKEN_VARIABLE, "").strip()
    if token == "":
        raise SettingsError(f"defina {TOKEN_VARIABLE} no .env ({TOKEN_HINT})")
    if len(token) < MIN_TOKEN_LENGTH:
        raise SettingsError(
            f"{TOKEN_VARIABLE} precisa ter pelo menos {MIN_TOKEN_LENGTH} caracteres ({TOKEN_HINT})"
        )
    return ServerSettings(
        token=token,
        host=environment.get(HOST_VARIABLE, "").strip() or DEFAULT_HOST,
        port=_read_port(environment.get(PORT_VARIABLE)),
        extra_allowed_hosts=_read_list(environment.get(ALLOWED_HOSTS_VARIABLE)),
        pipeline=_read_pipeline(environment.get(PIPELINE_VARIABLE)),
        ollama_url=environment.get(OLLAMA_URL_VARIABLE, "").strip() or DEFAULT_OLLAMA_URL,
        ollama_model=environment.get(OLLAMA_MODEL_VARIABLE, "").strip() or DEFAULT_OLLAMA_MODEL,
        ollama_keep_alive=environment.get(OLLAMA_KEEP_ALIVE_VARIABLE, "").strip()
        or DEFAULT_KEEP_ALIVE,
        cache_dir=_read_cache_dir(environment),
        cache_max_mb=_read_cache_max_mb(environment.get(CACHE_MAX_MB_VARIABLE)),
        demo_delay_ms=_read_non_negative_int(
            DEMO_DELAY_VARIABLE, environment.get(DEMO_DELAY_VARIABLE), DEFAULT_DEMO_DELAY_MS
        ),
    )


def read_env_file(path: Path) -> dict[str, str]:
    """Reads `KEY=VALUE` lines, ignoring blank lines, comments and surrounding quotes."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = _unquote(value.strip())
    return values


def apply_env_file(path: Path, environment: MutableMapping[str, str]) -> None:
    """Adds the values of an env file that are not set yet; real variables always win."""
    if not path.is_file():
        return
    for key, value in read_env_file(path).items():
        environment.setdefault(key, value)


def default_cache_dir(environment: Mapping[str, str]) -> Path:
    """Default cache folder, outside the repository.

    `$XDG_CACHE_HOME/kmoverlay-translate`, or `~/.cache/kmoverlay-translate`.
    """
    base = environment.get(XDG_CACHE_HOME_VARIABLE, "").strip()
    return (Path(base) if base else Path.home() / ".cache") / CACHE_FOLDER_NAME


def _read_cache_dir(environment: Mapping[str, str]) -> Path:
    raw = environment.get(CACHE_DIR_VARIABLE, "").strip()
    return Path(raw).expanduser() if raw else default_cache_dir(environment)


def _read_cache_max_mb(raw: str | None) -> int:
    value = _read_non_negative_int(CACHE_MAX_MB_VARIABLE, raw, DEFAULT_CACHE_MAX_MB)
    if value < 1:
        raise SettingsError(f"{CACHE_MAX_MB_VARIABLE} deve ser pelo menos 1")
    return value


def _read_pipeline(raw: str | None) -> PipelineName:
    value = (raw or "").strip() or DEFAULT_PIPELINE
    for name in PIPELINE_NAMES:
        if value == name:
            return name
    raise SettingsError(f"{PIPELINE_VARIABLE} deve ser {' ou '.join(PIPELINE_NAMES)}")


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _read_port(raw: str | None) -> int:
    port = _read_non_negative_int(PORT_VARIABLE, raw, DEFAULT_PORT)
    if not 1 <= port <= MAX_PORT:
        raise SettingsError(f"{PORT_VARIABLE} deve estar entre 1 e {MAX_PORT}")
    return port


def _read_non_negative_int(name: str, raw: str | None, default: int) -> int:
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise SettingsError(f"{name} deve ser um número inteiro") from error
    if value < 0:
        raise SettingsError(f"{name} não pode ser negativo")
    return value


def _read_list(raw: str | None) -> tuple[str, ...]:
    if raw is None:
        return ()
    return tuple(item.strip() for item in raw.split(",") if item.strip() != "")
