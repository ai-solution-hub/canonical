"""Unit tests for the 3 Path A @coco.fn(memo=True) LLM extractors.

Verifies the canonical 1.x extraction pattern (S256 W1 amendment of
`docs/specs/id-36-cocoindex-extraction-contract/TECH.md` §3.1):

  - `extract_classification(content_text)` -> ClassificationExtraction
  - `extract_qa_form(content_text)` -> QAFormExtraction
  - `extract_entity_mentions(content_text)` -> list[EntityMentionExtraction]

Each extractor:
  1. Calls `_anthropic_message(client, ...)` (bl-222), which routes through
     the STREAMING `anthropic.AsyncAnthropic().messages.stream(...)` surface
     — `async with client.messages.stream(**kwargs) as stream:
     return await stream.get_final_message()` — with the appropriate prompt
     + content_text. (Pre-bl-222 this was the non-streaming
     `messages.create(...)`; streaming is mandated by the SDK once
     `max_tokens` exceeds the non-streaming output cap, which bl-221's
     32768 qa_form ceiling does.)
  2. Validates the JSON response via `TypeAdapter(<Variant>).validate_json()`.
  3. Returns the typed Pydantic object on success.
  4. Propagates `ValidationError` on schema mismatch (Option A failure
     path per S256 WP4 brief — caught by `app_main()`'s try/except).

The anthropic SDK is mocked at the module-attribute boundary
(`extraction.anthropic.AsyncAnthropic`) — NO network calls at test time.
`messages.stream` is mocked as an async context manager whose
`get_final_message()` resolves to the fake Message (see `_MockStreamManager`
+ `_make_mock_client`). Each test sets ANTHROPIC_API_KEY to a fake value to
ensure the SDK client constructor doesn't raise on missing env.

Memoisation discipline (Inv-21): the `@coco.fn(memo=True)` decorator
returns an `AsyncFunction` instance (verified empirically against
cocoindex 1.0.3 — see WP3 stub pattern). Test class
`TestExtractorDecoration` asserts the decorated identity.

Reference: docs/specs/id-36-cocoindex-extraction-contract/TECH.md §3.1
Test strategy: ID-28.12 WP4 — extractor behaviour with mocked anthropic SDK
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

# ── Path setup ──────────────────────────────────────────────────────────────
# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


# ── Module under test ───────────────────────────────────────────────────────
# extraction.py imports anthropic + pydantic at module load. Both pinned
# packages are installed (anthropic 0.79.0, pydantic 2.12.5) per
# requirements.txt — no stubbing needed. cocoindex IS installed (1.0.3);
# the @coco.fn decorator runs at module import and produces AsyncFunction
# instances — also no stubbing needed.

from scripts.cocoindex_pipeline.extraction import (  # noqa: E402
    ClassificationExtraction,
    EntityMentionExtraction,
    QAFormExtraction,
    _strip_code_fence,
    classify_pydantic_error,
    extract_classification,
    extract_entity_mentions,
    extract_qa_form,
)


# ── Mock SDK response helper ────────────────────────────────────────────────


class _MockTextBlock:
    """Mimics anthropic's response.content[0] — has a `.text` attribute."""

    def __init__(self, text: str):
        self.text = text


class _MockUsage:
    """Mimics anthropic.types.Usage — carries the prompt-cache token counters
    the real SDK surfaces on `response.usage` (ID-61.1 / GAP-Q-EX2-002)."""

    def __init__(
        self,
        input_tokens: int = 100,
        output_tokens: int = 50,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
    ):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_creation_input_tokens = cache_creation_input_tokens
        self.cache_read_input_tokens = cache_read_input_tokens


class _MockMessageResponse:
    """Mimics anthropic.types.Message — has a `.content` list of text blocks,
    a `.stop_reason` (the real SDK always populates this; the {73.1}
    truncation guard reads it before validation) and an optional `.usage`
    (cache-token observability per ID-61.1)."""

    def __init__(
        self,
        json_text: str,
        stop_reason: str = "end_turn",
        usage: Any | None = None,
    ):
        self.content = [_MockTextBlock(json_text)]
        self.stop_reason = stop_reason
        self.usage = usage


class _MockStreamManager:
    """Mimics anthropic's `AsyncMessageStreamManager` — the async context
    manager returned (SYNCHRONOUSLY) by `client.messages.stream(**kwargs)`.

    bl-222 converted the 3 extractors from non-streaming
    `messages.create(...)` to streaming `messages.stream(...)`:

        async with client.messages.stream(**kwargs) as stream:
            return await stream.get_final_message()

    `__aenter__` yields a stub `stream` whose async `get_final_message()`
    resolves to the fully-accumulated `Message` (here `_MockMessageResponse`)
    exposing `.content[0].text` + `.stop_reason` — the same interface the
    extractors consumed pre-bl-222. Mirrors anthropic 0.79.0 where
    `stream(...)` is a synchronous call returning this manager."""

    def __init__(self, final_message: _MockMessageResponse):
        self._final_message = final_message

    async def __aenter__(self) -> Any:
        stream = MagicMock(name="AsyncMessageStream")
        stream.get_final_message = AsyncMock(return_value=self._final_message)
        return stream

    async def __aexit__(self, *exc_info: Any) -> bool:
        return False


def _make_mock_client(
    json_response: str, stop_reason: str = "end_turn"
) -> MagicMock:
    """Return a MagicMock AsyncAnthropic instance whose `messages.stream()`
    yields a streamed final Message with `content[0].text == json_response`
    and the given `stop_reason` (defaults to the normal `end_turn`).

    `messages.stream` is a PLAIN MagicMock (not AsyncMock): the real SDK
    method is synchronous and returns the async-context-manager stream
    manager — only `get_final_message()` (inside the manager) is awaited."""
    mock_client = MagicMock(name="AsyncAnthropic_instance")
    final_message = _MockMessageResponse(json_response, stop_reason=stop_reason)
    mock_client.messages.stream = MagicMock(
        return_value=_MockStreamManager(final_message)
    )
    return mock_client


# ── Canonical happy-path JSON fixtures ──────────────────────────────────────
# These are the LLM-produced JSON payloads — byte-for-byte the shape the live
# extractors feed `_*_adapter.validate_json(...)`. The LLM omits op_id /
# content_items_id / extracted_at per prompts.py instruction, and bl-220 / ID-74
# makes the memo extractor return types STAMP-FREE cores, so these fixtures must
# NOT carry the 3 stamp fields (the strict, extra="forbid" core shapes reject
# them as `extra_forbidden`). The stamp fields are added POST-memo by
# `stamp_extraction_base`, OUTSIDE the extractor, so they never appear in the
# LLM-output JSON these extractors validate.


def _classification_json(content_type: str = "policy") -> str:
    """Return a well-formed classification extraction JSON payload."""
    return json.dumps(
        {
            "extraction_kind": "classification",
            "content_type": content_type,
            "primary_domain": "compliance",
            "classification_confidence": 0.92,
            "secondary_classifications": ["governance"],
            "rationale": "Document defines an organisation-wide policy.",
        }
    )


def _qa_form_json() -> str:
    """Return a well-formed q_a_form extraction JSON payload."""
    return json.dumps(
        {
            "extraction_kind": "q_a_form",
            "form_metadata": {
                "form_type": "pqq",
                "form_format": "docx",
                "form_title": "Cyber Security PQQ",
                "issuing_organisation": "Crown Commercial Service",
                "deadline": "2026-06-30T17:00:00Z",
                "evaluation_methodology": "MEAT 60/40",
            },
            "qa_pairs": [
                {
                    "question_text": "Do you hold ISO 27001:2022?",
                    "answer_text": "Yes",
                    "expected_response_kind": "mandatory",
                    "evaluation_criteria": "Yes/No with evidence",
                    "evidence_requirements": ["iso27001_certificate"],
                    "scope_tags": ["information_security"],
                },
                {
                    "question_text": "Describe your IR process.",
                    "answer_text": None,
                    "expected_response_kind": "optional",
                    "evaluation_criteria": None,
                    "evidence_requirements": [],
                    "scope_tags": [],
                },
            ],
        }
    )


def _entity_mentions_json() -> str:
    """Return a well-formed list of entity_mention JSON payloads."""
    return json.dumps(
        [
            {
                "extraction_kind": "entity_mention",
                "entity_type": "certification",
                "entity_name": "ISO 27001:2022",
                "canonical_name": "iso_27001",
                "source_span_start": 0,
                "source_span_end": 15,
                "mention_confidence": 0.95,
            },
            {
                "extraction_kind": "entity_mention",
                "entity_type": "organisation",
                "entity_name": "Crown Commercial Service",
                "canonical_name": "crown_commercial_service",
                "source_span_start": 20,
                "source_span_end": 44,
                "mention_confidence": 0.88,
            },
        ]
    )


# ── pytest fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Set a dummy ANTHROPIC_API_KEY for every test — AsyncAnthropic()
    raises on missing env even though messages.create is mocked."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-dummy-key-for-mocked-tests")


# ============================================================================
# CLASSIFICATION EXTRACTOR
# ============================================================================


class TestExtractClassification:
    """Verify extract_classification() behaviour with mocked anthropic SDK."""

    def test_happy_path_returns_validated_classification_extraction(self):
        """Well-formed JSON response → typed ClassificationExtraction object."""
        mock_client = _make_mock_client(_classification_json("policy"))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(
                extract_classification("Test document content text.")
            )
        assert isinstance(result, ClassificationExtraction)
        assert result.content_type == "policy"
        assert result.primary_domain == "compliance"
        assert result.classification_confidence == pytest.approx(0.92)
        # bl-220 / ID-74: the memo extractor returns the STAMP-FREE core, so the
        # 3 stamp fields are NOT present (they are stamped post-memo by
        # stamp_extraction_base, outside the extractor).
        assert not hasattr(result, "op_id")

    def test_calls_anthropic_with_classification_prompt_and_content(self):
        """Extractor sends CLASSIFICATION_PROMPT as a cached system block and
        the per-document content as the (uncached) user message (ID-61.1 /
        GAP-Q-EX2-002 — supersedes the pre-cache `f"{PROMPT}\\n\\n{content}"`
        user-message concatenation)."""
        mock_client = _make_mock_client(_classification_json())
        captured_messages: list[Any] = []
        original_stream = mock_client.messages.stream

        # `messages.stream` is synchronous (returns the async-CM manager);
        # capture the kwargs then delegate to the real manager factory.
        def _capture_stream(**kwargs: Any) -> Any:
            captured_messages.append(kwargs)
            return original_stream(**kwargs)

        mock_client.messages.stream = _capture_stream
        content = "The quick brown fox jumps."
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            asyncio.run(extract_classification(content))
        assert len(captured_messages) == 1
        kwargs = captured_messages[0]
        # model=claude-opus-4-6; classification's max_tokens ceiling is the
        # per-extractor constant ({73.1} — classification output is bounded so
        # it keeps the modest 4096 budget while qa_form / entity_mentions get
        # larger ceilings).
        from scripts.cocoindex_pipeline.extraction import (
            _MAX_TOKENS_CLASSIFICATION,
        )

        assert kwargs["model"] == "claude-opus-4-6"
        assert kwargs["max_tokens"] == _MAX_TOKENS_CLASSIFICATION
        assert kwargs["messages"][0]["role"] == "user"
        # The static prompt rides in the system block (cached — see
        # TestPromptCachePassthrough); the user message carries ONLY the
        # per-document content_text.
        from scripts.cocoindex_pipeline.prompts import CLASSIFICATION_PROMPT

        assert kwargs["system"][0]["text"] == CLASSIFICATION_PROMPT
        assert kwargs["messages"][0]["content"] == content

    def test_invalid_content_type_raises_validation_error(self):
        """LLM returns content_type not in taxonomy → ValidationError."""
        # `invented_junk_type` is NOT in taxonomy_snapshot.json content_types
        # — the @field_validator on ClassificationExtraction.content_type
        # raises ValueError → Pydantic surfaces as ValidationError.
        mock_client = _make_mock_client(_classification_json("invented_junk_type"))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(ValidationError) as exc_info:
                asyncio.run(extract_classification("doc text"))
        # Per Q-EX2 §4.1: invalid content_type maps to 'invalid_enum' error_class.
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_missing_required_field_raises_validation_error(self):
        """LLM omits required `primary_domain` field → ValidationError."""
        # Build a JSON payload missing `primary_domain` — Pydantic strict-
        # mode + extra='forbid' fails closed.
        payload = json.loads(_classification_json())
        del payload["primary_domain"]
        mock_client = _make_mock_client(json.dumps(payload))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(ValidationError) as exc_info:
                asyncio.run(extract_classification("doc text"))
        # Per Q-EX2 §4.1: missing required field maps to 'missing_required'.
        assert classify_pydantic_error(exc_info.value) == "missing_required"


# ============================================================================
# Q&A FORM EXTRACTOR
# ============================================================================


class TestExtractQAForm:
    """Verify extract_qa_form() behaviour with mocked anthropic SDK."""

    def test_happy_path_returns_validated_qa_form_extraction(self):
        """Well-formed JSON response → typed QAFormExtraction object."""
        mock_client = _make_mock_client(_qa_form_json())
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_qa_form("Test form content text."))
        assert isinstance(result, QAFormExtraction)
        assert result.form_metadata.form_type == "pqq"
        assert result.form_metadata.form_format == "docx"
        assert len(result.qa_pairs) == 2
        assert result.qa_pairs[0].expected_response_kind == "mandatory"
        assert result.qa_pairs[1].expected_response_kind == "optional"

    def test_calls_anthropic_with_q_a_form_prompt(self):
        """Extractor uses Q_A_FORM_PROMPT (per spec §3.1)."""
        from scripts.cocoindex_pipeline.prompts import Q_A_FORM_PROMPT

        mock_client = _make_mock_client(_qa_form_json())
        captured: list[Any] = []
        original_stream = mock_client.messages.stream

        def _capture(**kwargs: Any) -> Any:
            captured.append(kwargs)
            return original_stream(**kwargs)

        mock_client.messages.stream = _capture
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            asyncio.run(extract_qa_form("form content"))
        assert len(captured) == 1
        # The Q_A_FORM_PROMPT rides in the cached system block (ID-61.1);
        # the user message carries only the per-document content — proves
        # the extractor uses the correct prompt constant.
        assert captured[0]["system"][0]["text"] == Q_A_FORM_PROMPT
        assert captured[0]["messages"][0]["content"] == "form content"

    def test_info_only_response_kind_raises_validation_error(self):
        """LLM returns expected_response_kind='info_only' → ValidationError.

        Per Q-EX2 verifier B-1: only mandatory + optional are canonical.
        The Literal['mandatory', 'optional'] constraint rejects any other
        value.
        """
        payload = json.loads(_qa_form_json())
        payload["qa_pairs"][0]["expected_response_kind"] = "info_only"
        mock_client = _make_mock_client(json.dumps(payload))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(ValidationError) as exc_info:
                asyncio.run(extract_qa_form("form content"))
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_unknown_form_type_raises_validation_error(self):
        """LLM returns form_type='rfx' (not in 11-value list) → ValidationError."""
        payload = json.loads(_qa_form_json())
        payload["form_metadata"]["form_type"] = "rfx"  # invented
        mock_client = _make_mock_client(json.dumps(payload))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(ValidationError) as exc_info:
                asyncio.run(extract_qa_form("form content"))
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"


# ============================================================================
# ENTITY MENTIONS EXTRACTOR
# ============================================================================


class TestExtractEntityMentions:
    """Verify extract_entity_mentions() behaviour with mocked anthropic SDK."""

    def test_happy_path_returns_list_of_entity_mentions(self):
        """Well-formed JSON array response → list[EntityMentionExtraction]."""
        mock_client = _make_mock_client(_entity_mentions_json())
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_entity_mentions("doc with entities"))
        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(e, EntityMentionExtraction) for e in result)
        assert result[0].entity_type == "certification"
        assert result[0].entity_name == "ISO 27001:2022"
        assert result[1].entity_type == "organisation"
        assert result[1].mention_confidence == pytest.approx(0.88)

    def test_empty_list_is_valid_response(self):
        """LLM returns empty list `[]` → valid empty list[EntityMentionExtraction].

        Per PRODUCT inv 3 + prompts.py: when document contains no entities,
        the LLM MUST return an empty list (not invent entities). The
        extractor must accept this without error.
        """
        mock_client = _make_mock_client("[]")
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_entity_mentions("doc with no entities"))
        assert result == []
        assert isinstance(result, list)

    def test_unknown_entity_type_raises_validation_error(self):
        """LLM returns entity_type='alien' (not in 12-value list) → ValidationError."""
        payload = json.loads(_entity_mentions_json())
        payload[0]["entity_type"] = "alien"  # not in canonical 12-value list
        mock_client = _make_mock_client(json.dumps(payload))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(ValidationError) as exc_info:
                asyncio.run(extract_entity_mentions("doc text"))
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_negative_span_offset_raises_validation_error(self):
        """LLM returns source_span_start=-1 → ValidationError.

        Per extraction.py: source_span_start has `Field(ge=0)` constraint;
        negative offsets fail Pydantic validation.
        """
        payload = json.loads(_entity_mentions_json())
        payload[0]["source_span_start"] = -1  # violates Field(ge=0)
        mock_client = _make_mock_client(json.dumps(payload))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(ValidationError):
                asyncio.run(extract_entity_mentions("doc text"))


# ============================================================================
# DECORATOR / MEMOISATION DISCIPLINE
# ============================================================================


class TestExtractorDecoration:
    """Verify the 3 extractors are `@coco.fn(memo=True)`-decorated and
    directly awaitable per Path A canonical pattern (S256 W1).

    Per S256 W1 stub-pattern verification + WP4 empirical pre-flight:
    with REAL cocoindex installed (production + this worktree), `@coco.fn(memo=True)`
    returns an `AsyncFunction` instance (`type(fn).__name__ == "AsyncFunction"`).

    Sibling tests in this suite stub cocoindex at the `sys.modules` boundary
    for LMDB-free isolation; that stubbing reduces `@coco.fn` to a pass-
    through, so the decorated symbol stays a plain async function in those
    test sessions. Both modes satisfy the behavioural contract: the
    decorated symbol is callable + returns an awaitable. Asserting the
    BEHAVIOUR (awaitability) rather than the internal type name keeps
    these tests robust to test-ordering side effects from sys.modules
    stubs in earlier test modules.
    """

    def test_extract_classification_call_returns_awaitable(self):
        """extract_classification(content) returns an awaitable (cocoindex
        AsyncFunction in production / plain async function in stubbed-
        cocoindex tests)."""
        import inspect

        coro = extract_classification("hi")
        try:
            assert inspect.isawaitable(coro), (
                f"extract_classification call must return an awaitable; "
                f"got type {type(coro).__name__!r}"
            )
        finally:
            if hasattr(coro, "close"):
                coro.close()

    def test_extract_qa_form_call_returns_awaitable(self):
        """extract_qa_form(content) returns an awaitable."""
        import inspect

        coro = extract_qa_form("hi")
        try:
            assert inspect.isawaitable(coro), (
                f"extract_qa_form call must return an awaitable; "
                f"got type {type(coro).__name__!r}"
            )
        finally:
            if hasattr(coro, "close"):
                coro.close()

    def test_extract_entity_mentions_call_returns_awaitable(self):
        """extract_entity_mentions(content) returns an awaitable."""
        import inspect

        coro = extract_entity_mentions("hi")
        try:
            assert inspect.isawaitable(coro), (
                f"extract_entity_mentions call must return an awaitable; "
                f"got type {type(coro).__name__!r}"
            )
        finally:
            if hasattr(coro, "close"):
                coro.close()

    def test_extractors_are_directly_awaitable_end_to_end(self):
        """The 3 extractors execute end-to-end via `await` (no .run() or
        .submit() boilerplate per S256 W1 stub-pattern). Patches the SDK
        + actually awaits one — the mocked happy-path JSON validates."""
        mock_client = _make_mock_client(_classification_json())
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_classification("hi"))
        assert isinstance(result, ClassificationExtraction)


# ============================================================================
# CODE-FENCE STRIPPING ({66.16} S295 live-ingest regression)
# ============================================================================


class TestStripCodeFence:
    """`_strip_code_fence` normalises fenced LLM JSON to a bare document."""

    def test_strips_json_language_fence(self):
        assert _strip_code_fence('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_strips_bare_fence(self):
        assert _strip_code_fence('```\n{"a": 1}\n```') == '{"a": 1}'

    def test_noop_on_unfenced(self):
        assert _strip_code_fence('{"a": 1}') == '{"a": 1}'

    def test_preserves_inner_backticks(self):
        # A value containing backticks must survive — only the OUTER fence is
        # stripped (closing-fence trim takes the final ``` at end-of-string).
        assert _strip_code_fence('```json\n{"r": "use `x`"}\n```') == '{"r": "use `x`"}'


class TestExtractorsTolerateFencedResponse:
    """Anthropic intermittently wraps JSON in a ```json … ``` fence; all three
    extractors must strip it before `validate_json`. Mirrors the live
    `extract_qa_form` crash (`json_invalid` 'expected value at line 1 column 1',
    {66.16} S295) that the unit suite missed because every happy-path fixture
    was unfenced."""

    @staticmethod
    def _fence(payload: str) -> str:
        return f"```json\n{payload}\n```"

    def test_classification_tolerates_fenced_response(self):
        mock_client = _make_mock_client(self._fence(_classification_json("policy")))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_classification("doc text"))
        assert isinstance(result, ClassificationExtraction)
        assert result.content_type == "policy"

    def test_qa_form_tolerates_fenced_response(self):
        mock_client = _make_mock_client(self._fence(_qa_form_json()))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_qa_form("doc text"))
        assert isinstance(result, QAFormExtraction)
        assert result.form_metadata.form_type == "pqq"

    def test_entity_mentions_tolerate_fenced_response(self):
        mock_client = _make_mock_client(self._fence(_entity_mentions_json()))
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_entity_mentions("doc text"))
        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(m, EntityMentionExtraction) for m in result)


# ============================================================================
# TRUNCATION GUARD ({73.1} S300 Path-B re-smoke regression)
# ============================================================================


class TestMaxTokensCeiling:
    """The {73.1} ceiling raise: qa_form needs the most headroom (large ITTs
    produce big `qa_pairs` arrays); entity_mentions is moderate; classification
    is bounded. All ceilings stay <= 64k (claude-opus-4-6 output limit). The
    constants are CEILINGS — generosity is free (you only pay for tokens
    actually generated)."""

    def test_per_extractor_ceilings_are_raised_and_within_opus_limit(self):
        from scripts.cocoindex_pipeline.extraction import (
            _MAX_TOKENS_CLASSIFICATION,
            _MAX_TOKENS_ENTITY_MENTIONS,
            _MAX_TOKENS_QA_FORM,
        )

        _OPUS_4_6_OUTPUT_LIMIT = 64000
        # qa_form gets the largest budget (the bug: a charnwood ITT truncated
        # at the old shared 4096 ceiling).
        assert _MAX_TOKENS_QA_FORM == 32768
        assert _MAX_TOKENS_ENTITY_MENTIONS == 16384
        assert _MAX_TOKENS_CLASSIFICATION == 4096
        # Ordering reflects the relative output sizes.
        assert (
            _MAX_TOKENS_CLASSIFICATION
            <= _MAX_TOKENS_ENTITY_MENTIONS
            < _MAX_TOKENS_QA_FORM
        )
        # None may exceed the model's output ceiling.
        for value in (
            _MAX_TOKENS_CLASSIFICATION,
            _MAX_TOKENS_ENTITY_MENTIONS,
            _MAX_TOKENS_QA_FORM,
        ):
            assert 0 < value <= _OPUS_4_6_OUTPUT_LIMIT

    def test_qa_form_requests_its_per_extractor_ceiling(self):
        from scripts.cocoindex_pipeline.extraction import _MAX_TOKENS_QA_FORM

        mock_client = _make_mock_client(_qa_form_json())
        captured: list[Any] = []
        original_stream = mock_client.messages.stream

        def _capture(**kwargs: Any) -> Any:
            captured.append(kwargs)
            return original_stream(**kwargs)

        mock_client.messages.stream = _capture
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            asyncio.run(extract_qa_form("form content"))
        assert captured[0]["max_tokens"] == _MAX_TOKENS_QA_FORM

    def test_entity_mentions_requests_its_per_extractor_ceiling(self):
        from scripts.cocoindex_pipeline.extraction import (
            _MAX_TOKENS_ENTITY_MENTIONS,
        )

        mock_client = _make_mock_client(_entity_mentions_json())
        captured: list[Any] = []
        original_stream = mock_client.messages.stream

        def _capture(**kwargs: Any) -> Any:
            captured.append(kwargs)
            return original_stream(**kwargs)

        mock_client.messages.stream = _capture
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            asyncio.run(extract_entity_mentions("doc text"))
        assert captured[0]["max_tokens"] == _MAX_TOKENS_ENTITY_MENTIONS


class TestTruncationGuard:
    """The {73.1} silent-failure hardening: when the Anthropic response is cut
    off by the `max_tokens` ceiling, the SDK sets `stop_reason='max_tokens'`
    and the body is a TRUNCATED JSON document. Pre-fix this surfaced as a
    cryptic downstream `Invalid JSON: EOF while parsing` from `validate_json`.

    Post-fix each extractor checks `stop_reason` BEFORE validation and raises a
    clear `TruncatedExtractionError` naming the extractor + the token limit, so
    truncation is loud and diagnosable.
    """

    # A deliberately TRUNCATED qa_form payload — valid JSON prefix cut mid-array
    # (exactly the failure shape from op 3d1334ba). If the guard did NOT fire,
    # `validate_json` would raise a JSON-parse error on this — so the test
    # proves the guard intercepts FIRST.
    _TRUNCATED_JSON = '{"form_metadata": {"form_type": "itt", "form_format": "pdf"}, "qa_pairs": [{"question_text": "Describe your'

    def test_extract_classification_raises_clear_error_on_truncation(self):
        from scripts.cocoindex_pipeline.extraction import TruncatedExtractionError

        mock_client = _make_mock_client(
            self._TRUNCATED_JSON, stop_reason="max_tokens"
        )
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(TruncatedExtractionError) as exc_info:
                asyncio.run(extract_classification("doc text"))
        msg = str(exc_info.value)
        assert "extract_classification" in msg
        assert "max_tokens" in msg

    def test_extract_qa_form_raises_clear_error_on_truncation(self):
        from scripts.cocoindex_pipeline.extraction import TruncatedExtractionError

        mock_client = _make_mock_client(
            self._TRUNCATED_JSON, stop_reason="max_tokens"
        )
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(TruncatedExtractionError) as exc_info:
                asyncio.run(extract_qa_form("form content"))
        msg = str(exc_info.value)
        assert "extract_qa_form" in msg
        assert "max_tokens" in msg

    def test_extract_entity_mentions_raises_clear_error_on_truncation(self):
        from scripts.cocoindex_pipeline.extraction import TruncatedExtractionError

        mock_client = _make_mock_client(
            "[{\"entity_text\": \"Acme", stop_reason="max_tokens"
        )
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(TruncatedExtractionError) as exc_info:
                asyncio.run(extract_entity_mentions("doc text"))
        msg = str(exc_info.value)
        assert "extract_entity_mentions" in msg
        assert "max_tokens" in msg

    def test_truncation_error_is_not_a_validation_error(self):
        """The whole point of the guard: truncation must NOT surface as the
        cryptic downstream JSON-parse `ValidationError`. `TruncatedExtractionError`
        is a `ValueError` (so it still propagates through the existing
        non-retryable + Option A flow-scope path) but is NOT a `ValidationError`."""
        from scripts.cocoindex_pipeline.extraction import TruncatedExtractionError

        assert issubclass(TruncatedExtractionError, ValueError)
        assert not issubclass(TruncatedExtractionError, ValidationError)

    def test_normal_stop_reason_validates_as_today(self):
        """An `end_turn` response with well-formed JSON validates normally — the
        guard does not interfere with the happy path."""
        mock_client = _make_mock_client(_qa_form_json(), stop_reason="end_turn")
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_qa_form("form content"))
        assert isinstance(result, QAFormExtraction)
        assert len(result.qa_pairs) == 2


# ============================================================================
# STREAMING FOR LARGE max_tokens (bl-222 — S301 live re-smoke regression)
# ============================================================================


class TestStreamingForLargeMaxTokens:
    """bl-222: bl-221 raised qa_form's `max_tokens` to 32768. The SDK's
    NON-streaming `messages.create(...)` calls
    `_calculate_nonstreaming_timeout(max_tokens, ...)`, which raises
    `ValueError: Streaming is required for operations that may take longer
    than 10 minutes` whenever the request could exceed the 10-minute cap —
    `expected_time = 3600 * max_tokens / 128000`. At 32768 that is 921.6 s >
    600 s, so it fires DETERMINISTICALLY, client-side, before any API call.
    It is NOT a retryable exception, so pre-fix it aborted the doc's whole
    cocoindex ingest (zero rows persist) on EVERY document (extract_qa_form
    runs unconditionally) — regressing both Path-A and Path-B.

    The fix routes all 3 extractors through `messages.stream(...)`, which the
    SDK mandates for large `max_tokens` (and which is what bl-221 wanted:
    large form output without truncation or the 10-min cap)."""

    def test_sdk_nonstreaming_guard_fires_at_qa_form_ceiling(self):
        """FAIL-before witness: the REAL SDK guard raises the
        'Streaming is required' ValueError at the qa_form ceiling (32768) on
        the non-streaming path — this is exactly the hazard bl-222 removes by
        streaming. (Locks in the regression: if a future change reverts to
        `messages.create`, the large ceiling would trip this same guard.)

        Invokes the SDK's own `_calculate_nonstreaming_timeout` directly. The
        method uses no `self` attributes (verified against anthropic 0.79.0),
        so we call it with a throwaway `self` to exercise the genuine guard
        WITHOUT constructing a networked client (which would touch httpx /
        proxy env in the sandbox)."""
        from anthropic._base_client import BaseClient

        from scripts.cocoindex_pipeline.extraction import _MAX_TOKENS_QA_FORM

        with pytest.raises(ValueError, match="Streaming is required"):
            # Second arg models the model's non-streaming output cap (None =
            # rely purely on the >10-min expected-time check, which 32768
            # already exceeds: 3600 * 32768 / 128000 = 921.6 s > 600 s).
            BaseClient._calculate_nonstreaming_timeout(
                object(), _MAX_TOKENS_QA_FORM, None
            )

    def test_qa_form_at_large_ceiling_does_not_raise_streaming_required(self):
        """The whole point of bl-222: running `extract_qa_form` (max_tokens=
        32768) end-to-end must NOT raise the 'Streaming is required'
        ValueError — because the extractor now streams. The happy-path
        streamed message validates normally."""
        mock_client = _make_mock_client(_qa_form_json(), stop_reason="end_turn")
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            # If extract_qa_form still called messages.create, the real SDK
            # guard would raise ValueError('Streaming is required ...') before
            # the mock could intercept. It does not — proving streaming.
            result = asyncio.run(extract_qa_form("large ITT form content"))
        assert isinstance(result, QAFormExtraction)
        # The extractor used the streaming surface, never non-streaming create.
        assert mock_client.messages.stream.call_count == 1
        assert mock_client.messages.stream.call_args.kwargs["max_tokens"] == 32768
        mock_client.messages.create.assert_not_called()

    def test_all_three_extractors_use_streaming_not_create(self):
        """Uniform conversion: classification, qa_form, and entity_mentions
        all route through `messages.stream(...)` and never touch the
        non-streaming `messages.create(...)`."""
        for runner, payload in (
            (extract_classification, _classification_json("policy")),
            (extract_qa_form, _qa_form_json()),
            (extract_entity_mentions, _entity_mentions_json()),
        ):
            mock_client = _make_mock_client(payload)
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                asyncio.run(runner("doc content"))
            assert mock_client.messages.stream.call_count == 1, runner.__name__
            mock_client.messages.create.assert_not_called()

    def test_truncation_guard_still_fires_on_streamed_max_tokens_stop(self):
        """The {73.1} truncation guard must keep firing on the streaming
        path: a streamed final Message whose `stop_reason == 'max_tokens'`
        (even at the large 32768 ceiling) raises `TruncatedExtractionError`
        BEFORE validation — `get_final_message()` carries `.stop_reason`
        exactly as the non-streaming Message did."""
        from scripts.cocoindex_pipeline.extraction import (
            TruncatedExtractionError,
            _MAX_TOKENS_QA_FORM,
        )

        truncated = (
            '{"form_metadata": {"form_type": "itt", "form_format": "pdf"}, '
            '"qa_pairs": [{"question_text": "Describe your'
        )
        mock_client = _make_mock_client(truncated, stop_reason="max_tokens")
        with patch(
            "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            with pytest.raises(TruncatedExtractionError) as exc_info:
                asyncio.run(extract_qa_form("large form content"))
        msg = str(exc_info.value)
        assert "extract_qa_form" in msg
        assert "max_tokens" in msg
        assert str(_MAX_TOKENS_QA_FORM) in msg


# ============================================================================
# PROMPT-CACHE PASSTHROUGH (ID-61.1 — GAP-Q-EX2-002)
# ============================================================================


class TestPromptCachePassthrough:
    """ID-61.1 / GAP-Q-EX2-002: each of the 3 extractors sends its STATIC
    instruction prompt in a system block carrying a
    `cache_control: {"type": "ephemeral"}` breakpoint, with ONLY the
    per-document `content_text` in the uncached user-message suffix. The
    pattern mirrors the proven prior art (`lib/ai/draft.ts` cachedBlocks vs
    uncachedBlocks) and was verified against the pinned anthropic SDK
    (0.79.0: `TextBlockParam.cache_control: Optional[CacheControlEphemeralParam]`,
    and `messages.stream(...)` accepts `system: Union[str, Iterable[TextBlockParam]]`).

    Cache-token observability: `_anthropic_message` logs the usage counters
    (cache_creation_input_tokens / cache_read_input_tokens) from the streamed
    final Message, so a live cache hit is visible in pipeline logs — the
    cache-hit fixture below shows `cache_read_input_tokens > 0` on the second
    call (pattern: test_classify.py::test_cache_tokens_extracted).
    """

    @staticmethod
    def _capture_stream_kwargs(mock_client: MagicMock) -> list[dict[str, Any]]:
        """Wrap `messages.stream` so each call's kwargs are recorded while
        still delegating to the original mock stream-manager factory."""
        captured: list[dict[str, Any]] = []
        original_stream = mock_client.messages.stream

        def _capture(**kwargs: Any) -> Any:
            captured.append(kwargs)
            return original_stream(**kwargs)

        mock_client.messages.stream = _capture
        return captured

    def _cases(self) -> list[tuple[Any, str, str]]:
        from scripts.cocoindex_pipeline.prompts import (
            CLASSIFICATION_PROMPT,
            ENTITY_MENTION_PROMPT,
            Q_A_FORM_PROMPT,
        )

        return [
            (extract_classification, CLASSIFICATION_PROMPT, _classification_json()),
            (extract_qa_form, Q_A_FORM_PROMPT, _qa_form_json()),
            (extract_entity_mentions, ENTITY_MENTION_PROMPT, _entity_mentions_json()),
        ]

    def test_each_extractor_sends_static_prompt_in_cached_system_block(self):
        """All 3 extractor calls carry the static prompt as a single system
        block stamped `cache_control: ephemeral` — byte-for-byte the prompt
        constant, nothing else (no flow-stamp fields, no per-doc content)."""
        content = "Per-document content text only."
        for extractor, prompt, payload in self._cases():
            mock_client = _make_mock_client(payload)
            captured = self._capture_stream_kwargs(mock_client)
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                asyncio.run(extractor(content))
            assert len(captured) == 1, extractor
            assert captured[0]["system"] == [
                {
                    "type": "text",
                    "text": prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ], f"{extractor}: static prompt must be a cached system block"

    def test_per_doc_content_stays_in_uncached_user_message(self):
        """The per-document content_text is the ENTIRE user message — a plain
        (uncached) string with no prompt prefix and no cache_control block."""
        content = "Unique per-document body that must never be cached."
        for extractor, prompt, payload in self._cases():
            mock_client = _make_mock_client(payload)
            captured = self._capture_stream_kwargs(mock_client)
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                asyncio.run(extractor(content))
            assert captured[0]["messages"] == [
                {"role": "user", "content": content}
            ], f"{extractor}: user message must be exactly the uncached content_text"
            # The static prompt must NOT leak into the uncached suffix.
            assert prompt not in captured[0]["messages"][0]["content"]

    def test_flow_stamp_fields_stay_out_of_both_blocks(self):
        """No regression on prompts.py flow-stamp discipline: op_id /
        content_items_id / extracted_at never enter the prompt or the user
        message (they are stamped POST-memo by stamp_extraction_base)."""
        for extractor, prompt, payload in self._cases():
            mock_client = _make_mock_client(payload)
            captured = self._capture_stream_kwargs(mock_client)
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                asyncio.run(extractor("doc body"))
            sent_text = (
                captured[0]["system"][0]["text"]
                + captured[0]["messages"][0]["content"]
            )
            for stamp_field in ("op_id", "content_items_id", "extracted_at"):
                assert stamp_field not in sent_text, (
                    f"{extractor}: flow-stamp field {stamp_field!r} must stay "
                    f"out of the prompt (prompts.py flow-stamp discipline)"
                )

    def test_cache_hit_fixture_shows_cache_read_tokens_on_second_call(
        self, caplog: pytest.LogCaptureFixture
    ):
        """Cache-hit fixture: the first call writes the cache
        (cache_creation_input_tokens > 0, cache_read_input_tokens == 0); the
        second call HITS it (cache_read_input_tokens > 0) — and both surface
        in the `_anthropic_message` usage log so a live run's cache behaviour
        is observable (testStrategy: cache_read_input_tokens > 0 on call 2)."""
        first = _MockMessageResponse(
            _classification_json(),
            usage=_MockUsage(
                cache_creation_input_tokens=2048, cache_read_input_tokens=0
            ),
        )
        second = _MockMessageResponse(
            _classification_json(),
            usage=_MockUsage(
                cache_creation_input_tokens=0, cache_read_input_tokens=2048
            ),
        )
        mock_client = MagicMock(name="AsyncAnthropic_instance")
        mock_client.messages.stream = MagicMock(
            side_effect=[_MockStreamManager(first), _MockStreamManager(second)]
        )
        with caplog.at_level(
            logging.INFO, logger="scripts.cocoindex_pipeline.extraction"
        ):
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                asyncio.run(extract_classification("first document body"))
                asyncio.run(extract_classification("second document body"))
        usage_logs = [
            record.getMessage()
            for record in caplog.records
            if "cache_read_input_tokens" in record.getMessage()
        ]
        assert len(usage_logs) == 2, "one usage log line per extractor call"
        # First call: cache write, no read.
        assert "cache_creation_input_tokens=2048" in usage_logs[0]
        assert "cache_read_input_tokens=0" in usage_logs[0]
        # Second call: cache HIT — cache_read_input_tokens > 0.
        assert "cache_read_input_tokens=2048" in usage_logs[1]

    def test_usage_log_skipped_when_usage_absent(
        self, caplog: pytest.LogCaptureFixture
    ):
        """A Message without `.usage` (defensive: mocks / unexpected SDK
        shapes) must not crash the extractor — the usage log is simply
        omitted."""
        mock_client = _make_mock_client(_classification_json())  # usage=None
        with caplog.at_level(
            logging.INFO, logger="scripts.cocoindex_pipeline.extraction"
        ):
            with patch(
                "scripts.cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
                return_value=mock_client,
            ):
                result = asyncio.run(extract_classification("doc body"))
        assert isinstance(result, ClassificationExtraction)
        assert not any(
            "cache_read_input_tokens" in record.getMessage()
            for record in caplog.records
        )
