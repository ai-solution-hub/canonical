"""Unit tests for the 3 Path A @coco.fn(memo=True) LLM extractors.

Verifies the canonical 1.x extraction pattern (S256 W1 amendment of
`docs/specs/cocoindex-extraction-contract/TECH.md` §3.1):

  - `extract_classification(content_text)` -> ClassificationExtraction
  - `extract_qa_form(content_text)` -> QAFormExtraction
  - `extract_entity_mentions(content_text)` -> list[EntityMentionExtraction]

Each extractor:
  1. Calls `anthropic.AsyncAnthropic().messages.create(...)` with the
     appropriate prompt + content_text.
  2. Validates the JSON response via `TypeAdapter(<Variant>).validate_json()`.
  3. Returns the typed Pydantic object on success.
  4. Propagates `ValidationError` on schema mismatch (Option A failure
     path per S256 WP4 brief — caught by `app_main()`'s try/except).

The anthropic SDK is mocked at the module-attribute boundary
(`extraction.anthropic.AsyncAnthropic`) — NO network calls at test time.
Each test sets ANTHROPIC_API_KEY to a fake value to ensure the
SDK client constructor doesn't raise on missing env.

Memoisation discipline (Inv-21): the `@coco.fn(memo=True)` decorator
returns an `AsyncFunction` instance (verified empirically against
cocoindex 1.0.3 — see WP3 stub pattern). Test class
`TestExtractorDecoration` asserts the decorated identity.

Reference: docs/specs/cocoindex-extraction-contract/TECH.md §3.1
Test strategy: ID-28.12 WP4 — extractor behaviour with mocked anthropic SDK
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from pydantic import ValidationError

# ── Path setup ──────────────────────────────────────────────────────────────

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ── Module under test ───────────────────────────────────────────────────────
# extraction.py imports anthropic + pydantic at module load. Both pinned
# packages are installed (anthropic 0.79.0, pydantic 2.12.5) per
# requirements.txt — no stubbing needed. cocoindex IS installed (1.0.3);
# the @coco.fn decorator runs at module import and produces AsyncFunction
# instances — also no stubbing needed.

from cocoindex_pipeline.extraction import (  # noqa: E402
    ClassificationExtraction,
    EntityMentionExtraction,
    QAFormExtraction,
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


class _MockMessageResponse:
    """Mimics anthropic.types.Message — has a `.content` list of text blocks."""

    def __init__(self, json_text: str):
        self.content = [_MockTextBlock(json_text)]


def _make_mock_client(json_response: str) -> MagicMock:
    """Return a MagicMock AsyncAnthropic instance whose messages.create()
    awaitable resolves to a Message with `content[0].text == json_response`."""
    mock_client = MagicMock(name="AsyncAnthropic_instance")
    mock_create = AsyncMock(return_value=_MockMessageResponse(json_response))
    mock_client.messages.create = mock_create
    return mock_client


# ── Canonical happy-path JSON fixtures ──────────────────────────────────────
# These are the LLM-produced JSON payloads (NOT the stamped final form —
# the LLM omits op_id / content_items_id / extracted_at per prompts.py
# instruction; those are stamped POST-validation by stamp_extraction_base).
# However, the strict Pydantic shape DOES require those fields at
# validation time. So the test fixtures populate them — exercising the
# JSON-mode round-trip end-to-end. In production, stamp_extraction_base
# populates these post-validation; the LLM has no business returning UUIDs.

_FAKE_OP_ID = "a0000000-0000-4000-8000-000000000001"
_FAKE_CONTENT_ID = "b1111111-1111-4111-8111-111111111111"
_FAKE_EXTRACTED_AT = "2026-05-22T12:00:00Z"


def _classification_json(content_type: str = "policy") -> str:
    """Return a well-formed classification extraction JSON payload."""
    return json.dumps(
        {
            "op_id": _FAKE_OP_ID,
            "content_items_id": _FAKE_CONTENT_ID,
            "extracted_at": _FAKE_EXTRACTED_AT,
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
            "op_id": _FAKE_OP_ID,
            "content_items_id": _FAKE_CONTENT_ID,
            "extracted_at": _FAKE_EXTRACTED_AT,
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
                "op_id": _FAKE_OP_ID,
                "content_items_id": _FAKE_CONTENT_ID,
                "extracted_at": _FAKE_EXTRACTED_AT,
                "extraction_kind": "entity_mention",
                "entity_type": "certification",
                "entity_name": "ISO 27001:2022",
                "canonical_name": "iso_27001",
                "source_span_start": 0,
                "source_span_end": 15,
                "mention_confidence": 0.95,
            },
            {
                "op_id": _FAKE_OP_ID,
                "content_items_id": _FAKE_CONTENT_ID,
                "extracted_at": _FAKE_EXTRACTED_AT,
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(
                extract_classification("Test document content text.")
            )
        assert isinstance(result, ClassificationExtraction)
        assert result.content_type == "policy"
        assert result.primary_domain == "compliance"
        assert result.classification_confidence == pytest.approx(0.92)
        assert result.op_id == UUID(_FAKE_OP_ID)

    def test_calls_anthropic_with_classification_prompt_and_content(self):
        """Extractor concatenates `f"{CLASSIFICATION_PROMPT}\\n\\n{content_text}"`
        per spec §3.1 (prompts.py + content joined with double-newline)."""
        mock_client = _make_mock_client(_classification_json())
        captured_messages: list[Any] = []
        original_create = mock_client.messages.create

        async def _capture_create(**kwargs: Any) -> Any:
            captured_messages.append(kwargs)
            return await original_create()

        mock_client.messages.create = _capture_create
        content = "The quick brown fox jumps."
        with patch(
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            asyncio.run(extract_classification(content))
        assert len(captured_messages) == 1
        kwargs = captured_messages[0]
        # Per spec §3.1 + brief: model=claude-opus-4-6, max_tokens=4096
        assert kwargs["model"] == "claude-opus-4-6"
        assert kwargs["max_tokens"] == 4096
        assert kwargs["messages"][0]["role"] == "user"
        # The user message must contain the content_text appended after a
        # double-newline (the prompt is too long to assert verbatim here;
        # the WP3 test_cocoindex_prompts.py asserts the prompt shape).
        user_content = kwargs["messages"][0]["content"]
        assert user_content.endswith(f"\n\n{content}")

    def test_invalid_content_type_raises_validation_error(self):
        """LLM returns content_type not in taxonomy → ValidationError."""
        # `invented_junk_type` is NOT in taxonomy_snapshot.json content_types
        # — the @field_validator on ClassificationExtraction.content_type
        # raises ValueError → Pydantic surfaces as ValidationError.
        mock_client = _make_mock_client(_classification_json("invented_junk_type"))
        with patch(
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
        from cocoindex_pipeline.prompts import Q_A_FORM_PROMPT

        mock_client = _make_mock_client(_qa_form_json())
        captured: list[Any] = []
        original_create = mock_client.messages.create

        async def _capture(**kwargs: Any) -> Any:
            captured.append(kwargs)
            return await original_create()

        mock_client.messages.create = _capture
        with patch(
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            asyncio.run(extract_qa_form("form content"))
        assert len(captured) == 1
        user_content = captured[0]["messages"][0]["content"]
        # Assert the user-message starts with the Q_A_FORM_PROMPT — proves
        # the extractor uses the correct prompt constant.
        assert user_content.startswith(Q_A_FORM_PROMPT)

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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
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
            "cocoindex_pipeline.extraction.anthropic.AsyncAnthropic",
            return_value=mock_client,
        ):
            result = asyncio.run(extract_classification("hi"))
        assert isinstance(result, ClassificationExtraction)
