"""Caches of translation responses (JSON bytes): in memory, or on disk across restarts.

The plan describes a cache per stage (OCR, translation, rendering). For now a
single response cache is enough: the reader, the translator, the model and the
prompt are all part of the key (pipeline version), so a change never serves old
results.
"""

import hashlib
import logging
import os
from collections import OrderedDict
from pathlib import Path
from threading import Lock
from typing import Protocol

DEFAULT_MAX_ENTRIES = 256
ENTRY_SUFFIX = ".json"
TEMPORARY_SUFFIX = ".tmp"

logger = logging.getLogger(__name__)


class ResultCache(Protocol):
    """Stores responses by key; the least recently used ones go first when it is full."""

    def get(self, key: str) -> bytes | None:
        """The stored value, or `None`; a hit counts as a recent use."""
        ...

    def put(self, key: str, value: bytes) -> None:
        """Stores a value, dropping old entries if needed."""
        ...


class MemoryResultCache[Value]:
    """Least-recently-used cache with a fixed number of entries (used in tests)."""

    def __init__(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be at least 1")
        self._max_entries = max_entries
        self._entries: OrderedDict[str, Value] = OrderedDict()

    def get(self, key: str) -> Value | None:
        """Returns the cached value and marks it as recently used, or `None`."""
        value = self._entries.get(key)
        if value is not None:
            self._entries.move_to_end(key)
        return value

    def put(self, key: str, value: Value) -> None:
        """Stores a value, dropping the least recently used one when full."""
        self._entries[key] = value
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def __len__(self) -> int:
        return len(self._entries)


class DiskResultCache:
    """Least-recently-used cache in a directory, limited in bytes.

    One file per entry, named by the hash of the key. The modification time
    marks the last use, so the order survives restarts.
    """

    def __init__(self, directory: Path, max_bytes: int) -> None:
        if max_bytes < 1:
            raise ValueError("max_bytes must be at least 1")
        self._directory = directory
        self._max_bytes = max_bytes
        self._lock = Lock()
        directory.mkdir(parents=True, exist_ok=True)
        # Leftovers of a write interrupted by a crash are not entries.
        for leftover in directory.glob(f"*{TEMPORARY_SUFFIX}"):
            leftover.unlink(missing_ok=True)
        self._sizes = {path: path.stat().st_size for path in directory.glob(f"*{ENTRY_SUFFIX}")}

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        with self._lock:
            try:
                value = path.read_bytes()
            except FileNotFoundError:
                return None
            os.utime(path)
            return value

    def put(self, key: str, value: bytes) -> None:
        if len(value) > self._max_bytes:
            # A single result bigger than the whole cache would evict everything else.
            return
        path = self._path(key)
        temporary = path.with_suffix(TEMPORARY_SUFFIX)
        with self._lock:
            # Written aside and renamed, so a crash never leaves a truncated entry.
            temporary.write_bytes(value)
            temporary.replace(path)
            self._sizes[path] = len(value)
            self._evict()

    @property
    def total_bytes(self) -> int:
        return sum(self._sizes.values())

    def _evict(self) -> None:
        total = self.total_bytes
        if total <= self._max_bytes:
            return
        for path in sorted(self._sizes, key=self._last_use):
            if total <= self._max_bytes:
                break
            total -= self._sizes.pop(path)
            path.unlink(missing_ok=True)

    def _last_use(self, path: Path) -> float:
        try:
            return path.stat().st_mtime
        except FileNotFoundError:
            # Removed from outside (e.g. the user cleaned the folder): drop it first.
            logger.warning("Cache entry %s disappeared", path.name)
            return float("-inf")

    def _path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self._directory / f"{digest}{ENTRY_SUFFIX}"
