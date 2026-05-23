"""HTTP wrapper server for the cocoindex sidecar Cloud Run Service.

Listens on `$PORT` (default 8080), serves `GET /health` → 200 +
`{"status": "ok"}`, and runs `coco.start_blocking()` in a daemon thread
so the cocoindex fs-watch loop runs concurrently with aiohttp.

Concurrency model: cocoindex 1.0.3 has no public non-blocking start
variant, so the Rust-engine loop spawns on a daemon thread; aiohttp owns
the main thread. Both pick up SIGTERM independently — aiohttp drains
in-flight HTTP requests, cocoindex drains in-flight pipeline work. The
GIL is released for cocoindex's native work so /health responsiveness is
not blocked by the LMDB poll loop.

References:
  docs/specs/cocoindex-flow-scaffolding/TECH.md §P-1.
  cloudrun/services/*-cocoindex.yaml — startupProbe /health:8080.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
from typing import Any

import cocoindex as coco
from aiohttp import web

# `scripts.cocoindex_pipeline.flow` is imported LAZILY inside
# `start_cocoindex_thread()` rather than at module top. Eager import would
# register the `kh_pipeline_db` ContextKey at test-collection time,
# colliding with the idle-mode test (which pops `cocoindex_pipeline.flow`
# from sys.modules and re-imports through the unqualified namespace —
# cocoindex's global key registry refuses the duplicate registration).

_logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Port resolution
# ──────────────────────────────────────────────────────────────────────────


def resolve_port() -> int:
    """Return the port from `$PORT`, defaulting to 8080.

    Malformed `PORT` raises `ValueError` rather than silent fallback —
    defensive against deploy-manifest typos.
    """
    raw = os.environ.get("PORT", "8080")
    return int(raw)


# ──────────────────────────────────────────────────────────────────────────
# Signal handling
# ──────────────────────────────────────────────────────────────────────────


def install_signal_handlers() -> threading.Event:
    """Install a SIGTERM handler that sets and returns a shutdown Event.

    Logs the signal arrival for post-mortem correlation; callers poll or
    `await event.wait()` to observe the drain signal.
    """
    shutdown_event = threading.Event()

    def _handle_sigterm(signum: int, frame: Any) -> None:  # noqa: ARG001 — frame unused
        _logger.info(
            "SIGTERM received; setting shutdown event for graceful drain. "
            "signum=%s",
            signum,
        )
        shutdown_event.set()

    signal.signal(signal.SIGTERM, _handle_sigterm)
    return shutdown_event


# ──────────────────────────────────────────────────────────────────────────
# HTTP route handlers
# ──────────────────────────────────────────────────────────────────────────


async def _health_handler(request: web.Request) -> web.Response:  # noqa: ARG001 — request unused
    """GET /health — Cloud Run startupProbe + livenessProbe target."""
    return web.json_response({"status": "ok"})


# ──────────────────────────────────────────────────────────────────────────
# Application factory
# ──────────────────────────────────────────────────────────────────────────


def build_app() -> web.Application:
    """Build the aiohttp app with the /health route attached.

    Factored out so unit tests can exercise the route table without
    booting a listening socket or invoking `coco.start_blocking()`.
    """
    app = web.Application()
    app.router.add_get("/health", _health_handler)
    return app


# ──────────────────────────────────────────────────────────────────────────
# cocoindex background-thread invocation
# ──────────────────────────────────────────────────────────────────────────


def start_cocoindex_thread() -> threading.Thread:
    """Spawn a daemon thread that calls `coco.start_blocking()`.

    The flow.py import below is the side-effect that registers
    `KH_PIPELINE_APP` with the cocoindex environment; without it
    `start_blocking()` runs with no flows. The lazy form keeps unit tests
    that only exercise build_app/resolve_port/install_signal_handlers
    free of the ContextKey registration (see module-top NOTE).

    Returns the thread so callers can join in tests.
    """
    from scripts.cocoindex_pipeline.flow import (  # noqa: F401 — side-effect registration
        KH_PIPELINE_APP as _KH_PIPELINE_APP,
    )

    def _target() -> None:
        _logger.info("cocoindex background thread starting via coco.start_blocking()")
        try:
            coco.start_blocking()
        except Exception:  # noqa: BLE001 — top-level boundary, must log + reraise
            _logger.exception("cocoindex background thread crashed")
            raise

    thread = threading.Thread(
        target=_target,
        name="cocoindex-start_blocking",
        daemon=True,
    )
    thread.start()
    return thread


# ──────────────────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────────────────


def main() -> None:
    """Boot the HTTP server + cocoindex background thread."""
    # Cloud Run picks up stdout/stderr as jsonPayload with PYTHONUNBUFFERED=1.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )

    port = resolve_port()
    _logger.info("Starting cocoindex sidecar HTTP wrapper on port=%d", port)

    # SIGTERM handler logs arrival for post-mortem correlation; the returned
    # event is unused (aiohttp's web.run_app has its own signal trapping).
    install_signal_handlers()

    # Spawn cocoindex BEFORE web.run_app() so the cocoindex Rust engine is
    # primed for incoming work the moment aiohttp accepts its first request.
    start_cocoindex_thread()

    app = build_app()
    web.run_app(app, host="0.0.0.0", port=port, print=None)  # noqa: S104 — Cloud Run requires 0.0.0.0


if __name__ == "__main__":
    main()
