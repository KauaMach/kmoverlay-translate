"""In-memory cache of translation responses.

Fase 2 replaces it with the per-stage disk cache described in the plan; the
interface stays the same.
"""

from collections import OrderedDict

DEFAULT_MAX_ENTRIES = 256


class MemoryResultCache[Value]:
    """Least-recently-used cache with a fixed number of entries."""

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
