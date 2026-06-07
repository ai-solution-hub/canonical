"""Tests for cocoindex_pipeline/flow.py — Subtask ID-28.19
app_main() retry counter wiring (Inv-23 production observability gap closure).

Verifies the production wiring that closes the Inv-23 end-to-end contract
deferred from 28.13 + 28.17. The S258 W1 work (28.17) shipped the
`bind_retry_counter` / `current_retry_counter` substrate in flow_context.py
and the tenacity `_anthropic_retry` wrapper around the 3 extractors with a
`before_sleep` hook that bumps `current_retry_counter()`. However, the
bump only fires when a counter is bound in the active `contextvars.ContextVar`
scope. This Subtask wires `app_main()` to bind the per-flow
`_FlowRetryCounter` instance so the observability contract closes.

Contract under test:

  1. `app_main()` source imports `bind_retry_counter` from `flow_context`
     (structural assertion — keeps the call site visible).

  2. `app_main()` source body contains an `async with bind_retry_counter(...)`
     wrapper around (or nested with) the existing `bind_flow_meta()` block —
     verified by source-inspection so the wiring discipline is checked even
     though the cocoindex Rust engine cannot be booted in unit tests.

  3. Behavioural binding: when an extractor invocation runs INSIDE the
     `bind_retry_counter(counter)` scope (modelling what `app_main()` does
     post-wiring), a transient `InternalServerError` followed by a successful
     response bumps the bound counter exactly once — proving the production
     bump call site fires when the binding is active.

  4. No-retry happy path: a successful flow run with no transient errors
     leaves the counter at 0 → `_emit_pipeline_run_webhook(retry_count=0)`
     emits the verbatim `retryCount: 0` payload (the baseline shape is
     preserved; the wiring does NOT pre-populate spurious bumps).

  5. Idle-mode safety: the existing 28.12 / 28.16 contract that
     `app_main()` returns cleanly when COCOINDEX_SOURCE_PATH is unset
     remains intact (the new wrapper must not introduce a raise on the
     early-return path).

Stub strategy: `cocoindex` (with a pass-through `@coco.fn`) and `aiohttp` are
injected ONLY for the duration of the flow / extraction imports below via
`stubbed_sys_modules()`, then removed from sys.modules so they do not leak
across the shared pytest process (ID-44.5). The captured `flow.aiohttp` stub
has its `ClientSession` pinned to `_StubSession` AFTER import so webhook
emissions are captured without a live HTTP server — and crucially WITHOUT
mutating the real `aiohttp.ClientSession` (the prior code pinned onto the real
package when this file imported flow first, leaking into sibling tests).

Reference: docs/reference/task-list.json → ID-28 → Subtask 19
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import pytest


# ── Path setup ──────────────────────────────────────────────────────────────
#
# Two import paths are valid for the cocoindex_pipeline package in this
# repo: the short form `cocoindex_pipeline.*` (used by sibling tests that
# don't touch `flow.py`) and the canonical absolute form
# `scripts.cocoindex_pipeline.*` (used by `flow.py`'s own imports and by
# the production `python3 -m scripts.cocoindex_pipeline` entrypoint).
#
# This test file deliberately uses the canonical absolute form because
# `flow.py` imports `bind_retry_counter` via the absolute path; mixing
# the two paths in a single test process creates the dual-import-path
# hazard documented in `flow_context.py` (lines 91-126) — two
# `_retry_counter_var` ContextVar instances under different module
# identities, with the bind-write and read sides diverging. Using the
# same absolute path here matches how `app_main()` runs in production
# (the container boots via `python3 -m scripts.cocoindex_pipeline`).
#
# We add the repo ROOT (the parent of `scripts/`) to sys.path so the
# `scripts` package is importable.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Also add scripts/ for compatibility with sibling test files that share
# the same pytest collection (their `cocoindex_pipeline.*` imports must
# still resolve when their fixtures execute alongside ours).
_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ── cocoindex stub for cross-test isolation (mirrors test_cocoindex_*.py) ───
#
# Sibling test files in the cocoindex test family inject MagicMock stubs
# into sys.modules at import time (e.g. test_cocoindex_adapters.py,
# test_cocoindex_flow_pipeline_run_webhook.py). When pytest runs them
# before us in the same process, our import would either:
#   - hit the leftover MagicMock and fail (no .connectors sub-package), or
#   - hit a real cocoindex that the previous test partially poisoned.
#
# Mitigation: install our own stub that provides a WORKING `@coco.fn`
# decorator (pass-through) — so `extract_classification(...)` is the
# real async function, awaitable in tests — alongside the other minimal
# cocoindex attributes the production modules access at import time.
#
# `setdefault` honours any prior stub a sibling test set; the prior
# stub's `coco.fn` may already be a MagicMock that doesn't pass-through,
# so we OVERWRITE the .fn attribute on whatever `cocoindex` entry exists
# to install our working decorator. This is safe because:
#   (a) other tests that ran before us already finished — their state
#       does not propagate to ours,
#   (b) tests that run AFTER us re-overwrite or re-stub for their own
#       needs (idempotent in practice; pytest collection happens
#       module-by-module).


def _pass_through_fn_decorator(**kwargs):
    """Replacement for cocoindex's @coco.fn decorator.

    `@coco.fn(memo=True)` is the real decorator. Production extractors
    use it as `@coco.fn(memo=True)` on top of an `async def`. For unit
    tests we don't need memoisation (we want each test to exercise the
    real SDK call path). The pass-through here returns the wrapped
    function unchanged — `extract_classification(text)` is the original
    coroutine, fully awaitable.
    """
    del kwargs  # unused — we ignore memo flags

    def _wrap(func):
        return func

    return _wrap


# Build a minimal cocoindex stub with a working .fn decorator.
def _build_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")
    stub.fn = _pass_through_fn_decorator
    stub.ContextKey = MagicMock(name="ContextKey")
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    stub.use_context = MagicMock(name="use_context")
    stub.start = MagicMock(name="start")
    return stub


def _stub_module(name: str) -> MagicMock:
    if name not in sys.modules:
        sys.modules[name] = MagicMock(name=name)
    return sys.modules[name]


# Build this file's OWN cocoindex stub with a working pass-through `@coco.fn`
# decorator — without it, a sibling stub's MagicMock `.fn` turns
# `extract_classification` into an un-awaitable MagicMock and the behavioural
# tests fail. The stub (+ connector submodules) is scoped to the flow /
# extraction imports below via `stubbed_sys_modules()` and removed from
# sys.modules afterwards, so it neither leaks into nor inherits from sibling
# files (ID-44.5) — making this file's cocoindex residency deterministic
# regardless of collection order.
from conftest import stubbed_sys_modules  # noqa: E402

_coco_stub = _build_coco_stub()
_coco_stub.fn = _pass_through_fn_decorator

_localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
_pg_stub = MagicMock(name="cocoindex.connectors.postgres")
_pg_stub.ColumnDef = MagicMock(name="ColumnDef")
_pg_stub.TableSchema = MagicMock(name="TableSchema")
_pg_stub.mount_table_target = MagicMock(name="mount_table_target")
_connectorkits_stub = MagicMock(name="cocoindex.connectorkits")
_target_stub = MagicMock(name="cocoindex.connectorkits.target")
_target_stub.ManagedBy = MagicMock(name="ManagedBy")
# asyncpg + docling are inert (no process-global state, no real-package
# consumer) so they stay resident in sys.modules.
_stub_module("asyncpg")
_stub_module("docling")
_stub_module("docling.document_converter")


# ── aiohttp stub for webhook payload capture (mirrors the pattern used by
# test_cocoindex_flow_pipeline_run_webhook.py — applied AFTER real flow
# import via attribute-pinning) ─────────────────────────────────────────────


class _StubResponse:
    """In-memory stand-in for aiohttp.ClientResponse."""

    def __init__(self, status: int = 200, body: str = "ok"):
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self) -> "_StubResponse":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None


class _StubSession:
    """In-memory stand-in for aiohttp.ClientSession — captures POST payload."""

    last_url: str | None = None
    last_headers: dict[str, str] | None = None
    last_json: dict[str, object] | None = None
    last_timeout: object = None
    next_response_status: int = 200
    next_response_body: str = "ok"
    raise_on_post: BaseException | None = None

    @classmethod
    def reset(cls) -> None:
        cls.last_url = None
        cls.last_headers = None
        cls.last_json = None
        cls.last_timeout = None
        cls.next_response_status = 200
        cls.next_response_body = "ok"
        cls.raise_on_post = None

    async def __aenter__(self) -> "_StubSession":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    def post(self, url: str, *, json=None, headers=None, timeout=None):  # noqa: ANN001
        if _StubSession.raise_on_post is not None:
            raise _StubSession.raise_on_post
        _StubSession.last_url = url
        _StubSession.last_headers = headers
        _StubSession.last_json = json
        _StubSession.last_timeout = timeout
        return _StubResponse(
            status=_StubSession.next_response_status,
            body=_StubSession.next_response_body,
        )


# aiohttp module stub captured as `flow.aiohttp` at import time so the webhook
# helper's `aiohttp.ClientSession(...)` / `aiohttp.ClientTimeout(...)` calls hit
# our in-memory stub rather than the real package.
_aiohttp_stub = MagicMock(name="aiohttp")
_aiohttp_stub.ClientSession = _StubSession


# ── Import the modules under test (real cocoindex 1.0.3 + extraction) ──────
#
# Use the SAME absolute import path that `flow.py` itself uses
# (`scripts.cocoindex_pipeline.*`) so the `bind_retry_counter` symbol in
# `flow` and the `current_retry_counter` reader inside `extraction.py`
# share a single ContextVar identity. Mixing this path with the short
# `cocoindex_pipeline.*` form triggers the dual-import-path hazard
# documented in `flow_context.py` lines 91-126.
#
# The stubs are scoped to these imports and removed from sys.modules
# afterwards (ID-44.5); flow / extraction capture the stub references at import
# time, so the tests still run stub-backed once sys.modules is restored.
with stubbed_sys_modules(
    {
        "cocoindex": _coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": _localfs_stub,
        "cocoindex.connectors.postgres": _pg_stub,
        "cocoindex.connectorkits": _connectorkits_stub,
        "cocoindex.connectorkits.target": _target_stub,
        "aiohttp": _aiohttp_stub,
    }
):
    from scripts.cocoindex_pipeline import flow  # noqa: E402  (stub-scoped)
    from scripts.cocoindex_pipeline import flow_context  # noqa: E402
    from scripts.cocoindex_pipeline.extraction import (  # noqa: E402
        ClassificationExtraction,
        extract_classification,
    )


# Pin this file's aiohttp stub onto the captured `flow.aiohttp` so the webhook
# emission helper sees our in-memory session rather than firing live HTTP. We
# pin onto the STUB module object — never the real aiohttp package — so nothing
# leaks into sibling tests (e.g. test_cocoindex_server.py resolves the real
# aiohttp).
#
# Post ID-67.2 namespace canonicalisation `flow` is a SINGLE
# `scripts.cocoindex_pipeline.flow` sys.modules identity shared with
# test_cocoindex_flow_pipeline_run_webhook.py, which ALSO assigns its own
# aiohttp stub onto `flow.aiohttp` at import time. Collection order
# (`app_main…` < `flow_pipeline…`) means that sibling's import-time
# `flow.aiohttp = …` would otherwise CLOBBER this module-level pin and swallow
# this file's webhook POSTs — so the `_pin_webhook_session` autouse fixture
# below RE-ASSERTS the pin before every test rather than relying on it
# surviving collection.
flow.aiohttp = _aiohttp_stub  # type: ignore[assignment]


# ── Fast-retry fixture so transient-503 tests do not sleep the full ladder ──


@pytest.fixture(autouse=True)
def _pin_webhook_session() -> None:
    """Re-assert this file's aiohttp stub on the shared canonical `flow` module
    before each test (ID-67.2): the single sys.modules identity is shared with
    test_cocoindex_flow_pipeline_run_webhook.py, whose own import-time pin would
    otherwise leave its stub (not `_StubSession`) resident on `flow.aiohttp`."""
    flow.aiohttp = _aiohttp_stub  # type: ignore[assignment]


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set a dummy ANTHROPIC_API_KEY — AsyncAnthropic() raises on missing
    env even when messages.create() is mocked."""
    monkeypatch.setenv(
        "ANTHROPIC_API_KEY", "test-dummy-key-for-mocked-tests"
    )


@pytest.fixture(autouse=True)
def _fast_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch tenacity's exponential-wait bounds to zero so tests don't sleep
    the 1-2-4-8-16 s ladder. The COUNT semantic (1 retry → 1 bump) is what
    we assert."""
    monkeypatch.setattr(
        "scripts.cocoindex_pipeline.extraction._ANTHROPIC_RETRY_WAIT_SECONDS_MIN",
        0.0,
        raising=False,
    )
    monkeypatch.setattr(
        "scripts.cocoindex_pipeline.extraction._ANTHROPIC_RETRY_WAIT_SECONDS_MAX",
        0.0,
        raising=False,
    )


# ── Test stubs ──────────────────────────────────────────────────────────────


class _MockTextBlock:
    """Mimics anthropic's response.content[0] — has a `.text` attribute."""

    def __init__(self, text: str):
        self.text = text


class _MockMessageResponse:
    """Mimics anthropic.types.Message — has `.content` list of text blocks
    and a `.stop_reason` (the streamed final message always carries it)."""

    def __init__(self, json_text: str, stop_reason: str = "end_turn"):
        self.content = [_MockTextBlock(json_text)]
        self.stop_reason = stop_reason


# bl-220 / ID-74: stamp-free core fixture — no op_id / content_items_id /
# extracted_at (stamped post-memo, not by the LLM / the memo extractor).
def _classification_json() -> str:
    return json.dumps(
        {
            "extraction_kind": "classification",
            "content_type": "policy",
            "primary_domain": "compliance",
            "classification_confidence": 0.92,
            "secondary_classifications": ["governance"],
            "rationale": "Policy document.",
        }
    )


def _make_anthropic_error(cls: type[anthropic.APIError]) -> anthropic.APIError:
    """Construct an anthropic error bypassing the response-requiring
    constructor (sufficient for tenacity's isinstance() check)."""
    err = cls.__new__(cls)
    err.message = f"Test {cls.__name__}"
    return err


def _internal_server_error() -> anthropic.InternalServerError:
    return _make_anthropic_error(anthropic.InternalServerError)  # type: ignore[return-value]


class _StreamManagerWithSideEffect:
    """Async-CM stand-in for anthropic's `AsyncMessageStreamManager` whose
    `get_final_message()` replays ONE side-effect — raise if exception, else
    return as the streamed final Message. bl-222 streamed the extractors, so
    a transient failure surfaces from `get_final_message()` (the await point
    `_anthropic_retry` wraps)."""

    def __init__(self, side_effect: Any):
        self._side_effect = side_effect

    async def __aenter__(self) -> Any:
        side_effect = self._side_effect
        stream = MagicMock(name="AsyncMessageStream")
        if isinstance(side_effect, BaseException):
            stream.get_final_message = AsyncMock(side_effect=side_effect)
        else:
            stream.get_final_message = AsyncMock(return_value=side_effect)
        return stream

    async def __aexit__(self, *exc_info: Any) -> bool:
        return False


def _make_mock_client_with_side_effects(side_effects: list[Any]) -> MagicMock:
    # bl-222: extractors stream now, so mock `messages.stream` (synchronous,
    # returns the async-CM manager) rather than `messages.create`. One
    # manager per call → `.stream.call_count` counts attempts as before.
    mock_client = MagicMock(name="AsyncAnthropic_instance")
    mock_client.messages.stream = MagicMock(
        side_effect=[
            _StreamManagerWithSideEffect(item) for item in side_effects
        ]
    )
    return mock_client


# ============================================================================
# SLICE 1: Structural assertion — app_main() imports bind_retry_counter
# ============================================================================


class TestAppMainImportsBindRetryCounter:
    """The retry-counter wiring requires `flow.py` to import
    `bind_retry_counter` from `flow_context` so the call site is visible at
    the canonical entry point.
    """

    def test_flow_module_exposes_bind_retry_counter(self) -> None:
        """flow.py must import `bind_retry_counter` (the binding context
        manager). Without this import, the wiring inside `app_main()` cannot
        attach the per-flow counter to the contextvar that
        `_bump_flow_retry_counter()` reads."""
        assert hasattr(flow, "bind_retry_counter"), (
            "flow.py must import bind_retry_counter from flow_context — "
            "the binding context manager is the mechanism that wires the "
            "per-flow retry counter into the contextvar that "
            "_bump_flow_retry_counter() reads. Without this import, "
            "production runs emit retry_count=0 even when retries fired."
        )

    def test_flow_bind_retry_counter_is_callable_async_context_manager(
        self,
    ) -> None:
        """`flow.bind_retry_counter` must be the async context manager from
        flow_context — verified by exercising the bind/unbind cycle.
        """
        # Construct a counter, enter the binding, verify the bound counter
        # is observable inside the scope and restored on exit.
        counter = flow._FlowRetryCounter()

        async def _exercise() -> tuple[object | None, object | None]:
            async with flow.bind_retry_counter(counter):
                inside = flow_context.current_retry_counter()
            outside = flow_context.current_retry_counter()
            return inside, outside

        inside, outside = asyncio.run(_exercise())
        assert inside is counter, (
            f"current_retry_counter() inside flow.bind_retry_counter scope "
            f"must return the bound counter; got {inside!r}. If this fails, "
            f"the bind/read pair is using divergent ContextVar identities "
            f"(dual-import-path hazard) and the production bump would "
            f"silently miss."
        )
        assert outside is None, (
            "current_retry_counter() outside the binding must return None "
            "(no prior binding)."
        )


# ============================================================================
# SLICE 2: Source-inspection — app_main() body wraps the extractor block
# ============================================================================


class TestAppMainBodyContainsBindRetryCounterWrapper:
    """Source-inspection contract: `app_main()` body must contain an
    `async with bind_retry_counter(flow_retry_counter)` (or equivalent)
    wrapper.

    Source-inspection is the canonical pattern here (mirrors 28.16's
    `TestAppMainFlowMetaCtxBinding`) because the cocoindex Rust engine
    cannot be booted in a unit test, so we cannot exercise `app_main()`
    end-to-end. Asserting on the source text proves the wiring is in
    place at the call site.
    """

    def test_app_main_source_contains_bind_retry_counter_call(self) -> None:
        """`app_main()` must thread the per-flow `_FlowRetryCounter` onto
        `ingest_file`.

        ID-66.19 reality: cocoindex runs the per-item `ingest_file` on its own
        `_LoopRunner` daemon thread, which does NOT inherit `app_main`'s
        ContextVar bindings — so binding the retry counter around `mount_each`
        bound it on the WRONG thread and the tenacity `before_sleep` hook in
        extraction.py read None. `app_main` now threads it as
        `flow_retry_counter=flow_retry_counter` via `functools.partial`, and
        `ingest_file` RE-BINDS it locally on the daemon thread."""
        source = inspect.getsource(flow.app_main)
        assert "flow_retry_counter=flow_retry_counter" in source, (
            "app_main() must thread `flow_retry_counter=flow_retry_counter` onto "
            "ingest_file (via functools.partial) so the per-flow `_FlowRetryCounter` "
            "crosses the cocoindex daemon-thread boundary and ingest_file can "
            "re-bind it for the tenacity before_sleep hook in extraction.py. "
            "Without it, production retries fire but the observability counter is "
            "never updated — `pipeline_runs.result.retry_count` emits 0."
        )

    def test_app_main_source_uses_async_with_for_binding(self) -> None:
        """`app_main()` threads the run context onto `ingest_file` via a NAMED
        per-item closure (ID-66.19 + {66.16}: NOT `functools.partial`, which has
        no `__name__`/`__qualname__` and crashes cocoindex `mount_each`), and
        `ingest_file` re-binds the retry counter on the daemon thread via an
        `async with` — the bind point moved off app_main's wrong thread into
        ingest_file's correct (daemon) thread."""
        app_main_source = inspect.getsource(flow.app_main)
        assert "async def bound_ingest_file(" in app_main_source, (
            "app_main() must thread the run context onto a NAMED per-item closure "
            "(not functools.partial — a partial has no __name__/__qualname__ and "
            "crashes cocoindex mount_each, {66.16}) so the context crosses the "
            "cocoindex daemon-thread boundary."
        )
        assert "flow_retry_counter=" in app_main_source, (
            "the closure must forward flow_retry_counter into ingest_file."
        )
        ingest_source = inspect.getsource(flow.ingest_file)
        assert "bind_retry_counter(" in ingest_source, (
            "ingest_file must RE-BIND the retry counter locally on the daemon "
            "thread (ID-66.19 caveat) so extraction.py's before_sleep hook reads "
            "it; the contextvar token-reset on exit stays exception-safe."
        )

    def test_flow_retry_counter_instantiated_once_in_app_main(self) -> None:
        """The per-flow `_FlowRetryCounter` instance must be instantiated
        exactly once in `app_main()` (the 28.13 substrate at line ~876).
        Duplicate instantiation would mean the bound counter is not the
        same instance the rollup webhook reads at flow-end."""
        source = inspect.getsource(flow.app_main)
        # Count occurrences of the instantiation pattern. Allow for comment
        # blocks that reference the class but do not construct it.
        instantiation_lines = [
            line
            for line in source.splitlines()
            if "flow_retry_counter = _FlowRetryCounter()" in line
        ]
        assert len(instantiation_lines) == 1, (
            f"Expected exactly one `flow_retry_counter = _FlowRetryCounter()` "
            f"line in app_main(); found {len(instantiation_lines)}. "
            f"Duplicate instantiation breaks the contract: the bound counter "
            f"must be the SAME instance the rollup webhook reads at "
            f"flow-end via flow_retry_counter.get()."
        )


# ============================================================================
# SLICE 3: Behavioural — counter bumps inside the binding scope
# ============================================================================


class TestRetryBumpFiresInsideAppMainBindingScope:
    """Behavioural contract: when an extractor retries inside the
    `bind_retry_counter(flow_retry_counter)` scope (modelling what
    `app_main()` does post-wiring), `_bump_flow_retry_counter()` fires
    and bumps the per-flow counter.

    The cocoindex Rust engine cannot be booted in unit tests, so we
    model the production scope by:

      1. Instantiating `_FlowRetryCounter` exactly as `app_main()` does.
      2. Entering `async with flow.bind_retry_counter(counter)` — the same
         binding the production wiring uses.
      3. Invoking `extract_classification` with a mocked anthropic client
         whose `messages.create` raises a transient 503 once then returns
         a valid payload — the same code path production runs.
      4. Asserting the bound counter shows `.get() == 1` afterwards.

    This proves the production bump fires once the binding wiring is
    active in `app_main()`.
    """

    def test_one_transient_503_inside_binding_bumps_counter_once(
        self,
    ) -> None:
        """The canonical Inv-23 contract closure scenario: transient 503
        then success, counter bound via the same context manager
        `app_main()` uses → counter shows exactly 1 bump."""
        # Instantiate the production counter class — same as app_main() line 876.
        flow_retry_counter = flow._FlowRetryCounter()
        assert flow_retry_counter.get() == 0, (
            "fresh counter must start at 0 — baseline sanity"
        )

        # Mocked anthropic client: 1 transient 503, then valid response.
        side_effects = [
            _internal_server_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)

        async def _exercise() -> ClassificationExtraction:
            # Same binding pattern app_main() uses post-28.19 wiring.
            async with flow.bind_retry_counter(flow_retry_counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        # The core Inv-23 closure assertion: the counter that was bound
        # via `bind_retry_counter` shows exactly 1 bump after the retry.
        assert flow_retry_counter.get() == 1, (
            f"flow_retry_counter must show exactly 1 bump after a single "
            f"transient 503 retry inside the binding scope; got "
            f"{flow_retry_counter.get()}. This is the Inv-23 production "
            f"observability contract — without this bump, "
            f"pipeline_runs.result.retry_count would emit 0 even when "
            f"retries actually fired."
        )
        # Sanity: SDK called twice (1 fail + 1 success).
        assert mock_client.messages.stream.call_count == 2

    def test_webhook_payload_carries_retry_count_after_binding_scope_bump(
        self,
    ) -> None:
        """End-to-end-ish: a retry inside the binding scope feeds the
        counter; the rollup webhook emitted at flow-end carries the
        bumped value as `retryCount >= 1` in the payload.

        Models the post-28.19 production wiring: `app_main()` binds the
        counter, the extractor retries bump it, the `finally` block
        emits `_emit_pipeline_run_webhook(retry_count=counter.get())`.
        """
        _StubSession.reset()
        flow_retry_counter = flow._FlowRetryCounter()

        side_effects = [
            _internal_server_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)

        url = "https://kh.example.org/api/internal/pipeline-runs/record"
        secret = "test-cron-secret"

        async def _exercise() -> None:
            # Inside the binding scope: retry bumps the counter.
            async with flow.bind_retry_counter(flow_retry_counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")
            # After the scope: emit the rollup webhook (mirrors app_main()
            # finally-block emission).
            await flow._emit_pipeline_run_webhook(
                op_id=uuid.uuid4(),
                status="completed",
                stage_counts=flow._empty_stage_counts(),
                items_processed=1,
                items_created=[str(uuid.uuid4())],
                retry_count=flow_retry_counter.get(),
            )

        env = {"PIPELINE_RUN_WEBHOOK_URL": url, "CRON_SECRET": secret}
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(_exercise())

        payload = _StubSession.last_json
        assert payload is not None, "expected a webhook POST; got None"
        assert payload.get("status") == "completed"
        assert payload.get("retryCount") == 1, (
            f"webhook payload must emit retryCount=1 after a single transient "
            f"503 retry inside the binding scope; got "
            f"retryCount={payload.get('retryCount')!r}"
        )


# ============================================================================
# SLICE 4: No-retry happy path — retry_count emits 0 when no retries fire
# ============================================================================


class TestNoRetryHappyPathPreserved:
    """The 28.19 binding must NOT change the no-retry happy-path behaviour:
    a flow run with no transient errors emits `retry_count == 0` (verbatim,
    per the 28.13 rollup contract — 0 is meaningful per the route's
    discriminator).

    This guards against a regression where the binding might inadvertently
    pre-populate the counter or change the rollup emission shape.
    """

    def test_no_retries_inside_binding_emits_retry_count_zero(self) -> None:
        """A clean extractor invocation inside the binding scope leaves the
        counter at 0 — `_emit_pipeline_run_webhook(retry_count=0)` then
        emits `retryCount: 0` verbatim in the payload."""
        _StubSession.reset()
        flow_retry_counter = flow._FlowRetryCounter()

        # Mocked client: NO transient errors — valid response first try.
        side_effects = [_MockMessageResponse(_classification_json())]
        mock_client = _make_mock_client_with_side_effects(side_effects)

        url = "https://kh.example.org/api/internal/pipeline-runs/record"
        secret = "test-cron-secret"

        async def _exercise() -> None:
            async with flow.bind_retry_counter(flow_retry_counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")
            await flow._emit_pipeline_run_webhook(
                op_id=uuid.uuid4(),
                status="completed",
                stage_counts=flow._empty_stage_counts(),
                items_processed=1,
                items_created=[str(uuid.uuid4())],
                retry_count=flow_retry_counter.get(),
            )

        env = {"PIPELINE_RUN_WEBHOOK_URL": url, "CRON_SECRET": secret}
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(_exercise())

        # No retries fired → counter stays at 0.
        assert flow_retry_counter.get() == 0, (
            f"counter must remain at 0 when no retries fire; got "
            f"{flow_retry_counter.get()}. A non-zero baseline would indicate "
            f"the binding is incorrectly pre-populating bumps."
        )
        # Webhook payload carries 0 verbatim per Inv-23 / 28.13 contract.
        payload = _StubSession.last_json
        assert payload is not None
        assert payload.get("retryCount") == 0, (
            f"webhook payload must emit retryCount=0 verbatim when no "
            f"retries fire; got retryCount={payload.get('retryCount')!r}. "
            f"The 28.13 fix-pack contract requires retry_count to be emitted "
            f"on every rollup row, including 0, so operator dashboards "
            f"relying on `result.retry_count IS NOT NULL` filter behave "
            f"correctly."
        )
        # SDK called exactly once (no retry).
        assert mock_client.messages.stream.call_count == 1


# ============================================================================
# SLICE 5: Idle-mode safety — the new wrapper must not break the early return
# ============================================================================


class TestIdleModeContractPreserved:
    """The existing 28.12 / 28.16 idle-mode contract is that `app_main()`
    returns cleanly when COCOINDEX_SOURCE_PATH is unset. The 28.19 wiring
    must not introduce a raise on this early-return path (e.g. by
    accidentally moving the binding outside the source-path-exists guard).
    """

    def test_app_main_idle_mode_does_not_raise(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """COCOINDEX_SOURCE_PATH unset → `app_main()` returns cleanly,
        no raise."""
        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        # Should not raise — the early-return guard at the top of
        # app_main() must fire before any cocoindex / asyncpg / coco_pool
        # construction (and before the new bind_retry_counter wrapper).
        asyncio.run(flow.app_main())
