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

from scripts.cocoindex_pipeline.writer_fence import (
    DEFAULT_LEASE_TTL_SECONDS,
    WriterFenceBusyError,
    release_writer_fence,
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
