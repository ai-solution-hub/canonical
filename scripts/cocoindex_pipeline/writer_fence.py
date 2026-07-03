"""ID-138 {138.9} — cross-language writer-fence barrier primitive (Python leg).

TECH.md §2.6 R(ops) / §3.4 O (writer fencing); PLAN.md §2 ("Writer fencing is
a shared cross-language primitive: {138.9} pg advisory-lock RPC + TS + Python
helpers"). Mirrors `lib/corpus/writer-fence.ts` (TS leg) over the SAME two SQL
functions (`supabase/migrations/20260703160400_id138_writer_fence.sql`):
`public.corpus_writer_fence_try_acquire(p_holder text)` /
`public.corpus_writer_fence_release(p_holder text)`. The FIVE corpus writers
this fences: write-back ({138.12}), upload ({138.13}), pull-sync ({138.14} —
the cocoindex incremental walk runs UNDER the pull-sync fence hold, no
separate acquisition), and the id-45 ({45.7}) operator bulk-load.

TRY-SEMANTICS, NOT BLOCKING (full rationale in the migration file header):
`try_acquire_writer_fence` returning `False` is a NORMAL outcome (another
writer holds the fence) — the caller decides whether to abort or retry with
backoff; it is never raised as an exception. A raised exception means the
RPC call itself failed (DB/connection error), a materially different
failure mode.

CONNECTION AFFINITY (why this leg does NOT share the TS leg's PostgREST
caveat): `pg_advisory_lock`/`pg_advisory_unlock` are SESSION-scoped. The
Python callers hold a SINGLE `asyncpg.Connection` (checked out via
`pool.acquire()`) for the whole acquire -> critical section -> release span,
so the acquire and release calls are always evaluated on the SAME backend
session — unlike the TS leg, which calls the same two functions over
supabase-js `.rpc()` (PostgREST), where session affinity across two separate
HTTP round trips is NOT guaranteed (see the migration header + writer-fence.ts
for that documented limitation). `try_acquire_writer_fence` and
`release_writer_fence` therefore take an `asyncpg.Connection`, NEVER a bare
`asyncpg.Pool` — passing a pool would invite acquiring on one checked-out
connection and releasing on another, silently reproducing the TS leg's
caveat here too. Use the `writer_fence()` async context manager below to get
this right by construction.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, AsyncIterator

if TYPE_CHECKING:
    import asyncpg

_logger = logging.getLogger(__name__)


class WriterFenceBusyError(Exception):
    """Raised by `writer_fence()` when the fence could not be acquired —
    another writer currently holds it. Mirrors `WriterFenceBusyError` in
    `lib/corpus/writer-fence.ts`.
    """

    def __init__(self, holder: str | None = None) -> None:
        suffix = f" (requested by {holder})" if holder else ""
        super().__init__(
            f"corpus writer-fence busy — another writer holds it{suffix}"
        )
        self.holder = holder


async def try_acquire_writer_fence(
    conn: "asyncpg.Connection", holder: str | None = None
) -> bool:
    """Try to acquire the corpus writer-fence on `conn`'s session.

    Returns `False` if another writer holds it — normal, expected, never
    blocks. Raises on a genuine DB/connection error.

    `conn` MUST be the SAME connection later passed to
    `release_writer_fence` (the lock is session-scoped) — prefer the
    `writer_fence()` context manager below, which guarantees this.
    """
    return await conn.fetchval(
        "SELECT public.corpus_writer_fence_try_acquire($1)", holder
    )


async def release_writer_fence(
    conn: "asyncpg.Connection", holder: str | None = None
) -> bool:
    """Release the corpus writer-fence on `conn`'s session.

    Returns `False` if this session did not hold it — should not happen when
    `conn` is the SAME connection used to acquire (see module docstring); a
    `False` here on the Python leg indicates a genuine caller bug, not the
    TS leg's PostgREST session-affinity caveat.
    """
    return await conn.fetchval(
        "SELECT public.corpus_writer_fence_release($1)", holder
    )


@asynccontextmanager
async def writer_fence(
    pool: "asyncpg.Pool", holder: str | None = None
) -> AsyncIterator["asyncpg.Connection"]:
    """Acquire the corpus writer-fence for the duration of the `async with`
    block, on ONE checked-out connection (never a bare pool — see module
    docstring).

    Raises `WriterFenceBusyError` if the fence is already held. Always
    attempts release on exit; a release failure is logged, never masks a
    body exception.

    Usage::

        async with writer_fence(db_pool, holder="pull_sync") as conn:
            ...  # critical section (bucket/volume writes)
    """
    async with pool.acquire() as conn:
        acquired = await try_acquire_writer_fence(conn, holder)
        if not acquired:
            raise WriterFenceBusyError(holder)
        try:
            yield conn
        finally:
            try:
                await release_writer_fence(conn, holder)
            except Exception:  # noqa: BLE001 - never mask the body's own exception
                _logger.warning(
                    "writer_fence: release_writer_fence failed in finally "
                    "block (holder=%s)",
                    holder,
                    exc_info=True,
                )
