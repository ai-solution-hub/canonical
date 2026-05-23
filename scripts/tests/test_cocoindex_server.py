"""Unit tests for `scripts/cocoindex_pipeline/server.py` — HTTP wrapper for the
cocoindex sidecar Cloud Run Service.

Covers PRODUCT Inv-6 (HTTPS /health probe returns 200 OK) + the wrapper
contract specified in Subtask 28.15 dispatch brief:

  - HTTP server bind succeeds on $PORT (default 8080).
  - GET /health returns HTTP 200 + JSON body {"status": "ok"}.
  - SIGTERM handler installed (signal.getsignal(SIGTERM) is not default).
  - cocoindex `coco.start_blocking()` invoked in a background daemon thread
    (mock + assert thread spawn).

Test philosophy: every test asserts real behaviour. The HTTP `/health` path
is exercised through aiohttp's `TestClient` / `TestServer` wrappers driven
by `asyncio.run()` — matching the project-established pattern in
test_cocoindex_extraction.py (no pytest-asyncio plugin dependency). The
cocoindex `coco.start_blocking()` call is patched out because (a) we do
NOT want to boot the cocoindex Rust engine inside the test process, and
(b) the unit under test is the wrapper, not cocoindex.

Stub-pattern: identical to test_cocoindex_extraction.py — no LMDB engine
boot at test time, no real Anthropic call. We use `unittest.mock.patch`
to intercept `coco.start_blocking` + `threading.Thread` where needed.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import threading
from unittest.mock import MagicMock, patch

import pytest

# ──────────────────────────────────────────────────────────────────────────
# Test-isolation: pop any sys.modules stubs of aiohttp / aiohttp.* installed
# by sibling test modules (specifically
# `test_cocoindex_flow_pipeline_run_webhook.py` which sets
# `sys.modules['aiohttp'] = MagicMock(...)` at module load via
# `setdefault()`). pytest collection runs all test files into the same
# Python process, so once the webhook test runs the MagicMock entry is
# present and a fresh `from aiohttp import web` resolves to the MagicMock,
# breaking with `'aiohttp' is not a package`. Popping the stub forces
# Python's import machinery to find the real `aiohttp` package on disk.
for _stubbed in [
    "aiohttp",
    "aiohttp.test_utils",
    "aiohttp.web",
]:
    if _stubbed in sys.modules and isinstance(sys.modules[_stubbed], MagicMock):
        del sys.modules[_stubbed]

from aiohttp import web  # noqa: E402 — must follow the sys.modules cleanup above
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────


@pytest.fixture
def aiohttp_app() -> web.Application:
    """Build the aiohttp Application via `build_app()` from the server module.

    The server module exports a `build_app()` factory so tests can exercise
    the routes without booting a real listening socket. The factory must
    NOT call `coco.start_blocking()` — that is the responsibility of
    `main()` / `run_server()`.
    """
    from scripts.cocoindex_pipeline.server import build_app

    return build_app()


async def _exercise_health(aiohttp_app: web.Application) -> tuple[int, dict, str]:
    """Helper — boot a TestServer, GET /health, return (status, body, ctype)."""
    async with TestClient(TestServer(aiohttp_app)) as client:
        resp = await client.get("/health")
        body = await resp.json()
        ctype = resp.headers.get("Content-Type", "")
        return resp.status, body, ctype


# ──────────────────────────────────────────────────────────────────────────
# §1 — /health endpoint
# ──────────────────────────────────────────────────────────────────────────


class TestHealthEndpoint:
    """Inv-6 — GET /health returns 200 + {"status": "ok"}."""

    def test_health_returns_200_ok(self, aiohttp_app: web.Application) -> None:
        status, _, _ = asyncio.run(_exercise_health(aiohttp_app))
        assert status == 200

    def test_health_body_status_ok(self, aiohttp_app: web.Application) -> None:
        _, body, _ = asyncio.run(_exercise_health(aiohttp_app))
        assert body == {"status": "ok"}

    def test_health_content_type_json(self, aiohttp_app: web.Application) -> None:
        _, _, ctype = asyncio.run(_exercise_health(aiohttp_app))
        assert "application/json" in ctype


# ──────────────────────────────────────────────────────────────────────────
# §2 — SIGTERM handler
# ──────────────────────────────────────────────────────────────────────────


class TestSigtermHandler:
    """Inv-6 + Cloud Run scale-down contract — SIGTERM installed for drain."""

    def test_install_signal_handlers_replaces_default(self) -> None:
        """After install_signal_handlers() the SIGTERM signal is not the
        Python-default handler."""
        from scripts.cocoindex_pipeline.server import install_signal_handlers

        # Save the original handler so we can restore it after the test.
        original = signal.getsignal(signal.SIGTERM)
        try:
            install_signal_handlers()
            installed = signal.getsignal(signal.SIGTERM)
            # signal.SIG_DFL is the Python default (the integer 0).
            assert installed is not signal.SIG_DFL
            # The installed handler must be callable.
            assert callable(installed)
        finally:
            # Restore the original so other tests run with a clean signal state.
            signal.signal(signal.SIGTERM, original)

    def test_install_signal_handlers_returns_drain_flag(self) -> None:
        """install_signal_handlers() returns a `threading.Event` (or duck-
        typed equivalent) that is_set() after the handler is invoked."""
        from scripts.cocoindex_pipeline.server import install_signal_handlers

        original = signal.getsignal(signal.SIGTERM)
        try:
            shutdown_event = install_signal_handlers()
            # Pre-signal: not set.
            assert not shutdown_event.is_set()
            # Invoke the installed handler directly (simulating SIGTERM
            # delivery — we do NOT raise the signal because pytest may
            # treat that as fatal in some configurations).
            handler = signal.getsignal(signal.SIGTERM)
            assert callable(handler)
            handler(signal.SIGTERM, None)
            # Post-handler: drain flag set.
            assert shutdown_event.is_set()
        finally:
            signal.signal(signal.SIGTERM, original)


# ──────────────────────────────────────────────────────────────────────────
# §3 — cocoindex background-thread invocation
# ──────────────────────────────────────────────────────────────────────────


class TestCocoindexBackgroundThread:
    """coco.start_blocking() runs in a background daemon thread so the
    HTTP server runs concurrently with the cocoindex fs-watch loop.

    Test-isolation note: this test triggers `start_cocoindex_thread()`
    which lazy-imports flow.py. flow.py registers cocoindex ContextKeys
    + App entries in process-global registries that cannot be cleanly
    reset in cocoindex 1.0.3 (`reset_default_env_for_tests()` only
    handles lifespan registration). Consequently, running this test in
    the SAME pytest process as `test_cocoindex_flow_idle_mode.py` will
    cause the idle-mode test to fail on the second flow.py re-import
    (the idle-mode test pops `cocoindex_pipeline.flow` from sys.modules
    and re-imports through the unqualified namespace, which tries to
    register the same App name twice — refused by cocoindex's
    `_app_registry`). The cross-contamination is pre-existing and not
    introduced by this Subtask — surfaced as an out-of-scope
    observation for Curator triage. Running each file in isolation
    works correctly.
    """

    def test_start_cocoindex_thread_spawns_daemon_thread(self) -> None:
        """`start_cocoindex_thread()` spawns a daemon thread whose target
        calls `coco.start_blocking()`."""
        from scripts.cocoindex_pipeline import server as server_mod

        with patch.object(
            server_mod.coco, "start_blocking", return_value=None
        ) as mock_start:
            thread = server_mod.start_cocoindex_thread()
            # The returned thread must be daemon so it does not block
            # Python interpreter shutdown.
            assert isinstance(thread, threading.Thread)
            assert thread.daemon is True
            # The thread should have started (alive or already-completed).
            # Join with a short timeout so the test doesn't hang if the
            # mock blocks unexpectedly.
            thread.join(timeout=2.0)
            mock_start.assert_called_once()
        # Side-effect verification: flow.py landed in sys.modules via
        # the lazy import (mirrors the contract test originally split
        # into a second test case; collapsed here to keep both
        # assertions in one cocoindex-side-effect-incurring test
        # rather than incurring the cost twice).
        import sys as _sys

        assert (
            "scripts.cocoindex_pipeline.flow" in _sys.modules
            or "cocoindex_pipeline.flow" in _sys.modules
        ), "flow.py must be imported via start_cocoindex_thread() lazy import"


# ──────────────────────────────────────────────────────────────────────────
# §4 — PORT env var honoured
# ──────────────────────────────────────────────────────────────────────────


class TestPortEnvVar:
    """The wrapper reads `int(os.environ.get('PORT', 8080))`."""

    def test_default_port_is_8080(self) -> None:
        from scripts.cocoindex_pipeline.server import resolve_port

        # Clear PORT for the default-case test.
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PORT", None)
            assert resolve_port() == 8080

    def test_port_env_var_overrides_default(self) -> None:
        from scripts.cocoindex_pipeline.server import resolve_port

        with patch.dict(os.environ, {"PORT": "9090"}):
            assert resolve_port() == 9090

    def test_port_must_be_int_parseable(self) -> None:
        """Non-int PORT raises ValueError at parse time. Cloud Run only
        ever sets a numeric PORT — fail fast on malformed input rather
        than silently fallback to 8080 (defensive, not silent-fail)."""
        from scripts.cocoindex_pipeline.server import resolve_port

        with patch.dict(os.environ, {"PORT": "not-a-port"}):
            with pytest.raises(ValueError):
                resolve_port()
