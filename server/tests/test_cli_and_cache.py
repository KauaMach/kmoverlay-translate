from pathlib import Path
from typing import Any

import pytest

from kmoverlay_server import cli
from kmoverlay_server.result_cache import MemoryResultCache

TOKEN = "a-token-long-enough-123"


def test_lru_cache_drops_the_least_recently_used_entry() -> None:
    cache: MemoryResultCache[str] = MemoryResultCache(max_entries=2)
    cache.put("a", "first")
    cache.put("b", "second")

    assert cache.get("a") == "first"
    cache.put("c", "third")

    assert cache.get("b") is None
    assert cache.get("a") == "first"
    assert cache.get("c") == "third"
    assert len(cache) == 2


def test_lru_cache_needs_room_for_one_entry() -> None:
    with pytest.raises(ValueError):
        MemoryResultCache(max_entries=0)


def test_serve_refuses_to_start_without_a_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("KMOVERLAY_TOKEN", raising=False)

    exit_code = cli.main(["serve", "--env-file", str(tmp_path / "missing.env")])

    assert exit_code == cli.EXIT_CONFIGURATION_ERROR
    assert "KMOVERLAY_TOKEN" in capsys.readouterr().err


def test_serve_reads_the_env_file_and_starts_uvicorn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for variable in ("KMOVERLAY_TOKEN", "KMOVERLAY_HOST", "KMOVERLAY_PORT"):
        monkeypatch.delenv(variable, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(f"KMOVERLAY_TOKEN={TOKEN}\nKMOVERLAY_PORT=9100\n", encoding="utf-8")
    started: dict[str, Any] = {}
    monkeypatch.setattr(
        cli.uvicorn, "run", lambda app, host, port: started.update(host=host, port=port)
    )

    exit_code = cli.main(["serve", "--env-file", str(env_file)])

    assert exit_code == cli.EXIT_OK
    assert started == {"host": "127.0.0.1", "port": 9100}
