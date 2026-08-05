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

import asyncio
import logging
import threading
import uuid
from contextlib import asynccontextmanager, suppress
from typing import TYPE_CHECKING, Any, AsyncIterator, Callable, Protocol, cast

if TYPE_CHECKING:
    import asyncpg

_logger = logging.getLogger(__name__)


# BL-397: `try_acquire_writer_fence` / `release_writer_fence` take a
# structural (Protocol) connection type, not the nominal `asyncpg.Connection`
# they took previously. Both are called with whatever `writer_fence()` checks
# out of the pool — a real `asyncpg.Pool.acquire()` yields a
# `PoolConnectionProxy`, not a bare `Connection`, and pyright correctly
# rejects passing that proxy to a parameter typed as `Connection` (different,
# non-overlapping asyncpg classes). Protocol typing (mirrors
# `RetryCounterProtocol` / `StageCounterProtocol` in `flow_context.py`) fixes
# this the same way those do: describe only the one method these two
# primitives actually call, so BOTH `asyncpg.Connection` and
# `PoolConnectionProxy` satisfy it structurally, and the test suite's
# lightweight `_FakeConn` stand-in satisfies it too, with no asyncpg
# inheritance required. `writer_fence()` below keeps the nominal
# `asyncpg.Pool` / `asyncpg.Connection` types unchanged on its OWN public
# signature (its callers, e.g. `server.py`, get back a full `Connection` as
# before); only its internal checkout is `cast` to bridge the
# `PoolConnectionProxy` -> `Connection` gap for that one call. Zero runtime
# behaviour change throughout — asyncpg objects already duck-type this shape.
class FenceConnection(Protocol):
    """Structural shape of the connection-like object `try_acquire_writer_fence`
    / `release_writer_fence` need — just the one `fetchval` call they issue."""

    async def fetchval(self, query: str, *args: object) -> Any: ...


# Server-side default TTL (seconds) applied when `ttl_seconds` is omitted —
# mirrors the SQL function's own DEFAULT (3600s) so callers that pass
# `ttl_seconds=None` and rely on the DB default and callers that pass this
# module constant see identical behaviour. See the migration header for the
# TTL asymmetry rationale (too short breaks SAFETY; too long only costs
# LIVENESS after a genuine crash).
DEFAULT_LEASE_TTL_SECONDS = 3600

# id-382 — active renewal while a pass holds the fence. The acquire TTL above
# stays the SAFETY FLOOR (a holder whose renewal beats all fail — e.g. the
# renew RPC is not yet migrated onto this project — keeps the full 3600s lease,
# which is exactly today's behaviour, never a mid-pass expiry with the walk
# still writing). Each successful renewal beat re-stamps
# `expires_at = now() + RENEWAL_LEASE_TTL_SECONDS`, so the FIRST beat truncates
# the 1-hour acquire window down to the renewal window and every later beat
# keeps extending it. Net effect once the renew RPC is applied: a holder that
# dies (cancelled run, OOM kill, docker stop, host reboot) frees the fence
# within RENEWAL_LEASE_TTL_SECONDS of its last beat instead of within an hour.
#
# Sizing (measured, not guessed): the longest legitimate single walk pass the
# platform's own consumer budgets for is 1800 s — the cocoindex-nightly walk
# completion deadline (.github/workflows/cocoindex-nightly.yml, raised 900 s ->
# 1800 s owner-ratified as the cold-Docling safety net). With renewal the lease
# TTL no longer needs to cover the pass at all (beats continue for as long as
# the pass lives), so the TTL is sized to RENEWAL RESILIENCE instead:
# 120 s = 6 beats of 20 s, i.e. five consecutive missed beats (transient DB
# blips) before the lease could lapse — and even then the renew RPC REFUSES to
# resurrect an expired lease, so the failure mode is this holder losing the
# fence loudly, never two concurrent writers.
RENEWAL_LEASE_TTL_SECONDS = 120
RENEWAL_INTERVAL_SECONDS = 20.0

# SQLSTATE raised when the renew RPC does not exist on the target project yet
# (the id-382 migration is authored report-first, applied owner-gated). The
# renewal loop treats it as "degraded: stop renewing, keep the acquire TTL".
_UNDEFINED_FUNCTION_SQLSTATE = "42883"

# id-382 — registry of leases THIS PROCESS currently holds (token -> holder
# label). Written by `writer_fence()` on acquire/release; drained by
# `release_registered_leases_sync()` on the SIGTERM/shutdown path so a
# docker-stopped container releases its lease instead of stranding it for the
# TTL. Threading (not asyncio) lock: registered from walk-thread event loops,
# drained from the main thread after aiohttp's loop has closed.
_ACTIVE_LEASES: "dict[uuid.UUID, str | None]" = {}
_ACTIVE_LEASES_LOCK = threading.Lock()


class WriterFenceBusyError(Exception):
    """Raised by `writer_fence()` when the fence could not be acquired —
    another writer currently holds it. Mirrors `WriterFenceBusyError` in
    `lib/corpus/writer-fence.ts`.

    id-382 part 3: carries the CURRENT holder's label + expiry when the busy
    read could observe them (`held_by` / `expires_at`, best-effort — `None`
    when the lease row was not readable). The message embeds the literal
    "blocked by lease held by <label>, expires <ts>" phrasing that the
    cocoindex-nightly wait loop greps out of the sidecar log to fail fast on
    a blocked (not slow) walk.
    """

    def __init__(
        self,
        holder: str | None = None,
        held_by: str | None = None,
        expires_at: Any = None,
    ) -> None:
        message = "corpus writer-fence busy — another writer holds it"
        if holder:
            message += f" (requested by {holder})"
        if held_by is not None or expires_at is not None:
            message += (
                f" — blocked by lease held by {held_by or 'unknown'}, "
                f"expires {expires_at}"
            )
        super().__init__(message)
        self.holder = holder
        self.held_by = held_by
        self.expires_at = expires_at


async def try_acquire_writer_fence(
    conn: FenceConnection,
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
    # `fetchval` is typed `Any` (asyncpg is dynamically typed on row/scalar
    # decoding) — the SQL function itself returns SQL boolean, so `bool(...)`
    # is a type-narrowing no-op for the real value, and a documented
    # fail-safe (never expected in practice: this is a scalar function
    # call, which always returns exactly one row) if it were ever `None`.
    return bool(
        await conn.fetchval(
            "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)",
            holder_token,
            holder,
            ttl_seconds,
        )
    )


async def release_writer_fence(
    conn: FenceConnection,
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
    # See try_acquire_writer_fence's `bool(...)` note above — same rationale.
    return bool(
        await conn.fetchval(
            "SELECT public.corpus_writer_fence_lease_release($1, $2)",
            holder_token,
            holder,
        )
    )


async def renew_writer_fence(
    conn: FenceConnection,
    holder_token: "uuid.UUID",
    holder: str | None = None,
    ttl_seconds: int = RENEWAL_LEASE_TTL_SECONDS,
) -> bool:
    """Re-stamp the held lease's `expires_at` to `now() + ttl_seconds`.

    Token-scoped like release (id-382 hard constraint): the RPC updates ONLY
    the row whose CURRENT `holder_token` matches, and refuses an already-
    expired lease — so a renewal can never extend (or resurrect) someone
    else's lease. Returns `False` when the lease is no longer this token's
    to renew (expired and/or reclaimed) — the holder has LOST the fence.

    The `corpus_writer_fence_lease_renew` RPC ships in a separate owner-gated
    migration; on a project where it is not yet applied this call raises
    SQLSTATE 42883, which `_renewal_loop` treats as "degraded: stop renewing,
    the acquire TTL stays the bound" (today's behaviour, no safety change).
    """
    # See try_acquire_writer_fence's `bool(...)` note above — same rationale.
    return bool(
        await conn.fetchval(
            "SELECT public.corpus_writer_fence_lease_renew($1, $2, $3)",
            holder_token,
            holder,
            ttl_seconds,
        )
    )


async def _fetch_busy_lease_status(conn: FenceConnection) -> "dict[str, Any] | None":
    """Best-effort read of the CURRENT lease row after a busy acquire.

    id-382 part 3: this module (the sidecar's DB leg) is the ONLY layer with
    reach into the lease table — the workflow wait loop can only relay what
    the sidecar logs — so holder + expires_at are read HERE and carried on
    `WriterFenceBusyError`.

    Best-effort by design, never load-bearing: the table is RLS-locked with
    zero policies and all-role REVOKEs, readable only by the table-owner role
    (`postgres` — which the direct asyncpg `COCOINDEX_DB_DSN` connection is in
    practice; the TS/PostgREST leg never calls this). If the read fails for
    any reason the busy error is raised without holder detail, exactly the
    pre-id-382 behaviour.
    """
    fetchrow = getattr(conn, "fetchrow", None)
    if fetchrow is None:
        return None
    try:
        row = await fetchrow(
            "SELECT holder_label, expires_at "
            "FROM public.corpus_writer_fence_lease "
            "WHERE fence_name = public._corpus_writer_fence_lease_name()"
        )
    except Exception:  # noqa: BLE001 — enrichment only, never mask the busy signal
        _logger.debug(
            "writer_fence: busy-lease status read failed (enrichment only)",
            exc_info=True,
        )
        return None
    if row is None:
        return None
    return {"holder_label": row["holder_label"], "expires_at": row["expires_at"]}


async def _renewal_loop(
    pool: "asyncpg.Pool",
    holder_token: "uuid.UUID",
    holder: str | None,
    interval_seconds: float,
    ttl_seconds: int,
) -> None:
    """Renew the held lease every `interval_seconds` until cancelled.

    Sleep-first: the acquire itself just stamped a fresh `expires_at`, and
    the very-early-death window (holder killed before the first beat) is
    covered by the SIGTERM-path `release_registered_leases_sync()` below.
    Each beat checks out its OWN pool connection (`_build_pull_sync_pool` is
    min 1 / max 2 — the fence-holding connection occupies slot 1, a beat
    briefly occupies slot 2) because the held connection may be mid-query in
    the critical section and asyncpg connections reject concurrent operations.
    """
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            async with pool.acquire() as pool_conn:
                conn = cast("asyncpg.Connection", pool_conn)
                renewed = await renew_writer_fence(
                    conn, holder_token, holder, ttl_seconds
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — a failed beat must never kill the pass
            if getattr(exc, "sqlstate", None) == _UNDEFINED_FUNCTION_SQLSTATE:
                _logger.warning(
                    "writer_fence: corpus_writer_fence_lease_renew is not "
                    "deployed on this project — lease renewal DEGRADED for "
                    "this pass (holder=%s keeps its full acquire TTL; a dead "
                    "holder frees only at TTL expiry). Apply the id-382 renew "
                    "migration to enable the short renewal window.",
                    holder,
                )
                return
            _logger.warning(
                "writer_fence: lease renewal beat failed (transient, "
                "holder=%s) — retrying next beat; the lease survives up to "
                "%ss of consecutive failures",
                holder,
                ttl_seconds,
                exc_info=True,
            )
            continue
        if not renewed:
            _logger.critical(
                "writer_fence: lease renewal REFUSED mid-pass (holder=%s, "
                "token=%s) — this holder's lease expired or was reclaimed by "
                "a newer writer, so THIS pass is no longer fenced. The pass "
                "is not aborted (update_blocking is not interruptible) but "
                "its writes may now interleave with another writer's — "
                "investigate before trusting this pass's output.",
                holder,
                holder_token,
            )
            return


@asynccontextmanager
async def writer_fence(
    pool: "asyncpg.Pool",
    holder: str | None = None,
    ttl_seconds: int = DEFAULT_LEASE_TTL_SECONDS,
    renew_interval_seconds: float = RENEWAL_INTERVAL_SECONDS,
    renew_ttl_seconds: int = RENEWAL_LEASE_TTL_SECONDS,
) -> AsyncIterator["asyncpg.Connection"]:
    """Acquire the corpus writer-fence lease for the duration of the
    `async with` block, minting a fresh holder token internally, on ONE
    checked-out connection (never a bare pool — see module docstring).

    Raises `WriterFenceBusyError` if the fence is already held (enriched
    with the current holder + expiry when readable — id-382 part 3). While
    the block runs, a background task renews the lease every
    `renew_interval_seconds` (id-382 part 1 — see `_renewal_loop` /
    `RENEWAL_LEASE_TTL_SECONDS` sizing note), and the hold is registered so
    the shutdown path can release it if the process is torn down mid-pass.
    Always attempts release (with the SAME token) on exit; a release failure
    is logged, never masks a body exception.

    Usage::

        async with writer_fence(db_pool, holder="pull_sync") as conn:
            ...  # critical section (bucket/volume writes)
    """
    holder_token = uuid.uuid4()
    async with pool.acquire() as pool_conn:
        # `Pool.acquire()` actually yields a `PoolConnectionProxy`, which
        # proxies every `Connection` method (`fetchval` included) — this
        # `cast` is a type-checker-only bridge (BL-397), not a runtime
        # conversion, back onto this function's own declared
        # `asyncpg.Connection` public contract.
        conn = cast("asyncpg.Connection", pool_conn)
        acquired = await try_acquire_writer_fence(
            conn, holder_token, holder, ttl_seconds
        )
        if not acquired:
            status = await _fetch_busy_lease_status(conn)
            raise WriterFenceBusyError(
                holder,
                held_by=status["holder_label"] if status else None,
                expires_at=status["expires_at"] if status else None,
            )
        with _ACTIVE_LEASES_LOCK:
            _ACTIVE_LEASES[holder_token] = holder
        renew_task = asyncio.create_task(
            _renewal_loop(
                pool, holder_token, holder, renew_interval_seconds, renew_ttl_seconds
            )
        )
        try:
            yield conn
        finally:
            # Cancel the renewal task BEFORE releasing: a beat landing after
            # the release would find zero matching rows and log a spurious
            # lost-lease CRITICAL.
            renew_task.cancel()
            with suppress(asyncio.CancelledError):
                await renew_task
            try:
                await release_writer_fence(conn, holder_token, holder)
            except Exception:  # noqa: BLE001 - never mask the body's own exception
                _logger.warning(
                    "writer_fence: release_writer_fence failed in finally "
                    "block (holder=%s)",
                    holder,
                    exc_info=True,
                )
            finally:
                with _ACTIVE_LEASES_LOCK:
                    _ACTIVE_LEASES.pop(holder_token, None)


def reset_active_lease_registry() -> None:
    """Clear the active-lease registry — test-only clean-slate helper."""
    with _ACTIVE_LEASES_LOCK:
        _ACTIVE_LEASES.clear()


async def _release_lease_once(
    dsn: str, holder_token: "uuid.UUID", holder: str | None, connect_timeout: float
) -> bool:
    """Open a fresh short-lived connection and release ONE registered lease.

    A fresh connection (not the pass's pool) because this runs on the
    shutdown path AFTER aiohttp's event loop has closed — the pass's pool
    lives on the (doomed) walk thread's loop and is unreachable here.
    """
    import asyncpg  # runtime import — module stays import-light (see header)

    conn = await asyncpg.connect(dsn, timeout=connect_timeout)
    try:
        released = await release_writer_fence(conn, holder_token, holder)
    finally:
        await conn.close()
    if released:
        with _ACTIVE_LEASES_LOCK:
            _ACTIVE_LEASES.pop(holder_token, None)
    return released


def release_registered_leases_sync(
    build_dsn: "Callable[[], str]", connect_timeout: float = 3.0
) -> int:
    """Best-effort, token-scoped release of every lease this process still
    holds — the id-382 part-1 SIGTERM/shutdown half.

    Called from `server.py`'s `main()` after `web.run_app()` returns (the
    docker-stop / GitHub-Actions-cancel drain path) and from the crash-exit
    path, moments before process exit. At that point any registered hold
    belongs to a walk pass that can never complete — the walk thread is a
    daemon thread that dies with the process — so releasing frees the fence
    immediately instead of stranding it for the TTL (observed live: S501 run
    30283987166, S507 run 30388008506, each a 1-hour outage of ALL corpus
    walking on the shared project).

    SAFETY: release goes through `corpus_writer_fence_lease_release` with the
    registered token, so it can only ever delete THIS process's own lease
    (the near-miss constraint in tasks/id-382 — never a release by fence
    name). Everything is best-effort with a short connect timeout: the docker
    stop grace window is ~10 s and a failed release must never block exit.

    Returns the number of leases actually released.
    """
    with _ACTIVE_LEASES_LOCK:
        snapshot = dict(_ACTIVE_LEASES)
    if not snapshot:
        return 0
    try:
        dsn = build_dsn()
    except Exception:  # noqa: BLE001 — shutdown path, must never raise
        _logger.warning(
            "writer_fence: shutdown lease release skipped — DSN unavailable",
            exc_info=True,
        )
        return 0
    released_count = 0
    for holder_token, holder in snapshot.items():
        try:
            released = asyncio.run(
                _release_lease_once(dsn, holder_token, holder, connect_timeout)
            )
        except Exception:  # noqa: BLE001 — shutdown path, must never raise
            _logger.warning(
                "writer_fence: shutdown lease release failed (holder=%s, "
                "token=%s) — the lease frees at TTL/renewal expiry instead",
                holder,
                holder_token,
                exc_info=True,
            )
            continue
        if released:
            released_count += 1
            _logger.info(
                "writer_fence: shutdown released still-held lease "
                "(holder=%s, token=%s)",
                holder,
                holder_token,
            )
        else:
            _logger.warning(
                "writer_fence: shutdown release found the lease no longer "
                "held by this token (holder=%s, token=%s) — already "
                "expired/reclaimed; nothing to free",
                holder,
                holder_token,
            )
    return released_count
