"""HTTP wrapper server for the cocoindex sidecar (on-prem B1 / Coolify).

Listens on `$PORT` (default 8080), serves `GET /health` (200 +
`{"status": "ok"}` while the cocoindex worker thread is alive; 503 +
`{"status": "error", ...}` once the worker has crashed — ID-49.8 / audit
§7.5), and provisions the cocoindex environment on a daemon thread so the
asyncpg pool + LMDB engine are ready for an on-demand corpus walk.

Boot wiring (ID-83 / bl-221 — Shape 1 lifespan-only boot): the worker
enters the cocoindex environment via `coco.start_blocking()`, NOT
`KH_PIPELINE_APP.update_blocking(...)`. `start_blocking()` enters the App's
lifespan (provisioning the asyncpg pool under `DB_CTX` + the LMDB engine)
and returns — it runs NO registered App's `main_fn`, so `app_main` (and
therefore `walk_dir`) NEVER runs at boot. A container boot/restart can
therefore NEVER auto-walk the corpus or burn Anthropic tokens, regardless
of whether `COCOINDEX_SOURCE_PATH` is set (bl-221 G1).

The corpus walk fires ONLY on an explicit signal: the bearer-gated
`POST /walk` route runs `KH_PIPELINE_APP.update_blocking(live=False)` on
demand. `update_blocking()` reuses the SAME cached lifespan-bearing default
environment that `start_blocking()` entered at boot (verified empirically
against cocoindex 1.0.3: `LazyEnvironment._get_env` short-circuits on the
cached `self._env`), so `mount_table_target(DB_CTX, …)` resolves the pool
and `app_main` runs exactly ONE non-live update pass, then returns to idle
(bl-221 G2). This retires the SOURCE_PATH-blanking burn-valve: the burn
guard is now "boot never walks", an architectural guarantee, not a manual
operator step.

Concurrency model: `start_blocking()` enters the lifespan on cocoindex's
default-env event loop (a daemon loop-runner thread) and returns; the env
stays cached process-wide, so a later `/walk` `update_blocking` reuses it.
The boot daemon thread therefore completes cleanly after provisioning —
aiohttp owns the main thread and serves /health for the container lifetime.
A single-flight lock in the `/walk` route guarantees at most one walk pass
runs at a time (bl-221 G4). Both threads pick up SIGTERM independently.

References:
  docs/specs/bl-221-cocoindex-walk-trigger/TECH.md §5 (boot-decouple +
    /walk trigger), §4 (empirical update_blocking(live=False) verification).
  docs/runbooks/onprem-b1-deploy.md §B2 (retired burn-valve discipline).
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

# `cocoindex` is imported at module top so `server.coco` is a stable patch
# target for the boot-path guard in test_cocoindex_server.py. Under ID-83 /
# bl-221 (Shape 1 lifespan-only boot) the guard INVERTED: the boot path now
# calls `coco.start_blocking()` (enter lifespan, NO walk) and must NOT call any
# walking `KH_PIPELINE_APP.update_blocking(...)`. The on-demand `POST /walk`
# route is the only caller of `update_blocking(live=False)`.
import cocoindex as coco  # — patch-target + boot-time lifespan entry
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
# worker (the asyncpg gaierror boot crash) still reported the container Ready —
# a healthy container with a dead pipeline. This shared Event lets the worker
# thread signal a crash so /health can return non-200, letting a health/liveness
# check flag the container when the pipeline is actually down.
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
# Walk single-flight state (ID-83 / bl-221 G4)
# ──────────────────────────────────────────────────────────────────────────
#
# The `POST /walk` route runs a one-shot `update_blocking(live=False)` corpus
# walk on a worker thread. A second walk signal arriving while a walk is in
# flight is rejected with 409 — never two concurrent walks burning Anthropic in
# parallel. A non-reentrant `threading.Lock` is the single-flight guard: the
# handler acquires it non-blocking (`acquire(blocking=False)`); a failed acquire
# means a walk is already in flight. The worker thread releases it in a
# `finally` so a failed walk (exception in `update_blocking`) does NOT wedge the
# lock — the next signal can start a fresh walk.

_WALK_IN_FLIGHT = threading.Lock()


def walk_in_progress() -> bool:
    """True while a `/walk` corpus pass is in flight (the single-flight lock is held)."""
    return _WALK_IN_FLIGHT.locked()


def reset_walk_state() -> None:
    """Release the walk single-flight lock if held — test-only clean-slate helper."""
    if _WALK_IN_FLIGHT.locked():
        try:
            _WALK_IN_FLIGHT.release()
        except RuntimeError:
            # Released from a thread that did not acquire it (test teardown) —
            # tolerate, the goal is simply a clean unlocked state.
            pass


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
    """GET /health — container health/liveness probe target.

    Reflects the cocoindex worker thread, not just aiohttp (ID-49.8 / audit
    §7.5). Returns 503 when the worker has crashed so a health/liveness check
    flags the container — a healthy container now means the pipeline is
    actually up, not merely that the HTTP thread survived.
    """
    if worker_is_healthy():
        return web.json_response({"status": "ok"})
    return web.json_response(
        {"status": "error", "reason": "cocoindex worker thread crashed"},
        status=503,
    )


async def _stage_handler(request: web.Request) -> web.Response:
    """POST /stage — drop multipart fixture bytes into the watched corpus dir.

    Co-resident with the cocoindex worker (ID-62 Slice A): the bytes are
    written to the local-fs `COCOINDEX_SOURCE_PATH` corpus dir — no second
    process, no network hop. The route is host-agnostic — identical on the B1
    on-prem host.

    Staging does NOT trigger ingestion (ID-83 / bl-221): there is no continuous
    `walk_dir` watcher polling the corpus. `/stage` only lands the bytes;
    ingestion fires on a separate explicit bearer-gated `POST /walk`
    (`_walk_handler`, a one-shot `update_blocking(live=False)` pass). The
    stage -> walk -> assert verify sequence (ID-62) issues `/walk` between
    staging and asserting — staging alone produces no rows.

    URL items ({75.11} WP-G): a URL-sourced reference item is staged by
    seeding a gate-passed `feed_articles` ledger row (`passed = true`), NOT
    by staging bytes — the walk's URL source (`FeedUrlSource`, mounted in
    `flow.app_main`) enumerates the ledger directly and PullMD/Docling fetch
    the body at ingest time. `/stage` remains file-fixture-only; the {62.10}
    URL proof seeds its ledger row, then issues the same `POST /walk`.

    Wire contract (matches the {62.8} `stageFixture` client): a
    `multipart/form-data` body with a `file` part (raw bytes, filename set by
    the caller), a `destPath` text part (corpus-relative target), and a
    `titlePrefix` text part (informational; the caller embeds the prefix in
    the dest filename — `/stage` does NO in-byte title injection, OQ-62-6).

    Failure model (Inv-5): a client-correctable mis-wire is a NAMED 400, never
    a silent accept and never a 5xx. 5xx is reserved for an unambiguous
    server-side mount failure. The handler imports no pullmd binary and no
    Playwright driver, so the cloudbuild AGPL assertion stays green
    (TECH-CONSTRAINT-AGPL). It does not touch `_health_handler` /
    `worker_is_healthy()` — adding /stage cannot flip /health to 503 (Inv-6).
    """
    # (1) Resolve the corpus root; loud-reject a mis-wire as a named 400 [Inv-5].
    source_path = os.environ.get("COCOINDEX_SOURCE_PATH")
    if not source_path:
        return web.json_response(
            {"error": "COCOINDEX_SOURCE_PATH is unset"}, status=400
        )
    if not Path(source_path).exists():
        return web.json_response(
            {"error": f"COCOINDEX_SOURCE_PATH does not exist: {source_path}"},
            status=400,
        )

    # (2) Read the multipart body; capture the file bytes + the text parts [Inv-2].
    #     Guard the content type FIRST: `request.multipart()` raises an internal
    #     AssertionError on a non-multipart body (aiohttp's MultipartReader
    #     asserts `multipart/*`), which would surface as an unhandled 500. A
    #     client posting JSON here is a client-correctable mis-wire → named 400,
    #     never a 5xx [Inv-5].
    if "multipart" not in request.content_type:
        return web.json_response(
            {
                "error": (
                    "/stage requires a multipart/form-data body, got "
                    f"Content-Type: {request.content_type}"
                )
            },
            status=400,
        )
    file_bytes: bytes | None = None
    dest_path: str | None = None
    title_prefix: str | None = None
    reader = await request.multipart()
    async for part in reader:
        if part.name == "file":
            file_bytes = await part.read(decode=False)
        elif part.name == "destPath":
            dest_path = await part.text()
        elif part.name == "titlePrefix":
            title_prefix = await part.text()

    # A request carrying only a path string with no bytes is rejected — bytes
    # on the wire, not a path the writer can't see [Inv-2].
    if file_bytes is None or not dest_path:
        return web.json_response(
            {
                "error": (
                    "multipart request must include a 'file' part (bytes) and "
                    "a non-empty 'destPath' part"
                )
            },
            status=400,
        )

    # (3) Resolve the corpus-relative target; reject path-escape, write nothing
    #     on rejection [Inv-3]. realpath() collapses `..` and resolves symlinks,
    #     so the containment check catches traversal regardless of how it is
    #     spelled. An absolute destPath is rejected up front (pathlib would
    #     otherwise discard the corpus root when joined with an absolute path).
    if os.path.isabs(dest_path):
        return web.json_response(
            {"error": f"destPath must be corpus-relative, not absolute: {dest_path}"},
            status=400,
        )
    corpus_real = os.path.realpath(source_path)
    target_real = os.path.realpath(os.path.join(corpus_real, dest_path))
    if target_real != corpus_real and not target_real.startswith(corpus_real + os.sep):
        return web.json_response(
            {"error": f"destPath escapes the corpus root: {dest_path}"},
            status=400,
        )

    os.makedirs(os.path.dirname(target_real), exist_ok=True)
    with open(target_real, "wb") as fh:
        fh.write(file_bytes)

    request_id = uuid.uuid4().hex
    written_rel = os.path.relpath(target_real, corpus_real)
    _logger.info(
        "/stage wrote %d bytes to %s (titlePrefix=%r, requestId=%s)",
        len(file_bytes),
        written_rel,
        title_prefix,
        request_id,
    )

    # (4) Respond 2xx echoing the dest path + an informational requestId [Inv-4].
    return web.json_response(
        {"destPath": written_rel, "requestId": request_id}, status=200
    )


async def _read_full_reprocess_flag(request: web.Request) -> bool:
    """Parse the optional `full_reprocess` boolean from the /walk request body.

    Default `False` (incremental walk). A missing/empty body, a non-JSON body,
    or a JSON body without the key all yield the incremental default — the flag
    is purely opt-in, so a bare `POST /walk` with no body is a valid incremental
    trigger. Accepts a JSON boolean or the strings "true"/"1" (case-insensitive)
    for operator-friendly `curl --data` ergonomics.
    """
    if not request.can_read_body:
        return False
    try:
        payload = await request.json()
    except (ValueError, json.JSONDecodeError):
        return False
    if not isinstance(payload, dict):
        return False
    raw = payload.get("full_reprocess", False)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in {"true", "1", "yes"}
    return False


def _run_walk(full_reprocess: bool, request_id: str) -> None:
    """Worker-thread target — run ONE non-live corpus walk, release the lock.

    Runs `KH_PIPELINE_APP.update_blocking(live=False, full_reprocess=…)`, which
    reuses the cached lifespan-bearing default env entered at boot and runs
    `app_main` exactly once (bl-221 G2), then returns to idle. The single-flight
    lock is released in a `finally` so a FAILED walk (an exception in
    `update_blocking`) does NOT wedge the lock — the next /walk signal can start
    a fresh pass. A walk failure does NOT flag the worker crashed: /health
    reflects the long-lived environment's liveness, not a one-shot walk's
    outcome (the walk's result is observed via the pipeline_runs webhook +
    {66.15} datapath monitor), so a transient walk error must not fail the
    container's liveness probe.
    """
    try:
        from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP

        _logger.info(
            "/walk starting one-shot update_blocking(live=False, "
            "full_reprocess=%s, requestId=%s)",
            full_reprocess,
            request_id,
        )
        KH_PIPELINE_APP.update_blocking(live=False, full_reprocess=full_reprocess)
        _logger.info("/walk completed (requestId=%s)", request_id)
    except Exception:  # noqa: BLE001 — top-level worker boundary, must log
        # A walk failure is logged but does NOT mark the worker crashed (see
        # docstring): the long-lived env is still healthy; only this pass failed.
        _logger.exception("/walk update_blocking failed (requestId=%s)", request_id)
    finally:
        # Release the single-flight guard regardless of outcome so a failed walk
        # never wedges the lock (bl-221 G4).
        reset_walk_state()


async def _walk_handler(request: web.Request) -> web.Response:
    """POST /walk — trigger ONE on-demand corpus walk (bl-221 G2, G4).

    The explicit walk-trigger that replaces "container boots with SOURCE_PATH
    set" as the walk signal. Boot no longer walks (ID-83.1); this route is the
    only path that runs a corpus pass.

    Auth (bl-221): `Authorization: Bearer <CRON_SECRET>`. Reuses the CRON_SECRET
    already present in both compose files and read outbound by
    `flow._emit_pipeline_run_webhook` — here it is the inbound gate. A
    missing/wrong bearer → 401. If CRON_SECRET is unset in the environment the
    route fails closed (503) rather than allowing an unauthenticated walk.

    Single-flight (G4): a module-level `threading.Lock` acquired non-blocking.
    If a walk is already in flight → 409, never a second concurrent walk burning
    Anthropic in parallel. The lock is released by the worker thread's `finally`
    (including on a walk exception — a failed walk must not wedge the lock).

    Body (optional): `{"full_reprocess": true}` maps to
    `update_blocking(full_reprocess=True)` (full re-walk, cache-invalidating);
    default is an incremental walk. A bare body-less POST is a valid incremental
    trigger.

    Idle-source safety: if `COCOINDEX_SOURCE_PATH` is unset/missing the route
    returns a NAMED 400 up front (mirroring the /stage loud-reject discipline,
    Inv-5) — friendlier for an operator who expected a corpus, and it avoids
    spending the single-flight slot on a guaranteed no-op walk.

    Behaviour: validate bearer + source → acquire the single-flight guard →
    spawn a daemon worker thread running `_run_walk` (one-shot
    `update_blocking(live=False, full_reprocess=…)`) → return 202 Accepted +
    `requestId` immediately (the walk runs async; completion is observed via the
    pipeline_runs webhook). Does NOT touch `worker_is_healthy()` — a /walk
    request cannot flip /health to 503.
    """
    # (1) Auth — bearer must match CRON_SECRET. Fail closed if the secret is
    #     unset (never allow an unauthenticated walk).
    cron_secret = os.environ.get("CRON_SECRET")
    if not cron_secret:
        return web.json_response(
            {"error": "CRON_SECRET is unset — /walk auth unavailable"},
            status=503,
        )
    auth_header = request.headers.get("Authorization", "")
    expected = f"Bearer {cron_secret}"
    if auth_header != expected:
        return web.json_response(
            {"error": "missing or invalid bearer token"}, status=401
        )

    # (2) Idle-source loud-reject (Inv-5) — a walk with no corpus is a named 400,
    #     not a silent no-op that consumes the single-flight slot.
    source_path = os.environ.get("COCOINDEX_SOURCE_PATH")
    if not source_path:
        return web.json_response(
            {"error": "COCOINDEX_SOURCE_PATH is unset — nothing to walk"},
            status=400,
        )
    if not Path(source_path).exists():
        return web.json_response(
            {"error": f"COCOINDEX_SOURCE_PATH does not exist: {source_path}"},
            status=400,
        )

    # (3) Single-flight guard (G4) — non-blocking acquire; a held lock means a
    #     walk is already running → 409.
    if not _WALK_IN_FLIGHT.acquire(blocking=False):
        return web.json_response(
            {"error": "walk already in progress"}, status=409
        )

    # (4) Parse the optional full_reprocess flag, then spawn the walk worker.
    #     If anything below raises before the thread starts, release the lock so
    #     it is not wedged by a handler-side failure.
    try:
        full_reprocess = await _read_full_reprocess_flag(request)
        request_id = uuid.uuid4().hex
        thread = threading.Thread(
            target=_run_walk,
            args=(full_reprocess, request_id),
            name="cocoindex-walk",
            daemon=True,
        )
        thread.start()
    except Exception:
        reset_walk_state()
        raise

    _logger.info(
        "/walk accepted (full_reprocess=%s, requestId=%s)",
        full_reprocess,
        request_id,
    )
    return web.json_response(
        {
            "status": "accepted",
            "requestId": request_id,
            "fullReprocess": full_reprocess,
        },
        status=202,
    )


# ──────────────────────────────────────────────────────────────────────────
# Application factory
# ──────────────────────────────────────────────────────────────────────────


def build_app() -> web.Application:
    """Build the aiohttp app with the /health, /stage and /walk routes attached.

    Factored out so unit tests can exercise the route table without
    booting a listening socket or running the cocoindex App.

    Routes:
      - GET  /health — liveness probe (reflects the cocoindex worker thread).
      - POST /stage  — multipart byte-drop into the watched corpus dir (ID-62).
      - POST /walk   — bearer-gated on-demand corpus walk trigger (ID-83 /
        bl-221). Adding /walk does NOT touch /health — a walk request cannot
        flip the liveness probe.

    `client_max_size` is set EXPLICITLY to 50 MB: aiohttp's invisible default
    is 1 MB, which a future large /stage fixture (multi-MB PDF/DOCX — the
    largest current fixture is already 510 KB) would silently trip. 50 MB is
    deliberate headroom, and the size cap is not a public-exposure concern:
    the route is compose-internal only — never published outside the Docker
    network (Inv-13).
    """
    app = web.Application(client_max_size=50 * 1024 * 1024)
    app.router.add_get("/health", _health_handler)
    app.router.add_post("/stage", _stage_handler)
    app.router.add_post("/walk", _walk_handler)
    return app


# ──────────────────────────────────────────────────────────────────────────
# cocoindex background-thread invocation
# ──────────────────────────────────────────────────────────────────────────


def start_cocoindex_thread() -> threading.Thread:
    """Spawn a daemon thread that provisions the cocoindex env via `coco.start_blocking()`.

    Boot-decouple contract (ID-83 / bl-221, spec TECH.md §5.1 Shape 1):
    boot enters the cocoindex environment's lifespan ONLY — it performs ZERO
    corpus walk. `coco.start_blocking()` → `environment.start_sync()` starts
    the default environment and ENTERS its `@coco.lifespan` (provisioning the
    asyncpg pool under `DB_CTX` + the LMDB engine store), then RETURNS. It runs
    NO registered App's `main_fn`, so `app_main` (and therefore `walk_dir`)
    never executes at boot — a container boot/restart CANNOT auto-walk the
    corpus or burn Anthropic tokens, regardless of `COCOINDEX_SOURCE_PATH`'s
    value (bl-221 G1). This RETIRES the SOURCE_PATH-blanking burn-valve.

    The flow.py import below brings `KH_PIPELINE_APP` into scope (and, as an
    import side-effect, registers the App + `@coco.lifespan kh_pipeline_lifespan`
    on cocoindex's default environment) so the SAME default env that
    `start_blocking()` enters carries the App's lifespan. The lazy form keeps
    unit tests that only exercise build_app/resolve_port/install_signal_handlers
    free of the ContextKey registration (see module-top NOTE).

    Walk is on-demand only: the `POST /walk` route runs
    `KH_PIPELINE_APP.update_blocking(live=False)`, which reuses this SAME cached
    lifespan-bearing default environment (verified empirically against cocoindex
    1.0.3: `LazyEnvironment._get_env` returns the cached `self._env`; the env is
    cached process-wide once `start_blocking()` enters it) and runs `app_main`
    exactly ONCE, then returns to idle (bl-221 G2). See `_walk_handler`.

    Lifespan persistence: `start_blocking()` enters the lifespan on cocoindex's
    default-env loop (a daemon loop-runner thread) and caches the `Environment`
    on `_default_env._env`; the env stays up after this daemon thread returns,
    so aiohttp's /health stays green for the container lifetime and the later
    `/walk` `update_blocking` finds the pool already provisioned.

    O-Q8 idle-mode (defence-in-depth): even on a walk, when
    `COCOINDEX_SOURCE_PATH` is unset/missing, `app_main` logs and returns
    before any `mount_each` — a clean no-op walk. The boot path here never
    reaches `app_main` at all, so idle-mode is a backstop, not the boot guard.

    Crash wiring preserved (ID-49.8): a failure ENTERING the lifespan (e.g. the
    asyncpg gaierror boot crash) flags the worker crashed so /health returns
    503 and a health check marks the container unhealthy (audit §7.5).

    Returns the thread so callers can join in tests.
    """
    # Import flow.py for its registration side-effect: it registers the
    # `kh_pipeline` App + `@coco.lifespan kh_pipeline_lifespan` on the default
    # environment, so `coco.start_blocking()` below enters THAT lifespan. The
    # `KH_PIPELINE_APP` handle itself is consumed by the on-demand `/walk`
    # route, not by this boot path.
    from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP  # noqa: F401

    def _target() -> None:
        _logger.info(
            "cocoindex background thread provisioning env via "
            "coco.start_blocking() (lifespan-only boot — NO corpus walk; "
            "walk fires on-demand via POST /walk)"
        )
        try:
            coco.start_blocking()
        except Exception:  # noqa: BLE001 — top-level boundary, must log + reraise
            # ID-49.8: flag the worker as crashed so /health returns non-200 and
            # a health check marks the container unhealthy (audit §7.5). The daemon
            # thread dies after this; the crash flag is the only signal the
            # aiohttp /health handler has to observe the dead environment.
            mark_worker_crashed()
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
# Workspace-manifest seed (ID-62.6, ID-83-corrected)
# ──────────────────────────────────────────────────────────────────────────


# Minimal schema-valid manifest: `schema_version` 1 + an empty `mappings` list.
# Empty `mappings` is degenerate-but-legal (every path then resolves to a
# `ResolutionFailure`, which is observability-only for file content — bl-219),
# but it parses cleanly through `load_workspace_manifest`, which is all the seed
# needs: a present, parseable manifest so the first `/walk` does NOT abort with
# `ManifestLoadError`. See `workspace_resolver.WorkspaceManifest`.
_SEED_MANIFEST: dict[str, Any] = {"schema_version": 1, "mappings": []}
_WORKSPACE_MANIFEST_NAME = ".kh-workspace-map.json"


def _seed_workspace_manifest() -> None:
    """Ensure a schema-valid `.kh-workspace-map.json` exists at the corpus root.

    Rationale (ID-83 / bl-221 — NOT the pre-ID-83 boot-watch framing): boot is
    lifespan-only and never walks, so this seed is NOT "arm the boot watch" /
    "seed before `start_cocoindex_thread()`". It exists because the manifest
    must be present at the corpus root **before the FIRST `POST /walk`** — the
    walk runs `app_main`, which loads `<COCOINDEX_SOURCE_PATH>/.kh-workspace-map.json`
    and raises `ManifestLoadError` (→ zero rows) if it is absent
    (`workspace_resolver.load_workspace_manifest`). Seeding here in `main()`
    guarantees a parseable manifest exists from the container's first request;
    the old pre-`start_cocoindex_thread()` ordering constraint is moot (boot
    never walks).

    Behaviour:
      - `COCOINDEX_SOURCE_PATH` unset → no-op (idle mode; boot must not fail).
      - else `os.makedirs(source, exist_ok=True)`, then write the minimal
        `{"schema_version": 1, "mappings": []}` manifest ONLY if it is absent
        (an operator-supplied manifest is never clobbered).
    """
    source = os.environ.get("COCOINDEX_SOURCE_PATH")
    if not source:
        _logger.info(
            "COCOINDEX_SOURCE_PATH unset — skipping workspace-manifest seed "
            "(idle mode; the first POST /walk would itself no-op)"
        )
        return

    os.makedirs(source, exist_ok=True)
    manifest_path = Path(source) / _WORKSPACE_MANIFEST_NAME
    if manifest_path.exists():
        _logger.info(
            "workspace manifest already present at %s — not clobbering",
            manifest_path,
        )
        return

    manifest_path.write_text(
        json.dumps(_SEED_MANIFEST) + "\n", encoding="utf-8"
    )
    _logger.info(
        "seeded minimal workspace manifest at %s (schema_version=1, empty "
        "mappings) so the first POST /walk does not abort with ManifestLoadError",
        manifest_path,
    )


# ──────────────────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────────────────


def main() -> None:
    """Boot the HTTP server + cocoindex background thread."""
    # Coolify/Docker captures stdout/stderr as container logs; PYTHONUNBUFFERED=1 keeps them unbuffered.
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

    # Seed a schema-valid workspace manifest at the corpus root if absent, so
    # the first POST /walk's app_main does NOT abort with ManifestLoadError
    # (ID-62.6, ID-83-corrected). Placement here is fine — boot never walks
    # (ID-83), so the only ordering constraint is "before the first /walk",
    # which any in-main() placement satisfies.
    _seed_workspace_manifest()

    # Provision the cocoindex environment BEFORE web.run_app() so the asyncpg
    # pool + LMDB engine are entered (lifespan-only, NO walk — bl-221 Shape 1)
    # and ready for an on-demand POST /walk the moment aiohttp serves requests.
    start_cocoindex_thread()

    app = build_app()
    # Inv-13: the public-exposure guard is the Compose topology — the cocoindex
    # service publishes NO `ports:` mapping, so this bind is reachable only on
    # the internal Docker bridge network. The container MUST bind 0.0.0.0 for
    # that bridge reachability; a loopback bind would break compose-internal calls.
    web.run_app(app, host="0.0.0.0", port=port, print=None)  # noqa: S104 — bind all interfaces for Docker-network reachability


if __name__ == "__main__":
    main()
