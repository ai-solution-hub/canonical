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

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ── Module under test ───────────────────────────────────────────────────────

from cocoindex_pipeline.extraction import (  # noqa: E402
    ClassificationExtraction,
    EntityMentionExtraction,
    QAFormExtraction,
    extract_classification,
    extract_entity_mentions,
    extract_qa_form,
)
from cocoindex_pipeline.flow_context import (  # noqa: E402
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
    """Mimics anthropic.types.Message — has a `.content` list of text blocks."""

    def __init__(self, json_text: str):
        self.content = [_MockTextBlock(json_text)]


# ── Canonical happy-path JSON fixtures ──────────────────────────────────────


_FAKE_OP_ID = "a0000000-0000-4000-8000-000000000001"
_FAKE_CONTENT_ID = "b1111111-1111-4111-8111-111111111111"
_FAKE_EXTRACTED_AT = "2026-05-22T12:00:00Z"


def _classification_json() -> str:
    return json.dumps(
        {
            "op_id": _FAKE_OP_ID,
            "content_items_id": _FAKE_CONTENT_ID,
            "extracted_at": _FAKE_EXTRACTED_AT,
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
            "op_id": _FAKE_OP_ID,
            "content_items_id": _FAKE_CONTENT_ID,
            "extracted_at": _FAKE_EXTRACTED_AT,
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
        "cocoindex_pipeline.extraction._ANTHROPIC_RETRY_WAIT_SECONDS_MIN",
        0.0,
        raising=False,
    )
    monkeypatch.setattr(
        "cocoindex_pipeline.extraction._ANTHROPIC_RETRY_WAIT_SECONDS_MAX",
        0.0,
        raising=False,
    )


def _make_mock_client_with_side_effects(side_effects: list[Any]) -> MagicMock:
    """Return a MagicMock AsyncAnthropic client whose messages.create()
    side-effect sequence is replayed across multiple awaits.

    `side_effects` items are either exceptions (raised by the AsyncMock)
    or `_MockMessageResponse` instances (returned by the AsyncMock).
    """
    mock_client = MagicMock(name="AsyncAnthropic_instance")
    mock_create = AsyncMock(side_effect=side_effects)
    mock_client.messages.create = mock_create
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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert result.content_type == "policy"
        assert counter.get() == 1
        # Verify the SDK was called twice (1 fail + 1 success)
        assert mock_client.messages.create.call_count == 2

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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert counter.get() == 2
        assert mock_client.messages.create.call_count == 3


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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")

        with pytest.raises(anthropic.InternalServerError):
            asyncio.run(_exercise())

        assert counter.get() == 3
        assert mock_client.messages.create.call_count == 4


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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")

        with pytest.raises(anthropic.AuthenticationError):
            asyncio.run(_exercise())

        assert counter.get() == 0
        assert mock_client.messages.create.call_count == 1

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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                    return_value=mock_client,
                ):
                    await extract_classification("test content")

        with pytest.raises(anthropic.BadRequestError):
            asyncio.run(_exercise())

        assert counter.get() == 0
        assert mock_client.messages.create.call_count == 1


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
                "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                return await extract_classification("test content")

        result = asyncio.run(_exercise())
        assert isinstance(result, ClassificationExtraction)
        assert mock_client.messages.create.call_count == 2


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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
                    "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
        from cocoindex_pipeline import extraction

        assert hasattr(extraction, "_anthropic_retry")
