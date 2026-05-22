"""HTTP wrapper server for the cocoindex sidecar Cloud Run Service.

Listens on `$PORT` (default 8080), exposes `GET /health` returning HTTP
200 + `{"status": "ok"}`, and runs `coco.start_blocking()` in a background
daemon thread so the cocoindex fs-watch loop runs concurrently with the
HTTP server.

Resolves the deploy blocker identified in Subtask 28.15:

- `cloudrun/cloudbuild-cocoindex.yaml` GOOGLE_ENTRYPOINT now references this
  module (`python3 scripts/cocoindex_pipeline/server.py`).
- Cloud Run Service startupProbe expects `/health` on port 8080 (see
  `cloudrun/services/{prod,staging}-{kpf,example-client}-cocoindex.yaml`).
- PRODUCT Inv-6 (HTTPS /health probe returns 200 OK) is now satisfied.

Concurrency model:
  The cocoindex Rust engine + fs-watch loop is synchronous and runs via
  `coco.start_blocking()` — there is no public non-blocking variant in
  cocoindex 1.0.3. The wrapper therefore spawns a `threading.Thread`
  (daemon=True) for cocoindex BEFORE booting aiohttp's `web.run_app()`.
  Daemon threads do not block interpreter shutdown; SIGTERM delivered
  by Cloud Run scale-down trips the shutdown event + lets aiohttp drain
  in-flight HTTP requests; cocoindex's own SIGTERM handling (inside its
  Rust engine) drains in-flight pipeline work.

Concurrency caveat:
  Python's threading + the GIL mean the HTTP event loop competes with
  cocoindex's CPython-level callbacks (LiteLLM invocations, Pydantic
  validation, JSON I/O). cocoindex's Rust engine releases the GIL for
  its native work so /health responsiveness is not blocked by the LMDB
  poll loop. This is acceptable for the Inv-6 contract — /health is a
  trivial endpoint that only needs to respond in <1 s during the
  startup probe window. If concurrency becomes constrained, switch to a
  separate Cloud Run Job for cocoindex.

References:
  docs/specs/cocoindex-flow-scaffolding/TECH.md §P-1 (Cloud Run deploy contract)
  cloudrun/cloudbuild-cocoindex.yaml — GOOGLE_ENTRYPOINT line
  cloudrun/services/staging-kpf-cocoindex.yaml — startupProbe /health:8080
  scripts/cocoindex_pipeline/flow.py — KH_PIPELINE_APP + app_main
  scripts/cocoindex_pipeline/__main__.py — original bare entrypoint (now superseded)

CLAUDE.md gotchas applied:
  - cocoindex 1.0.3 requires dangerouslyDisableSandbox in dev for the
    Rust-engine LMDB boot; production runtime under Cloud Run does not
    need sandbox-disable (no MCP sandbox in container).
  - Python background output: use PYTHONUNBUFFERED=1 in Cloud Run env
    (already set by buildpack default) or logs are invisible.
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

# NOTE: `scripts.cocoindex_pipeline.flow` is imported LAZILY inside
# `start_cocoindex_thread()` rather than at module top. Eager-importing
# flow.py here would register the `kh_pipeline_db` cocoindex ContextKey
# during test collection (whenever pytest collects this module to read
# the test file's `from scripts.cocoindex_pipeline.server import ...`).
# The idle-mode test (`test_cocoindex_flow_idle_mode.py`) then pops
# `cocoindex_pipeline.flow` from sys.modules and re-imports through the
# unqualified namespace, which tries to create the same ContextKey via
# a SECOND module identity (`cocoindex_pipeline.flow` vs
# `scripts.cocoindex_pipeline.flow` are two sys.modules entries for the
# same physical file) — cocoindex's global key registry refuses the
# duplicate registration with `ValueError: Context key kh_pipeline_db
# already used`. Deferring the flow.py import to runtime keeps unit
# tests free of the cocoindex global side-effect while preserving the
# production contract (main() invokes start_cocoindex_thread() which
# does the import + registration before coco.start_blocking() runs).

_logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Port resolution
# ──────────────────────────────────────────────────────────────────────────


def resolve_port() -> int:
    """Return the port from `$PORT`, defaulting to 8080.

    Cloud Run sets `PORT` to a numeric value (typically 8080) at container
    start. Malformed `PORT` raises `ValueError` rather than silently
    fallback — defensive against deploy-manifest typos.
    """
    raw = os.environ.get("PORT", "8080")
    return int(raw)


# ──────────────────────────────────────────────────────────────────────────
# Signal handling
# ──────────────────────────────────────────────────────────────────────────


def install_signal_handlers() -> threading.Event:
    """Install a SIGTERM handler that sets a shutdown `threading.Event`.

    Cloud Run sends SIGTERM at scale-to-zero (default 10 s grace period
    before SIGKILL). The handler:
      - Logs a structured INFO message so post-mortem operators can
        correlate Cloud Run shutdown events with sidecar drain.
      - Sets the returned `threading.Event` so the caller's main loop
        (typically `web.run_app()` via its own internal handling) can
        observe the signal and exit cleanly.

    Returns the shutdown `threading.Event` so callers can `await
    event.wait()` or poll `event.is_set()`.
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
    """GET /health — returns 200 OK + JSON body `{"status": "ok"}`.

    This is the Cloud Run startupProbe + livenessProbe target. The probe
    contract is defined in `cloudrun/services/staging-kpf-cocoindex.yaml`
    (and the three sibling manifests):
        startupProbe.httpGet.path = /health
        startupProbe.httpGet.port = 8080
    The endpoint MUST respond well within the probe's
    `periodSeconds * failureThreshold` window. Implementation is trivial
    so the probe budget is dominated by image cold-start (not handler
    runtime).
    """
    return web.json_response({"status": "ok"})


# ──────────────────────────────────────────────────────────────────────────
# Application factory
# ──────────────────────────────────────────────────────────────────────────


def build_app() -> web.Application:
    """Build the aiohttp `web.Application` with the /health route attached.

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

    `coco.start_blocking()` is synchronous and blocks until SIGTERM or
    KeyboardInterrupt. We run it in a daemon thread so:
      1. The HTTP server (aiohttp event loop on the main thread) can
         respond to /health probes concurrently.
      2. Python interpreter shutdown is not blocked by the thread
         (daemon=True implies the interpreter exits without joining).
      3. Cloud Run SIGTERM delivery reaches both threads — aiohttp drains
         in-flight requests; cocoindex's Rust engine drains in-flight
         pipeline work.

    Side effect: imports `scripts.cocoindex_pipeline.flow` (lazy at call
    time, not module top — see header comment for the test-isolation
    rationale). The flow.py import registers `KH_PIPELINE_APP` with the
    cocoindex environment via the `coco.App(...)` constructor side-effect
    at module load. Without this import the App is never registered and
    `coco.start_blocking()` runs with no flows.

    The function returns the `threading.Thread` so callers can join
    (e.g. in tests where the mocked `coco.start_blocking` returns
    immediately and we want to assert the call happened).
    """
    # Lazy import — triggers KH_PIPELINE_APP registration on the cocoindex
    # environment via flow.py module-load side-effect. Done here (not at
    # module top) so unit tests that exercise build_app() / resolve_port()
    # / install_signal_handlers() do not pay the ContextKey registration
    # cost (and do not collide with the idle-mode test's sys.modules
    # surgery — see header comment).
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
    """Boot the HTTP server + cocoindex background thread.

    Order of operations:
      1. Configure stdlib logging (INFO level, structured for Cloud Run).
      2. Install SIGTERM handler (returns shutdown event — currently
         unused by aiohttp's run_app which has its own signal handling,
         but kept available for future drain coordination).
      3. Spawn cocoindex background daemon thread.
      4. Build aiohttp app + run on $PORT.
    """
    # stdlib logging — Cloud Run picks up stdout/stderr as jsonPayload
    # when PYTHONUNBUFFERED=1 (set by buildpack default).
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )

    port = resolve_port()
    _logger.info("Starting cocoindex sidecar HTTP wrapper on port=%d", port)

    # Install SIGTERM handler. The returned shutdown_event is currently
    # unused (aiohttp's run_app has its own signal trapping), but the
    # handler logs the SIGTERM arrival for post-mortem correlation.
    install_signal_handlers()

    # Spawn cocoindex in a background daemon thread BEFORE booting the
    # HTTP server. coco.start_blocking() handles its own SIGTERM trap
    # internally (cocoindex 1.0.3 Rust engine).
    start_cocoindex_thread()

    # Boot aiohttp on the main thread. web.run_app() blocks until
    # SIGTERM / SIGINT; aiohttp installs its own signal handlers and
    # drains in-flight requests before returning.
    app = build_app()
    web.run_app(app, host="0.0.0.0", port=port, print=None)  # noqa: S104 — Cloud Run requires 0.0.0.0


if __name__ == "__main__":
    main()
