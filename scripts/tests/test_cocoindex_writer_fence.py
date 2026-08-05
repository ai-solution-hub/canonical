"""Unit tests for scripts/cocoindex_pipeline/writer_fence.py — ID-138 {138.9}
REDESIGN (S445) — lease mechanism.

Spec: TECH.md §2.6 R(ops), §3.4 O (writer fencing); PLAN.md §2.

Verifies OBSERVABLE BEHAVIOUR against a minimal fake asyncpg pool/connection
(no real DB connection, mirroring test_lifespan_alias_generation.py's
`_FakePool` pattern): the correct SQL is issued with the holder_token +
holder params, a `False` acquire/release result is returned (never raised —
try-semantics, "busy" is a normal outcome), `writer_fence()` mints a token
and acquires-then-releases with the SAME token on the SAME connection,
raises `WriterFenceBusyError` without attempting a release when the fence is
busy, and a release failure is logged (never masks the body's own
exception).

Async tests follow the repo convention (no pytest-asyncio plugin): drive the
coroutine via `asyncio.run` inside a sync test function.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

import pytest

from scripts.cocoindex_pipeline import writer_fence as writer_fence_mod
from scripts.cocoindex_pipeline.writer_fence import (
    DEFAULT_LEASE_TTL_SECONDS,
    RENEWAL_LEASE_TTL_SECONDS,
    WriterFenceBusyError,
    release_registered_leases_sync,
    release_writer_fence,
    renew_writer_fence,
    reset_active_lease_registry,
    try_acquire_writer_fence,
    writer_fence,
)


# ---------------------------------------------------------------------------
# Fake asyncpg connection/pool (mirrors test_lifespan_alias_generation.py's
# _FakePool — a minimal stand-in, no real DB connection).
# ---------------------------------------------------------------------------


class _FakeConn:
    """Backs both fence SQL calls. `release_outcome` may be a bool (the
    fetchval result) or an Exception instance (simulates a release RPC/DB
    failure)."""

    def __init__(
        self, acquire_result: bool, release_outcome: bool | Exception = True
    ) -> None:
        self.acquire_result = acquire_result
        self.release_outcome = release_outcome
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchval(self, query: str, *args: object) -> bool:
        self.calls.append((query, args))
        if "corpus_writer_fence_lease_acquire" in query:
            return self.acquire_result
        if "corpus_writer_fence_lease_release" in query:
            if isinstance(self.release_outcome, Exception):
                raise self.release_outcome
            return self.release_outcome
        raise AssertionError(f"unexpected query: {query}")


class _FakeAcquireCtx:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakeConn:
        return self._conn

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


class _FakePool:
    """Minimal fake asyncpg pool: `.acquire()` always hands back the SAME
    `_FakeConn` instance, mirroring the invariant `writer_fence()` relies on
    (one connection for both acquire + release)."""

    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    def acquire(self) -> _FakeAcquireCtx:
        return _FakeAcquireCtx(self._conn)


# ---------------------------------------------------------------------------
# try_acquire_writer_fence / release_writer_fence — low-level contract
# ---------------------------------------------------------------------------


def test_try_acquire_sends_token_ttl_and_holder_and_returns_true_on_acquisition() -> (
    None
):
    conn = _FakeConn(acquire_result=True)
    token = uuid.uuid4()

    acquired = asyncio.run(
        try_acquire_writer_fence(conn, token, holder="pull_sync", ttl_seconds=120)
    )

    assert acquired is True
    assert conn.calls == [
        (
            "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)",
            (token, "pull_sync", 120),
        )
    ]


def test_try_acquire_uses_default_ttl_when_omitted() -> None:
    conn = _FakeConn(acquire_result=True)
    token = uuid.uuid4()

    asyncio.run(try_acquire_writer_fence(conn, token))

    assert conn.calls == [
        (
            "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)",
            (token, None, DEFAULT_LEASE_TTL_SECONDS),
        )
    ]


def test_try_acquire_returns_false_without_raising_when_fence_busy() -> None:
    conn = _FakeConn(acquire_result=False)

    acquired = asyncio.run(try_acquire_writer_fence(conn, uuid.uuid4()))

    assert acquired is False


def test_release_sends_token_and_holder_and_returns_true_on_release() -> None:
    conn = _FakeConn(acquire_result=True, release_outcome=True)
    token = uuid.uuid4()

    released = asyncio.run(release_writer_fence(conn, token, holder="upload"))

    assert released is True
    assert conn.calls == [
        (
            "SELECT public.corpus_writer_fence_lease_release($1, $2)",
            (token, "upload"),
        )
    ]


def test_release_returns_false_without_raising_when_token_does_not_match_current_holder() -> (
    None
):
    conn = _FakeConn(acquire_result=True, release_outcome=False)

    released = asyncio.run(release_writer_fence(conn, uuid.uuid4()))

    assert released is False


def test_release_raises_on_a_genuine_db_failure() -> None:
    conn = _FakeConn(acquire_result=True, release_outcome=RuntimeError("conn reset"))

    with pytest.raises(RuntimeError, match="conn reset"):
        asyncio.run(release_writer_fence(conn, uuid.uuid4()))


# ---------------------------------------------------------------------------
# writer_fence() — async context manager (acquire -> yield -> release)
# ---------------------------------------------------------------------------


def test_writer_fence_acquires_yields_and_releases_on_the_same_connection_with_the_same_token() -> (
    None
):
    conn = _FakeConn(acquire_result=True, release_outcome=True)
    pool = _FakePool(conn)

    async def _run() -> str:
        async with writer_fence(pool, holder="write_back") as held_conn:
            assert held_conn is conn
            return "critical section ran"

    result = asyncio.run(_run())

    assert result == "critical section ran"
    assert (
        conn.calls[0][0]
        == "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)"
    )
    assert (
        conn.calls[-1][0]
        == "SELECT public.corpus_writer_fence_lease_release($1, $2)"
    )
    # The SAME minted token threaded through both the acquire and release
    # calls (fencing-token semantics).
    acquire_token = conn.calls[0][1][0]
    release_token = conn.calls[-1][1][0]
    assert isinstance(acquire_token, uuid.UUID)
    assert release_token == acquire_token


def test_writer_fence_raises_busy_error_and_never_releases_when_fence_is_held() -> (
    None
):
    conn = _FakeConn(acquire_result=False)
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="upload"):
            raise AssertionError("body must never run when the fence is busy")

    with pytest.raises(WriterFenceBusyError):
        asyncio.run(_run())

    # Never acquired -> never attempts a release call.
    assert len(conn.calls) == 1
    assert (
        conn.calls[0][0]
        == "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)"
    )


def test_writer_fence_still_releases_when_body_raises_and_propagates_original_error() -> (
    None
):
    conn = _FakeConn(acquire_result=True, release_outcome=True)
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool):
            raise ValueError("critical section blew up")

    with pytest.raises(ValueError, match="critical section blew up"):
        asyncio.run(_run())

    assert (
        conn.calls[-1][0]
        == "SELECT public.corpus_writer_fence_lease_release($1, $2)"
    )


def test_writer_fence_mints_a_different_token_on_each_call() -> None:
    conn = _FakeConn(acquire_result=True, release_outcome=True)
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="write_back"):
            pass
        async with writer_fence(pool, holder="write_back"):
            pass

    asyncio.run(_run())

    first_acquire_token = conn.calls[0][1][0]
    second_acquire_token = conn.calls[2][1][0]
    assert first_acquire_token != second_acquire_token


def test_writer_fence_logs_when_release_fails_after_a_successful_body(
    caplog: pytest.LogCaptureFixture,
) -> None:
    conn = _FakeConn(
        acquire_result=True, release_outcome=RuntimeError("release RPC failed")
    )
    pool = _FakePool(conn)

    async def _run() -> str:
        async with writer_fence(pool, holder="pull_sync"):
            return "done"

    with caplog.at_level(
        logging.WARNING, logger="scripts.cocoindex_pipeline.writer_fence"
    ):
        result = asyncio.run(_run())

    assert result == "done"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1


def test_writer_fence_release_failure_never_masks_the_bodys_original_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    conn = _FakeConn(
        acquire_result=True, release_outcome=RuntimeError("release RPC failed")
    )
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="pull_sync"):
            raise ValueError("original callback failure")

    with caplog.at_level(
        logging.WARNING, logger="scripts.cocoindex_pipeline.writer_fence"
    ):
        with pytest.raises(ValueError, match="original callback failure"):
            asyncio.run(_run())

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1


# ---------------------------------------------------------------------------
# id-382 — lease renewal, busy enrichment, and the shutdown release path
# ---------------------------------------------------------------------------


class _RenewFakeConn(_FakeConn):
    """Extends the fake with the renew RPC + (optionally) the busy-status
    `fetchrow` read. `renew_outcomes` is consumed one result per beat; each
    entry is a bool (renew fetchval result) or an Exception to raise. When
    the list runs dry the last entry repeats. `renew_seen` is set on the
    first renew call so tests can synchronise deterministically instead of
    sleeping."""

    def __init__(
        self,
        acquire_result: bool,
        release_outcome: bool | Exception = True,
        renew_outcomes: list[bool | Exception] | None = None,
        busy_row: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(acquire_result, release_outcome)
        self.renew_outcomes = list(renew_outcomes or [True])
        self.renew_seen = asyncio.Event()
        self.busy_row = busy_row

    async def fetchval(self, query: str, *args: object) -> bool:
        if "corpus_writer_fence_lease_renew" in query:
            self.calls.append((query, args))
            self.renew_seen.set()
            outcome = (
                self.renew_outcomes.pop(0)
                if len(self.renew_outcomes) > 1
                else self.renew_outcomes[0]
            )
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        return await super().fetchval(query, *args)

    async def fetchrow(self, query: str, *args: object) -> "dict[str, Any] | None":
        self.calls.append((query, args))
        return self.busy_row


def _renew_calls(conn: _FakeConn) -> list[tuple[str, tuple[Any, ...]]]:
    return [c for c in conn.calls if "lease_renew" in c[0]]


def test_writer_fence_renews_with_the_same_token_and_renewal_ttl() -> None:
    conn = _RenewFakeConn(acquire_result=True)
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(
            pool, holder="pull_sync", renew_interval_seconds=0.001
        ):
            await asyncio.wait_for(conn.renew_seen.wait(), timeout=2.0)

    asyncio.run(_run())

    renew_calls = _renew_calls(conn)
    assert renew_calls, "at least one renewal beat must have fired"
    acquire_token = conn.calls[0][1][0]
    assert renew_calls[0][1] == (
        acquire_token,
        "pull_sync",
        RENEWAL_LEASE_TTL_SECONDS,
    )
    # Release still runs last, with the SAME token (renewal never replaces it).
    assert "lease_release" in conn.calls[-1][0]
    assert conn.calls[-1][1][0] == acquire_token


def test_writer_fence_default_interval_means_no_beat_for_a_fast_body() -> None:
    """The default 20s sleep-first cadence never fires inside a fast pass —
    the pre-id-382 call sequence (acquire, release) is preserved exactly."""
    conn = _RenewFakeConn(acquire_result=True)
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="pull_sync"):
            pass

    asyncio.run(_run())

    assert _renew_calls(conn) == []
    assert [c[0] for c in conn.calls] == [
        "SELECT public.corpus_writer_fence_lease_acquire($1, $2, $3)",
        "SELECT public.corpus_writer_fence_lease_release($1, $2)",
    ]


def test_renewal_stops_quietly_when_the_renew_rpc_is_not_deployed(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """SQLSTATE 42883 (function does not exist — the id-382 migration is
    owner-gated and may lag this code) degrades to no-renewal: one warning,
    the loop stops, the pass completes, release still runs."""

    class _UndefinedFunction(Exception):
        sqlstate = "42883"

    conn = _RenewFakeConn(
        acquire_result=True, renew_outcomes=[_UndefinedFunction()]
    )
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(
            pool, holder="pull_sync", renew_interval_seconds=0.001
        ):
            await asyncio.wait_for(conn.renew_seen.wait(), timeout=2.0)
            # Give the loop a beat to prove it STOPPED rather than retried.
            await asyncio.sleep(0.05)

    with caplog.at_level(
        logging.WARNING, logger="scripts.cocoindex_pipeline.writer_fence"
    ):
        asyncio.run(_run())

    assert len(_renew_calls(conn)) == 1, "the loop must stop after 42883"
    assert any("not deployed" in r.message for r in caplog.records)
    assert "lease_release" in conn.calls[-1][0]


def test_renewal_survives_a_transient_beat_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    conn = _RenewFakeConn(
        acquire_result=True,
        renew_outcomes=[RuntimeError("conn reset"), True, True],
    )
    pool = _FakePool(conn)

    async def _wait_for_two_beats() -> None:
        while len(_renew_calls(conn)) < 2:
            await asyncio.sleep(0.005)

    async def _run() -> None:
        async with writer_fence(
            pool, holder="pull_sync", renew_interval_seconds=0.001
        ):
            await asyncio.wait_for(_wait_for_two_beats(), timeout=2.0)

    with caplog.at_level(
        logging.WARNING, logger="scripts.cocoindex_pipeline.writer_fence"
    ):
        asyncio.run(_run())

    assert len(_renew_calls(conn)) >= 2, "the loop must retry after a transient"


def test_renewal_logs_critical_and_stops_when_the_lease_is_lost(
    caplog: pytest.LogCaptureFixture,
) -> None:
    conn = _RenewFakeConn(acquire_result=True, renew_outcomes=[False])
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(
            pool, holder="pull_sync", renew_interval_seconds=0.001
        ):
            await asyncio.wait_for(conn.renew_seen.wait(), timeout=2.0)
            await asyncio.sleep(0.05)

    with caplog.at_level(
        logging.CRITICAL, logger="scripts.cocoindex_pipeline.writer_fence"
    ):
        asyncio.run(_run())

    assert len(_renew_calls(conn)) == 1, "the loop must stop after losing the lease"
    criticals = [r for r in caplog.records if r.levelno == logging.CRITICAL]
    assert len(criticals) == 1
    assert "no longer fenced" in criticals[0].message


def test_renew_writer_fence_sends_token_holder_and_ttl() -> None:
    conn = _RenewFakeConn(acquire_result=True)
    token = uuid.uuid4()

    renewed = asyncio.run(
        renew_writer_fence(conn, token, holder="pull_sync", ttl_seconds=90)
    )

    assert renewed is True
    assert conn.calls == [
        (
            "SELECT public.corpus_writer_fence_lease_renew($1, $2, $3)",
            (token, "pull_sync", 90),
        )
    ]


def test_busy_error_carries_holder_and_expiry_when_the_lease_row_is_readable() -> None:
    conn = _RenewFakeConn(
        acquire_result=False,
        busy_row={"holder_label": "pull_sync", "expires_at": "2026-07-27T17:50:10Z"},
    )
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="upload"):
            raise AssertionError("body must never run when the fence is busy")

    with pytest.raises(WriterFenceBusyError) as excinfo:
        asyncio.run(_run())

    assert excinfo.value.held_by == "pull_sync"
    assert excinfo.value.expires_at == "2026-07-27T17:50:10Z"
    # The literal phrasing the cocoindex-nightly wait loop greps for.
    assert "blocked by lease held by pull_sync, expires 2026-07-27T17:50:10Z" in str(
        excinfo.value
    )


def test_busy_error_stays_plain_when_the_status_read_is_unavailable() -> None:
    """The bare `_FakeConn` has no `fetchrow` — enrichment silently skips,
    exactly the pre-id-382 busy behaviour (and the pre-migration reality on
    a project where the direct role cannot read the lease table)."""
    conn = _FakeConn(acquire_result=False)
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="upload"):
            raise AssertionError("unreachable")

    with pytest.raises(WriterFenceBusyError) as excinfo:
        asyncio.run(_run())

    assert excinfo.value.held_by is None
    assert excinfo.value.expires_at is None
    assert "blocked by lease held by" not in str(excinfo.value)


def test_active_lease_registry_tracks_the_hold_and_clears_on_exit() -> None:
    reset_active_lease_registry()
    conn = _RenewFakeConn(acquire_result=True)
    pool = _FakePool(conn)
    seen_during_body: dict[uuid.UUID, str | None] = {}

    async def _run() -> None:
        async with writer_fence(pool, holder="pull_sync"):
            with writer_fence_mod._ACTIVE_LEASES_LOCK:
                seen_during_body.update(writer_fence_mod._ACTIVE_LEASES)

    asyncio.run(_run())

    assert list(seen_during_body.values()) == ["pull_sync"]
    with writer_fence_mod._ACTIVE_LEASES_LOCK:
        assert writer_fence_mod._ACTIVE_LEASES == {}


def test_registry_clears_even_when_release_fails() -> None:
    reset_active_lease_registry()
    conn = _RenewFakeConn(
        acquire_result=True, release_outcome=RuntimeError("release RPC failed")
    )
    pool = _FakePool(conn)

    async def _run() -> None:
        async with writer_fence(pool, holder="pull_sync"):
            pass

    asyncio.run(_run())

    with writer_fence_mod._ACTIVE_LEASES_LOCK:
        assert writer_fence_mod._ACTIVE_LEASES == {}


def test_release_registered_leases_sync_returns_zero_without_touching_the_dsn() -> None:
    reset_active_lease_registry()

    def _explodes() -> str:
        raise AssertionError("build_dsn must not be called for an empty registry")

    assert release_registered_leases_sync(_explodes) == 0


def test_release_registered_leases_sync_releases_with_the_registered_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reset_active_lease_registry()
    token = uuid.uuid4()
    with writer_fence_mod._ACTIVE_LEASES_LOCK:
        writer_fence_mod._ACTIVE_LEASES[token] = "pull_sync"

    released_calls: list[tuple[str, tuple[Any, ...]]] = []

    class _ShutdownFakeConn:
        async def fetchval(self, query: str, *args: object) -> bool:
            released_calls.append((query, args))
            return True

        async def close(self) -> None:
            pass

    async def _fake_connect(dsn: str, timeout: float) -> _ShutdownFakeConn:
        assert dsn == "postgresql://fence-test"
        return _ShutdownFakeConn()

    import asyncpg

    monkeypatch.setattr(asyncpg, "connect", _fake_connect)
    try:
        released = release_registered_leases_sync(
            lambda: "postgresql://fence-test"
        )
    finally:
        reset_active_lease_registry()

    assert released == 1
    assert released_calls == [
        (
            "SELECT public.corpus_writer_fence_lease_release($1, $2)",
            (token, "pull_sync"),
        )
    ]
    with writer_fence_mod._ACTIVE_LEASES_LOCK:
        assert writer_fence_mod._ACTIVE_LEASES == {}


def test_release_registered_leases_sync_never_raises_on_connect_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reset_active_lease_registry()
    token = uuid.uuid4()
    with writer_fence_mod._ACTIVE_LEASES_LOCK:
        writer_fence_mod._ACTIVE_LEASES[token] = "pull_sync"

    async def _fake_connect(dsn: str, timeout: float) -> None:
        raise OSError("connection refused")

    import asyncpg

    monkeypatch.setattr(asyncpg, "connect", _fake_connect)
    try:
        released = release_registered_leases_sync(lambda: "postgresql://x")
    finally:
        reset_active_lease_registry()

    assert released == 0
