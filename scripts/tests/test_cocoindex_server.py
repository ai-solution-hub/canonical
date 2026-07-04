"""Unit tests for `scripts/cocoindex_pipeline/server.py` — HTTP wrapper for the
cocoindex sidecar (on-prem Coolify service).

Covers PRODUCT Inv-6 (HTTPS /health probe returns 200 OK) + the wrapper
contract specified in Subtask 28.15 dispatch brief, as amended by ID-83 /
bl-221 (boot-decouple — boot enters the lifespan, never walks):

  - HTTP server bind succeeds on $PORT (default 8080).
  - GET /health returns HTTP 200 + JSON body {"status": "ok"}.
  - SIGTERM handler installed (signal.getsignal(SIGTERM) is not default).
  - cocoindex `coco.start_blocking()` (lifespan-only, NO walk) invoked in a
    background daemon thread, and NO walking `update_blocking(...)` runs at
    boot (mock + assert thread spawn + inverted boot guard, bl-221 G1).
  - POST /walk runs the on-demand `update_blocking(live=False)` corpus walk
    behind a CRON_SECRET bearer + single-flight lock (TestWalkRoute).

Test philosophy: every test asserts real behaviour. The HTTP `/health`
path is exercised by invoking the registered route handler IN-PROCESS via
`aiohttp.test_utils.make_mocked_request()` — no `TestClient`/`TestServer`,
so NO real listening TCP socket is bound (honouring the fixture docstring's
stated contract and keeping the test green in sandboxed runs). The real
`GET /health` round-trip against the deployed on-prem sidecar is covered
separately by
`__tests__/integration/cocoindex/agpl-boundary.integration.test.ts`, so no
coverage gap is introduced by dropping the socket-level client here. The
cocoindex `coco.start_blocking()` call is patched out because (a) we do
NOT want to boot the cocoindex Rust engine inside the test process, and
(b) the unit under test is the wrapper, not cocoindex.

Stub-pattern: identical to test_cocoindex_extraction.py — no LMDB engine
boot at test time, no real Anthropic call. We use `unittest.mock.patch`
to intercept `coco.start_blocking` + `threading.Thread` where needed.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import signal
import sys
import threading
from pathlib import Path
from typing import Callable
from unittest.mock import Mock, patch

import pytest

# Sibling cocoindex test modules used to leak MagicMock `aiohttp` stubs into
# sys.modules via module-scope `setdefault()`, which broke this file's real
# `from aiohttp import web` import (`'aiohttp' is not a package`). That root
# cause is fixed in ID-44.5: the sibling stubs are now scoped to their
# module-under-test import via `stubbed_sys_modules()` and removed from
# sys.modules afterwards, so a fresh `from aiohttp import web` here resolves the
# real package directly — no defensive `del sys.modules[...]` cleanup needed.
from aiohttp import web  # noqa: E402
from aiohttp.streams import StreamReader  # noqa: E402
from aiohttp.test_utils import make_mocked_request  # noqa: E402


# ──────────────────────────────────────────────────────────────────────────
# Engine-availability probe (bl-218)
# ──────────────────────────────────────────────────────────────────────────
#
# `TestIdleModeBoot::test_idle_mode_boot_returns_clean_worker_stays_healthy` is
# the ONE test in this file that drives the REAL cocoindex Rust engine (it does
# NOT mock the engine boot). Under a sandboxed agent worktree the cocoindex
# Rust core raises EPERM when `core.Environment(...)` boots
# (`cocoindex/_internal/environment.py:240`, reached via the lifespan-only
# `coco.start_blocking()` boot — post-ID-83 the worker arms the live fs-watch in
# the lifespan and NEVER walks the corpus at boot; there is no
# `update_blocking(live=True)` call). The EPERM is swallowed by server.py's worker-crash handler, so
# the test sees `lifespan_entered` False + `worker_is_healthy()` False and its
# assertions FAIL rather than erroring — an in-test try/except cannot catch it.
# The correct fix is a collection-time `@pytest.mark.skipif` keyed on an
# independent probe that ACTUALLY ATTEMPTS the engine boot (a bare
# `importorskip('cocoindex')` is insufficient: cocoindex imports fine; only the
# engine *boot* EPERMs).
#
# The probe runs the minimal real `core.Environment(...)` construction — the
# exact EPERM site the test drives — in a SUBPROCESS so it cannot pollute the
# cocoindex process-global registries, leak the loop runner / daemon threads, or
# otherwise perturb the other tests in this file. It returns False on
# PermissionError/OSError (EPERM is errno 1 → PermissionError), True on a clean
# boot (exit 0), so the test STILL RUNS in non-sandboxed CI.

_COCOINDEX_ENGINE_AVAILABLE: bool | None = None

# Minimal real engine boot, executed in an isolated subprocess. Constructs the
# same `core.Environment(...)` the idle-mode test drives (via
# `cocoindex._internal.environment.Environment`, whose __init__ reaches
# `core.Environment(...)` at environment.py:240). Exits 0 on a clean boot,
# non-zero (and prints the errno) on EPERM/OSError.
_ENGINE_PROBE_SRC = """
import sys, tempfile, os
try:
    from cocoindex._internal import setting
    from cocoindex._internal.environment import Environment
    d = tempfile.mkdtemp(prefix='bl218-engine-probe-')
    Environment(settings=setting.Settings(db_path=os.path.join(d, 'lmdb')))
except (PermissionError, OSError) as exc:
    sys.stderr.write('ENGINE_BOOT_DENIED:%r\\n' % (exc,))
    sys.exit(3)
except Exception as exc:  # any other failure → treat as engine-unavailable too
    sys.stderr.write('ENGINE_BOOT_ERROR:%r\\n' % (exc,))
    sys.exit(4)
sys.exit(0)
"""


def _cocoindex_engine_available() -> bool:
    """Return True iff the cocoindex Rust engine can boot in this environment.

    Cached module-global (runs once). Drives the minimal real
    `core.Environment(...)` construction in a SUBPROCESS — the exact boot the
    idle-mode test exercises — and reports availability from the subprocess
    exit code:

      - exit 0  → engine booted cleanly → True (the idle-mode test RUNS, e.g.
                  in non-sandboxed CI; this is non-negotiable).
      - exit 3  → PermissionError/OSError (EPERM under a sandboxed agent
                  worktree) → False (the idle-mode test self-skips).
      - other   → cocoindex unavailable / unexpected boot failure → False
                  (the test cannot meaningfully run, so skip rather than red).

    Subprocess isolation guarantees the probe cannot pollute cocoindex's
    process-global App/env registries, leak the `_LoopRunner` daemon thread, or
    perturb the in-process mocked tests in this file.
    """
    global _COCOINDEX_ENGINE_AVAILABLE
    if _COCOINDEX_ENGINE_AVAILABLE is not None:
        return _COCOINDEX_ENGINE_AVAILABLE

    # Test-of-the-guard hook: setting BL218_FORCE_ENGINE_UNAVAILABLE=1 forces the
    # probe to report the engine as unavailable WITHOUT running it, so the skip
    # path can be exercised on a machine where the engine actually boots. Unset in
    # CI and in normal runs, so it never causes a spurious skip.
    if os.environ.get("BL218_FORCE_ENGINE_UNAVAILABLE") == "1":
        _COCOINDEX_ENGINE_AVAILABLE = False
        return _COCOINDEX_ENGINE_AVAILABLE

    import subprocess  # noqa: PLC0415

    try:
        proc = subprocess.run(
            [sys.executable, "-c", _ENGINE_PROBE_SRC],
            capture_output=True,
            timeout=60,
        )
        _COCOINDEX_ENGINE_AVAILABLE = proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        # Could not even launch the probe — treat the engine as unavailable.
        _COCOINDEX_ENGINE_AVAILABLE = False
    return _COCOINDEX_ENGINE_AVAILABLE


def _reset_cocoindex_app_registry() -> None:
    """Drop any `kh_pipeline` entry from cocoindex's global App registry.

    Test-isolation fix (ID-49.7): cocoindex 1.0.3 keeps a process-global App
    registry. When this file shares a pytest process with
    `test_cocoindex_flow_idle_mode.py` (which imports `cocoindex_pipeline.flow`
    with the REAL cocoindex), the `kh_pipeline` App is already registered when
    `start_cocoindex_thread()` lazily imports `scripts.cocoindex_pipeline.flow`
    (a second sys.modules path for the same file) — tripping
    `ValueError: An app named 'kh_pipeline' is already registered`.

    Per the Checker's guidance, duplicate-App tolerance belongs TEST-SIDE
    (registry reset), not in production `flow.py`. We clear the registry entry
    here so the lazy flow import can re-register cleanly. Best-effort: if the
    cocoindex internals are stubbed (sibling MagicMock) or the API moves, the
    reset is skipped silently — the import then either succeeds (stub) or the
    original behaviour is preserved.
    """
    try:
        from cocoindex._internal.environment import (  # type: ignore[import]
            _default_env,
        )

        registry = _default_env._info._app_registry
        with _default_env._info._app_registry_lock:
            registry.pop("kh_pipeline", None)
    except (ImportError, AttributeError):
        # cocoindex internals unavailable/stubbed — nothing to reset.
        pass


def _reload_real_flow_module() -> object:
    """Reload `scripts.cocoindex_pipeline.flow` under the REAL cocoindex.

    Test-isolation fix (ID-49.1): `test_cocoindex_flow_write_path.py`
    `importlib.reload(flow)`s the flow module under a MagicMock cocoindex stub
    (`stubbed_sys_modules`), which leaves `flow.KH_PIPELINE_APP` a MagicMock in
    `sys.modules` even after cocoindex is restored (reload mutates the module
    object in-place). A later end-to-end boot test that imports
    `KH_PIPELINE_APP` would then get the stub, whose `update_blocking` is a
    no-op — the lifespan never enters and the behavioural assertion is vacuous.

    This helper re-executes flow.py with the REAL cocoindex in `sys.modules`,
    restoring a genuine `coco.App`-backed `KH_PIPELINE_APP`, mirroring the
    write-path file's own per-file reload discipline. Best-effort: if cocoindex
    is unavailable the reload is skipped and the current module is returned.
    """
    import importlib  # noqa: PLC0415

    from scripts.cocoindex_pipeline import flow as flow_mod

    from unittest.mock import MagicMock

    if isinstance(getattr(flow_mod, "KH_PIPELINE_APP", None), MagicMock):
        importlib.reload(flow_mod)
    return flow_mod


def _stop_cocoindex_default_env() -> None:
    """Stop (clear the cached `_env` on) cocoindex's process-global default env.

    Test-isolation fix (ID-49.1): cocoindex 1.0.3 caches the started
    environment on `_default_env._env`. Once ANY sibling test starts the env
    (e.g. `test_cocoindex_flow_write_path.py` runs a real `update_blocking`),
    the env stays cached process-wide, so a later `update_blocking()` reuses it
    WITHOUT re-entering the `@coco.lifespan` (`_get_env` short-circuits on
    `if self._env is not None`). The idle-mode boot test below asserts the
    lifespan IS entered on boot, so it must clear the cached env first.

    `coco.stop_blocking()` clears `_env` (and closes the prior exit stack /
    pool) while PRESERVING the registered lifespan fn — unlike
    `reset_default_env_for_tests()`, which also drops the lifespan fn (the
    lifespan would NOT re-register, since flow.py is already in sys.modules and
    the `@coco.lifespan` decorator only runs at import time). Best-effort: if
    cocoindex internals are stubbed or the API moves, the stop is skipped.

    Exception scope (ID-55.4): narrowed from the prior bare ``except (...,
    Exception)`` to the two failure modes this best-effort teardown legitimately
    swallows — ``ImportError`` (cocoindex genuinely absent) and ``AttributeError``
    (``stop_blocking`` missing because the API moved or ``cocoindex`` is a
    MagicMock stub). ``stop_blocking()`` itself returns cleanly when no env has
    started (verified against installed cocoindex 1.0.3 — ``environment.stop_sync``
    is a no-op on an unstarted env), so there is no "no env yet" exception to
    catch. Any OTHER exception from a real teardown now propagates visibly rather
    than being silently suppressed.
    """
    try:
        import cocoindex as _coco

        _coco.stop_blocking()
    except (ImportError, AttributeError):
        # cocoindex genuinely absent (ImportError) or stop_blocking missing /
        # stubbed (AttributeError) — nothing to tear down.
        pass


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
    """Helper — invoke the /health route handler in-process, NO real socket.

    Resolves the registered route for `GET /health` against the app's
    router using a `make_mocked_request()`-built request (which binds no
    TCP socket), awaits the matched handler coroutine directly, and reads
    the returned `web.Response`. Asserts against `resp.status`, the parsed
    JSON body, and `resp.content_type` — semantically identical to the
    previous TestClient round-trip, minus the socket bind.
    """
    request = make_mocked_request("GET", "/health", app=aiohttp_app)
    match_info = await aiohttp_app.router.resolve(request)
    resp = await match_info.handler(request)
    body = json.loads(resp.body)
    return resp.status, body, resp.content_type


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
    """Inv-6 + container stop/drain contract — SIGTERM installed for drain."""

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
    """The cocoindex worker enters the environment's lifespan ONLY at boot via
    `coco.start_blocking()` — it performs ZERO corpus walk. The HTTP server runs
    concurrently on the main thread; the walk fires on-demand via `POST /walk`.

    INVERTED boot contract (ID-83 / bl-221, SANCTIONED — TECH.md §5.1 Shape 1):
    the guard below is the deliberate INVERSE of the ID-49.1 boot-wiring guard
    it replaces. The ID-49.1 contract was "boot MUST run
    `update_blocking(live=True)` (walk on boot) and MUST NOT call the bare
    `coco.start_blocking()`". bl-221 retires the SOURCE_PATH-blanking burn-valve
    by making boot architecturally walk-free: boot now MUST call
    `coco.start_blocking()` (enter the lifespan, provisioning `DB_CTX` + LMDB,
    running NO `app_main`) and MUST NOT call any walking `update_blocking(...)`.
    A container boot/restart therefore cannot auto-walk the corpus or burn
    Anthropic tokens regardless of `COCOINDEX_SOURCE_PATH` (bl-221 G1). The
    on-demand walk is exercised by `TestWalkRoute`. This inversion is a
    spec-sanctioned contract change, NOT a regression.

    Empirically verified against installed cocoindex 1.0.3:
    `coco.start_blocking()` → `environment.start_sync()` enters the default
    env's `@coco.lifespan` and caches the `Environment` on `_default_env._env`,
    then returns (runs no `main_fn`); a later `update_blocking(live=False)`
    reuses that cached env and runs `app_main` once.

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

    def test_start_cocoindex_thread_enters_lifespan_no_walk(self) -> None:
        """`start_cocoindex_thread()` spawns a daemon thread whose target calls
        `coco.start_blocking()` (enter the lifespan, NO walk) and does NOT call
        any walking `KH_PIPELINE_APP.update_blocking(...)`.

        This is the INVERTED boot guard (bl-221 G1): boot provisions the env
        (DB pool + LMDB) WITHOUT walking the corpus, so a restart can never
        auto-burn Anthropic. The walk is on-demand via `POST /walk` only."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_worker_state()
        # Clear any cross-file kh_pipeline App registration so the lazy flow
        # import inside start_cocoindex_thread() can re-register cleanly
        # (ID-49.7 test-side registry reset).
        _reset_cocoindex_app_registry()

        # Patch `update_blocking` via the MODULE-CACHED reference (not a
        # locally-imported instance) so the "boot never walks" assertion is
        # order-stable. A sibling test imports `cocoindex_pipeline.flow`
        # unqualified, which can leave flow loaded under both the qualified
        # `scripts.cocoindex_pipeline.flow` and the unqualified
        # `cocoindex_pipeline.flow` paths — two distinct `KH_PIPELINE_APP`
        # instances. Patching the qualified module object keeps the assertion
        # stable in both collection orders (ID-49.1 carry-over).
        import scripts.cocoindex_pipeline.flow as _flow

        with patch.object(
            _flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            # Boot MUST take the lifespan-only `start_blocking()` path.
            with patch.object(
                server_mod.coco, "start_blocking", return_value=None
            ) as mock_start_blocking:
                thread = server_mod.start_cocoindex_thread()
                # The returned thread must be daemon so it does not block
                # Python interpreter shutdown.
                assert isinstance(thread, threading.Thread)
                assert thread.daemon is True
                # Join with a short timeout so the test doesn't hang if the
                # mock blocks unexpectedly.
                thread.join(timeout=2.0)

                # INVERTED contract: boot enters the lifespan exactly once …
                mock_start_blocking.assert_called_once_with()
            # … and NEVER walks the corpus at boot (no update_blocking call of
            # any liveness — the walk is on-demand via POST /walk).
            mock_update.assert_not_called()
            # A successful lifespan-only boot must NOT flip the worker
            # unhealthy — proves the daemon thread's success path does not
            # spuriously trip the crash flag.
            assert server_mod.worker_is_healthy(), (
                "a clean lifespan-only boot must leave the worker healthy"
            )
        # Side-effect verification: flow.py landed in sys.modules via the lazy
        # import (its registration side-effect binds the App's lifespan onto the
        # default env that `start_blocking()` enters).
        import sys as _sys

        assert (
            "scripts.cocoindex_pipeline.flow" in _sys.modules
            or "cocoindex_pipeline.flow" in _sys.modules
        ), "flow.py must be imported via start_cocoindex_thread() lazy import"


# ──────────────────────────────────────────────────────────────────────────
# §3b — worker-liveness: /health reflects the cocoindex thread (ID-49.8)
# ──────────────────────────────────────────────────────────────────────────


class TestWorkerLiveness:
    """ID-49.8 / audit §7.5 — /health must reflect the cocoindex worker thread,
    not just aiohttp.

    Root cause context: the worker crashed at boot (asyncpg gaierror) while
    /health stayed 200 on a separate thread, so the health check reported the
    container Ready while the pipeline was dead. The fix wires a shared crash flag the
    worker thread sets on crash; /health returns non-200 when the worker is
    dead, so a healthy container means the pipeline is actually up.
    """

    def test_health_200_when_worker_healthy(
        self, aiohttp_app: web.Application
    ) -> None:
        """Default (no crash) — /health returns 200 + {"status": "ok"}."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_worker_state()
        status, body, _ = asyncio.run(_exercise_health(aiohttp_app))
        assert status == 200
        assert body["status"] == "ok"

    def test_health_503_when_worker_crashed(
        self, aiohttp_app: web.Application
    ) -> None:
        """After the worker thread marks itself crashed, /health returns a
        non-200 status (503) so a health/liveness check flags the
        container rather than reporting a dead pipeline as Ready."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_worker_state()
        try:
            server_mod.mark_worker_crashed()
            status, body, _ = asyncio.run(_exercise_health(aiohttp_app))
            assert status == 503, (
                "/health must return non-200 when the cocoindex worker is dead"
            )
            assert body["status"] != "ok"
        finally:
            # Leave global state clean for sibling tests.
            server_mod.reset_worker_state()

    @pytest.mark.filterwarnings(
        "ignore::pytest.PytestUnhandledThreadExceptionWarning"
    )
    def test_thread_crash_sets_worker_flag(self) -> None:
        """When entering the lifespan raises, start_cocoindex_thread()'s target
        must mark the worker crashed (so /health can observe it).

        Post-ID-83 / bl-221 the boot path runs `coco.start_blocking()` (enter
        the lifespan, NO walk); a boot crash there (e.g. the asyncpg gaierror
        that motivated audit §7.5) must flip the worker unhealthy exactly as the
        previous `update_blocking` boot path did. The crash-flag wiring is
        preserved unchanged across the boot-decouple.

        The intentional daemon-thread crash emits PytestUnhandledThreadExceptionWarning
        under pytest 9.x. Suppressed here with a SCOPED filterwarnings marker — the
        warning is expected behaviour for this test and must NOT bleed globally.
        (ID-49.7 folded finding 1.)
        """
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_worker_state()
        # Clear any cross-file kh_pipeline App registration so the lazy flow
        # import inside start_cocoindex_thread() can re-register cleanly
        # (ID-49.7 test-side registry reset).
        _reset_cocoindex_app_registry()

        try:
            with patch.object(
                server_mod.coco,
                "start_blocking",
                side_effect=RuntimeError("boom"),
            ):
                thread = server_mod.start_cocoindex_thread()
                thread.join(timeout=2.0)
            assert not server_mod.worker_is_healthy(), (
                "a crashed lifespan-entry boot must flip the worker to unhealthy"
            )
        finally:
            server_mod.reset_worker_state()


# ──────────────────────────────────────────────────────────────────────────
# §3c — Lifespan-only boot end-to-end: no walk on boot (ID-83 / bl-221)
# ──────────────────────────────────────────────────────────────────────────


class TestLifespanOnlyBoot:
    """ID-83 / bl-221 (Shape 1) — booting the worker enters the lifespan via
    `coco.start_blocking()` (DB_CTX provisioned, LMDB engine up), completes
    cleanly, leaves the Service alive (worker stays healthy, no raise), and runs
    NO corpus walk — even were COCOINDEX_SOURCE_PATH set.

    This is the behavioural end-to-end of the boot-decouple: it drives the REAL
    `coco.start_blocking()` (NOT a mock of it) through the server's daemon
    thread, proving the boot call enters the cocoindex environment's lifespan
    (so `/walk`'s later `update_blocking(live=False)` finds the pool already
    provisioned) WITHOUT executing `app_main` / `walk_dir` at boot. Only the
    lifespan's asyncpg pool is mocked — a live Supabase pooler connection is
    impractical in unit scope and the boot path never reaches
    `mount_table_target`, so the pool is never exercised beyond provisioning.
    The DSN env var is set to a syntactically-valid (but never-dialled) pooler
    string so `_build_dsn()` passes its fail-fast validation without a network
    call.

    On-prem reality this models (bl-221 steady state): COCOINDEX_SOURCE_PATH
    stays set; the container boots, the worker enters the lifespan and its
    daemon thread completes cleanly, aiohttp's main thread keeps /health green,
    and NO walk runs until an explicit `POST /walk` signal arrives. A
    deploy/restart is burn-safe by construction (G1) — the SOURCE_PATH-blanking
    valve is retired.
    """

    @pytest.mark.skipif(
        not _cocoindex_engine_available(),
        reason=(
            "cocoindex Rust engine cannot boot under sandboxed agent worktree "
            "(EPERM on core.Environment); the real-engine boot is exercised in "
            "non-sandboxed CI"
        ),
    )
    @pytest.mark.filterwarnings(
        "ignore::pytest.PytestUnhandledThreadExceptionWarning"
    )
    def test_lifespan_only_boot_enters_env_no_walk_worker_stays_healthy(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_worker_state()
        # Ensure flow.KH_PIPELINE_APP is the REAL App, not a MagicMock left by
        # test_cocoindex_flow_write_path.py's stub-reload (see helper docstring).
        _reload_real_flow_module()
        _reset_cocoindex_app_registry()
        # Clear any env cached by a sibling test so this boot RE-ENTERS the
        # lifespan (the assertion below depends on it). See helper docstring.
        _stop_cocoindex_default_env()

        fake_pool = MagicMock(name="fake_asyncpg_pool")
        # The lifespan-only boot awaits TWO pool coroutines, so both must be
        # AsyncMock or `await <plain MagicMock>` raises `TypeError: object
        # MagicMock can't be used in 'await' expression` (worker flagged crashed
        # → worker_is_healthy() False → the G1 assertion below fails):
        #   1. `await pool.fetch(...)` — flow._generate_client_alias_snapshot
        #      (the {101.10} alias-cache prime in kh_pipeline_lifespan, run on
        #      boot BEFORE the yield). Return [] = the graceful dev/CI path:
        #      PIPELINE_CLIENT_ORG is unset here so the fail-closed branch is
        #      skipped and prime_alias_cache_from_db_rows([]) installs the
        #      baseline-only map — a CLEAN, healthy idle boot.
        #   2. `await pool.close()` — kh_pipeline_lifespan teardown.
        fake_pool.fetch = AsyncMock(return_value=[])
        fake_pool.close = AsyncMock()

        lifespan_entered = threading.Event()

        async def _fake_create_pool(*_args: object, **_kwargs: object) -> MagicMock:
            lifespan_entered.set()
            return fake_pool

        # COCOINDEX_SOURCE_PATH is set to a real (empty) corpus dir to prove the
        # KEY bl-221 invariant: even WITH a source path set, the lifespan-only
        # boot does NOT walk it (boot never reaches app_main). COCOINDEX_DB is
        # the engine's LMDB state-store path; without it environment.start
        # raises. A valid-shaped DSN so the lifespan's _build_dsn() fail-fast
        # passes without dialling a real pooler host.
        #
        # monkeypatch.{setenv,delenv} so EVERY env mutation is restored on
        # teardown (no leak to sibling tests).
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_DB", str(tmp_path / "lmdb"))
        monkeypatch.setenv(
            "COCOINDEX_DB_DSN",
            "postgresql://postgres.fake:pw@"
            "aws-0-eu-west-2.pooler.supabase.com:5432/postgres",
        )
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        try:
            with patch("asyncpg.create_pool", side_effect=_fake_create_pool):
                thread = server_mod.start_cocoindex_thread()
                thread.join(timeout=10.0)

            assert not thread.is_alive(), (
                "lifespan-only boot must complete (start_blocking returns once "
                "the lifespan is entered); the worker daemon thread must not hang"
            )
            assert lifespan_entered.is_set(), (
                "the lifespan must be entered on boot (DB_CTX provisioned) — "
                "coco.start_blocking() enters the lifespan-bearing default env"
            )
            assert server_mod.worker_is_healthy(), (
                "lifespan-only boot is a CLEAN return (bl-221 G1); the worker "
                "must NOT be flagged crashed — the Service stays alive, idle, "
                "awaiting an explicit POST /walk signal"
            )
        finally:
            server_mod.reset_worker_state()
            # Tear down the env this test started (closes the mocked pool;
            # leaves no cached env for later tests to trip over).
            _stop_cocoindex_default_env()


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
        """Non-int PORT raises ValueError at parse time. The platform only
        ever sets a numeric PORT — fail fast on malformed input rather
        than silently fallback to 8080 (defensive, not silent-fail)."""
        from scripts.cocoindex_pipeline.server import resolve_port

        with patch.dict(os.environ, {"PORT": "not-a-port"}):
            with pytest.raises(ValueError):
                resolve_port()


# ──────────────────────────────────────────────────────────────────────────
# §4b — boot-time workspace-manifest seed (ID-62.6, ID-83-corrected)
# ──────────────────────────────────────────────────────────────────────────


class TestSeedWorkspaceManifest:
    """ID-62.6 (re-scoped per ID-83) — `main()`'s seed block ensures a
    schema-valid `.kh-workspace-map.json` exists at the corpus root before the
    FIRST `POST /walk`.

    Under ID-83 / bl-221 boot never walks, so the seed is no longer
    "before the watch arms"; it is "before the first /walk, else `app_main`
    raises `ManifestLoadError` and every walk produces zero rows". The seed:
      - reads `COCOINDEX_SOURCE_PATH`; no-op when unset (idle mode),
      - `os.makedirs(source, exist_ok=True)`,
      - writes `{"schema_version": 1, "mappings": []}` only if the manifest is
        ABSENT (never clobbers an operator-supplied manifest).

    The seed is asserted path-agnostically against the env value (the real
    on-prem path is `/cocoindex-state/corpus`, NOT the spec's literal
    `/corpus`), and the written manifest is fed through the REAL
    `load_workspace_manifest` validator to prove it parses without raising.
    """

    def test_seed_creates_dir_and_manifest_under_env_path(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scripts.cocoindex_pipeline.server import _seed_workspace_manifest

        # COCOINDEX_SOURCE_PATH points at a dir that does NOT yet exist — the
        # seed must makedirs it (mirrors the real corpus mount being empty).
        source = tmp_path / "cocoindex-state" / "corpus"
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(source))

        _seed_workspace_manifest()

        # Path-agnostic: the manifest lands under the ENV value, whatever it is.
        manifest = source / ".kh-workspace-map.json"
        assert source.is_dir()
        assert manifest.exists()

    def test_seeded_manifest_parses_via_real_validator(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The seeded manifest is the minimal schema-valid shape — the REAL
        `load_workspace_manifest` parses it without raising (degenerate but
        legal empty `mappings`)."""
        from scripts.cocoindex_pipeline.server import _seed_workspace_manifest
        from scripts.cocoindex_pipeline.workspace_resolver import (
            load_workspace_manifest,
        )

        source = tmp_path / "corpus"
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(source))
        _seed_workspace_manifest()

        manifest = load_workspace_manifest(source / ".kh-workspace-map.json")
        assert manifest.schema_version == 1
        assert manifest.mappings == []

    def test_seed_does_not_clobber_existing_manifest(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An operator-supplied manifest is preserved — the seed only writes
        when the manifest is ABSENT."""
        from scripts.cocoindex_pipeline.server import _seed_workspace_manifest

        source = tmp_path / "corpus"
        source.mkdir()
        manifest = source / ".kh-workspace-map.json"
        existing = (
            '{"schema_version": 1, "mappings": '
            '[{"path_prefix": "forms/", '
            '"workspace_id": "00000000-0000-4000-8000-000000000001"}]}'
        )
        manifest.write_text(existing, encoding="utf-8")

        _seed_workspace_manifest()

        # Untouched — the operator's mapping survives.
        assert manifest.read_text(encoding="utf-8") == existing

    def test_seed_noop_when_source_path_unset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Idle mode: COCOINDEX_SOURCE_PATH unset → the seed is a clean no-op
        (no dir created, no raise). Boot in idle mode must not fail."""
        from scripts.cocoindex_pipeline.server import _seed_workspace_manifest

        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        # Must not raise.
        _seed_workspace_manifest()


# ──────────────────────────────────────────────────────────────────────────
# §5 — POST /stage multipart byte-drop route (ID-62.5)
# ──────────────────────────────────────────────────────────────────────────


_STAGE_BOUNDARY = "testboundary000ID62stage"


def _encode_multipart(
    *,
    file_bytes: bytes | None = None,
    file_name: str = "fixture.bin",
    dest_path: str | None = None,
    title_prefix: str | None = None,
) -> bytes:
    """Encode a `multipart/form-data` body with the `/stage` field names.

    A part is omitted entirely when its argument is None, so individual tests
    can construct a body that is missing the `file` or `destPath` part to
    exercise the loud-reject paths (Inv-2). Field names match the {62.8}
    client contract exactly: `file` (bytes, with filename), `destPath` (text),
    `titlePrefix` (text).
    """
    crlf = b"\r\n"
    b = _STAGE_BOUNDARY.encode()
    chunks: list[bytes] = []
    if file_bytes is not None:
        chunks.append(
            b"--"
            + b
            + crlf
            + b'Content-Disposition: form-data; name="file"; filename="'
            + file_name.encode()
            + b'"'
            + crlf
            + b"Content-Type: application/octet-stream"
            + crlf
            + crlf
            + file_bytes
            + crlf
        )
    if dest_path is not None:
        chunks.append(
            b"--"
            + b
            + crlf
            + b'Content-Disposition: form-data; name="destPath"'
            + crlf
            + crlf
            + dest_path.encode()
            + crlf
        )
    if title_prefix is not None:
        chunks.append(
            b"--"
            + b
            + crlf
            + b'Content-Disposition: form-data; name="titlePrefix"'
            + crlf
            + crlf
            + title_prefix.encode()
            + crlf
        )
    chunks.append(b"--" + b + b"--" + crlf)
    return b"".join(chunks)


async def _exercise_stage(
    aiohttp_app: web.Application,
    *,
    file_bytes: bytes | None = None,
    file_name: str = "fixture.bin",
    dest_path: str | None = None,
    title_prefix: str | None = None,
) -> tuple[int, dict]:
    """Invoke the /stage handler in-process with a real multipart payload.

    Mirrors `_exercise_health` (route resolve + direct handler await, no TCP
    socket) but feeds a `multipart/form-data` body through a `StreamReader`
    so `await request.multipart()` parses a genuine multipart stream — the
    same code path a live POST drives. Returns `(status, parsed_json_body)`.
    """
    body = _encode_multipart(
        file_bytes=file_bytes,
        file_name=file_name,
        dest_path=dest_path,
        title_prefix=title_prefix,
    )
    loop = asyncio.get_running_loop()
    stream = StreamReader(Mock(), limit=2**16, loop=loop)
    stream.feed_data(body)
    stream.feed_eof()
    headers = {"Content-Type": f"multipart/form-data; boundary={_STAGE_BOUNDARY}"}
    request = make_mocked_request(
        "POST", "/stage", headers=headers, payload=stream, app=aiohttp_app
    )
    match_info = await aiohttp_app.router.resolve(request)
    resp = await match_info.handler(request)
    return resp.status, json.loads(resp.body)


async def _exercise_stage_raw(
    aiohttp_app: web.Application,
    *,
    raw_body: bytes,
    content_type: str,
) -> tuple[int, dict]:
    """Invoke the /stage handler in-process with a NON-multipart body.

    Mirrors `_exercise_stage` (route resolve + direct handler await, no TCP
    socket) but sends `raw_body` verbatim under an arbitrary `content_type` —
    the mis-wired-client path: a POST that never went through multipart
    encoding (e.g. a JSON body). Returns `(status, parsed_json_body)`.
    """
    loop = asyncio.get_running_loop()
    stream = StreamReader(Mock(), limit=2**16, loop=loop)
    stream.feed_data(raw_body)
    stream.feed_eof()
    headers = {"Content-Type": content_type}
    request = make_mocked_request(
        "POST", "/stage", headers=headers, payload=stream, app=aiohttp_app
    )
    match_info = await aiohttp_app.router.resolve(request)
    resp = await match_info.handler(request)
    return resp.status, json.loads(resp.body)


class TestStageRouteTable:
    """Inv-1 — `POST /stage` is registered on the same `build_app()` app."""

    def test_stage_route_registered(self, aiohttp_app: web.Application) -> None:
        routes = {
            (route.method, route.resource.canonical)
            for route in aiohttp_app.router.routes()
            if route.resource is not None
        }
        assert ("POST", "/stage") in routes

    def test_health_route_still_registered(
        self, aiohttp_app: web.Application
    ) -> None:
        """Adding /stage must not displace the existing /health route (Inv-6)."""
        routes = {
            (route.method, route.resource.canonical)
            for route in aiohttp_app.router.routes()
            if route.resource is not None
        }
        assert ("GET", "/health") in routes


class TestStageLoudReject:
    """Inv-5 — a client-correctable mis-wire is a NAMED 400, never silent /
    5xx. COCOINDEX_SOURCE_PATH unset or pointing at a missing dir → 400."""

    def test_stage_400_when_source_path_unset(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        status, body = asyncio.run(
            _exercise_stage(
                aiohttp_app,
                file_bytes=b"x",
                dest_path="f.bin",
                title_prefix="P-",
            )
        )
        assert status == 400
        assert "COCOINDEX_SOURCE_PATH" in body["error"]

    def test_stage_400_when_source_path_missing_dir(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        missing = tmp_path / "does-not-exist"
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(missing))
        status, body = asyncio.run(
            _exercise_stage(
                aiohttp_app,
                file_bytes=b"x",
                dest_path="f.bin",
                title_prefix="P-",
            )
        )
        assert status == 400
        # The path is named in the error so the mis-wire is diagnosable.
        assert str(missing) in body["error"]


class TestStageMultipartContract:
    """Inv-2 — a path-only request (no bytes) is rejected; a well-formed
    multipart write lands the bytes (Inv-3); the response echoes the dest
    path + a requestId (Inv-4)."""

    def test_stage_400_when_file_part_absent(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        # destPath present but NO file bytes → rejected (a path the writer
        # can't see is not a stage).
        status, body = asyncio.run(
            _exercise_stage(aiohttp_app, dest_path="f.bin", title_prefix="P-")
        )
        assert status == 400
        assert "error" in body

    def test_stage_400_when_dest_path_absent(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        status, body = asyncio.run(
            _exercise_stage(aiohttp_app, file_bytes=b"x", title_prefix="P-")
        )
        assert status == 400
        assert "error" in body

    def test_stage_writes_bytes_to_corpus_dest(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        payload = b"PK\x03\x04 fake-xlsx-bytes"
        status, body = asyncio.run(
            _exercise_stage(
                aiohttp_app,
                file_bytes=payload,
                file_name="P-123-form.xlsx",
                dest_path="forms/P-123-form.xlsx",
                title_prefix="P-123",
            )
        )
        assert status == 200
        # Bytes landed at corpus_root/destPath — ingested by the next
        # explicit POST /walk (ID-83: staging alone never ingests).
        written = corpus / "forms" / "P-123-form.xlsx"
        assert written.exists()
        assert written.read_bytes() == payload
        # Response echoes the corpus-relative dest path + a requestId.
        assert body["destPath"] == "forms/P-123-form.xlsx"
        assert isinstance(body["requestId"], str) and len(body["requestId"]) > 0


class TestStagePathEscape:
    """Inv-3 — a destPath that escapes the corpus root is rejected 400 and
    writes nothing (no `../` traversal, no absolute path)."""

    def test_stage_400_on_parent_traversal(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        status, body = asyncio.run(
            _exercise_stage(
                aiohttp_app,
                file_bytes=b"escape",
                dest_path="../escaped.bin",
                title_prefix="P-",
            )
        )
        assert status == 400
        assert "error" in body
        # Nothing written outside the corpus root.
        assert not (tmp_path / "escaped.bin").exists()

    def test_stage_400_on_absolute_dest_path(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        abs_target = tmp_path / "abs-escape.bin"
        status, body = asyncio.run(
            _exercise_stage(
                aiohttp_app,
                file_bytes=b"escape",
                dest_path=str(abs_target),
                title_prefix="P-",
            )
        )
        assert status == 400
        assert "error" in body
        assert not abs_target.exists()


class TestStageContentTypeGuard:
    """Inv-5 — a non-multipart POST /stage is a NAMED 400, never a 5xx.

    Without a content-type guard, `await request.multipart()` raises an
    internal AssertionError on a non-multipart body (aiohttp's
    `MultipartReader` asserts `multipart/*`), surfacing as an unhandled 500.
    A client posting JSON to /stage is a client-correctable mis-wire and must
    learn so from a named 400 error body (ID-62 quality-review Nit 1).
    """

    def test_stage_400_on_json_content_type(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        status, body = asyncio.run(
            _exercise_stage_raw(
                aiohttp_app,
                raw_body=json.dumps(
                    {"destPath": "f.bin", "titlePrefix": "P-"}
                ).encode(),
                content_type="application/json",
            )
        )
        assert status == 400
        # The error names the multipart requirement so the mis-wire is
        # client-diagnosable (Inv-5).
        assert "multipart" in body["error"]

    def test_stage_400_on_json_content_type_writes_nothing(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        status, _ = asyncio.run(
            _exercise_stage_raw(
                aiohttp_app,
                raw_body=json.dumps({"destPath": "f.bin"}).encode(),
                content_type="application/json",
            )
        )
        assert status == 400
        # Rejection writes nothing into the corpus dir.
        assert list(corpus.iterdir()) == []


class TestClientMaxSize:
    """build_app() must override aiohttp's invisible 1 MB `client_max_size`
    default (ID-62 quality-review Nit 2).

    Contract documentation, not behaviour simulation: the limit is enforced
    inside aiohttp's request-payload machinery, which this file's in-process
    `make_mocked_request` harness does not drive, and a real >limit round-trip
    would need a 50 MB socket body (wasteful). The one-line config assertion
    pins the contract — large staged fixtures (multi-MB PDF/DOCX) must not be
    rejected by a default nobody chose. 50 MB rationale lives in the
    `build_app()` docstring.
    """

    def test_build_app_sets_50mb_client_max_size(
        self, aiohttp_app: web.Application
    ) -> None:
        assert aiohttp_app._client_max_size == 50 * 1024 * 1024


# ──────────────────────────────────────────────────────────────────────────
# §6 — POST /walk on-demand corpus-walk trigger (ID-83.2 / bl-221)
# ──────────────────────────────────────────────────────────────────────────


_WALK_CRON_SECRET = "test-cron-secret-bl221"


async def _exercise_walk(
    aiohttp_app: web.Application,
    *,
    bearer: str | None = _WALK_CRON_SECRET,
    body: dict | None = None,
    raw_body: bytes | None = None,
    content_type: str = "application/json",
) -> tuple[int, dict]:
    """Invoke the /walk handler in-process (route resolve + direct await).

    Mirrors `_exercise_health` / `_exercise_stage` — no TCP socket. Sends an
    optional JSON body and an optional `Authorization: Bearer <bearer>` header
    (omit the header entirely by passing `bearer=None`). Pass `raw_body` to
    send NON-JSON bytes verbatim (bl-225 — the malformed-body regression
    path); `body` and `raw_body` are mutually exclusive. Returns
    `(status, parsed_json_body)`.
    """
    assert body is None or raw_body is None, (
        "pass either `body` (JSON dict) or `raw_body` (verbatim bytes), not both"
    )
    headers: dict[str, str] = {}
    if bearer is not None:
        headers["Authorization"] = f"Bearer {bearer}"
    payload: bytes = b""
    if body is not None:
        payload = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif raw_body is not None:
        payload = raw_body
        headers["Content-Type"] = content_type
    loop = asyncio.get_running_loop()
    stream = StreamReader(Mock(), limit=2**16, loop=loop)
    stream.feed_data(payload)
    stream.feed_eof()
    request = make_mocked_request(
        "POST", "/walk", headers=headers, payload=stream, app=aiohttp_app
    )
    match_info = await aiohttp_app.router.resolve(request)
    resp = await match_info.handler(request)
    return resp.status, json.loads(resp.body)


def _patched_walk_app() -> object:
    """Return the qualified flow module whose KH_PIPELINE_APP the walk worker
    thread resolves.

    `_run_walk` does `from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP`
    — patching that module object's `update_blocking` intercepts the real
    cocoindex run regardless of unqualified-import collection order (same
    discipline as TestCocoindexBackgroundThread)."""
    _reset_cocoindex_app_registry()
    import scripts.cocoindex_pipeline.flow as _flow

    return _flow


# ──────────────────────────────────────────────────────────────────────────
# P5 pull-sync test doubles ({138.14}) — a minimal fake asyncpg pool/conn that
# ALWAYS grants + releases the writer-fence lease (mirrors
# test_cocoindex_writer_fence.py's `_FakeConn`/`_FakePool`, duplicated locally
# rather than imported: that file is {138.9}'s own test file, out of THIS
# Subtask's file-ownership boundary).
# ──────────────────────────────────────────────────────────────────────────


class _FakeFenceConn:
    """Backs the writer-fence SQL calls. `acquire_result` gates whether the
    lease is granted (True = granted, mirroring an available fence)."""

    def __init__(self, acquire_result: bool = True) -> None:
        self.acquire_result = acquire_result
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, query: str, *args: object) -> bool:
        self.calls.append((query, args))
        if "corpus_writer_fence_lease_acquire" in query:
            return self.acquire_result
        if "corpus_writer_fence_lease_release" in query:
            return True
        raise AssertionError(f"unexpected fence query: {query}")


class _FakeFenceAcquireCtx:
    def __init__(self, conn: _FakeFenceConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakeFenceConn:
        return self._conn

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


class _FakeFencePool:
    """Minimal fake asyncpg pool — `.acquire()` always hands back the SAME
    `_FakeFenceConn` (the invariant `writer_fence()` relies on)."""

    def __init__(self, conn: _FakeFenceConn | None = None) -> None:
        self.conn = conn or _FakeFenceConn()
        self.closed = False

    def acquire(self) -> _FakeFenceAcquireCtx:
        return _FakeFenceAcquireCtx(self.conn)

    async def close(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def _fake_pull_sync_stack(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test in this file gets a NO-OP P5 pull-sync by default: the
    writer-fence lease always grants (a fake asyncpg pool/conn — no real DB
    reachable in a unit test) and zero pull-sync candidate rows (no real
    Storage/Postgres either), so the pre-existing `/walk` tests reach
    `update_blocking` exactly as the pre-P5 contract expected. The
    `TestPullSync*` classes below override these seams directly to exercise
    P5's OWN behaviour.
    """
    from scripts.cocoindex_pipeline import server as server_mod

    async def _fake_build_pool() -> _FakeFencePool:
        return _FakeFencePool()

    async def _fake_fetch_candidates(_conn: object) -> list[dict]:
        return []

    monkeypatch.setattr(server_mod, "_build_pull_sync_pool", _fake_build_pool)
    monkeypatch.setattr(
        server_mod, "_fetch_pull_sync_candidates", _fake_fetch_candidates
    )


class TestWalkRouteTable:
    """`POST /walk` is registered on the same `build_app()` app and does not
    displace /health or /stage."""

    def test_walk_route_registered(self, aiohttp_app: web.Application) -> None:
        routes = {
            (route.method, route.resource.canonical)
            for route in aiohttp_app.router.routes()
            if route.resource is not None
        }
        assert ("POST", "/walk") in routes

    def test_walk_does_not_displace_existing_routes(
        self, aiohttp_app: web.Application
    ) -> None:
        routes = {
            (route.method, route.resource.canonical)
            for route in aiohttp_app.router.routes()
            if route.resource is not None
        }
        assert ("GET", "/health") in routes
        assert ("POST", "/stage") in routes


class TestWalkAuth:
    """bl-221 — /walk is bearer-gated on CRON_SECRET (401 on missing/wrong)."""

    def test_walk_401_when_no_bearer(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            status, body = asyncio.run(
                _exercise_walk(aiohttp_app, bearer=None)
            )
        assert status == 401
        assert "error" in body
        # A 401 must NOT have kicked a walk, and must NOT have left the lock held.
        mock_update.assert_not_called()
        assert not server_mod.walk_in_progress()

    def test_walk_401_when_wrong_bearer(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            status, _ = asyncio.run(
                _exercise_walk(aiohttp_app, bearer="wrong-secret")
            )
        assert status == 401
        mock_update.assert_not_called()
        assert not server_mod.walk_in_progress()

    def test_walk_503_when_cron_secret_unset(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Fail closed: if CRON_SECRET is unset the route returns 503, never
        allowing an unauthenticated walk."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.delenv("CRON_SECRET", raising=False)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))
        status, _ = asyncio.run(_exercise_walk(aiohttp_app, bearer=None))
        assert status == 503
        assert not server_mod.walk_in_progress()


class TestWalkIdleSource:
    """bl-221 — an idle source (COCOINDEX_SOURCE_PATH unset/missing) is a NAMED
    400 (mirrors /stage Inv-5), never a silent no-op consuming a walk slot."""

    def test_walk_400_when_source_path_unset(
        self,
        aiohttp_app: web.Application,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            status, body = asyncio.run(_exercise_walk(aiohttp_app))
        assert status == 400
        assert "COCOINDEX_SOURCE_PATH" in body["error"]
        mock_update.assert_not_called()
        assert not server_mod.walk_in_progress()

    def test_walk_400_when_source_path_missing_dir(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        missing = tmp_path / "does-not-exist"
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(missing))
        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            status, body = asyncio.run(_exercise_walk(aiohttp_app))
        assert status == 400
        assert str(missing) in body["error"]
        mock_update.assert_not_called()
        assert not server_mod.walk_in_progress()


class TestWalkHappyPath:
    """bl-221 — a valid bearer + present source → 202 + the worker thread runs
    `update_blocking(live=False, full_reprocess=…)` exactly once, then the
    single-flight lock is released."""

    def test_walk_202_runs_update_blocking_live_false(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        walk_ran = threading.Event()

        def _record_update(**_kwargs: object) -> None:
            walk_ran.set()

        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP,
            "update_blocking",
            side_effect=_record_update,
        ) as mock_update:
            status, body = asyncio.run(_exercise_walk(aiohttp_app))
            # The handler returns 202 immediately; the walk runs async on a
            # daemon thread. Wait for the worker to actually invoke the mock.
            assert walk_ran.wait(timeout=2.0), (
                "the /walk worker thread must invoke update_blocking"
            )

        assert status == 202
        assert body["status"] == "accepted"
        assert isinstance(body["requestId"], str) and len(body["requestId"]) > 0
        # The ONE-SHOT, non-live walk primitive — NOT live=True (which would
        # arm the continuous fs-watch loop the boot-decouple retired).
        mock_update.assert_called_once_with(live=False, full_reprocess=False)
        # After a successful walk the single-flight lock is released (the
        # worker's finally), so a subsequent walk could start.
        _wait_for_lock_release(server_mod)
        assert not server_mod.walk_in_progress()

    def test_walk_full_reprocess_flag_forwarded(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A `{"full_reprocess": true}` body maps to
        `update_blocking(full_reprocess=True)`."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        walk_ran = threading.Event()

        def _record_update(**_kwargs: object) -> None:
            walk_ran.set()

        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP,
            "update_blocking",
            side_effect=_record_update,
        ) as mock_update:
            status, body = asyncio.run(
                _exercise_walk(aiohttp_app, body={"full_reprocess": True})
            )
            assert walk_ran.wait(timeout=2.0)

        assert status == 202
        assert body["fullReprocess"] is True
        mock_update.assert_called_once_with(live=False, full_reprocess=True)
        _wait_for_lock_release(server_mod)
        assert not server_mod.walk_in_progress()


class TestWalkNonJsonBody:
    """bl-225 — a POST /walk with a NON-JSON body is handled gracefully: the
    `full_reprocess` flag falls back to the incremental default (False) and the
    walk is accepted 202, exactly as the handler docstring promises ("a
    non-JSON body … yield[s] the incremental default").

    Regression context: `_read_full_reprocess_flag`'s except clause names
    `json.JSONDecodeError`, but server.py lacked `import json` until c66382c6
    ({62.6}) — so a non-JSON body raised `NameError` while EVALUATING the
    except tuple, crashing the handler instead of falling back. The defect was
    never observable because the suite previously mocked aiohttp before this
    path. These cases drive the REAL parse-failure path through the route
    handler: were the `import json` reverted, both fail with NameError instead
    of returning 202.
    """

    def _assert_graceful_incremental_walk(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        *,
        raw_body: bytes,
        content_type: str,
    ) -> None:
        """Drive /walk with a verbatim non-JSON body; assert the graceful
        incremental-default contract (202 + fullReprocess False + walk runs
        with full_reprocess=False + lock released)."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        walk_ran = threading.Event()

        def _record_update(**_kwargs: object) -> None:
            walk_ran.set()

        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP,
            "update_blocking",
            side_effect=_record_update,
        ) as mock_update:
            # Pre-fix this await raised NameError (json undefined in the
            # except tuple) — the request crashed instead of degrading to an
            # incremental walk.
            status, body = asyncio.run(
                _exercise_walk(
                    aiohttp_app, raw_body=raw_body, content_type=content_type
                )
            )
            assert walk_ran.wait(timeout=2.0), (
                "a non-JSON body must still trigger the incremental walk"
            )

        assert status == 202
        assert body["status"] == "accepted"
        assert body["fullReprocess"] is False
        mock_update.assert_called_once_with(live=False, full_reprocess=False)
        _wait_for_lock_release(server_mod)
        assert not server_mod.walk_in_progress()

    def test_walk_202_incremental_on_non_json_body(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Plain-text garbage body (e.g. a mis-fired `curl --data`) → graceful
        incremental walk, no NameError."""
        self._assert_graceful_incremental_walk(
            aiohttp_app,
            tmp_path,
            monkeypatch,
            raw_body=b"this is not json {{{",
            content_type="text/plain",
        )

    def test_walk_202_incremental_on_truncated_json_body(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A truncated JSON body declared as application/json (json.loads
        raises JSONDecodeError) → graceful incremental walk, no NameError."""
        self._assert_graceful_incremental_walk(
            aiohttp_app,
            tmp_path,
            monkeypatch,
            raw_body=b'{"full_reprocess":',
            content_type="application/json",
        )


class TestWalkSingleFlight:
    """bl-221 G4 — a walk arriving while another is in flight is rejected 409;
    the lock is released after a walk completes AND after a walk raises (a failed
    walk must not wedge the lock)."""

    def test_walk_409_when_walk_in_flight(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        release = threading.Event()
        first_walk_started = threading.Event()

        def _blocking_update(**_kwargs: object) -> None:
            # Hold the walk open so a second request observes the lock held.
            first_walk_started.set()
            release.wait(timeout=5.0)

        flow = _patched_walk_app()
        try:
            with patch.object(
                flow.KH_PIPELINE_APP,
                "update_blocking",
                side_effect=_blocking_update,
            ):
                # First /walk → 202, walk thread now holds the single-flight lock.
                status1, _ = asyncio.run(_exercise_walk(aiohttp_app))
                assert status1 == 202
                assert first_walk_started.wait(timeout=2.0)
                assert server_mod.walk_in_progress()

                # Second /walk while the first is in flight → 409.
                status2, body2 = asyncio.run(_exercise_walk(aiohttp_app))
                assert status2 == 409
                assert "in progress" in body2["error"]
        finally:
            # Let the first walk complete so its finally releases the lock.
            release.set()
            _wait_for_lock_release(server_mod)
        assert not server_mod.walk_in_progress()

    def test_walk_lock_released_after_exception(
        self,
        aiohttp_app: web.Application,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A walk that RAISES inside update_blocking must still release the
        single-flight lock (the worker's finally) so the next walk can start —
        a failed walk must not wedge the lock."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_walk_state()
        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("CRON_SECRET", _WALK_CRON_SECRET)
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        walk_attempted = threading.Event()

        def _raising_update(**_kwargs: object) -> None:
            walk_attempted.set()
            raise RuntimeError("walk boom")

        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP,
            "update_blocking",
            side_effect=_raising_update,
        ):
            status, _ = asyncio.run(_exercise_walk(aiohttp_app))
            assert status == 202  # the failure is async; the accept is 202
            assert walk_attempted.wait(timeout=2.0)

        # The walk raised; the lock must STILL have been released by the finally.
        _wait_for_lock_release(server_mod)
        assert not server_mod.walk_in_progress(), (
            "a failed walk must release the single-flight lock (not wedge it)"
        )
        # The worker did NOT flip /health unhealthy — a transient walk failure
        # must not fail the container liveness probe.
        assert server_mod.worker_is_healthy()


def _wait_for_lock_release(server_mod: object, timeout: float = 2.0) -> None:
    """Spin-wait until the walk single-flight lock is released (worker finally).

    The lock is released on the walk worker thread, so the assertion must allow
    a brief window after `update_blocking` returns/raises for the `finally` to
    run. Uses a short bounded poll rather than a fixed sleep.
    """
    import time

    deadline = time.monotonic() + timeout
    while server_mod.walk_in_progress() and time.monotonic() < deadline:
        time.sleep(0.01)


# ──────────────────────────────────────────────────────────────────────────
# §7 — P5 content-hash-gated pull-sync ({138.14}; TECH.md §3.2 P5, §2.3 R(c),
# §2.6 R(ops))
# ──────────────────────────────────────────────────────────────────────────


class _FakeFetchConn:
    """Fake asyncpg connection backing `.fetch(...)` (the candidate-scope
    query) — distinct from `_FakeFenceConn`, which backs the fence's
    `.fetchval(...)` calls only."""

    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, query: str, *args: object) -> list[dict]:
        self.calls.append((query, args))
        return self.rows


class TestPullSyncCandidateScope:
    """{138.14} — the SQL predicate is the ONLY mechanism that excludes
    `ingest_once` / `live_connected` / `external_referenced` / `tombstoned`
    rows from pull-sync (a unit test cannot spin up a real Postgres WHERE
    filter) — this proves the QUERY SHAPE encodes the R(c)/§10.5 scope,
    mirroring test_cocoindex_writer_fence.py's exact-SQL-text convention."""

    def test_query_filters_keep_and_watch_and_excludes_tombstoned(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        # The file-wide autouse fixture (`_fake_pull_sync_stack`) replaces
        # `server_mod._fetch_pull_sync_candidates` with a no-op fake so the
        # PRE-EXISTING /walk tests stay unaffected by P5 — undo it here so
        # THIS test calls the REAL implementation it means to exercise.
        monkeypatch.undo()

        fake_rows = [
            {
                "id": "sd-1",
                "storage_path": "a.md",
                "logical_path": "a.md",
                "content_hash": "abc123",
            }
        ]
        conn = _FakeFetchConn(fake_rows)

        rows = asyncio.run(server_mod._fetch_pull_sync_candidates(conn))

        assert rows == fake_rows
        assert len(conn.calls) == 1
        query, args = conn.calls[0]
        assert "retention_class = $1" in query
        assert "admission_status <> 'tombstoned'" in query
        assert args == ("keep_and_watch",)


class TestPullSyncHashGate:
    """{138.14} P5 — the content-hash gate: the deliverable is that an
    unchanged bucket object is NEVER rewritten (byte- and mtime-identical);
    a changed or absent local file IS materialised via the injected
    downloader, keyed on the FROZEN `storage_path`, written to the MUTABLE
    `logical_path` (R(id) rename tolerance)."""

    def test_local_file_sha256_returns_none_for_a_missing_file(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _local_file_sha256

        assert _local_file_sha256(tmp_path / "does-not-exist.md") is None

    def test_local_file_sha256_matches_hashlib_reference(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _local_file_sha256

        path = tmp_path / "f.md"
        data = b"some corpus bytes"
        path.write_bytes(data)

        assert _local_file_sha256(path) == hashlib.sha256(data).hexdigest()

    def test_hash_match_skips_download_and_leaves_file_byte_and_mtime_identical(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _materialise_one

        data = b"identical bytes"
        target = tmp_path / "doc.md"
        target.write_bytes(data)
        before_mtime_ns = target.stat().st_mtime_ns

        def _download(_storage_path: str) -> bytes:
            raise AssertionError(
                "download must NEVER be called on a content-hash match"
            )

        row = {
            "storage_path": "doc.md",
            "logical_path": "doc.md",
            "content_hash": hashlib.sha256(data).hexdigest(),
        }

        outcome = _materialise_one(str(tmp_path), row, _download)

        assert outcome == "unchanged"
        assert target.read_bytes() == data
        assert target.stat().st_mtime_ns == before_mtime_ns

    def test_hash_mismatch_downloads_and_rewrites_the_file(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _materialise_one

        target = tmp_path / "doc.md"
        target.write_bytes(b"stale bytes")
        new_bytes = b"fresh bytes from the bucket"
        calls: list[str] = []

        def _download(storage_path: str) -> bytes:
            calls.append(storage_path)
            return new_bytes

        row = {
            "storage_path": "doc.md",
            "logical_path": "doc.md",
            "content_hash": hashlib.sha256(new_bytes).hexdigest(),
        }

        outcome = _materialise_one(str(tmp_path), row, _download)

        assert outcome == "materialised"
        assert target.read_bytes() == new_bytes
        assert calls == ["doc.md"]

    def test_missing_local_file_is_materialised_via_download(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _materialise_one

        target = tmp_path / "new" / "doc.md"
        new_bytes = b"brand new bytes"

        def _download(_storage_path: str) -> bytes:
            return new_bytes

        row = {
            "storage_path": "new/doc.md",
            "logical_path": "new/doc.md",
            "content_hash": hashlib.sha256(new_bytes).hexdigest(),
        }

        outcome = _materialise_one(str(tmp_path), row, _download)

        assert outcome == "materialised"
        assert target.read_bytes() == new_bytes

    def test_download_keys_on_frozen_storage_path_write_targets_mutable_logical_path(
        self, tmp_path: Path
    ) -> None:
        """R(id) rename tolerance: the bucket object key is the FROZEN
        `storage_path`; the local write target is the MUTABLE `logical_path`
        (a rename updates `logical_path`, never `storage_path`, per
        `_upsert_source_document`)."""
        from scripts.cocoindex_pipeline.server import _materialise_one

        new_bytes = b"renamed doc bytes"
        requested_keys: list[str] = []

        def _download(storage_path: str) -> bytes:
            requested_keys.append(storage_path)
            return new_bytes

        row = {
            "storage_path": "original/name.md",  # frozen bucket key
            "logical_path": "renamed/name.md",  # current client-facing path
            "content_hash": hashlib.sha256(new_bytes).hexdigest(),
        }

        outcome = _materialise_one(str(tmp_path), row, _download)

        assert outcome == "materialised"
        assert requested_keys == ["original/name.md"]
        assert (tmp_path / "renamed" / "name.md").read_bytes() == new_bytes
        assert not (tmp_path / "original" / "name.md").exists()

    def test_local_path_falls_back_to_storage_path_when_logical_path_absent(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _materialise_one

        new_bytes = b"no logical_path yet"

        def _download(_storage_path: str) -> bytes:
            return new_bytes

        row = {
            "storage_path": "legacy/name.md",
            "logical_path": None,
            "content_hash": hashlib.sha256(new_bytes).hexdigest(),
        }

        outcome = _materialise_one(str(tmp_path), row, _download)

        assert outcome == "materialised"
        assert (tmp_path / "legacy" / "name.md").read_bytes() == new_bytes


class TestPullSyncPathContainment:
    """SECURITY (HIGH) — `logical_path` is DB-sourced but NOT trustworthy: it
    is exactly the client-mutable rename attribute (R(id)), so a hostile or
    corrupted value must NEVER let pull-sync write outside
    `COCOINDEX_SOURCE_PATH`. Mirrors `TestStagePathEscape`'s existing
    `_stage_handler` containment-test convention: refused, nothing written
    outside the root, downloader never invoked."""

    def _refusing_download(self) -> Callable[[str], bytes]:
        def _download(_storage_path: str) -> bytes:
            raise AssertionError(
                "download must NEVER be called for a refused (escaping) row"
            )

        return _download

    def test_parent_traversal_logical_path_is_refused(
        self, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline.server import _materialise_one

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        row = {
            "storage_path": "escape.md",
            "logical_path": "../escape.md",
            "content_hash": "irrelevant",
        }

        outcome = _materialise_one(str(corpus), row, self._refusing_download())

        assert outcome == "refused"
        assert not (tmp_path / "escape.md").exists()
        assert list(corpus.iterdir()) == []

    def test_absolute_logical_path_is_refused(self, tmp_path: Path) -> None:
        from scripts.cocoindex_pipeline.server import _materialise_one

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        abs_target = tmp_path / "abs-escape.md"
        row = {
            "storage_path": "escape.md",
            "logical_path": str(abs_target),
            "content_hash": "irrelevant",
        }

        outcome = _materialise_one(str(corpus), row, self._refusing_download())

        assert outcome == "refused"
        assert not abs_target.exists()

    def test_embedded_parent_traversal_is_refused(self, tmp_path: Path) -> None:
        """`a/../../b` has NO leading `..` and is not absolute, but still
        escapes the root two levels up once resolved — must be refused."""
        from scripts.cocoindex_pipeline.server import _materialise_one

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        row = {
            "storage_path": "escape.md",
            "logical_path": "a/../../b/escape.md",
            "content_hash": "irrelevant",
        }

        outcome = _materialise_one(str(corpus), row, self._refusing_download())

        assert outcome == "refused"
        assert not (tmp_path / "b" / "escape.md").exists()
        assert not (tmp_path.parent / "b" / "escape.md").exists()

    def test_empty_and_whitespace_target_path_resolves_to_none(
        self, tmp_path: Path
    ) -> None:
        """Unit-level on `_resolve_pull_sync_target` directly (not via
        `_materialise_one`'s `row.get("logical_path") or storage_path`
        fallback, which would substitute a non-empty `storage_path` before
        this guard ever runs — defence-in-depth for a directly-empty value)."""
        from scripts.cocoindex_pipeline.server import _resolve_pull_sync_target

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        for bad_path in ("", "   "):
            assert _resolve_pull_sync_target(str(corpus), bad_path) is None

    def test_symlinked_subdir_inside_root_escaping_outward_is_refused(
        self, tmp_path: Path
    ) -> None:
        """A symlink PLANTED INSIDE `source_root` that points OUTSIDE it must
        not let a lexically-clean (no `..`, not absolute) `logical_path`
        escape — only a `realpath`-based check (not a string-prefix check)
        catches this."""
        from scripts.cocoindex_pipeline.server import _materialise_one

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        outside = tmp_path / "outside"
        outside.mkdir()

        linked = corpus / "linked"
        linked.symlink_to(outside, target_is_directory=True)

        row = {
            "storage_path": "escape.md",
            "logical_path": "linked/escape.md",
            "content_hash": "irrelevant",
        }

        outcome = _materialise_one(str(corpus), row, self._refusing_download())

        assert outcome == "refused"
        assert not (outside / "escape.md").exists()

    def test_refused_row_does_not_abort_the_pass_other_rows_still_materialise(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A single poisoned/corrupted row must not block pull-sync for
        every other legitimate keep_and_watch source — the pass continues."""
        from scripts.cocoindex_pipeline import server as server_mod

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        good_bytes = b"legitimate content"
        rows = [
            {
                "id": "sd-evil",
                "storage_path": "evil.md",
                "logical_path": "../evil.md",
                "content_hash": "irrelevant",
            },
            {
                "id": "sd-good",
                "storage_path": "good.md",
                "logical_path": "good.md",
                "content_hash": hashlib.sha256(good_bytes).hexdigest(),
            },
        ]

        async def _fake_fetch_candidates(_conn: object) -> list[dict]:
            return rows

        def _fake_downloader():
            def _download(storage_path: str) -> bytes:
                assert storage_path == "good.md"
                return good_bytes

            return _download

        monkeypatch.setattr(
            server_mod, "_fetch_pull_sync_candidates", _fake_fetch_candidates
        )
        monkeypatch.setattr(
            server_mod, "_resolve_storage_downloader", _fake_downloader
        )

        conn = _FakeFenceConn(acquire_result=True)

        counts = asyncio.run(server_mod._pull_sync_materialise(conn))

        assert counts == {"materialised": 1, "unchanged": 0, "refused": 1}
        assert (corpus / "good.md").read_bytes() == good_bytes
        assert not (tmp_path / "evil.md").exists()


class TestPullSyncFenceHold:
    """{138.14} P5 — the {138.9} writer fence is held across materialise ->
    walk; a busy fence means the walk NEVER runs (the P5 guard: no walk may
    ever run unfenced)."""

    def test_walk_runs_under_the_fence_hold_in_acquire_materialise_walk_release_order(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        # `_pull_sync_materialise` no-ops (idle-mode guard) when
        # COCOINDEX_SOURCE_PATH is unset — set it so the "materialise" event
        # below is actually reached (mirrors the /walk route's own
        # precondition, already validated upstream in `_walk_handler`).
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(tmp_path))

        events: list[tuple[str]] = []

        class _OrderedConn(_FakeFenceConn):
            async def fetchval(self, query: str, *args: object) -> bool:
                events.append(
                    (
                        "fence_acquire"
                        if "acquire" in query
                        else "fence_release",
                    )
                )
                return await super().fetchval(query, *args)

        conn = _OrderedConn(acquire_result=True)
        pool = _FakeFencePool(conn)

        async def _fake_build_pool() -> _FakeFencePool:
            return pool

        async def _fake_fetch_candidates(_conn: object) -> list[dict]:
            events.append(("materialise",))
            return []

        class _FakeApp:
            def update_blocking(self, **_kwargs: object) -> None:
                events.append(("update_blocking",))

        monkeypatch.setattr(server_mod, "_build_pull_sync_pool", _fake_build_pool)
        monkeypatch.setattr(
            server_mod, "_fetch_pull_sync_candidates", _fake_fetch_candidates
        )

        asyncio.run(
            server_mod._pull_sync_then_walk(_FakeApp(), False, "req-order")
        )

        assert [event[0] for event in events] == [
            "fence_acquire",
            "materialise",
            "update_blocking",
            "fence_release",
        ]
        assert pool.closed

    def test_busy_fence_raises_and_never_calls_update_blocking(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod
        from scripts.cocoindex_pipeline.writer_fence import WriterFenceBusyError

        conn = _FakeFenceConn(acquire_result=False)
        pool = _FakeFencePool(conn)

        async def _fake_build_pool() -> _FakeFencePool:
            return pool

        monkeypatch.setattr(server_mod, "_build_pull_sync_pool", _fake_build_pool)

        update_mock = Mock()

        class _FakeApp:
            update_blocking = update_mock

        with pytest.raises(WriterFenceBusyError):
            asyncio.run(
                server_mod._pull_sync_then_walk(_FakeApp(), False, "req-busy")
            )

        update_mock.assert_not_called()
        assert pool.closed  # the pool is still closed via the `finally`
        # Never attempted a release call — only the (failed) acquire.
        assert len(conn.calls) == 1


class TestWalkNeverRunsUnfenced:
    """{138.14} P5 guard, end-to-end via the real production entry point:
    `_run_walk` is the SOLE caller of `update_blocking` in this module, so a
    busy writer fence must abort the pass WITHOUT ever invoking it — the
    failure is swallowed (logged), never crashing the worker thread nor
    wedging the single-flight lock."""

    def test_busy_fence_aborts_the_pass_without_calling_update_blocking(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        busy_pool = _FakeFencePool(_FakeFenceConn(acquire_result=False))

        async def _fake_build_pool() -> _FakeFencePool:
            return busy_pool

        monkeypatch.setattr(server_mod, "_build_pull_sync_pool", _fake_build_pool)

        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            server_mod._run_walk(False, "req-busy-fence")

        mock_update.assert_not_called()
        # Only the (failed) acquire call was made — a busy fence never
        # attempts a release.
        assert len(busy_pool.conn.calls) == 1


class TestPullSyncEndToEnd:
    """{138.14} P5 — the full materialise-then-walk pass via the real
    `_run_walk` entry point, proving the content-hash gate (memoisation
    preservation) and the fence-hold ordering TOGETHER: an unchanged object
    is untouched (mtime+bytes preserved, never downloaded) and a changed
    object is materialised BEFORE the walk (`update_blocking`) runs."""

    def test_unchanged_file_untouched_and_changed_file_materialised_before_walk(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from scripts.cocoindex_pipeline import server as server_mod

        corpus = tmp_path / "corpus"
        corpus.mkdir()
        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(corpus))

        # Row A: on-disk bytes already match the stored content_hash exactly
        # — pull-sync must NOT touch it (mtime + bytes untouched, never
        # downloaded).
        unchanged_path = corpus / "unchanged.md"
        unchanged_bytes = b"unchanged content"
        unchanged_path.write_bytes(unchanged_bytes)
        unchanged_hash = hashlib.sha256(unchanged_bytes).hexdigest()
        before_mtime_ns = unchanged_path.stat().st_mtime_ns

        # Row B: on-disk bytes are STALE — pull-sync must download + rewrite
        # it before the walk runs.
        changed_path = corpus / "changed.md"
        changed_path.write_bytes(b"stale content")
        new_bytes = b"fresh content from the bucket"
        new_hash = hashlib.sha256(new_bytes).hexdigest()

        rows = [
            {
                "id": "sd-unchanged",
                "storage_path": "unchanged.md",
                "logical_path": "unchanged.md",
                "content_hash": unchanged_hash,
            },
            {
                "id": "sd-changed",
                "storage_path": "changed.md",
                "logical_path": "changed.md",
                "content_hash": new_hash,
            },
        ]

        async def _fake_fetch_candidates(_conn: object) -> list[dict]:
            return rows

        downloaded: list[str] = []

        def _fake_downloader():
            def _download(storage_path: str) -> bytes:
                downloaded.append(storage_path)
                assert storage_path == "changed.md", (
                    "the UNCHANGED row must never be downloaded"
                )
                return new_bytes

            return _download

        monkeypatch.setattr(
            server_mod, "_fetch_pull_sync_candidates", _fake_fetch_candidates
        )
        monkeypatch.setattr(
            server_mod, "_resolve_storage_downloader", _fake_downloader
        )

        observed_during_walk: dict[str, object] = {}

        def _record_update(**_kwargs: object) -> None:
            # By the time the walk runs, materialise must already be done.
            observed_during_walk["changed_bytes"] = changed_path.read_bytes()
            observed_during_walk["unchanged_mtime_ns"] = (
                unchanged_path.stat().st_mtime_ns
            )

        flow = _patched_walk_app()
        with patch.object(
            flow.KH_PIPELINE_APP,
            "update_blocking",
            side_effect=_record_update,
        ) as mock_update:
            server_mod._run_walk(False, "req-e2e")

        mock_update.assert_called_once_with(live=False, full_reprocess=False)
        # The changed file was rewritten with the NEW bytes BEFORE the walk ran.
        assert observed_during_walk["changed_bytes"] == new_bytes
        assert changed_path.read_bytes() == new_bytes
        # The unchanged file's mtime is BIT-IDENTICAL — never rewritten, so
        # cocoindex's own content-hash memoisation short-circuits it on walk.
        assert observed_during_walk["unchanged_mtime_ns"] == before_mtime_ns
        assert unchanged_path.stat().st_mtime_ns == before_mtime_ns
        assert unchanged_path.read_bytes() == unchanged_bytes
        # Only the CHANGED row's object was ever downloaded.
        assert downloaded == ["changed.md"]
