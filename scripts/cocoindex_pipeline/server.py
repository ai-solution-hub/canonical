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

import asyncio
import hashlib
import json
import logging
import os
import signal
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

# `asyncpg` + `writer_fence` are plain, side-effect-free imports (no cocoindex
# ContextKey registration risk — `writer_fence.py` imports NO cocoindex symbol
# at all, `TYPE_CHECKING`-only `asyncpg`) so, unlike `scripts.cocoindex_pipeline
# .flow`, both are safe at module top rather than lazily inside a function
# (ID-138 {138.14} P5 pull-sync — TECH.md §2.3 R(c) / §2.6 R(ops)).
import asyncpg
from tenacity import Retrying, before_sleep_log, stop_after_attempt, wait_exponential

from scripts.cocoindex_pipeline.writer_fence import WriterFenceBusyError, writer_fence

# `scripts.cocoindex_pipeline.extract` is the single in-house Trafilatura
# cleaner ({112.5}). The `POST /extract` route ({112.6}) calls it over HTTP so
# the synchronous TS manual route reaches the IDENTICAL cleaning behaviour the
# cocoindex worker uses in-process — one cleaner, two seams (PI-4 / PI-9). The
# import is module-top (not lazy) because the cleaner has no cocoindex
# ContextKey registration side-effect — unlike flow.py, importing it here is
# free of the test-collection registry hazard documented above.
from scripts.cocoindex_pipeline.extract import apply_quality_gate, clean_html

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
# Producer-run single-flight state (ID-132 {132.35} G-DEPLOY-PROOF, F2 —
# manual forced-run surface)
# ──────────────────────────────────────────────────────────────────────────
#
# `POST /producer-run` runs ONE forced producer pass (bypassing BOTH the
# delta gate and the reentrancy guard — `producer.trigger.run_producer_now`)
# on a worker thread. Mirrors `/walk`'s single-flight discipline (ID-83 /
# bl-221 G4) exactly, via its OWN independent `threading.Lock` — a forced
# producer run and a corpus walk are different resources (concept drafting
# vs source ingest) so they are NOT mutually exclusive with each other, only
# with a second concurrent forced producer run (never two producer passes
# burning Anthropic tokens in parallel).

_PRODUCER_RUN_IN_FLIGHT = threading.Lock()


def producer_run_in_progress() -> bool:
    """True while a `/producer-run` forced pass is in flight."""
    return _PRODUCER_RUN_IN_FLIGHT.locked()


def reset_producer_run_state() -> None:
    """Release the /producer-run single-flight lock if held — test-only clean-slate helper."""
    if _PRODUCER_RUN_IN_FLIGHT.locked():
        try:
            _PRODUCER_RUN_IN_FLIGHT.release()
        except RuntimeError:
            # Released from a thread that did not acquire it (test teardown) —
            # tolerate, the goal is simply a clean unlocked state.
            pass


# ──────────────────────────────────────────────────────────────────────────
# Shared rate-limit state ({112.6} Property 3 — best-effort hardening;
# extended to /walk by {127.17} / S436 D1 board ratification)
# ──────────────────────────────────────────────────────────────────────────
#
# `POST /extract` becomes Traefik-reachable (unlike the compose-internal /stage),
# so the app-wide 50 MB `client_max_size` premise dies and the route needs its
# own hardening: a tight per-route body cap (enforced in `_extract_handler`) PLUS
# a minimal per-process rate-limit guard. There is no existing rate-limit
# primitive in this aiohttp sidecar (no middleware, no limiter), so this is a
# deliberately minimal fixed-window counter — NOT heavy infra. It is a
# defence-in-depth backstop on top of the bearer gate (the only authorised caller
# is the KH app itself), bounding accidental floods, not a multi-tenant quota.
#
# `POST /walk` ({127.17}) reuses this SAME guard rather than a second
# mechanism: one process-global window is deliberately shared across both
# Traefik-reachable routes — this is a single-tenant backend pipeline
# sidecar (one authorised caller, the KH app itself), not a multi-user
# service needing per-route quotas.
#
# A single process-global window suffices: this is a single-tenant backend
# pipeline sidecar, not a multi-user service. The counter resets every
# `_RATE_LIMIT_WINDOW_SECONDS`; once `_RATE_LIMIT_MAX_REQUESTS` is reached within
# a window, further requests get 429 until the window rolls over. Guarded by a
# Lock because aiohttp handlers can interleave on the event loop and the walk
# worker runs on its own thread.

_EXTRACT_BODY_CAP_BYTES = 20 * 1024 * 1024  # aligned to lib/extraction/url.ts:30
_RATE_LIMIT_WINDOW_SECONDS = 60.0
_RATE_LIMIT_MAX_REQUESTS = 120

_RATE_LIMIT_LOCK = threading.Lock()
_rate_limit_window_start = 0.0
_rate_limit_count = 0


def _rate_limit_allows() -> bool:
    """Return True if a fresh `/extract` OR `/walk` request is within the
    shared per-window budget (see module comment above).

    Minimal fixed-window guard: on the first call of a new window it resets
    the counter; within a window it increments and rejects once
    `_RATE_LIMIT_MAX_REQUESTS` is exceeded. Best-effort, process-local — a
    flood backstop layered on each route's own bearer gate, not a precise
    per-route quota.
    """
    global _rate_limit_window_start, _rate_limit_count
    now = time.monotonic()
    with _RATE_LIMIT_LOCK:
        if now - _rate_limit_window_start >= _RATE_LIMIT_WINDOW_SECONDS:
            _rate_limit_window_start = now
            _rate_limit_count = 0
        if _rate_limit_count >= _RATE_LIMIT_MAX_REQUESTS:
            return False
        _rate_limit_count += 1
        return True


def reset_rate_limit_state() -> None:
    """Reset the shared `/extract` + `/walk` rate-limit window — test-only
    clean-slate helper."""
    global _rate_limit_window_start, _rate_limit_count
    with _RATE_LIMIT_LOCK:
        _rate_limit_window_start = 0.0
        _rate_limit_count = 0


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
    `flow.app_main`) enumerates the ledger directly and fetches + extracts
    the body at ingest time. `/stage` remains file-fixture-only; the {62.10}
    URL proof seeds its ledger row, then issues the same `POST /walk`.

    Wire contract (matches the {62.8} `stageFixture` client): a
    `multipart/form-data` body with a `file` part (raw bytes, filename set by
    the caller), a `destPath` text part (corpus-relative target), and a
    `titlePrefix` text part (informational; the caller embeds the prefix in
    the dest filename — `/stage` does NO in-byte title injection, OQ-62-6).

    Failure model (Inv-5): a client-correctable mis-wire is a NAMED 400, never
    a silent accept and never a 5xx. 5xx is reserved for an unambiguous
    server-side mount failure. The handler imports no heavy extraction binary,
    keeping the build surface lean. It does not touch `_health_handler` /
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


# ──────────────────────────────────────────────────────────────────────────
# P5 — content-hash-gated pull-sync ({138.14}; TECH.md §3.2 P5, §2.3 R(c),
# §2.6 R(ops); DR-015)
# ──────────────────────────────────────────────────────────────────────────
#
# Bucket → VPS-volume materialise, run immediately before every corpus walk
# (`_run_walk`, the sole caller of `update_blocking(...)` in this module — see
# below) and under the SAME {138.9} writer-fence hold the walk itself runs
# under, so no walk can ever fire unfenced (P5 guard).
#
# CONTENT-HASH GATE (the deliverable): a local file is written ONLY when its
# on-disk sha256 differs from the row's stored `content_hash` (populated from
# cocoindex's own `FileLike.content_fingerprint()`, a sha256 digest — see
# `test_cocoindex_identity_core.py::_FakeFile.content_fingerprint`). An
# unchanged file is left byte- and mtime-untouched, so cocoindex's OWN
# content-hash memoisation (COCO.10 two-tier memo, flow.py :2650-2654) still
# short-circuits it on the walk that follows — a naive re-download would churn
# mtime and defeat that memoisation (full re-extraction bill, §8.4).
#
# SCOPE (§10.5 shrink): ONLY `retention_class = 'keep_and_watch'`, non-
# tombstoned rows. `ingest_once` sources are extracted once via the {138.11}
# one-shot path and never re-walked, so they are never pull-synced; the
# "synthetic Platform corpus" the ruling also names is not a separate code
# path — once id-134 seeds it into the SAME bucket + `source_documents` table
# (that seeding is id-134's own work, NOT this Subtask's), its rows are
# `keep_and_watch` like any client corpus and fall out of this SAME filter.
#
# BUCKET KEY vs LOCAL PATH: the bucket object key is the FROZEN `storage_path`
# (R(a) SEED-CONTRACT — see `lib/edit-intent/write-back.ts` T1, the mirror
# upload-direction leg); the LOCAL destination is the MUTABLE `logical_path`
# (falling back to `storage_path` if unset) — the path cocoindex's walk
# actually scans by, so a rename (which updates `logical_path`, never
# `storage_path`, per `_upsert_source_document`) is picked up correctly.
#
# SECURITY — path containment: `logical_path` is DB-sourced but is exactly
# the client-mutable rename attribute, so it is NOT trustworthy input. Every
# local write target is resolved via `_resolve_pull_sync_target`, which
# refuses (never writes) an absolute path, a `..` component, or a
# realpath-resolved escape (including via a symlink planted inside
# `source_root`) — mirroring `_stage_handler`'s existing `destPath`
# containment discipline in this same file.

_PULL_SYNC_RETENTION_CLASS = "keep_and_watch"
# Mirrors `lib/edit-intent/write-back.ts` / `scripts/provision-corpus-bucket.ts`
# `CORPUS_BUCKET` — one private `corpus` bucket per client project (T3, {138.8}).
_CORPUS_BUCKET = "corpus"


async def _build_pull_sync_pool() -> "asyncpg.Pool":
    """Build the short-lived asyncpg pool the pull-sync fence + query use.

    Deliberately NOT the cocoindex-managed `DB_CTX` pool: `coco.use_context`
    only resolves from inside an active cocoindex component context (a
    mount/`App.update` call) — this walk-worker thread is a plain
    `threading.Thread` target, not one, so `DB_CTX` is unreachable here (see
    `cocoindex._internal.component_ctx.use_context`'s "must be called from
    within an active component context" contract). Reuses flow.py's
    `_build_dsn()` (the `COCOINDEX_DB_DSN` env var) rather than re-deriving
    the DSN a second way — see that function's docstring for why it must be
    an explicit, fully-formed pooler string (no host reconstruction, ID-49.8).
    """
    from scripts.cocoindex_pipeline.flow import _build_dsn

    return await asyncpg.create_pool(_build_dsn(), min_size=1, max_size=2)


def _resolve_storage_downloader() -> Callable[[str], bytes]:
    """Return a `storage_path -> bytes` downloader over the `corpus` bucket.

    Mirrors `scripts/bid_worker.py`'s `SUPABASE_URL` /
    `SUPABASE_SERVICE_ROLE_KEY` env convention and its `supabase-py`
    `.storage.from_(bucket).download(...)` precedent (same file,
    `fill_template_job`) — outbound HTTPS only, zero new ingress (DR-015).
    One client is built per pull-sync pass and reused across every candidate
    row (not one client per row).
    """
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for "
            "corpus pull-sync"
        )
    client = create_client(url, key)

    def _download(storage_path: str) -> bytes:
        return client.storage.from_(_CORPUS_BUCKET).download(storage_path)

    return _download


def _local_file_sha256(path: Path) -> str | None:
    """Return the on-disk file's sha256 hex digest, or `None` if absent.

    `None` (never a rewrite) is a distinct outcome from "hash mismatch" —
    both fall through to a materialise below, but the distinction matters for
    tests/observability (a genuinely missing local file vs. a stale one).
    """
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def _fetch_pull_sync_candidates(
    conn: "asyncpg.Connection",
) -> list[dict[str, Any]]:
    """Fetch the pull-sync scope: `keep_and_watch`, non-tombstoned rows only.

    `ingest_once` / `live_connected` / `external_referenced` rows are excluded
    by the `retention_class` filter; a `tombstoned` row is excluded by the
    `admission_status` filter regardless of its `retention_class` (R(ops) —
    a tombstoned source is never re-materialised).
    """
    rows = await conn.fetch(
        "SELECT id, storage_path, logical_path, content_hash "
        "FROM public.source_documents "
        "WHERE retention_class = $1 AND admission_status <> 'tombstoned'",
        _PULL_SYNC_RETENTION_CLASS,
    )
    return [dict(row) for row in rows]


def _resolve_pull_sync_target(source_root: str, logical_path: str) -> Path | None:
    """Resolve `logical_path` to a path INSIDE `source_root`, or `None` on
    ANY escape attempt — refuses, never raises, never touches the filesystem.

    SECURITY (path-containment): `logical_path` is DB-sourced but NOT
    trustworthy — it is precisely the client-mutable rename attribute (R(id):
    a rename updates `logical_path` via the walk/upload legs), so a hostile
    or corrupted value (`../../…`, an absolute path, or a symlink-assisted
    escape) must never be allowed to write outside the VPS volume root.

    Mirrors `_stage_handler`'s `destPath` containment discipline (Inv-3,
    same file) rather than inventing a second convention: reject up-front
    (empty/whitespace, absolute, any literal `..` component — cheap, no I/O),
    THEN `os.path.realpath()`-resolve BOTH sides and require the resolved
    target to sit under the resolved root. `os.path.realpath()` resolves
    symlinks for the LONGEST EXISTING prefix and joins any remaining
    (not-yet-created) components literally — it does not require the target
    to exist — so this order is safe to call BEFORE `mkdir(parents=True)`
    and still catches a symlink planted INSIDE `source_root` that would
    otherwise redirect the write elsewhere.
    """
    if not logical_path or not logical_path.strip():
        return None
    if os.path.isabs(logical_path):
        return None
    if any(part == ".." for part in Path(logical_path).parts):
        return None
    source_real = os.path.realpath(source_root)
    target_real = os.path.realpath(os.path.join(source_real, logical_path))
    if target_real != source_real and not target_real.startswith(
        source_real + os.sep
    ):
        return None
    return Path(target_real)


# ID-141 (bl-399 / subo-id138 S446 {138.14}) — retry-with-backoff download
# policy. Module-level constants (mirrors `extraction.py`'s
# `_ANTHROPIC_RETRY_WAIT_SECONDS_*` / `_ANTHROPIC_RETRY_TOTAL_ATTEMPTS`) so
# unit tests can monkeypatch the wait to zero (avoids a real backoff ladder
# slowing CI); production defaults: 0.5 s base, 5 s cap, 2x exponent.
_PULL_SYNC_DOWNLOAD_RETRY_WAIT_SECONDS_MIN: float = 0.5
_PULL_SYNC_DOWNLOAD_RETRY_WAIT_SECONDS_MAX: float = 5.0
# Total attempt cap — 1 initial + 2 retries (bounded per the ID-141 brief).
_PULL_SYNC_DOWNLOAD_RETRY_TOTAL_ATTEMPTS: int = 3


def _download_with_retry(
    download: Callable[[str], bytes], storage_path: str
) -> bytes:
    """Call `download(storage_path)`, retrying up to
    `_PULL_SYNC_DOWNLOAD_RETRY_TOTAL_ATTEMPTS` times total with exponential
    backoff on ANY exception (ID-141; mirrors `extraction.py`'s
    `_anthropic_retry` tenacity wrapper — the SYNC `Retrying` variant here
    since `download` is a plain blocking call, not an awaitable).

    `reraise=True` re-raises the LAST attempt's ORIGINAL exception (never
    tenacity's own `RetryError` wrapper) once every attempt is exhausted —
    the caller (`_materialise_one`, via `_pull_sync_materialise`'s per-row
    catch) owns the partial-row-tolerance decision; this helper owns ONLY
    the retry/backoff policy, never the tolerance.
    """
    retrying = Retrying(
        stop=stop_after_attempt(_PULL_SYNC_DOWNLOAD_RETRY_TOTAL_ATTEMPTS),
        wait=wait_exponential(
            multiplier=1,
            min=_PULL_SYNC_DOWNLOAD_RETRY_WAIT_SECONDS_MIN,
            max=_PULL_SYNC_DOWNLOAD_RETRY_WAIT_SECONDS_MAX,
        ),
        before_sleep=before_sleep_log(_logger, logging.WARNING),
        reraise=True,
    )
    return retrying(download, storage_path)


def _materialise_one(
    source_root: str, row: dict[str, Any], download: Callable[[str], bytes]
) -> str:
    """Materialise ONE candidate row content-hash-gated. Returns "unchanged",
    "materialised", or "refused" (a path-containment violation — logged,
    never raises, never touches the filesystem for that row). A refusal
    does NOT abort the pass: one poisoned/corrupted row must not block
    pull-sync for every other legitimate keep_and_watch source (see
    `_pull_sync_materialise`).

    ID-141: the download is retried with backoff (`_download_with_retry`);
    if every attempt fails (or the subsequent local write faults), the
    exception propagates OUT of this function. It is no longer this
    function's contract to say what happens next — `_pull_sync_materialise`
    catches it per-row (partial-row tolerance) rather than letting one row's
    fault abort the whole pass, EXCEPT when the whole pass yields zero
    successes (see that function's docstring)."""
    storage_path = row["storage_path"]
    logical_path = row.get("logical_path") or storage_path
    target = _resolve_pull_sync_target(source_root, logical_path)
    if target is None:
        _logger.warning(
            "pull-sync: REFUSING row id=%s — logical_path %r escapes "
            "COCOINDEX_SOURCE_PATH (absolute / '..' component / symlink "
            "escape); row skipped, no filesystem write attempted",
            row.get("id"),
            logical_path,
        )
        return "refused"
    local_hash = _local_file_sha256(target)
    if local_hash is not None and local_hash == row["content_hash"]:
        # Content-hash match — leave the file COMPLETELY untouched (no write,
        # no mtime churn) so cocoindex's own memoisation short-circuits it.
        return "unchanged"
    data = _download_with_retry(download, storage_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return "materialised"


async def _pull_sync_materialise(
    conn: "asyncpg.Connection",
) -> tuple[dict[str, int], list[dict[str, str]]]:
    """Run one content-hash-gated pull-sync pass over the keep_and_watch (+
    Platform) scope. Returns `(counts, row_failures)`:

      - `counts` — per-outcome tally for observability/tests
        ("materialised" / "unchanged" / "refused" / "failed" — see
        `_materialise_one`).
      - `row_failures` — `[{"id": ..., "reason": ...}, ...]`, one entry per
        row whose download/write raised even after `_download_with_retry`'s
        bounded retries were exhausted.

    ID-141 (bl-399 / subo-id138 S446 {138.14} — partial-row tolerance): a
    row that raises here is CAUGHT, recorded into `row_failures`, and
    skipped — it does NOT abort the pass, mirroring the {80.9} per-item-
    isolation cascade inversion (one bad row must never zero every other
    row's materialised writes). The ONLY exception: a WHOLLY failed pass —
    every row that was NOT merely "refused" FAILED (`row_failures` is
    non-empty) AND zero rows landed (`counts["materialised"] == 0 and
    counts["unchanged"] == 0`) — re-raises the LAST failed row's original
    exception, preserving the PRE-ID-141 abort behaviour for that
    degenerate case. This is precise for the MIXED case too: a pass with
    one "refused" row and one "failed" row (zero successes) still fires
    the guard — a refusal is never itself a success, so it cannot rescue
    an otherwise wholly-failed pass from aborting. `_pull_sync_then_walk`
    propagates the re-raise uncaught exactly as before, so a pass that
    lands nothing still skips the walk and releases the {138.9}
    writer-fence lock via `_run_walk`'s `finally`.

    Idle-mode guard (belt-and-braces): `_walk_handler` already rejects an
    unset/missing `COCOINDEX_SOURCE_PATH` with a 400 BEFORE `_run_walk` is
    ever spawned, so this branch is not reachable via the HTTP route today —
    it guards any future/direct caller of this function the same way
    `_seed_workspace_manifest` guards idle mode.
    """
    source_root = os.environ.get("COCOINDEX_SOURCE_PATH")
    if not source_root:
        _logger.info(
            "pull-sync: COCOINDEX_SOURCE_PATH unset — skipping (idle mode)"
        )
        return {"materialised": 0, "unchanged": 0, "refused": 0, "failed": 0}, []

    rows = await _fetch_pull_sync_candidates(conn)
    counts = {"materialised": 0, "unchanged": 0, "refused": 0, "failed": 0}
    row_failures: list[dict[str, str]] = []
    if not rows:
        return counts, row_failures

    download = _resolve_storage_downloader()
    last_exc: Exception | None = None
    for row in rows:
        try:
            outcome = _materialise_one(source_root, row, download)
        except Exception as exc:  # noqa: BLE001 — ID-141 partial-row tolerance
            last_exc = exc
            row_id = str(row.get("id"))
            _logger.warning(
                "pull-sync: row id=%s FAILED after retries exhausted — "
                "skipped, pass continues: %s",
                row_id,
                exc,
            )
            row_failures.append({"id": row_id, "reason": str(exc)})
            counts["failed"] += 1
            continue
        counts[outcome] = counts.get(outcome, 0) + 1

    if row_failures and counts["materialised"] == 0 and counts["unchanged"] == 0:
        # Wholly-failed pass — every row that wasn't merely "refused" raised,
        # and nothing landed. Preserve the pre-ID-141 abort behaviour: raise
        # so the caller aborts exactly as it did before per-row tolerance
        # existed (bl-399).
        assert last_exc is not None
        raise last_exc

    return counts, row_failures


async def _pull_sync_then_walk(
    app: Any, full_reprocess: bool, request_id: str
) -> None:
    """Acquire the {138.9} writer fence, pull-sync materialise, THEN run the
    walk — all under the SAME fence hold (TECH §2.6 R(ops) five-writer map:
    "sync"'s acquisition IS this hold; the cocoindex incremental walk needs no
    separate acquisition because it runs here, inside it).

    `WriterFenceBusyError` (another writer holds the lease) propagates to
    `_run_walk`'s top-level boundary uncaught — this walk PASS aborts (logged,
    single-flight lock released in `_run_walk`'s `finally`), `update_blocking`
    is never called. This is the P5 guard's enforcement point: the walk
    cannot run without first passing through this fence acquisition, because
    `_run_walk` is the ONLY caller of `update_blocking` in this module.

    ID-141: `_pull_sync_materialise` itself re-raises (uncaught here, same
    propagation as before) ONLY for a wholly-failed pass (zero rows landed);
    a PARTIAL failure (some rows failed, at least one succeeded) returns
    normally with `row_failures` populated, so the walk below still runs —
    `rowFailures` is surfaced log-side only (no existing pipeline_runs/
    webhook wire schema carries pull-sync counts today, so there is nothing
    to extend/risk-dropping per the S457 memoHeals lesson).
    """
    pool = await _build_pull_sync_pool()
    try:
        async with writer_fence(pool, holder="pull_sync") as conn:
            counts, row_failures = await _pull_sync_materialise(conn)
            if row_failures:
                _logger.warning(
                    "pull-sync materialise complete WITH row failures "
                    "(requestId=%s): counts=%s rowFailures=%d ids=%s",
                    request_id,
                    counts,
                    len(row_failures),
                    [failure["id"] for failure in row_failures],
                )
            else:
                _logger.info(
                    "pull-sync materialise complete (requestId=%s): %s",
                    request_id,
                    counts,
                )
            await asyncio.to_thread(
                app.update_blocking, live=False, full_reprocess=full_reprocess
            )
    finally:
        await pool.close()


def _run_walk(full_reprocess: bool, request_id: str) -> None:
    """Worker-thread target — pull-sync THEN run ONE non-live corpus walk
    under the SAME writer-fence hold, release the single-flight lock.

    ID-138 {138.14} P5: this is the SOLE production caller of
    `update_blocking(...)` in this module (`__main__.py`'s `live=True` call is
    a separate local-dev entry point, not this HTTP route), so wrapping it in
    `_pull_sync_then_walk` (fence acquire → pull-sync materialise →
    `update_blocking` → fence release) is sufficient to guarantee no walk
    ever runs unfenced via `POST /walk` — there is no second path to guard.

    `_pull_sync_then_walk` reuses the cached lifespan-bearing default env
    `update_blocking` enters (via `asyncio.to_thread`, since `update_blocking`
    is itself a blocking call), runs `app_main` exactly once (bl-221 G2), then
    returns to idle. The single-flight lock is released in a `finally` so a
    FAILED pass (an exception in `update_blocking`, in pull-sync materialise,
    or a `WriterFenceBusyError` when another writer holds the lease) does NOT
    wedge the lock — the next /walk signal can start a fresh pass. A walk
    failure does NOT flag the worker crashed: /health reflects the long-lived
    environment's liveness, not a one-shot walk's outcome (the walk's result
    is observed via the pipeline_runs webhook + {66.15} datapath monitor), so
    a transient walk error must not fail the container's liveness probe.
    """
    try:
        from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP

        _logger.info(
            "/walk starting pull-sync + one-shot update_blocking(live=False, "
            "full_reprocess=%s, requestId=%s)",
            full_reprocess,
            request_id,
        )
        asyncio.run(
            _pull_sync_then_walk(KH_PIPELINE_APP, full_reprocess, request_id)
        )
        _logger.info("/walk completed (requestId=%s)", request_id)
    except WriterFenceBusyError as exc:
        # Busy is a NORMAL, expected outcome (writer_fence.py) — another
        # writer holds the lease, so THIS pass aborts without ever calling
        # `update_blocking` (the P5 guard). A later /walk signal can retry.
        # Logged at WARNING (not `.exception`) — this is not a fault.
        _logger.warning(
            "/walk pull-sync fence busy — pass skipped, no walk ran "
            "(requestId=%s): %s",
            request_id,
            exc,
        )
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

    Auth (bl-221; ID-127.18 / S436 D1 dual-accept): `Authorization: Bearer
    <secret>`, accepting EITHER the dedicated `PIPELINE_TRIGGER_SECRET` OR
    the legacy shared `CRON_SECRET` — a rotation-safe window so this route
    keeps authenticating before every pipeline Coolify app + Vercel
    deployment has the new secret set. `CRON_SECRET` is also read outbound
    by `flow._emit_pipeline_run_webhook`; here BOTH env vars are the inbound
    gate. A missing/wrong bearer → 401. If NEITHER secret is set in the
    environment the route fails closed (503) rather than allowing an
    unauthenticated walk.

    Rate limit (S436 D1 hardening — {127.17}): reuses the SAME minimal
    fixed-window guard `/extract` uses (`_rate_limit_allows`, see the module
    comment above it) rather than inventing a second mechanism, so both
    Traefik-reachable routes behave consistently under flood. Over-budget →
    429 with a named reason, checked right after auth and BEFORE the
    idle-source check / single-flight guard so a flood cannot spend either.

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

    Behaviour: validate bearer → rate-limit guard → validate source → acquire
    the single-flight guard → spawn a daemon worker thread running `_run_walk`
    (P5 pull-sync under the {138.9} writer fence, THEN one-shot
    `update_blocking(live=False, full_reprocess=…)` — see `_run_walk` /
    `_pull_sync_then_walk`) → return 202 Accepted + `requestId` immediately
    (the walk runs async; completion is observed via the pipeline_runs
    webhook). Does NOT touch `worker_is_healthy()` — a /walk request cannot
    flip /health to 503.
    """
    # (1) Auth — bearer must match the dedicated PIPELINE_TRIGGER_SECRET OR
    #     the legacy shared CRON_SECRET (ID-127.18 dual-accept rotation
    #     window). Fail closed if BOTH are unset (never allow an
    #     unauthenticated walk).
    pipeline_trigger_secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    cron_secret = os.environ.get("CRON_SECRET")
    if not pipeline_trigger_secret and not cron_secret:
        return web.json_response(
            {
                "error": (
                    "PIPELINE_TRIGGER_SECRET and CRON_SECRET are both unset "
                    "— /walk auth unavailable"
                )
            },
            status=503,
        )
    auth_header = request.headers.get("Authorization", "")
    accepted_bearers = {
        f"Bearer {secret}"
        for secret in (pipeline_trigger_secret, cron_secret)
        if secret
    }
    if auth_header not in accepted_bearers:
        return web.json_response(
            {"error": "missing or invalid bearer token"}, status=401
        )

    # (2) Rate-limit guard (S436 D1 — {127.17}) — reuses the SAME `/extract`
    #     fixed-window budget (`_rate_limit_allows`), a flood backstop layered
    #     on the bearer gate. Over-budget → a named 429, before the
    #     idle-source check or the single-flight slot is touched.
    if not _rate_limit_allows():
        return web.json_response(
            {"error": "rate limit exceeded — retry later"}, status=429
        )

    # (3) Idle-source loud-reject (Inv-5) — a walk with no corpus is a named 400,
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

    # (4) Single-flight guard (G4) — non-blocking acquire; a held lock means a
    #     walk is already running → 409.
    if not _WALK_IN_FLIGHT.acquire(blocking=False):
        return web.json_response(
            {"error": "walk already in progress"}, status=409
        )

    # (5) Parse the optional full_reprocess flag, then spawn the walk worker.
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
# POST /producer-run — DR-055 manual forced-run surface (ID-132 {132.35}
# G-DEPLOY-PROOF, F2)
# ──────────────────────────────────────────────────────────────────────────
#
# The automatic post-walk hook (`flow.app_main`'s `finally` block ->
# `producer.trigger.trigger_producer_post_walk`) is delta-gated (`if not
# deltas: return False`) — it only ever fires when the JUST-COMPLETED walk
# touched `source_documents` rows, so the BI-18 Run-1 proof ("a producer run
# over UNCHANGED L-records makes zero Anthropic drafting calls — a memo-hit
# no-op") is unreachable through it: there is no way to force a producer pass
# over records that legitimately did not change this walk. This route is that
# manual forced surface — bearer-gated + single-flight, mirroring `/walk`
# exactly — that bypasses BOTH the delta gate and the reentrancy guard via
# `producer.trigger.run_producer_now` (never `trigger_producer_post_walk`).
#
# **Why a SEPARATE cocoindex App (not `KH_PIPELINE_APP.update_blocking()`).**
# `enrich_concept` is `@coco.fn(memo=True)` — BI-18 memoisation requires an
# ACTIVE cocoindex ComponentContext (verified against the installed engine,
# `cocoindex._internal.function.AsyncFunction.__call__`: with no ambient
# ComponentContext, `@coco.fn(memo=True)` executes UNMEMOISED, silently
# defeating the whole Run-1 proof). `mount_table_target`'s `re_target` handle
# has the SAME requirement (`coco.use_mount` -> `get_context_from_ctx()`).
# `KH_PIPELINE_APP.update_blocking()` runs the FULL corpus walk (`app_main`,
# gated on `COCOINDEX_SOURCE_PATH`) — not a "producer-only, skip the walk"
# mode, and this Subtask's flow.py file-ownership boundary is the ONE
# trigger-context call site only, so `app_main` cannot be given a second
# mode here. `_build_forced_producer_report` instead constructs a genuinely
# SEPARATE `coco.App` (a distinct `AppConfig(name=...)`, but the SAME default
# `environment` `AppConfig` defaults to — verified empirically:
# `coco.start_blocking()`'s `@coco.lifespan kh_pipeline_lifespan` registers
# onto `cocoindex._internal.component_ctx._default_env`, NOT onto
# `KH_PIPELINE_APP` specifically, so `coco.use_context(DB_CTX)` resolves the
# SAME already-provisioned pool from EITHER App). `update_blocking()` on
# THAT App gives its own `main_fn` a real, live ComponentContext — so
# `enrich_concept`'s memo cache is genuinely live, `mount_table_target`
# succeeds, and `re_target.declare_row()` resolves `get_context_from_ctx()`
# exactly as flow.py's own post-walk hook does.
#
# **Named implementation decision (journaled, not silently assumed).** This
# forced-run App's memo/target-state namespace is DISTINCT from
# `KH_PIPELINE_APP`'s ("kh_pipeline") — cocoindex's persistent LMDB
# target-state/memo store is keyed by component stable-path, which is
# name-derived. Two forced runs (Run-1 cold-draft, Run-2 memo-hit) through
# THIS route are self-consistently comparable — they share the SAME App
# name/namespace every call — but a memo cache populated by the AUTOMATIC
# post-walk hook (running inside `KH_PIPELINE_APP`) is NOT guaranteed to be
# hit by a forced `/producer-run` call, or vice versa. The BI-18 proof
# sequence should therefore run entirely through ONE surface (either two
# `/producer-run` calls, or a walk-triggered run followed by another walk
# with no new deltas) — not compare a walk-triggered Run-1 against a forced
# Run-2 (or the reverse) and expect a cross-App memo-hit.

_PRODUCER_FORCED_RUN_APP_NAME = "kh_pipeline_producer_forced"


def _build_forced_producer_report(request_id: str) -> Any:
    """Builds the pool/re_target/repo_path context inside a dedicated
    cocoindex App's `main_fn` (see module comment above for why a separate
    App is required) and forces ONE producer run via
    `producer.trigger.run_producer_now` — the delta gate + reentrancy guard
    are bypassed entirely (`deltas=()`), so this runs over EVERY concept
    `LRecordsSource.list_concepts()` returns, exactly like the {132.16}
    "discrete `producer` command" surface the trigger module's own docstring
    names as the manual-invocation contract.

    A dedicated, easily-monkeypatched seam (mirrors `_build_pull_sync_pool`)
    so `_run_producer_forced`'s auth/single-flight/thread-dispatch logic is
    testable without booting the real cocoindex Rust engine — see
    `test_cocoindex_server.py`'s `TestProducerRun*` classes (which patch
    THIS function directly) and that same file's `TestForcedProducerReportWiring`
    class (source-inspection coverage of this function's own body, mirroring
    `test_flow_producer_chain.py`'s established pattern for `app_main` — the
    real engine cannot boot in unit tests either way).
    """
    from scripts.cocoindex_pipeline import flow
    from scripts.cocoindex_pipeline.producer.trigger import run_producer_now

    async def _forced_producer_main_fn() -> Any:
        pool = coco.use_context(flow.DB_CTX)
        re_target = await flow.mount_table_target(
            flow.DB_CTX,
            "record_embeddings",
            flow.RECORD_EMBEDDINGS_SCHEMA,
            managed_by=flow.ManagedBy.USER,
        )
        repo_path = os.environ.get("OKF_BUNDLE_DIR") or None
        return await run_producer_now(
            deltas=(),
            pool=pool,
            re_target=re_target,
            repo_path=repo_path,
        )

    forced_app = coco.App(
        coco.AppConfig(name=_PRODUCER_FORCED_RUN_APP_NAME),
        _forced_producer_main_fn,
    )
    _logger.info(
        "/producer-run (requestId=%s) entering forced-run App %r",
        request_id,
        _PRODUCER_FORCED_RUN_APP_NAME,
    )
    return forced_app.update_blocking()


def _run_producer_forced(request_id: str) -> None:
    """Worker-thread target — runs `_build_forced_producer_report` and
    releases the single-flight lock regardless of outcome (mirrors
    `_run_walk`'s containment posture: a failed forced run must not wedge
    the lock, and must not be surfaced as a container-liveness fault)."""
    try:
        report = _build_forced_producer_report(request_id)
        _logger.info(
            "/producer-run completed (requestId=%s): ran=%s embedded=%d",
            request_id,
            getattr(report, "ran", None),
            len(getattr(report, "embedded", ()) or ()),
        )
    except Exception:  # noqa: BLE001 — top-level worker boundary, must log
        _logger.exception("/producer-run failed (requestId=%s)", request_id)
    finally:
        reset_producer_run_state()


async def _producer_run_handler(request: web.Request) -> web.Response:  # noqa: ARG001 — request unused (no body contract yet)
    """POST /producer-run — the DR-055 manual forced-run surface (F2).

    Auth: identical dual-accept bearer gate to `/walk` (`PIPELINE_TRIGGER_
    SECRET` OR the legacy `CRON_SECRET`) — fails closed (503) if neither
    secret is configured, 401 on a missing/wrong bearer.

    Rate limit: reuses the SAME shared `/walk` + `/extract` fixed-window
    guard (`_rate_limit_allows`) — a flood backstop layered on the bearer
    gate, checked right after auth.

    Idle-bundle loud-reject (mirrors `/walk`'s Inv-5 idle-source gate): if
    `OKF_BUNDLE_DIR` is unset or does not point at an existing directory, a
    named 400 up front — never a silent no-op that consumes the
    single-flight slot on a guaranteed-idle forced run.

    Single-flight (mirrors bl-221 G4): a module-level `threading.Lock`
    acquired non-blocking. A forced run already in flight -> 409.

    Behaviour: validate bearer -> rate-limit guard -> validate OKF_BUNDLE_DIR
    -> acquire the single-flight guard -> spawn a daemon worker thread
    running `_run_producer_forced` -> return 202 Accepted + `requestId`
    immediately (the run happens async; completion is observed via the
    server log — this route has no webhook of its own).
    """
    # (1) Auth — SAME dual-accept bearer gate as /walk (ID-127.18 dual-accept
    #     rotation window). Fail closed if BOTH are unset.
    pipeline_trigger_secret = os.environ.get("PIPELINE_TRIGGER_SECRET")
    cron_secret = os.environ.get("CRON_SECRET")
    if not pipeline_trigger_secret and not cron_secret:
        return web.json_response(
            {
                "error": (
                    "PIPELINE_TRIGGER_SECRET and CRON_SECRET are both unset "
                    "— /producer-run auth unavailable"
                )
            },
            status=503,
        )
    auth_header = request.headers.get("Authorization", "")
    accepted_bearers = {
        f"Bearer {secret}"
        for secret in (pipeline_trigger_secret, cron_secret)
        if secret
    }
    if auth_header not in accepted_bearers:
        return web.json_response(
            {"error": "missing or invalid bearer token"}, status=401
        )

    # (2) Rate-limit guard — the SAME shared `/walk` + `/extract` budget.
    if not _rate_limit_allows():
        return web.json_response(
            {"error": "rate limit exceeded — retry later"}, status=429
        )

    # (3) Idle-bundle loud-reject — a forced run with no bundle checkout is a
    #     named 400, not a silent no-op that consumes the single-flight slot.
    bundle_dir = os.environ.get("OKF_BUNDLE_DIR")
    if not bundle_dir:
        return web.json_response(
            {"error": "OKF_BUNDLE_DIR is unset — nothing to run the producer over"},
            status=400,
        )
    if not Path(bundle_dir).exists():
        return web.json_response(
            {"error": f"OKF_BUNDLE_DIR does not exist: {bundle_dir}"}, status=400
        )

    # (4) Single-flight guard — non-blocking acquire; a held lock means a
    #     forced run is already in progress -> 409.
    if not _PRODUCER_RUN_IN_FLIGHT.acquire(blocking=False):
        return web.json_response(
            {"error": "producer run already in progress"}, status=409
        )

    # (5) Spawn the worker thread. If anything below raises before the
    #     thread starts, release the lock so it is not wedged.
    try:
        request_id = uuid.uuid4().hex
        thread = threading.Thread(
            target=_run_producer_forced,
            args=(request_id,),
            name="cocoindex-producer-run",
            daemon=True,
        )
        thread.start()
    except Exception:
        reset_producer_run_state()
        raise

    _logger.info("/producer-run accepted (requestId=%s)", request_id)
    return web.json_response(
        {"status": "accepted", "requestId": request_id}, status=202
    )


async def _extract_handler(request: web.Request) -> web.Response:
    """POST /extract — the PURE-CLEANER HTTP seam ({112.6}, PI-4 / PI-9).

    Lets the synchronous TypeScript manual route reach the IDENTICAL in-house
    Trafilatura cleaner the cocoindex worker uses in-process: read the POSTed
    HTML, call `clean_html` + `apply_quality_gate`, return
    `{text, verdict, warnings}` (Task ID-112 TECH Hand-off #2 / S366).

    FOUR ratified properties, all load-bearing:

    1. PURE CLEANER, NO fetch / NO SSRF here. The CALLER fetches the HTML (its
       own SSRF surface — the Vercel route's `validateUrl`); this endpoint only
       cleans the bytes it is handed. A REJECT verdict (content too short) is a
       200 SUCCESS carrying the REJECT verdict — NOT a 503 and NOT a 4xx at this
       layer (the manual route in {112.10} maps REJECT→422; this endpoint just
       reports the verdict).

    2. DEDICATED bearer `EXTRACT_API_TOKEN` (NOT `CRON_SECRET` — different blast
       radius). Mirrors the /walk fail-closed bearer pattern: a missing/wrong
       bearer → 401; if EXTRACT_API_TOKEN is unset the route fails CLOSED with
       401 (never an unauthenticated extract). A CRON_SECRET-valued bearer is
       NOT accepted.

    3. HARDENED per-route 20 MB body cap (aligned to the manual route's
       `MAX_CONTENT_SIZE`, lib/extraction/url.ts:30) — TIGHTER than the app-wide
       50 MB `client_max_size`, which was justified as compose-internal-only and
       dies once /extract is Traefik-reachable. Enforced both on the declared
       `Content-Length` (cheap up-front guard) AND on the actual bytes read off
       the wire (an absent/understated header cannot bypass it). Over-cap → 413.
       A minimal per-process rate-limit guard (best-effort, see
       `_rate_limit_allows`) returns 429 once the window budget is exceeded.

    4. A clean REJECT (200 + verdict) is distinct from MALFORMED input (a 4xx):
       an empty body is a named 400, never confused with a too-short page (200
       REJECT).
    """
    # (1) Auth — dedicated EXTRACT_API_TOKEN bearer. Fail closed if unset
    #     (never allow an unauthenticated extract). CRON_SECRET is deliberately
    #     NOT consulted here — a different blast radius (Property 2).
    extract_token = os.environ.get("EXTRACT_API_TOKEN")
    if not extract_token:
        return web.json_response(
            {"error": "EXTRACT_API_TOKEN is unset — /extract auth unavailable"},
            status=401,
        )
    auth_header = request.headers.get("Authorization", "")
    if auth_header != f"Bearer {extract_token}":
        return web.json_response(
            {"error": "missing or invalid bearer token"}, status=401
        )

    # (2) Rate-limit guard (Property 3, best-effort) — a flood backstop layered
    #     on the bearer gate. Over-budget → 429, before any body read.
    if not _rate_limit_allows():
        return web.json_response(
            {"error": "rate limit exceeded — retry later"}, status=429
        )

    # (3) Body cap (Property 3) — cheap up-front Content-Length guard first, so
    #     an honestly-declared over-cap body is rejected without reading 20 MB.
    declared = request.content_length
    if declared is not None and declared > _EXTRACT_BODY_CAP_BYTES:
        return web.json_response(
            {
                "error": (
                    f"request body exceeds the {_EXTRACT_BODY_CAP_BYTES}-byte "
                    "/extract cap"
                )
            },
            status=413,
        )

    # Read the body, but never trust the header: read one byte past the cap and
    # reject if the ACTUAL bytes exceed it (an absent/understated Content-Length
    # cannot smuggle an over-cap body past the up-front guard).
    raw = await request.content.read(_EXTRACT_BODY_CAP_BYTES + 1)
    if len(raw) > _EXTRACT_BODY_CAP_BYTES:
        return web.json_response(
            {
                "error": (
                    f"request body exceeds the {_EXTRACT_BODY_CAP_BYTES}-byte "
                    "/extract cap"
                )
            },
            status=413,
        )

    # (4) Malformed input — an empty body is a client-correctable named 400,
    #     distinct from a too-short-but-present page (a 200 REJECT below).
    if not raw.strip():
        return web.json_response(
            {"error": "request body must contain HTML to clean"}, status=400
        )

    html = raw.decode("utf-8", errors="replace")

    # (5) Pure-cleaner core: clean → gate → report. NO fetch, NO SSRF (Property
    #     1). An optional `url` query param feeds Trafilatura's link/metadata
    #     resolution; it is NOT fetched.
    url = request.query.get("url")
    text = clean_html(html, url=url)
    gate = apply_quality_gate(text)

    # A REJECT (too short) is a 200 carrying the verdict — NOT a 4xx (Property
    # 1); the manual route maps REJECT→422 downstream. `warnings` is always a
    # list (empty on OK/REJECT, one entry on WARN).
    warnings = [gate.warning] if gate.warning is not None else []
    return web.json_response(
        {"text": text, "verdict": gate.verdict.value, "warnings": warnings},
        status=200,
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
      - POST /extract — bearer-gated PURE-CLEANER HTTP seam ({112.6}): HTML in →
        `{text, verdict, warnings}` out, NO fetch / NO SSRF. Hardened with a
        per-route 20 MB body cap (tighter than the app-wide 50 MB) because —
        unlike /stage + /walk — it IS Traefik-reachable.
      - POST /producer-run — bearer-gated manual forced-run surface (ID-132
        {132.35} G-DEPLOY-PROOF F2): forces ONE producer pass over every
        concept, bypassing the automatic post-walk hook's delta gate — the
        surface the BI-18 Run-1 (memo-hit no-op) proof requires. Same
        auth/rate-limit/single-flight discipline as /walk, an INDEPENDENT
        single-flight lock.

    `client_max_size` is set EXPLICITLY to 50 MB: aiohttp's invisible default
    is 1 MB, which a future large /stage fixture (multi-MB PDF/DOCX — the
    largest current fixture is already 510 KB) would silently trip. 50 MB is
    deliberate headroom for the compose-internal /stage + /walk routes (Inv-13).
    The Traefik-reachable /extract route does NOT inherit this headroom — it
    enforces its own TIGHTER 20 MB per-route cap inside `_extract_handler`.
    """
    app = web.Application(client_max_size=50 * 1024 * 1024)
    app.router.add_get("/health", _health_handler)
    app.router.add_post("/stage", _stage_handler)
    app.router.add_post("/walk", _walk_handler)
    app.router.add_post("/extract", _extract_handler)
    app.router.add_post("/producer-run", _producer_run_handler)
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
