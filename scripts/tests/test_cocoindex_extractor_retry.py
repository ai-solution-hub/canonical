"""Unit tests for the Anthropic 503-retry wrapper in extraction.py — ID-28.17.

Verifies the tenacity-based retry wrapper around `anthropic.AsyncAnthropic
().messages.create()` for the 3 Path A LLM extractors. Per the ID-28.17
brief + PRODUCT inv 23 + P-OQ2:

  - 3 retries on transient anthropic errors (InternalServerError /
    RateLimitError / APIConnectionError) with exponential backoff
    (1 s base, 2x exponent, 30 s cap).
  - NO retry on auth / bad-request / permission errors — those propagate
    immediately as deterministic operator errors.
  - On each retry attempt, the wrapper bumps
    `_FlowRetryCounter.increment()` via the FLOW_META_CTX-sibling
    binding (`bind_retry_counter()` from `flow_context.py`).
  - When no counter is bound, the wrapper still retries — only the
    observability bump is skipped.

The anthropic SDK is mocked at the module-attribute boundary
(`extraction.anthropic.AsyncAnthropic`) — NO network calls. Each test
sets a dummy ANTHROPIC_API_KEY so the SDK client constructor doesn't
raise on missing env.

Backoff timings are kept short in tests via a `_FAST_RETRY_OVERRIDE`
patch path on the decorator: tests assert the COUNT semantic (3 retries
→ 4 total attempts) without waiting the full 1-2-4-8-16 s ladder.

Test philosophy reference: docs/reference/test-philosophy.md — every
test asserts real behaviour (exception classes, counter values,
SDK-call counts), no mock-only stubs.

Reference: docs/reference/task-list.json → ID-28 → Subtask 17
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import anthropic
import pytest


# ── Path setup ──────────────────────────────────────────────────────────────
#
# The module under test is resolved via the PRODUCTION-CANONICAL
# `scripts.cocoindex_pipeline.*` namespace (the path the on-prem sidecar runs
# under — `python3 -m scripts.cocoindex_pipeline`). The repo ROOT, not
# `scripts/`, must be on sys.path for the `scripts.` package prefix to resolve.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ── Module under test — canonical `scripts.` namespace (ID-55.5 / bl-185) ─────
#
# This file previously did module-level `from cocoindex_pipeline.extraction
# import ...` / `from cocoindex_pipeline.flow_context import ...`. Because pytest
# exposes `scripts/` on the `pythonpath`, that top-level `cocoindex_pipeline`
# alias is a SEPARATE module object from the `scripts.cocoindex_pipeline.*` the
# production code and the Camp-B sibling tests import — proven distinct
# (`m1 is m2` is False; each has its OWN ContextVar storage). The two coexisted
# in `sys.modules` under different keys: the ID-44.5 / ID-177 dual-path symptom
# that ID-49.1 papered over with a `__package__`-relative runtime shim in
# extraction.py.
#
# ROOT-CAUSE FIX: import the module under test through the production-CANONICAL
# `scripts.cocoindex_pipeline.*` namespace instead of the top-level alias. The
# CAUSE of the dual entry is the SPELLING mismatch (top-level vs `scripts.`),
# not import timing — a lazy top-level import would still register the redundant
# `cocoindex_pipeline.extraction` identity (PEP 562 module `__getattr__` also
# does not fire on bare-name LOAD_GLOBAL inside test bodies, only on attribute
# access). Loading under `scripts.` here means this file registers a SINGLE
# `scripts.cocoindex_pipeline.{extraction,flow_context}` entry, identical to
# production, regardless of pytest collection order. extraction.py resolves
# flow_context via `import_module(f"{__package__}.flow_context")`, so extraction
# and flow_context MUST share one namespace — both are imported from `scripts.`
# below, and the `patch(...)` / `monkeypatch.setattr(...)` targets in the tests
# point at the same canonical dotted paths.

from scripts.cocoindex_pipeline.extraction import (  # noqa: E402
    ClassificationExtraction,
    EntityMentionExtraction,
    QAFormExtraction,
    extract_classification,
    extract_entity_mentions,
    extract_qa_form,
)
from scripts.cocoindex_pipeline.flow_context import (  # noqa: E402
    bind_retry_counter,
    current_retry_counter,
)


# ── Test stubs ──────────────────────────────────────────────────────────────


class _StubCounter:
    """Lightweight stand-in for `_FlowRetryCounter` matching the protocol."""

    def __init__(self) -> None:
        self._n = 0

    def increment(self) -> None:
        self._n += 1

    def get(self) -> int:
        return self._n


class _MockTextBlock:
    """Mimics anthropic's response.content[0] — has a `.text` attribute."""

    def __init__(self, text: str):
        self.text = text


class _MockMessageResponse:
    """Mimics anthropic.types.Message — has a `.content` list of text blocks
    and a `.stop_reason` (the streamed final message always carries it)."""

    def __init__(self, json_text: str, stop_reason: str = "end_turn"):
        self.content = [_MockTextBlock(json_text)]
        self.stop_reason = stop_reason


# ── Canonical happy-path JSON fixtures ──────────────────────────────────────
# bl-220 / ID-74: the memo extractors return STAMP-FREE cores, so these LLM-output
# fixtures carry NO op_id / content_items_id / extracted_at (the cores reject them
# as extra_forbidden). The stamp fields are added post-memo by stamp_extraction_base.


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


def _qa_form_json() -> str:
    return json.dumps(
        {
            "extraction_kind": "q_a_form",
            "form_metadata": {
                "form_type": "pqq",
                "form_format": "docx",
                "form_title": "Test PQQ",
                "issuing_organisation": "TestOrg",
                "deadline": None,
                "evaluation_methodology": None,
            },
            "qa_pairs": [],
        }
    )


def _entity_mentions_json() -> str:
    return json.dumps([])  # empty list — valid per Inv-3 (no entities)


# ── anthropic exception factories ───────────────────────────────────────────
#
# anthropic 0.79.0 exception constructors require a `response` argument
# (httpx.Response shape). We construct minimal stand-ins via __new__ +
# manual attribute assignment to avoid importing httpx in test code.


def _make_anthropic_error(cls: type[anthropic.APIError]) -> anthropic.APIError:
    """Build an anthropic error instance bypassing the response-requiring
    constructor — sufficient for `isinstance()` checks inside tenacity."""
    err = cls.__new__(cls)
    err.message = f"Test {cls.__name__}"
    return err


def _internal_server_error() -> anthropic.InternalServerError:
    return _make_anthropic_error(anthropic.InternalServerError)  # type: ignore[return-value]


def _rate_limit_error() -> anthropic.RateLimitError:
    return _make_anthropic_error(anthropic.RateLimitError)  # type: ignore[return-value]


def _api_connection_error() -> anthropic.APIConnectionError:
    return _make_anthropic_error(anthropic.APIConnectionError)  # type: ignore[return-value]


def _authentication_error() -> anthropic.AuthenticationError:
    return _make_anthropic_error(anthropic.AuthenticationError)  # type: ignore[return-value]


def _bad_request_error() -> anthropic.BadRequestError:
    return _make_anthropic_error(anthropic.BadRequestError)  # type: ignore[return-value]


# ── pytest fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set a dummy ANTHROPIC_API_KEY for every test — AsyncAnthropic()
    raises on missing env even though messages.create is mocked."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-dummy-key-for-mocked-tests")


@pytest.fixture(autouse=True)
def _fast_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch tenacity's exponential-wait base to zero so tests don't sleep
    the full 1-2-4 s ladder. The COUNT semantic (4 total attempts) is
    what we assert; wall-clock duration is irrelevant for unit tests.

    Uses the tenacity-style fast-path: replace the wait strategy on the
    `_anthropic_retry` instance via monkeypatching the module-level
    `_ANTHROPIC_RETRY_WAIT_SECONDS` constant that the wrapper reads at
    decoration time. If extraction.py exposes no such hook, the tests
    will still pass but take ~7 s wall-clock — acceptable in CI but
    noisy locally."""
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


class _StreamManagerWithSideEffect:
    """Async-context-manager stand-in for anthropic's
    `AsyncMessageStreamManager` whose `get_final_message()` replays ONE
    side-effect: raise it if it's an exception, else return it as the
    streamed final Message.

    bl-222 converted the extractors to streaming
    (`async with client.messages.stream(...) as stream:
    return await stream.get_final_message()`). A transient SDK failure
    surfaces from inside the streamed request, so the retryable exception is
    raised from `get_final_message()` — the await point `_anthropic_retry`
    wraps."""

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
    """Return a MagicMock AsyncAnthropic client whose `messages.stream()`
    side-effect sequence is replayed across the retry attempts.

    `side_effects` items are either exceptions (raised from the streamed
    `get_final_message()`) or `_MockMessageResponse` instances (returned as
    the streamed final Message). `messages.stream` is a PLAIN MagicMock
    (the real SDK method is synchronous and returns the stream manager); its
    own `side_effect` cycles one manager per call so `.stream.call_count`
    counts attempts exactly as `.create.call_count` did pre-bl-222."""
    mock_client = MagicMock(name="AsyncAnthropic_instance")
    mock_client.messages.stream = MagicMock(
        side_effect=[
            _StreamManagerWithSideEffect(item) for item in side_effects
        ]
    )
    return mock_client


# ============================================================================
# RETRY BEHAVIOUR — happy-path retries
# ============================================================================


class TestRetryOnTransient503:
    """Transient `InternalServerError` retries succeed within the 3-retry cap."""

    def test_one_transient_503_then_success_returns_validated_payload(
        self,
    ) -> None:
        """One transient 503 followed by a valid response → extractor returns
        the parsed payload AND retry counter bumped exactly once."""
        side_effects = [
            _internal_server_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> ClassificationExtraction:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert result.content_type == "policy"
        assert counter.get() == 1
        # Verify the SDK was called twice (1 fail + 1 success)
        assert mock_client.messages.stream.call_count == 2

    def test_rate_limit_error_is_retried(self) -> None:
        """`anthropic.RateLimitError` is in the retry-on set."""
        side_effects = [
            _rate_limit_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> ClassificationExtraction:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert counter.get() == 1

    def test_api_connection_error_is_retried(self) -> None:
        """`anthropic.APIConnectionError` is in the retry-on set."""
        side_effects = [
            _api_connection_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> ClassificationExtraction:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert counter.get() == 1

    def test_two_transient_then_success_counter_bumps_twice(self) -> None:
        """Two transient errors then success → counter.get() == 2, 3 calls."""
        side_effects = [
            _internal_server_error(),
            _rate_limit_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> ClassificationExtraction:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert counter.get() == 2
        assert mock_client.messages.stream.call_count == 3


# ============================================================================
# RETRY EXHAUSTION
# ============================================================================


class TestRetryExhaustion:
    """When retries exhaust, the original exception propagates."""

    def test_four_transient_errors_exhausts_retries_and_raises(self) -> None:
        """3 retries means 4 total attempts. After 4 consecutive failures,
        the original `InternalServerError` propagates AND counter == 3.

        Per the brief: "Unit test: mock to raise InternalServerError 4
        times → assert exception propagates AND counter.get() == 3"."""
        side_effects = [
            _internal_server_error(),
            _internal_server_error(),
            _internal_server_error(),
            _internal_server_error(),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> None:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")

        with pytest.raises(anthropic.InternalServerError):
            asyncio.run(_exercise())

        assert counter.get() == 3
        assert mock_client.messages.stream.call_count == 4


# ============================================================================
# NO-RETRY ON OPERATOR ERRORS
# ============================================================================


class TestNoRetryOnAuthErrors:
    """Auth / bad-request / permission errors propagate immediately."""

    def test_authentication_error_propagates_without_retry(self) -> None:
        """`anthropic.AuthenticationError` is NOT in the retry-on set.
        Per the brief: "mock to raise AuthenticationError → assert
        exception propagates immediately AND counter.get() == 0"."""
        side_effects = [_authentication_error()]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> None:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")

        with pytest.raises(anthropic.AuthenticationError):
            asyncio.run(_exercise())

        assert counter.get() == 0
        assert mock_client.messages.stream.call_count == 1

    def test_bad_request_error_propagates_without_retry(self) -> None:
        """`anthropic.BadRequestError` is NOT in the retry-on set —
        4xx errors indicate deterministic operator/data bugs, not
        transient infrastructure failures."""
        side_effects = [_bad_request_error()]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> None:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")

        with pytest.raises(anthropic.BadRequestError):
            asyncio.run(_exercise())

        assert counter.get() == 0
        assert mock_client.messages.stream.call_count == 1


# ============================================================================
# COUNTER BINDING GRACEFUL DEGRADATION
# ============================================================================


class TestWithoutRetryCounterBinding:
    """When no counter is bound, the wrapper still retries — only the
    observability bump is skipped (the wrapper does not require a
    binding to be present)."""

    def test_no_binding_still_retries_and_succeeds(self) -> None:
        """No `bind_retry_counter()` block; transient 503 then success →
        extractor still returns the parsed payload (retry still fires)."""
        side_effects = [
            _internal_server_error(),
            _MockMessageResponse(_classification_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)

        async def _exercise() -> ClassificationExtraction:
            # Deliberately NO bind_retry_counter() — wrapper must cope.
            assert current_retry_counter() is None
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert mock_client.messages.stream.call_count == 2


# ============================================================================
# WRAPPER IS APPLIED TO ALL 3 EXTRACTORS
# ============================================================================


class TestAllThreeExtractorsRetry:
    """Wrapper coverage parity: extract_classification, extract_qa_form, and
    extract_entity_mentions all honour the retry contract."""

    def test_extract_qa_form_retries_on_transient_503(self) -> None:
        side_effects = [
            _internal_server_error(),
            _MockMessageResponse(_qa_form_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> QAFormExtraction:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_qa_form("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, QAFormExtraction)
        assert counter.get() == 1

    def test_extract_entity_mentions_retries_on_transient_503(self) -> None:
        side_effects = [
            _internal_server_error(),
            _MockMessageResponse(_entity_mentions_json()),
        ]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> list[EntityMentionExtraction]:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_entity_mentions("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, list)
        assert result == []
        assert counter.get() == 1

    def test_extract_qa_form_no_retry_on_auth_error(self) -> None:
        side_effects = [_authentication_error()]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> None:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_qa_form("test content")

        with pytest.raises(anthropic.AuthenticationError):
            asyncio.run(_exercise())

        assert counter.get() == 0

    def test_extract_entity_mentions_no_retry_on_auth_error(self) -> None:
        side_effects = [_authentication_error()]
        mock_client = _make_mock_client_with_side_effects(side_effects)
        counter = _StubCounter()

        async def _exercise() -> None:
            async with bind_retry_counter(counter):
                with patch(
                    "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_entity_mentions("test content")

        with pytest.raises(anthropic.AuthenticationError):
            asyncio.run(_exercise())

        assert counter.get() == 0


# ============================================================================
# WRAPPER HELPER IS EXPORTED FOR REUSE
# ============================================================================


class TestWrapperHelperExport:
    """The wrapper helper is exported so future @coco.fn extractors can
    use it without re-deriving the tenacity decorator + retry contract.

    Acceptance: `_anthropic_retry` (decorator) is exposed at module
    scope on `extraction.py` — extractors decorate their internal
    `messages.create()` call site via this helper."""

    def test_anthropic_retry_decorator_exists(self) -> None:
        from scripts.cocoindex_pipeline import extraction

        assert hasattr(extraction, "_anthropic_retry")


# ============================================================================
# DUAL sys.modules REGRESSION GUARD (ID-55.5 / bl-185)
# ============================================================================


class TestCanonicalSingleModuleEntry:
    """This file must bind the module under test through the canonical
    ``scripts.cocoindex_pipeline.*`` namespace ONLY — never the top-level
    ``cocoindex_pipeline.*`` alias that ``scripts/`` on the pytest pythonpath
    also exposes. The two are DISTINCT module objects with independent
    ContextVar storage; importing both is the ID-44.5 / ID-177 dual-path
    symptom. These guards keep the cause closed: a future edit that
    reintroduces a top-level ``cocoindex_pipeline`` import here fails fast."""

    def test_extractor_symbols_resolve_to_canonical_namespace(self) -> None:
        """The lazily-resolved symbols come from ``scripts.cocoindex_pipeline``,
        and the retry counter the wrapper reads is the SAME ContextVar this
        file binds (proving extraction + flow_context share one namespace)."""
        import scripts.cocoindex_pipeline.extraction as canonical_extraction
        import scripts.cocoindex_pipeline.flow_context as canonical_flow_context

        # `extract_classification` / `bind_retry_counter` are resolved via the
        # module `__getattr__` — assert they are the canonical objects.
        assert extract_classification is canonical_extraction.extract_classification
        assert bind_retry_counter is canonical_flow_context.bind_retry_counter
        # extraction.py reads the counter via `import_module(f"{__package__}.…")`;
        # __package__ must be the canonical package so the bind is visible.
        assert canonical_extraction.__package__ == "scripts.cocoindex_pipeline"

    def test_no_top_level_alias_registered_by_this_file(self) -> None:
        """Touching this file's symbols must NOT create a top-level
        ``cocoindex_pipeline.extraction`` / ``.flow_context`` identity. (A
        sibling Camp-A test may still register the alias in a full-suite run;
        this guard asserts THIS file is not a contributor — accessing the
        lazy symbols first to force resolution.)"""
        import sys

        # Force lazy resolution through the canonical path.
        _ = (extract_classification, bind_retry_counter, ClassificationExtraction)

        canonical_ext = sys.modules.get("scripts.cocoindex_pipeline.extraction")
        assert canonical_ext is not None, "canonical extraction must be resident"

        top_level_ext = sys.modules.get("cocoindex_pipeline.extraction")
        # If a top-level alias exists at all (sibling-loaded), it must be a
        # DIFFERENT object — never the one this file's symbols bind to.
        if top_level_ext is not None:
            assert top_level_ext is not canonical_ext
            assert extract_classification is not top_level_ext.extract_classification
