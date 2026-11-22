from pathlib import Path

import pytest

from kmoverlay_server.settings import (
    DEFAULT_DEMO_DELAY_MS,
    DEFAULT_HOST,
    DEFAULT_PORT,
    ServerSettings,
    SettingsError,
    apply_env_file,
    load_settings,
    read_env_file,
)

TOKEN = "a-token-long-enough-123"


def test_the_token_is_required() -> None:
    with pytest.raises(SettingsError, match="KMOVERLAY_TOKEN"):
        load_settings({})
    with pytest.raises(SettingsError, match="pelo menos 16"):
        load_settings({"KMOVERLAY_TOKEN": "short"})


def test_defaults_listen_only_on_this_computer() -> None:
    settings = load_settings({"KMOVERLAY_TOKEN": TOKEN})

    assert settings.host == DEFAULT_HOST
    assert settings.port == DEFAULT_PORT
    assert settings.demo_delay_ms == DEFAULT_DEMO_DELAY_MS
    assert settings.allowed_hosts == ["127.0.0.1", "localhost"]


def test_custom_values_are_read() -> None:
    settings = load_settings(
        {
            "KMOVERLAY_TOKEN": f"  {TOKEN}  ",
            "KMOVERLAY_HOST": "0.0.0.0",
            "KMOVERLAY_PORT": "9000",
            "KMOVERLAY_ALLOWED_HOSTS": "192.168.0.10, pc.tailnet.ts.net,",
            "KMOVERLAY_DEMO_DELAY_MS": "0",
        }
    )

    assert settings.token == TOKEN
    assert settings.port == 9000
    assert settings.demo_delay_ms == 0
    # Listening on every interface adds no name by itself: the phone's names must be listed.
    assert settings.allowed_hosts == ["127.0.0.1", "localhost", "192.168.0.10", "pc.tailnet.ts.net"]


def test_a_specific_bind_address_is_allowed_as_host() -> None:
    assert ServerSettings(token=TOKEN, host="192.168.0.10").allowed_hosts[-1] == "192.168.0.10"


@pytest.mark.parametrize(
    ("variable", "value"),
    [("KMOVERLAY_PORT", "abc"), ("KMOVERLAY_PORT", "70000"), ("KMOVERLAY_DEMO_DELAY_MS", "-1")],
)
def test_invalid_numbers_are_rejected(variable: str, value: str) -> None:
    with pytest.raises(SettingsError, match=variable):
        load_settings({"KMOVERLAY_TOKEN": TOKEN, variable: value})


def test_env_files_are_read_without_overriding_real_variables(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        '# comment\n\nKMOVERLAY_TOKEN="from-file-token-123"\nKMOVERLAY_PORT=9000\nnot a pair\n',
        encoding="utf-8",
    )
    environment = {"KMOVERLAY_PORT": "8001"}

    apply_env_file(env_file, environment)

    assert read_env_file(env_file) == {
        "KMOVERLAY_TOKEN": "from-file-token-123",
        "KMOVERLAY_PORT": "9000",
    }
    assert environment == {"KMOVERLAY_PORT": "8001", "KMOVERLAY_TOKEN": "from-file-token-123"}


def test_a_missing_env_file_is_ignored(tmp_path: Path) -> None:
    environment: dict[str, str] = {}

    apply_env_file(tmp_path / "missing.env", environment)

    assert environment == {}
