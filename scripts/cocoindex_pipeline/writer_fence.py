"""ID-138 {138.9} REDESIGN (S445) — cross-language writer-fence barrier
primitive (Python leg), reworked from a session-scoped advisory lock onto a
pooling-agnostic row-based holder-token LEASE.

TECH.md §2.6 R(ops) / §3.4 O (writer fencing); PLAN.md §2 ("Writer fencing is
a shared cross-language primitive"). Mirrors `lib/corpus/writer-fence.ts` (TS
leg) over the SAME two SQL functions
(`supabase/migrations/20260704120000_id138_writer_fence_lease.sql`):
`public.corpus_writer_fence_lease_acquire(p_holder_token uuid, p_holder text,
p_ttl_seconds integer)` / `public.corpus_writer_fence_lease_release(
p_holder_token uuid, p_holder text)`. The FIVE corpus writers this fences:
write-back ({138.12}), upload ({138.13}), pull-sync ({138.14} — the
cocoindex incremental walk runs UNDER the pull-sync fence hold, no separate
acquisition), and the id-45 ({45.7}) operator bulk-load.

WHY THE REDESIGN — S445 empirical defect: the original
`pg_try_advisory_lock`-based primitive
(20260703160400_id138_writer_fence.sql, now DEPRECATED) is SESSION-scoped
and was found NOT mutually exclusive through PostgREST (the TS leg's
transport) — two "concurrent" `.rpc()` acquire calls landed on the SAME
pooled backend session, where `pg_try_advisory_lock` is reentrant, so BOTH
returned true. This Python leg never had that specific defect (it already
held one asyncpg connection for the whole acquire -> critical section ->
release span by construction — see below), but BOTH legs now call the SAME
lease-based primitive so there is exactly one mutual-exclusion mechanism to
reason about, not two (one advisory-lock-based, one row-based).

TRY-SEMANTICS, NOT BLOCKING (full rationale in the migration file header):
`try_acquire_writer_fence` returning `False` is a NORMAL outcome (another
writer holds an unexpired lease) — the caller decides whether to abort or
retry with backoff; it is never raised as an exception. A raised exception
means the RPC call itself failed (DB/connection error), a materially
different failure mode.

FENCING-TOKEN SEMANTICS (why every acquire takes/produces a `holder_token`):
the lease row records whichever `holder_token` acquired it; release only
succeeds if the SAME token is presented. This makes exclusion depend on the
ROW, not on which backend session/connection issued the call — so it works
identically whether `conn` came from a bare asyncpg pool checkout (this
Python leg) or from a pooled PostgREST session (the TS leg). This Python leg
still holds a SINGLE `asyncpg.Connection` (checked out via `pool.acquire()`)
for the whole acquire -> critical section -> release span, which remains
good practice (a single connection avoids any doubt about ordering), but
it is no longer LOAD-BEARING for correctness the way it was for the
session-scoped advisory lock — the lease's `holder_token` check is what
actually guarantees exclusion now. `try_acquire_writer_fence` and
`release_writer_fence` still take an `asyncpg.Connection`, NEVER a bare
`asyncpg.Pool`, to keep this leg's usage pattern uniform and simple. Use the
`writer_fence()` async context manager below to get this right by
construction — it mints the `holder_token` internally so callers never
handle it directly.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, AsyncIterator

if TYPE_CHECKING:
    import asyncpg

_logger = logging.getLogger(__name__)

# Server-side default TTL (seconds) applied when `ttl_seconds` is omitted —
# mirrors the SQL function's own DEFAULT (3600s) so callers that pass
# `ttl_seconds=None` and rely on the DB default and callers that pass this
# module constant see identical behaviour. See the migration header for the
# TTL asymmetry rationale (too short breaks SAFETY; too long only costs
# LIVENESS after a genuine crash).
DEFAULT_LEASE_TTL_SECONDS = 3600


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
    conn: "asyncpg.Connection",
    holder_token: "uuid.UUID",
    holder: str | None = None,
    ttl_seconds: int = DEFAULT_LEASE_TTL_SECONDS,
) -> bool:
    """Try to acquire the corpus writer-fence lease.

    Returns `False` if another writer holds an unexpired lease — normal,
    expected, never blocks. Raises on a genuine DB/connection error.

    `holder_token` is a caller-generated UUID identifying THIS acquisition
    (fencing-token semantics) — the matching `release_writer_fence` call
    MUST present the SAME token. Prefer the `writer_fence()` context manager
    below, which mints and threads this token automatically.
    """
    return await conn.fetchval(
        "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)",
        holder_token,
        holder,
        ttl_seconds,
    )


async def release_writer_fence(
    conn: "asyncpg.Connection",
    holder_token: "uuid.UUID",
    holder: str | None = None,
) -> bool:
    """Release the corpus writer-fence lease.

    Returns `False` if `holder_token` does not match the lease's CURRENT
    holder — fencing-token semantics: the lease already expired (TTL) and
    was reclaimed by a newer holder, or was never held by this token. This
    is a WARNING to investigate, never a hard failure — it can never mean
    this call released someone else's active lease.
    """
    return await conn.fetchval(
        "SELECT public.corpus_writer_fence_lease_release($1, $2)",
        holder_token,
        holder,
    )


@asynccontextmanager
async def writer_fence(
    pool: "asyncpg.Pool",
    holder: str | None = None,
    ttl_seconds: int = DEFAULT_LEASE_TTL_SECONDS,
) -> AsyncIterator["asyncpg.Connection"]:
    """Acquire the corpus writer-fence lease for the duration of the
    `async with` block, minting a fresh holder token internally, on ONE
    checked-out connection (never a bare pool — see module docstring).

    Raises `WriterFenceBusyError` if the fence is already held. Always
    attempts release (with the SAME token) on exit; a release failure is
    logged, never masks a body exception.

    Usage::

        async with writer_fence(db_pool, holder="pull_sync") as conn:
            ...  # critical section (bucket/volume writes)
    """
    holder_token = uuid.uuid4()
    async with pool.acquire() as conn:
        acquired = await try_acquire_writer_fence(
            conn, holder_token, holder, ttl_seconds
        )
        if not acquired:
            raise WriterFenceBusyError(holder)
        try:
            yield conn
        finally:
            try:
                await release_writer_fence(conn, holder_token, holder)
            except Exception:  # noqa: BLE001 - never mask the body's own exception
                _logger.warning(
                    "writer_fence: release_writer_fence failed in finally "
                    "block (holder=%s)",
                    holder,
                    exc_info=True,
                )
