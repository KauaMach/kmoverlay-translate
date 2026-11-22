"""One translation at a time (the models share a single GPU), best priority first."""

import asyncio
import heapq
import itertools
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

PRIORITY_VISIBLE = 0
PRIORITY_PREFETCH = 1
DEFAULT_MAX_WAITING = 16


class QueueFullError(RuntimeError):
    """Too many jobs are waiting; the client should try again later."""


class PriorityGate:
    """Lets one job run at a time and, when it ends, starts the waiting job with
    the best (lowest) priority, oldest first.

    Pages on screen thus overtake pages being prepared ahead of the reader.
    """

    def __init__(self, max_waiting: int = DEFAULT_MAX_WAITING) -> None:
        self._max_waiting = max_waiting
        self._busy = False
        self._waiting: list[tuple[int, int, asyncio.Future[None]]] = []
        self._order = itertools.count()

    @asynccontextmanager
    async def turn(self, priority: int) -> AsyncIterator[None]:
        """Waits for the turn of a job and releases it when the block ends.

        Raises:
            QueueFullError: when `max_waiting` jobs are already waiting.
        """
        await self._acquire(priority)
        try:
            yield
        finally:
            self._release()

    @property
    def waiting(self) -> int:
        return sum(1 for _, _, future in self._waiting if not future.done())

    async def _acquire(self, priority: int) -> None:
        if not self._busy and self.waiting == 0:
            self._busy = True
            return
        if self.waiting >= self._max_waiting:
            raise QueueFullError
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiting, (priority, next(self._order), future))
        try:
            await future
        except asyncio.CancelledError:
            if future.done() and not future.cancelled():
                # The turn was handed over just as the job was cancelled: pass it on.
                self._release()
            raise

    def _release(self) -> None:
        while self._waiting:
            _, _, future = heapq.heappop(self._waiting)
            if not future.done():
                # The gate stays busy: the turn goes straight to the next job.
                future.set_result(None)
                return
        self._busy = False
