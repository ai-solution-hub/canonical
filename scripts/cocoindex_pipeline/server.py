"""HTTP wrapper server for the cocoindex sidecar Cloud Run Service.

Listens on `$PORT` (default 8080), serves `GET /health` (200 +
`{"status": "ok"}` while the cocoindex worker thread is alive; 503 +
`{"status": "error", ...}` once the worker has crashed — ID-49.8 / audit
§7.5), and runs `KH_PIPELINE_APP.update_blocking(live=True)` in a daemon
thread so the cocoindex fs-watch loop runs concurrently with aiohttp.

Boot wiring (ID-49.1): the worker runs the App via
`KH_PIPELINE_APP.update_blocking(live=True)`, NOT the bare
`coco.start_blocking()`. `start_blocking()` only enters the App's lifespan
(provisioning the asyncpg pool under `DB_CTX`); it does NOT run `app_main`.
`update_blocking()` lazily starts the same lifespan-bearing default
environment AND runs `app_main` on it, so `mount_table_target(DB_CTX, …)`
resolves the pool and ingest runs. See TECH.md §P-2 + `start_cocoindex_thread`.

Concurrency model: cocoindex 1.0.3 has no public non-blocking start
variant, so the Rust-engine loop spawns on a daemon thread; aiohttp owns
the main thread. Both pick up SIGTERM independently — aiohttp drains
in-flight HTTP requests, cocoindex drains in-flight pipeline work. The
GIL is released for cocoindex's native work so /health responsiveness is
not blocked by the LMDB poll loop.

References:
  docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-1.
  cloudrun/services/*-cocoindex.yaml — startupProbe /health:8080.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import threading
from typing import Any

# `cocoindex` is imported at module top so `server.coco` is a stable patch
# target for the boot-path regression guard in test_cocoindex_server.py
# (`assert_not_called()` on `coco.start_blocking`, proving the worker never
# reverts to the lifespan-only boot path — ID-49.1). The actual App run goes
# via `KH_PIPELINE_APP.update_blocking(live=True)`, not `coco.*`.
import cocoindex as coco  # noqa: F401 — patch-target + domain dependency
from aiohttp import web

# `scripts.cocoindex_pipeline.flow` is imported LAZILY inside
# `start_cocoindex_thread()` rather than at module top. Eager import would
# register the `kh_pipeline_db` ContextKey at test-collection time,
# colliding with the idle-mode test (which pops `cocoindex_pipeline.flow`
# from sys.modules and re-imports through the unqualified namespace —
# cocoindex's global key registry refuses the duplicate registration).

_logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Worker-liveness state (ID-49.8 / audit §7.5)
# ──────────────────────────────────────────────────────────────────────────
#
# The cocoindex worker runs on a daemon thread (start_cocoindex_thread). Before
# ID-49.8, /health was unconditionally 200 on the aiohttp thread, so a crashed
# worker (the asyncpg gaierror boot crash) still reported the revision Ready —
# a green revision with a dead pipeline. This shared Event lets the worker
# thread signal a crash so /health can return non-200, making the Cloud Run
# liveness probe fail the revision when the pipeline is actually down.
#
# See docs/audits/cocoindex-state-db-connection-crash-2026-05-26.md §7.5.

_WORKER_CRASHED = threading.Event()


def mark_worker_crashed() -> None:
    """Flag the cocoindex worker as crashed (set by the worker thread on death)."""
    _WORKER_CRASHED.set()


def reset_worker_state() -> None:
    """Clear the crash flag — used by tests and at a fresh worker (re)start."""
    _WORKER_CRASHED.clear()


def worker_is_healthy() -> bool:
    """True while the cocoindex worker thread has not signalled a crash."""
    return not _WORKER_CRASHED.is_set()


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
    """GET /health — Cloud Run startupProbe + livenessProbe target.

    Reflects the cocoindex worker thread, not just aiohttp (ID-49.8 / audit
    §7.5). Returns 503 when the worker has crashed so the Cloud Run liveness
    probe fails the revision — a green revision now means the pipeline is
    actually up, not merely that the HTTP thread survived.
    """
    if worker_is_healthy():
        return web.json_response({"status": "ok"})
    return web.json_response(
        {"status": "error", "reason": "cocoindex worker thread crashed"},
        status=503,
    )


# ──────────────────────────────────────────────────────────────────────────
# Application factory
# ──────────────────────────────────────────────────────────────────────────


def build_app() -> web.Application:
    """Build the aiohttp app with the /health route attached.

    Factored out so unit tests can exercise the route table without
    booting a listening socket or running the cocoindex App.
    """
    app = web.Application()
    app.router.add_get("/health", _health_handler)
    return app


# ──────────────────────────────────────────────────────────────────────────
# cocoindex background-thread invocation
# ──────────────────────────────────────────────────────────────────────────


def start_cocoindex_thread() -> threading.Thread:
    """Spawn a daemon thread that runs `KH_PIPELINE_APP.update_blocking(live=True)`.

    The flow.py import below brings `KH_PIPELINE_APP` into scope (and, as an
    import side-effect, registers the App + `@coco.lifespan kh_pipeline_lifespan`
    on cocoindex's default environment). The lazy form keeps unit tests that
    only exercise build_app/resolve_port/install_signal_handlers free of the
    ContextKey registration (see module-top NOTE).

    Boot-wiring contract (ID-49.1, spec TECH.md §P-2):
    `KH_PIPELINE_APP.update_blocking(live=True)` is THE call that runs the
    pipeline. It is NOT interchangeable with the bare `coco.start_blocking()`:
    `start_blocking()` only starts the default environment and ENTERS its
    lifespan (provisioning the asyncpg pool under `DB_CTX`) — it does NOT run
    any registered App's `main_fn`. Booting via `start_blocking()` alone would
    provision the DB pool but never execute `app_main`, so
    `mount_table_target(DB_CTX, …)` would never run and the pipeline would
    silently do nothing. `update_blocking()` lazily starts the SAME
    `_default_env` where the lifespan registered (entering it, so `DB_CTX` is
    provided) and then runs `app_main` on it — the pool resolves, ingest runs.
    `live=True` arms cocoindex's continuous fs-watch loop so incremental
    source-folder changes are processed for the Service's lifetime. (Verified
    empirically against installed cocoindex 1.0.3; AppConfig.environment
    defaults to the same `_default_env` the lifespan binds to, so App and
    lifespan share one environment.)

    O-Q8 idle-mode: when `COCOINDEX_SOURCE_PATH` is unset/missing, `app_main`
    logs and returns before any `mount_each`, so `update_blocking()` returns
    cleanly with nothing to watch; the daemon thread exits and aiohttp keeps
    the Service alive. The worker is NOT flagged crashed on a clean return.

    Returns the thread so callers can join in tests.
    """
    from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP

    def _target() -> None:
        _logger.info(
            "cocoindex background thread starting via "
            "KH_PIPELINE_APP.update_blocking(live=True)"
        )
        try:
            KH_PIPELINE_APP.update_blocking(live=True)
        except Exception:  # noqa: BLE001 — top-level boundary, must log + reraise
            # ID-49.8: flag the worker as crashed so /health returns non-200 and
            # the Cloud Run liveness probe fails the revision (audit §7.5). The
            # daemon thread dies after this; the crash flag is the only signal
            # the aiohttp /health handler has to observe the dead pipeline.
            mark_worker_crashed()
            _logger.exception("cocoindex background thread crashed")
            raise

    thread = threading.Thread(
        target=_target,
        name="cocoindex-update_blocking",
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
