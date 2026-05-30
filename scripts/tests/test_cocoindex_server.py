"""Unit tests for `scripts/cocoindex_pipeline/server.py` — HTTP wrapper for the
cocoindex sidecar Cloud Run Service.

Covers PRODUCT Inv-6 (HTTPS /health probe returns 200 OK) + the wrapper
contract specified in Subtask 28.15 dispatch brief:

  - HTTP server bind succeeds on $PORT (default 8080).
  - GET /health returns HTTP 200 + JSON body {"status": "ok"}.
  - SIGTERM handler installed (signal.getsignal(SIGTERM) is not default).
  - cocoindex `coco.start_blocking()` invoked in a background daemon thread
    (mock + assert thread spawn).

Test philosophy: every test asserts real behaviour. The HTTP `/health`
path is exercised by invoking the registered route handler IN-PROCESS via
`aiohttp.test_utils.make_mocked_request()` — no `TestClient`/`TestServer`,
so NO real listening TCP socket is bound (honouring the fixture docstring's
stated contract and keeping the test green in sandboxed runs). The real
`GET /health` round-trip against the deployed Cloud Run sidecar is covered
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
import json
import os
import signal
import threading
from pathlib import Path
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
    """The cocoindex worker runs `KH_PIPELINE_APP.update_blocking(live=True)`
    in a background daemon thread so the HTTP server runs concurrently with
    the cocoindex fs-watch loop.

    ID-49.1 boot-wiring contract: the worker MUST run the App's
    `update_blocking(live=True)` — NOT the bare `coco.start_blocking()`.
    `coco.start_blocking()` only starts the default environment and ENTERS
    its lifespan (provisioning `DB_CTX`); it does NOT run any registered
    App's `main_fn`. Booting via `start_blocking()` alone provisions the DB
    pool but never executes `app_main` — `mount_table_target(DB_CTX, …)`
    never runs and the pipeline silently does nothing. `update_blocking()`
    lazily starts the same `_default_env` (entering the lifespan, so
    `DB_CTX` is provided) AND runs `app_main` on it. Empirically verified
    against installed cocoindex 1.0.3; spec anchor TECH.md §P-2 line 374.

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

    def test_start_cocoindex_thread_runs_app_update_blocking_live(self) -> None:
        """`start_cocoindex_thread()` spawns a daemon thread whose target
        calls `KH_PIPELINE_APP.update_blocking(live=True)` — the App-run that
        executes `app_main` (NOT the bare `coco.start_blocking()`, which only
        enters the lifespan without running the pipeline)."""
        from scripts.cocoindex_pipeline import server as server_mod

        server_mod.reset_worker_state()
        # Clear any cross-file kh_pipeline App registration so the lazy flow
        # import inside start_cocoindex_thread() can re-register cleanly
        # (ID-49.7 test-side registry reset).
        _reset_cocoindex_app_registry()

        # Patch via the MODULE-CACHED reference, not a locally-imported
        # instance. A sibling test (test_cocoindex_extractor_retry.py) imports
        # `cocoindex_pipeline.flow_context` UNQUALIFIED (after inserting
        # scripts/ on sys.path), which can leave flow loaded under both the
        # qualified `scripts.cocoindex_pipeline.flow` and the unqualified
        # `cocoindex_pipeline.flow` paths — two distinct module objects with two
        # distinct `KH_PIPELINE_APP` instances. The daemon thread inside
        # `start_cocoindex_thread()` resolves the QUALIFIED
        # `scripts.cocoindex_pipeline.flow.KH_PIPELINE_APP`; patching that exact
        # object (rather than `from … import KH_PIPELINE_APP`, which may bind the
        # unqualified instance depending on collection order) makes the test
        # order-stable in both directions (Checker FAIL fix, ID-49.1).
        import scripts.cocoindex_pipeline.flow as _flow

        with patch.object(
            _flow.KH_PIPELINE_APP, "update_blocking", return_value=None
        ) as mock_update:
            # Guard: the worker must NOT take the lifespan-only boot path.
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

            mock_update.assert_called_once_with(live=True)
            mock_start_blocking.assert_not_called()
            # Secondary behavioural assertion: a successful boot (mocked
            # update_blocking returns cleanly) must NOT flip the worker
            # unhealthy — proves the daemon thread's success path does not
            # spuriously trip the crash flag.
            assert server_mod.worker_is_healthy(), (
                "a clean App boot must leave the worker healthy"
            )
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
# §3b — worker-liveness: /health reflects the cocoindex thread (ID-49.8)
# ──────────────────────────────────────────────────────────────────────────


class TestWorkerLiveness:
    """ID-49.8 / audit §7.5 — /health must reflect the cocoindex worker thread,
    not just aiohttp.

    Root cause context: the worker crashed at boot (asyncpg gaierror) while
    /health stayed 200 on a separate thread, so Cloud Run reported the revision
    Ready while the pipeline was dead. The fix wires a shared crash flag the
    worker thread sets on crash; /health returns non-200 when the worker is
    dead, so a green revision means the pipeline is actually up.
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
        non-200 status (503) so the Cloud Run liveness probe fails the
        revision rather than reporting a dead pipeline as Ready."""
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
        """When the App boot raises, start_cocoindex_thread()'s target must mark
        the worker crashed (so /health can observe it).

        Post-ID-49.1 the worker runs `KH_PIPELINE_APP.update_blocking(live=True)`;
        a boot crash there (e.g. the asyncpg gaierror that motivated audit §7.5)
        must flip the worker unhealthy exactly as the previous
        `coco.start_blocking()` boot path did.

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

        from scripts.cocoindex_pipeline.flow import KH_PIPELINE_APP

        try:
            with patch.object(
                KH_PIPELINE_APP,
                "update_blocking",
                side_effect=RuntimeError("boom"),
            ):
                thread = server_mod.start_cocoindex_thread()
                thread.join(timeout=2.0)
            assert not server_mod.worker_is_healthy(), (
                "a crashed App boot must flip the worker to unhealthy"
            )
        finally:
            server_mod.reset_worker_state()


# ──────────────────────────────────────────────────────────────────────────
# §3c — App boot end-to-end: idle-mode (O-Q8) preserved (ID-49.1)
# ──────────────────────────────────────────────────────────────────────────


class TestIdleModeBoot:
    """ID-49.1 / O-Q8 — booting the worker with COCOINDEX_SOURCE_PATH unset
    must enter the lifespan, run `app_main` to its idle-mode clean return, and
    leave the Service alive (worker stays healthy, no raise).

    This is the behavioural end-to-end of the boot wiring: it drives the REAL
    `KH_PIPELINE_APP.update_blocking(live=True)` (NOT a mock of it) through the
    server's daemon thread, so it proves the chosen boot call actually runs the
    pipeline's `app_main` AND honours the idle-mode guard. Only the lifespan's
    asyncpg pool is mocked — a live Supabase pooler connection is impractical in
    unit scope, and the idle-mode path returns before any `mount_table_target`
    so the pool is never exercised beyond provisioning. The DSN env var is set
    to a syntactically-valid (but never-dialled) pooler string so `_build_dsn()`
    passes its fail-fast validation without a real network call.

    Cloud Run reality this models: T8 ships COCOINDEX_SOURCE_PATH EMPTY; the
    sidecar boots, the worker enters idle mode and its daemon thread completes
    cleanly, and aiohttp's main thread keeps /health green. T7 sets
    COCOINDEX_SOURCE_PATH + restarts the Service to begin ingest.
    """

    @pytest.mark.filterwarnings(
        "ignore::pytest.PytestUnhandledThreadExceptionWarning"
    )
    def test_idle_mode_boot_returns_clean_worker_stays_healthy(
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
        fake_pool.close = AsyncMock()

        lifespan_entered = threading.Event()

        async def _fake_create_pool(*_args: object, **_kwargs: object) -> MagicMock:
            lifespan_entered.set()
            return fake_pool

        # No COCOINDEX_SOURCE_PATH -> app_main takes the O-Q8 idle-mode return.
        # COCOINDEX_DB is the engine's LMDB state-store path (a real deploy var
        # per cloudrun/services/*-cocoindex.yaml — points at /cocoindex-state/lmdb
        # in prod); without it environment.start raises. Point it at a tmp dir.
        # A valid-shaped DSN so the lifespan's _build_dsn() fail-fast passes
        # without dialling a real pooler host.
        #
        # monkeypatch.{setenv,delenv} so EVERY env mutation — including the
        # COCOINDEX_SOURCE_PATH removal that puts app_main in idle mode — is
        # restored on teardown (the prior manual os.environ.pop inside a
        # patch.dict leaked the deletion to sibling tests; Checker NIT fix).
        monkeypatch.setenv("COCOINDEX_DB", str(tmp_path / "lmdb"))
        monkeypatch.setenv(
            "COCOINDEX_DB_DSN",
            "postgresql://postgres.fake:pw@"
            "aws-0-eu-west-2.pooler.supabase.com:5432/postgres",
        )
        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        try:
            with patch("asyncpg.create_pool", side_effect=_fake_create_pool):
                thread = server_mod.start_cocoindex_thread()
                thread.join(timeout=10.0)

            assert not thread.is_alive(), (
                "idle-mode boot must complete (app_main returns early); the "
                "worker daemon thread should not hang"
            )
            assert lifespan_entered.is_set(), (
                "the lifespan must be entered on boot (DB_CTX provisioned) — "
                "update_blocking(live=True) starts the lifespan-bearing env"
            )
            assert server_mod.worker_is_healthy(), (
                "idle-mode boot is a CLEAN return (O-Q8); the worker must NOT "
                "be flagged crashed — the Service stays alive"
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
        """Non-int PORT raises ValueError at parse time. Cloud Run only
        ever sets a numeric PORT — fail fast on malformed input rather
        than silently fallback to 8080 (defensive, not silent-fail)."""
        from scripts.cocoindex_pipeline.server import resolve_port

        with patch.dict(os.environ, {"PORT": "not-a-port"}):
            with pytest.raises(ValueError):
                resolve_port()


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
        # Bytes landed at corpus_root/destPath — the watcher's next cycle
        # picks them up.
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
