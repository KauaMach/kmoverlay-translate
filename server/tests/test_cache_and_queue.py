import asyncio
import hashlib
import json
import os
from pathlib import Path

import pytest

from kmoverlay_server.job_queue import (
    PRIORITY_PREFETCH,
    PRIORITY_VISIBLE,
    PriorityGate,
    QueueFullError,
)
from kmoverlay_server.result_cache import DiskResultCache
from kmoverlay_server.settings import (
    ServerSettings,
    SettingsError,
    default_cache_dir,
    load_settings,
)
from tests.conftest import TEST_TOKEN, CountingPipeline, make_client, png_bytes

OPTIONS = {"source_lang": "en", "target_lang": "pt-BR"}


def age(cache_dir: Path, seconds_ago: dict[str, int]) -> None:
    """Sets the last use of entries (by key) to some seconds in the past."""
    for key, seconds in seconds_ago.items():
        path = cache_dir / f"{hashlib.sha256(key.encode()).hexdigest()}.json"
        timestamp = path.stat().st_mtime - seconds
        os.utime(path, (timestamp, timestamp))


def test_the_disk_cache_survives_a_restart(tmp_path: Path) -> None:
    DiskResultCache(tmp_path, max_bytes=1000).put("page-1", b"translated")

    assert DiskResultCache(tmp_path, max_bytes=1000).get("page-1") == b"translated"
    assert DiskResultCache(tmp_path, max_bytes=1000).get("other") is None


def test_the_least_recently_used_entries_go_first(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path, max_bytes=25)
    cache.put("old", b"x" * 10)
    cache.put("used", b"x" * 10)
    age(tmp_path, {"old": 100, "used": 200})
    assert cache.get("used") is not None  # reading it makes it recent again

    cache.put("new", b"x" * 10)

    assert cache.get("old") is None
    assert cache.get("used") is not None
    assert cache.get("new") is not None
    assert cache.total_bytes <= 25


def test_values_bigger_than_the_cache_are_not_stored(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path, max_bytes=5)
    cache.put("small", b"abc")

    cache.put("huge", b"x" * 6)

    assert cache.get("huge") is None
    assert cache.get("small") == b"abc"


def test_interrupted_writes_are_cleaned_and_missing_files_ignored(tmp_path: Path) -> None:
    (tmp_path / "leftover.tmp").write_bytes(b"half")
    cache = DiskResultCache(tmp_path, max_bytes=20)
    cache.put("a", b"x" * 10)
    for path in tmp_path.glob("*.json"):
        path.unlink()  # cleaned from outside

    cache.put("b", b"x" * 15)

    assert not (tmp_path / "leftover.tmp").exists()
    assert cache.get("b") is not None


def test_translations_come_back_from_disk_after_a_restart(
    tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    settings = ServerSettings(token=TEST_TOKEN, cache_dir=tmp_path)
    image = png_bytes()
    files = [("images", ("page.png", image, "image/png"))]
    first = make_client(settings, CountingPipeline()).post(
        "/v1/translate", headers=auth_headers, files=files, data={"options": json.dumps(OPTIONS)}
    )

    restarted_pipeline = CountingPipeline()
    lookup = make_client(settings, restarted_pipeline).post(
        "/v1/lookup",
        headers=auth_headers,
        json={"image_sha256s": [hashlib.sha256(image).hexdigest()], "options": OPTIONS},
    )

    assert lookup.status_code == 200
    assert lookup.json() == first.json()
    assert restarted_pipeline.calls == 0


def test_the_cache_lives_outside_the_project_by_default() -> None:
    assert default_cache_dir({"XDG_CACHE_HOME": "/tmp/cache"}) == Path(
        "/tmp/cache/kmoverlay-translate"
    )
    assert default_cache_dir({}) == Path.home() / ".cache" / "kmoverlay-translate"
    settings = load_settings({"KMOVERLAY_TOKEN": TEST_TOKEN, "KMOVERLAY_CACHE_DIR": "~/kmo-cache"})
    assert settings.cache_dir == Path.home() / "kmo-cache"
    assert settings.cache_max_mb == 1024
    with pytest.raises(SettingsError, match="KMOVERLAY_CACHE_MAX_MB"):
        load_settings({"KMOVERLAY_TOKEN": TEST_TOKEN, "KMOVERLAY_CACHE_MAX_MB": "0"})


def test_pages_on_screen_overtake_pages_prepared_ahead() -> None:
    asyncio.run(scenario_pages_on_screen_overtake_pages_prepared_ahead())


async def scenario_pages_on_screen_overtake_pages_prepared_ahead() -> None:
    gate = PriorityGate()
    order: list[str] = []
    release_first = asyncio.Event()

    async def job(name: str, priority: int, wait: asyncio.Event | None = None) -> None:
        async with gate.turn(priority):
            order.append(name)
            if wait is not None:
                await wait.wait()

    running = asyncio.create_task(job("running", PRIORITY_VISIBLE, release_first))
    await asyncio.sleep(0)
    waiting = [
        asyncio.create_task(job("prefetch-1", PRIORITY_PREFETCH)),
        asyncio.create_task(job("prefetch-2", PRIORITY_PREFETCH)),
        asyncio.create_task(job("visible", PRIORITY_VISIBLE)),
    ]
    await asyncio.sleep(0)
    assert gate.waiting == 3

    release_first.set()
    await asyncio.gather(running, *waiting)

    assert order == ["running", "visible", "prefetch-1", "prefetch-2"]


def test_a_full_queue_refuses_new_jobs() -> None:
    asyncio.run(scenario_a_full_queue_refuses_new_jobs())


async def scenario_a_full_queue_refuses_new_jobs() -> None:
    gate = PriorityGate(max_waiting=1)
    release = asyncio.Event()

    async def hold() -> None:
        async with gate.turn(PRIORITY_VISIBLE):
            await release.wait()

    holder = asyncio.create_task(hold())
    await asyncio.sleep(0)
    waiter = asyncio.create_task(hold())
    await asyncio.sleep(0)

    with pytest.raises(QueueFullError):
        async with gate.turn(PRIORITY_VISIBLE):
            pass

    release.set()
    await asyncio.gather(holder, waiter)


def test_cancelled_jobs_do_not_block_the_queue() -> None:
    asyncio.run(scenario_cancelled_jobs_do_not_block_the_queue())


async def scenario_cancelled_jobs_do_not_block_the_queue() -> None:
    gate = PriorityGate()
    release = asyncio.Event()
    finished: list[str] = []

    async def job(name: str, wait: asyncio.Event | None = None) -> None:
        async with gate.turn(PRIORITY_VISIBLE):
            if wait is not None:
                await wait.wait()
            finished.append(name)

    holder = asyncio.create_task(job("holder", release))
    await asyncio.sleep(0)
    cancelled = asyncio.create_task(job("cancelled"))
    last = asyncio.create_task(job("last"))
    await asyncio.sleep(0)
    cancelled.cancel()
    await asyncio.sleep(0)

    release.set()
    await asyncio.gather(holder, last)

    assert finished == ["holder", "last"]
    assert cancelled.cancelled()
    assert gate.waiting == 0
