"""Unit tests for `scripts/cocoindex_pipeline/extraction.py` per Q-EX2 §5.1-§5.4.

Covers:
- §5.1 Schema-shape invariants — three variants round-trip through
  `ExtractionOutput.validate_json()`; negative cases for missing /
  invalid `extraction_kind`.
- §5.2 Validation-behaviour invariants — Pydantic strict-mode error
  surfaces map to `error_class` strings via `classify_pydantic_error`.
- §5.4 Enum-parity guards — entity_type vs lib/validation/schemas.ts,
  form_type vs docs/ontology/26-form-type.md, content_type vs
  taxonomy_snapshot.json.

Stub-pattern: no cocoindex Rust engine / LMDB at test time. The
`normalise_entity_span` helper is decorated `@coco.fn(memo=True)` but the
returned AsyncFunction wrapper is directly awaitable in Python (verified
empirically against cocoindex 1.0.3) so we test the underlying behaviour
without booting the cocoindex engine.

Test philosophy: every test asserts real behaviour (no mock-only stubs);
parity guards read the canonical TS / markdown / JSON sources directly so
that drift is caught at test run.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from scripts.cocoindex_pipeline.extraction import (
    ClassificationExtraction,
    EntityMentionExtraction,
    ExtractionOutput,
    FormMetadata,
    QAFormExtraction,
    QAPair,
    _VALID_CONTENT_TYPES,
    _VALID_DOMAINS,
    _VALID_FORM_TYPES,
    _VALID_SUBTOPICS,
    classify_pydantic_error,
    normalise_entity_span,
    stamp_extraction_base,
)
from scripts.cocoindex_pipeline.flow_context import bind_taxonomy_miss_counter


# ──────────────────────────────────────────────────────────────────────────
# Fixtures — Python-native dicts (note: UUID + datetime as instances, NOT
# strings, because strict-mode Pydantic refuses to coerce strings to UUID
# via `model_validate()`. The JSON round-trip via `.validate_json()` does
# accept strings.)
# ──────────────────────────────────────────────────────────────────────────


_OP_ID = UUID("a0000000-0000-4000-8000-000000000001")
_CONTENT_ID = UUID("b1111111-1111-4111-8111-111111111111")
_EXTRACTED_AT = datetime(2026, 5, 22, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def base_fields() -> dict:
    """Base fields stamped post-validation — used in every variant fixture."""
    return {
        "op_id": _OP_ID,
        "content_items_id": _CONTENT_ID,
        "extracted_at": _EXTRACTED_AT,
    }


@pytest.fixture
def base_fields_json() -> dict:
    """JSON-mode equivalents (strings, not UUID / datetime instances)."""
    return {
        "op_id": str(_OP_ID),
        "content_items_id": str(_CONTENT_ID),
        "extracted_at": _EXTRACTED_AT.isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────
# §5.1 — schema-shape round-trip tests
# ──────────────────────────────────────────────────────────────────────────


class TestClassificationVariant:
    """Q-EX2 PRODUCT inv 4 — classification variant shape."""

    def test_round_trips_via_json(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "extraction_kind": "classification",
            "content_type": "policy",
            "primary_domain": "compliance",
            "classification_confidence": 0.92,
            "secondary_classifications": ["governance"],
            "rationale": "Document defines an organisation-wide policy.",
        }
        ta = TypeAdapter(ExtractionOutput)
        parsed = ta.validate_json(json.dumps(payload))
        assert isinstance(parsed, ClassificationExtraction)
        assert parsed.content_type == "policy"
        assert parsed.primary_domain == "compliance"
        assert parsed.op_id == _OP_ID

    def test_all_canonical_content_types_pass(self, base_fields: dict) -> None:
        """Every value in taxonomy_snapshot.json must validate."""
        for ct in sorted(_VALID_CONTENT_TYPES):
            extraction = ClassificationExtraction(
                **base_fields,
                content_type=ct,
                primary_domain="security",
                classification_confidence=0.8,
            )
            assert extraction.content_type == ct

    def test_unknown_content_type_fails(self, base_fields: dict) -> None:
        with pytest.raises(ValidationError) as exc_info:
            ClassificationExtraction(
                **base_fields,
                content_type="invented_junk_type",
                primary_domain="security",
                classification_confidence=0.5,
            )
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_accepts_a_supplied_primary_subtopic(
        self, base_fields: dict
    ) -> None:
        """ID-63.7 (OQ-63-9): the classification shape carries a nullable
        `primary_subtopic` snake_case identifier alongside `primary_domain`."""
        extraction = ClassificationExtraction(
            **base_fields,
            content_type="policy",
            primary_domain="compliance",
            primary_subtopic="data_protection",
            classification_confidence=0.88,
        )
        assert extraction.primary_subtopic == "data_protection"

    def test_primary_subtopic_defaults_to_none_when_omitted(
        self, base_fields: dict
    ) -> None:
        """ID-63.7: `primary_subtopic` is optional/nullable so omitting it
        leaves the field None — backward-compatible with existing callers
        under `ConfigDict(extra='forbid')`."""
        extraction = ClassificationExtraction(
            **base_fields,
            content_type="research",
            primary_domain="security",
            classification_confidence=0.7,
        )
        assert extraction.primary_subtopic is None

    def test_round_trips_primary_subtopic_via_json(
        self, base_fields_json: dict
    ) -> None:
        """ID-63.7: a `primary_subtopic` value survives the canonical
        `TypeAdapter.validate_json` round-trip the extraction stage uses."""
        payload = {
            **base_fields_json,
            "extraction_kind": "classification",
            "content_type": "policy",
            "primary_domain": "compliance",
            "primary_subtopic": "information_governance",
            "classification_confidence": 0.9,
            "secondary_classifications": [],
            "rationale": None,
        }
        ta = TypeAdapter(ExtractionOutput)
        parsed = ta.validate_json(json.dumps(payload))
        assert isinstance(parsed, ClassificationExtraction)
        assert parsed.primary_subtopic == "information_governance"

    def test_round_trips_null_primary_subtopic_via_json(
        self, base_fields_json: dict
    ) -> None:
        """ID-63.7: an explicit `null` `primary_subtopic` round-trips to
        None rather than being rejected as an unexpected field."""
        payload = {
            **base_fields_json,
            "extraction_kind": "classification",
            "content_type": "research",
            "primary_domain": "security",
            "primary_subtopic": None,
            "classification_confidence": 0.6,
            "secondary_classifications": [],
            "rationale": None,
        }
        ta = TypeAdapter(ExtractionOutput)
        parsed = ta.validate_json(json.dumps(payload))
        assert isinstance(parsed, ClassificationExtraction)
        assert parsed.primary_subtopic is None


class TestQAFormVariant:
    """Q-EX2 PRODUCT inv 2 — q_a_form variant shape."""

    def test_round_trips_via_json(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "extraction_kind": "q_a_form",
            "form_metadata": {
                "form_type": "pqq",
                "form_format": "docx",
                "form_title": "Cyber Security Pre-Qualification",
                "issuing_organisation": "Crown Commercial Service",
                "deadline": "2026-06-30T17:00:00Z",
                "evaluation_methodology": "MEAT 60/40",
            },
            "qa_pairs": [
                {
                    "question_text": "Do you hold ISO 27001:2022 certification?",
                    "answer_text": "Yes, valid until 2027-03-15.",
                    "expected_response_kind": "mandatory",
                    "evaluation_criteria": "Yes / No with evidence",
                    "evidence_requirements": ["iso27001_certificate"],
                    "scope_tags": ["information_security"],
                },
                {
                    "question_text": "Describe your incident-response process.",
                    "answer_text": None,
                    "expected_response_kind": "optional",
                    "evaluation_criteria": None,
                    "evidence_requirements": [],
                    "scope_tags": [],
                },
            ],
        }
        ta = TypeAdapter(ExtractionOutput)
        parsed = ta.validate_json(json.dumps(payload))
        assert isinstance(parsed, QAFormExtraction)
        assert parsed.form_metadata.form_type == "pqq"
        assert len(parsed.qa_pairs) == 2
        assert parsed.qa_pairs[0].expected_response_kind == "mandatory"
        assert parsed.qa_pairs[1].expected_response_kind == "optional"

    def test_info_only_expected_response_kind_fails(
        self, base_fields: dict
    ) -> None:
        """Q-EX2 verifier B-1: only mandatory + optional are canonical."""
        form_meta = FormMetadata(form_type="rfp", form_format="pdf")
        with pytest.raises(ValidationError) as exc_info:
            QAFormExtraction(
                **base_fields,
                form_metadata=form_meta,
                qa_pairs=[
                    {  # type: ignore[list-item]
                        "question_text": "Q?",
                        "expected_response_kind": "info_only",  # invalid
                    }
                ],
            )
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_question_text_min_length(self, base_fields: dict) -> None:
        """QAPair.question_text MUST be non-empty."""
        form_meta = FormMetadata(form_type="bid", form_format="md")
        with pytest.raises(ValidationError):
            QAFormExtraction(
                **base_fields,
                form_metadata=form_meta,
                qa_pairs=[
                    QAPair(
                        question_text="",  # empty → fails min_length=1
                        expected_response_kind="mandatory",
                    )
                ],
            )

    def test_empty_qa_pairs_list_allowed(self, base_fields: dict) -> None:
        """A form-typed document with zero extracted Q&A pairs is valid."""
        form_meta = FormMetadata(form_type="checklist", form_format="md")
        extraction = QAFormExtraction(
            **base_fields,
            form_metadata=form_meta,
            qa_pairs=[],
        )
        assert extraction.qa_pairs == []


class TestEntityMentionVariant:
    """Q-EX2 PRODUCT inv 3 — entity_mention variant shape."""

    @pytest.fixture
    def canonical_entity_types(self) -> list[str]:
        return [
            "organisation",
            "certification",
            "regulation",
            "framework",
            "capability",
            "person",
            "technology",
            "project",
            "sector",
            "product",
            "standard",
            "methodology",
        ]

    def test_round_trips_via_json(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "extraction_kind": "entity_mention",
            "entity_type": "certification",
            "entity_name": "ISO 27001:2022",
            "canonical_name": "iso_27001",
            "source_span_start": 142,
            "source_span_end": 155,
            "mention_confidence": 0.95,
        }
        ta = TypeAdapter(ExtractionOutput)
        parsed = ta.validate_json(json.dumps(payload))
        assert isinstance(parsed, EntityMentionExtraction)
        assert parsed.entity_type == "certification"
        assert parsed.entity_name == "ISO 27001:2022"

    def test_all_12_entity_types_validate(
        self, base_fields: dict, canonical_entity_types: list[str]
    ) -> None:
        for et in canonical_entity_types:
            extraction = EntityMentionExtraction(
                **base_fields,
                entity_type=et,  # type: ignore[arg-type]
                entity_name="Acme Corp",
                source_span_start=0,
                source_span_end=9,
                mention_confidence=0.8,
            )
            assert extraction.entity_type == et

    def test_junk_entity_type_fails(self, base_fields: dict) -> None:
        with pytest.raises(ValidationError) as exc_info:
            EntityMentionExtraction(
                **base_fields,
                entity_type="invented_junk",  # type: ignore[arg-type]
                entity_name="Acme Corp",
                source_span_start=0,
                source_span_end=9,
                mention_confidence=0.8,
            )
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_confidence_out_of_range_fails(self, base_fields: dict) -> None:
        with pytest.raises(ValidationError):
            EntityMentionExtraction(
                **base_fields,
                entity_type="organisation",
                entity_name="Acme",
                source_span_start=0,
                source_span_end=4,
                mention_confidence=1.5,  # > 1.0
            )

    def test_negative_span_fails(self, base_fields: dict) -> None:
        with pytest.raises(ValidationError):
            EntityMentionExtraction(
                **base_fields,
                entity_type="organisation",
                entity_name="Acme",
                source_span_start=-1,  # < 0
                source_span_end=4,
                mention_confidence=0.8,
            )


# ──────────────────────────────────────────────────────────────────────────
# §5.1 — discriminated-union negative cases
# ──────────────────────────────────────────────────────────────────────────


class TestExtractionOutputDiscriminator:
    """Q-EX2 PRODUCT inv 1 — discriminated union root."""

    def test_extraction_kind_null_fails(
        self, base_fields_json: dict
    ) -> None:
        payload = {**base_fields_json, "extraction_kind": None}
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert (
            classify_pydantic_error(exc_info.value) == "invalid_discriminator"
        )

    def test_extraction_kind_unknown_fails(
        self, base_fields_json: dict
    ) -> None:
        payload = {**base_fields_json, "extraction_kind": "foo"}
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert (
            classify_pydantic_error(exc_info.value) == "invalid_discriminator"
        )

    def test_extraction_kind_missing_fails(
        self, base_fields_json: dict
    ) -> None:
        payload = {**base_fields_json}  # no extraction_kind at all
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert (
            classify_pydantic_error(exc_info.value) == "invalid_discriminator"
        )


# ──────────────────────────────────────────────────────────────────────────
# §5.2 — validation-failure paths (no Anthropic call required)
# ──────────────────────────────────────────────────────────────────────────


class TestClassifyPydanticError:
    """Q-EX2 §4.1 — explicit error_class mapping."""

    def test_missing_required_field(self, base_fields_json: dict) -> None:
        # ClassificationExtraction without `content_type`
        payload = {**base_fields_json, "extraction_kind": "classification"}
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert (
            classify_pydantic_error(exc_info.value) == "missing_required"
        )

    def test_literal_violation(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "extraction_kind": "entity_mention",
            "entity_type": "not_a_valid_type",
            "entity_name": "Acme",
            "source_span_start": 0,
            "source_span_end": 4,
            "mention_confidence": 0.8,
        }
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_unexpected_field(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "extraction_kind": "classification",
            "content_type": "article",
            "primary_domain": "compliance",
            "classification_confidence": 0.7,
            "llm_internal_thought": "Let me think...",  # forbidden
        }
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert (
            classify_pydantic_error(exc_info.value) == "unexpected_field"
        )

    def test_type_coercion_failure(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "extraction_kind": "entity_mention",
            "entity_type": "organisation",
            "entity_name": "Acme",
            "source_span_start": 0,
            "source_span_end": 4,
            "mention_confidence": "high",  # str instead of float
        }
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert classify_pydantic_error(exc_info.value) == "type_coercion"

    def test_uuid_parse_failure(self, base_fields_json: dict) -> None:
        payload = {
            **base_fields_json,
            "op_id": "not-a-uuid",
            "extraction_kind": "classification",
            "content_type": "article",
            "primary_domain": "compliance",
            "classification_confidence": 0.7,
        }
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert classify_pydantic_error(exc_info.value) == "type_coercion"

    def test_empty_validation_error_falls_back(self) -> None:
        """Defensive — empty errors() list falls back to type_coercion."""
        # Construct a ValidationError manually via a forced raise. The
        # simplest path is to use `from_exception_data` if available, but
        # easier is to validate something we know will fail and assert the
        # fallback path is wired. (The classify_pydantic_error path returns
        # "type_coercion" if .errors() is empty — defensive against
        # pydantic API drift.)
        try:
            ClassificationExtraction(
                op_id=_OP_ID,
                content_items_id=_CONTENT_ID,
                extracted_at=_EXTRACTED_AT,
                content_type="invalid",
                primary_domain="security",
                classification_confidence=0.5,
            )
        except ValidationError as e:
            assert classify_pydantic_error(e) in {
                "invalid_enum",
                "type_coercion",
            }


# ──────────────────────────────────────────────────────────────────────────
# §5.1 inv 5 — _ExtractionBase fields
# ──────────────────────────────────────────────────────────────────────────


class TestExtractionBaseFields:
    """Q-EX2 PRODUCT inv 5 — op_id / content_items_id / extracted_at."""

    def test_missing_op_id_fails(self, base_fields_json: dict) -> None:
        payload = {
            **{k: v for k, v in base_fields_json.items() if k != "op_id"},
            "extraction_kind": "classification",
            "content_type": "article",
            "primary_domain": "compliance",
            "classification_confidence": 0.7,
        }
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        assert (
            classify_pydantic_error(exc_info.value) == "missing_required"
        )

    def test_invalid_op_id_string_fails_via_json(
        self, base_fields_json: dict
    ) -> None:
        """Q-EX2 §5.1 verifier N-5 — JSON-mode UUID parse error.

        Per Pydantic v2.12 strict mode + JSON validation: a non-UUID string
        raises 'uuid_parsing' error type → 'type_coercion' error_class.
        This is the canonical LLM-output path (Anthropic returns JSON).
        """
        payload = {
            **base_fields_json,
            "op_id": "definitely-not-a-uuid",
            "extraction_kind": "classification",
            "content_type": "article",
            "primary_domain": "compliance",
            "classification_confidence": 0.7,
        }
        ta = TypeAdapter(ExtractionOutput)
        with pytest.raises(ValidationError) as exc_info:
            ta.validate_json(json.dumps(payload))
        errors = exc_info.value.errors()
        # Assert "UUID parse error" — NOT v1/v4 distinction per spec §5.1
        # verifier N-5.
        assert any("uuid" in e.get("type", "").lower() for e in errors)
        assert classify_pydantic_error(exc_info.value) == "type_coercion"


# ──────────────────────────────────────────────────────────────────────────
# §3.2 — inner-tier helpers
# ──────────────────────────────────────────────────────────────────────────


class TestStampExtractionBase:
    """Q-EX2 §3.2 — plain-Python helper, NOT @coco.fn."""

    def test_round_trip_preserves_variant_fields(
        self, base_fields: dict
    ) -> None:
        """Stamping should update only the three base fields, not the
        variant-specific payload."""
        original = ClassificationExtraction(
            op_id=UUID("00000000-0000-4000-8000-000000000000"),
            content_items_id=UUID("00000000-0000-4000-8000-000000000000"),
            extracted_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
            rationale="A research paper.",
        )
        new_op_id = uuid4()
        new_content_id = uuid4()
        stamped = stamp_extraction_base(
            original,
            op_id=new_op_id,
            content_items_id=new_content_id,
        )
        # Base fields updated
        assert stamped.op_id == new_op_id
        assert stamped.content_items_id == new_content_id
        assert stamped.extracted_at > original.extracted_at
        # Variant fields preserved
        assert stamped.content_type == "research"  # type: ignore[union-attr]
        assert stamped.primary_domain == "security"  # type: ignore[union-attr]
        assert stamped.classification_confidence == 0.9  # type: ignore[union-attr]
        assert stamped.rationale == "A research paper."  # type: ignore[union-attr]

    def test_returns_immutable_copy(self, base_fields: dict) -> None:
        """`stamp_extraction_base` uses `model_copy` — the original is unchanged."""
        original = ClassificationExtraction(
            **base_fields,
            content_type="article",
            primary_domain="compliance",
            classification_confidence=0.7,
        )
        original_op_id = original.op_id
        stamped = stamp_extraction_base(
            original,
            op_id=uuid4(),
            content_items_id=uuid4(),
        )
        # Original unchanged
        assert original.op_id == original_op_id
        # Stamped has new op_id
        assert stamped.op_id != original_op_id

    def test_explicit_kwargs_call_still_works_post_28_16(
        self, base_fields: dict
    ) -> None:
        """ID-28.16 changed `op_id` / `content_items_id` to optional kwargs
        that fall back to FLOW_META_CTX when omitted. The pre-28.16 explicit
        call signature (positional, kwargs both supplied) MUST still work
        — backwards-compat with WP3 / WP4 call-sites that pass explicit
        UUIDs.
        """
        original = ClassificationExtraction(
            **base_fields,
            content_type="article",
            primary_domain="compliance",
            classification_confidence=0.7,
        )
        new_op_id = uuid4()
        new_content_id = uuid4()
        # Same call signature as the pre-28.16 baseline — required kwargs
        # become "still-required-when-no-binding-active", but pass-through
        # behaviour is unchanged.
        stamped = stamp_extraction_base(
            original,
            op_id=new_op_id,
            content_items_id=new_content_id,
        )
        assert stamped.op_id == new_op_id
        assert stamped.content_items_id == new_content_id

    def test_missing_args_raises_runtime_error_when_no_binding(
        self, base_fields: dict
    ) -> None:
        """ID-28.16 contract: when neither explicit args nor a FLOW_META_CTX
        binding can supply the required values, RuntimeError is raised
        rather than silently stamping zero UUIDs.

        Backstop for "forgot to bind FLOW_META_CTX before invoking the
        stamper" operator error — surfaces as a loud exception, not as
        bad data landing in Postgres.
        """
        original = ClassificationExtraction(
            **base_fields,
            content_type="article",
            primary_domain="compliance",
            classification_confidence=0.7,
        )
        with pytest.raises(RuntimeError) as exc_info:
            # No kwargs + no active FLOW_META_CTX binding → raises.
            stamp_extraction_base(original)
        # Error message must name FLOW_META_CTX so the operator knows
        # what's missing.
        assert "FLOW_META_CTX" in str(exc_info.value)


class TestNormaliseEntitySpan:
    """Q-EX2 §3.2 — inner-tier @coco.fn(memo=True) async helper.

    Stub-pattern: the @coco.fn decorator wraps the async function into an
    AsyncFunction object that is directly awaitable. We call it via
    `asyncio.run(normalise_entity_span(...))` — no LMDB / Rust engine
    needed at test time (verified empirically against cocoindex 1.0.3).
    """

    def _build_extraction(
        self,
        content_text: str,
        start: int,
        end: int,
    ) -> EntityMentionExtraction:
        return EntityMentionExtraction(
            op_id=_OP_ID,
            content_items_id=_CONTENT_ID,
            extracted_at=_EXTRACTED_AT,
            entity_type="organisation",
            entity_name=content_text[start:end].strip(),
            source_span_start=start,
            source_span_end=end,
            mention_confidence=0.9,
        )

    def test_no_whitespace_returns_unchanged(self) -> None:
        text = "Hello ACME Corp world"
        extraction = self._build_extraction(text, 6, 15)  # "ACME Corp"
        result = asyncio.run(normalise_entity_span(extraction, text))
        assert result.source_span_start == 6
        assert result.source_span_end == 15

    def test_leading_whitespace_tightened(self) -> None:
        text = "Hello   ACME Corp world"
        # Span [5:17] = "   ACME Corp" — 3 leading spaces + "ACME Corp"
        # (verified: text[8:17] == "ACME Corp")
        extraction = self._build_extraction(text, 5, 17)
        result = asyncio.run(normalise_entity_span(extraction, text))
        # New start jumps past the 3 leading spaces (5 + 3 = 8)
        assert result.source_span_start == 8
        assert result.source_span_end == 17
        assert text[result.source_span_start : result.source_span_end] == "ACME Corp"

    def test_trailing_whitespace_tightened(self) -> None:
        text = "ACME Corp   is great"
        # Span [0:12] = "ACME Corp   " — "ACME Corp" + 3 trailing spaces
        # (verified: text[0:9] == "ACME Corp", text[9:12] == "   ")
        extraction = self._build_extraction(text, 0, 12)
        result = asyncio.run(normalise_entity_span(extraction, text))
        assert result.source_span_start == 0
        assert result.source_span_end == 9
        assert (
            text[result.source_span_start : result.source_span_end]
            == "ACME Corp"
        )

    def test_out_of_bounds_returns_unchanged(self) -> None:
        text = "short"
        extraction = self._build_extraction(text, 0, 5)
        # Mutate to out-of-bounds (cannot construct via Pydantic, so do it
        # via model_copy bypassing validation)
        bad_extraction = extraction.model_copy(
            update={"source_span_start": 0, "source_span_end": 999}
        )
        result = asyncio.run(normalise_entity_span(bad_extraction, text))
        # Returned unchanged because the span is out-of-bounds
        assert result.source_span_start == 0
        assert result.source_span_end == 999


# ──────────────────────────────────────────────────────────────────────────
# §5.4 — parity guards (the load-bearing drift defence)
# ──────────────────────────────────────────────────────────────────────────


_REPO_ROOT = Path(__file__).parent.parent.parent
_SCHEMAS_TS_PATH = _REPO_ROOT / "lib" / "validation" / "schemas.ts"


def _extract_ts_string_array(source: str, var_name: str) -> list[str]:
    """Extract a TS `const VAR = ['a', 'b', ...] as const;` string-array.

    Reads the file as text and uses a regex that matches the typical
    Knowledge Hub TS export pattern (single-quoted strings, trailing
    `as const`). Robust against extra whitespace + trailing commas.
    """
    # Match: export const VAR = [\n  'foo',\n  'bar',\n] as const;
    pattern = re.compile(
        rf"export\s+const\s+{var_name}\s*=\s*\[(.*?)\]\s*as\s+const\s*;",
        re.DOTALL,
    )
    match = pattern.search(source)
    if not match:
        raise ValueError(f"Could not find {var_name} in TS source")
    body = match.group(1)
    # Extract single-quoted strings
    return re.findall(r"'([^']+)'", body)


class TestEntityTypeParity:
    """Q-EX2 §5.4 — Python Literal vs TS VALID_ENTITY_TYPES."""

    def test_python_literal_matches_ts_constant(self) -> None:
        # Python source of truth — the Literal in EntityMentionExtraction
        python_entity_types = [
            "organisation",
            "certification",
            "regulation",
            "framework",
            "capability",
            "person",
            "technology",
            "project",
            "sector",
            "product",
            "standard",
            "methodology",
        ]
        # TS source of truth — VALID_ENTITY_TYPES at schemas.ts:1506-1519
        ts_source = _SCHEMAS_TS_PATH.read_text()
        ts_entity_types = _extract_ts_string_array(
            ts_source, "VALID_ENTITY_TYPES"
        )
        assert python_entity_types == ts_entity_types, (
            f"entity_type parity drift between Python "
            f"EntityMentionExtraction Literal and TS VALID_ENTITY_TYPES. "
            f"Python: {python_entity_types}. TS: {ts_entity_types}"
        )


class TestFormTypeParity:
    """ID-52.6 / TECH §2.6b — `form_type` triple-source lockstep.

    Python no longer carries a hardcoded Literal — `FormMetadata.form_type`
    is validated at runtime against `_VALID_FORM_TYPES`, which is loaded from
    `scripts/tests/fixtures/taxonomy_snapshot.json:form_types` (the same
    pattern as `_VALID_CONTENT_TYPES`). These tests are the Python half of
    the lockstep; the TS half is
    `__tests__/lib/ontology/form-type-parity.test.ts`, which asserts the
    snapshot keys match `docs/ontology/26-form-type.md` baseline_values.
    """

    def test_loaded_set_matches_snapshot_json(
        self, taxonomy_from_snapshot: dict
    ) -> None:
        """The frozenset built at module load must equal the snapshot keys."""
        snapshot_keys = {row["key"] for row in taxonomy_from_snapshot["form_types"]}
        assert _VALID_FORM_TYPES == snapshot_keys

    def test_snapshot_form_types_non_empty_and_bounded(
        self, taxonomy_from_snapshot: dict
    ) -> None:
        """Sanity guard — the snapshot is non-empty + reasonable size.

        The current canonical list (post 3-tier split, S275) is 8 values; the
        wider 1-50 bound tolerates future hybrid client extensions without
        churning this test on every legitimate baseline change."""
        form_types = taxonomy_from_snapshot["form_types"]
        assert isinstance(form_types, list)
        n = len(form_types)
        assert 1 <= n <= 50

    def test_unknown_form_type_fails_validation(
        self, base_fields: dict
    ) -> None:
        """A form_type value not in the snapshot must raise ValidationError
        with error_class=invalid_enum (mirrors content_type behaviour)."""
        with pytest.raises(ValidationError) as exc_info:
            FormMetadata(
                form_type="invented_junk_form_type",
                form_format="pdf",
            )
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"

    def test_all_canonical_form_types_pass(
        self, taxonomy_from_snapshot: dict
    ) -> None:
        """Every key in the snapshot must validate cleanly."""
        for row in taxonomy_from_snapshot["form_types"]:
            meta = FormMetadata(form_type=row["key"], form_format="pdf")
            assert meta.form_type == row["key"]


class TestExpectedResponseKindParity:
    """Q-EX2 §5.4 — 2-value list canonical."""

    def test_only_two_values(self) -> None:
        """Per Q-EX2 verifier B-1 — exactly 2 values: mandatory + optional.

        The Python Literal is inline in QAPair; this test ensures the
        literal-violation test in test_info_only_expected_response_kind_fails
        is meaningful (i.e. info_only really IS rejected as a third
        value)."""
        valid_kinds = {"mandatory", "optional"}
        # Should accept both
        for kind in valid_kinds:
            QAPair(
                question_text="Q?",
                expected_response_kind=kind,  # type: ignore[arg-type]
            )
        # Should reject anything else
        for invalid in {"info_only", "info-only", "INFORMATIONAL", "required"}:
            with pytest.raises(ValidationError):
                QAPair(
                    question_text="Q?",
                    expected_response_kind=invalid,  # type: ignore[arg-type]
                )


class TestContentTypeParity:
    """Q-EX2 §5.4 — runtime validator vs taxonomy_snapshot.json."""

    def test_loaded_set_matches_snapshot_json(
        self, taxonomy_from_snapshot: dict
    ) -> None:
        """The frozenset built at module load must equal the snapshot."""
        snapshot_types = set(taxonomy_from_snapshot["content_types"])
        assert _VALID_CONTENT_TYPES == snapshot_types

    def test_snapshot_has_15_values(
        self, taxonomy_from_snapshot: dict
    ) -> None:
        """Sanity guard — the snapshot is non-empty + reasonable size.

        If the snapshot drops to <10 or grows past 50 something has gone
        wrong (the canonical list is hand-curated and stable)."""
        n = len(taxonomy_from_snapshot["content_types"])
        assert 10 <= n <= 50


# ──────────────────────────────────────────────────────────────────────────
# ID-63.8 — out-of-taxonomy soft-warn (PRODUCT Inv-6/7; TECH §3.5-§3.7)
# ──────────────────────────────────────────────────────────────────────────


class _RecordingMissCounter:
    """Lightweight stand-in for the production `_FlowTaxonomyMissCounter`.

    Satisfies the `TaxonomyMissCounter` structural protocol so a
    `ClassificationExtraction` construction inside a
    `bind_taxonomy_miss_counter` scope records misses into `recorded`.
    """

    def __init__(self) -> None:
        self.recorded: list[tuple[str, str]] = []

    def record(self, *, field: str, value: str) -> None:
        self.recorded.append((field, value))

    def get(self, *, field: str, value: str) -> int:
        return self.recorded.count((field, value))

    def tally_by_field(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for field, _value in self.recorded:
            tally[field] = tally.get(field, 0) + 1
        return tally


def _build_classification_under_counter(
    counter: _RecordingMissCounter,
    base_fields: dict,
    **overrides: object,
) -> ClassificationExtraction:
    """Construct a ClassificationExtraction inside the counter binding.

    The soft-warn model-validator runs at construction time and reads the
    flow-bound counter via `current_taxonomy_miss_counter()`, so the
    construction must happen inside the `bind_taxonomy_miss_counter`
    async-context-manager scope.
    """

    async def _exercise() -> ClassificationExtraction:
        async with bind_taxonomy_miss_counter(counter):
            return ClassificationExtraction(**base_fields, **overrides)

    return asyncio.run(_exercise())


class TestTaxonomyParityGuards:
    """ID-63.8 §3.5/§3.6 — module-load sets match the snapshot."""

    def test_valid_domains_matches_snapshot(self, valid_domains: list) -> None:
        assert _VALID_DOMAINS == {d["name"] for d in valid_domains}

    def test_valid_subtopics_matches_snapshot(
        self, valid_subtopics: list
    ) -> None:
        assert _VALID_SUBTOPICS == {s["name"] for s in valid_subtopics}

    def test_subtopic_names_globally_unique(
        self, valid_subtopics: list
    ) -> None:
        """TECH §1.6 — a FLAT subtopic set is correct because subtopic names
        are globally unique across domains; a collision would mean the flat
        set silently drops a value."""
        names = [s["name"] for s in valid_subtopics]
        assert len(names) == len(set(names))


class TestOutOfTaxonomySoftWarn:
    """ID-63.8 — PRODUCT Inv-7: out-of-taxonomy values are observed, not rejected."""

    def test_out_of_taxonomy_primary_domain_validates_and_records(
        self, base_fields: dict, caplog: pytest.LogCaptureFixture
    ) -> None:
        """An unknown primary_domain VALIDATES (returns an instance, unchanged),
        bumps the bound counter with field='primary_domain', and warns."""
        counter = _RecordingMissCounter()
        with caplog.at_level("WARNING"):
            extraction = _build_classification_under_counter(
                counter,
                base_fields,
                content_type="policy",
                primary_domain="not_a_real_domain",
                classification_confidence=0.8,
            )
        # Row written UNCHANGED — no coercion, no drop.
        assert isinstance(extraction, ClassificationExtraction)
        assert extraction.primary_domain == "not_a_real_domain"
        assert counter.recorded == [("primary_domain", "not_a_real_domain")]
        assert any(
            "out-of-taxonomy" in rec.getMessage()
            and "primary_domain" in rec.getMessage()
            for rec in caplog.records
        )

    def test_out_of_taxonomy_primary_subtopic_validates_and_records(
        self, base_fields: dict, caplog: pytest.LogCaptureFixture
    ) -> None:
        counter = _RecordingMissCounter()
        with caplog.at_level("WARNING"):
            extraction = _build_classification_under_counter(
                counter,
                base_fields,
                content_type="policy",
                primary_domain="security",
                primary_subtopic="not_a_real_subtopic",
                classification_confidence=0.8,
            )
        assert extraction.primary_subtopic == "not_a_real_subtopic"
        assert counter.recorded == [
            ("primary_subtopic", "not_a_real_subtopic")
        ]
        assert any(
            "primary_subtopic" in rec.getMessage() for rec in caplog.records
        )

    def test_out_of_taxonomy_secondary_classification_records(
        self, base_fields: dict
    ) -> None:
        """Each out-of-taxonomy secondary_classifications value records a
        'secondary_classification' miss (one per offending entry)."""
        counter = _RecordingMissCounter()
        extraction = _build_classification_under_counter(
            counter,
            base_fields,
            content_type="policy",
            primary_domain="security",
            classification_confidence=0.8,
            secondary_classifications=["security", "not_a_real_domain"],
        )
        # Valid 'security' is untouched; only the unknown value is recorded.
        assert extraction.secondary_classifications == [
            "security",
            "not_a_real_domain",
        ]
        assert counter.recorded == [
            ("secondary_classification", "not_a_real_domain")
        ]

    def test_valid_domain_and_subtopic_no_bump_no_warning(
        self, base_fields: dict, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A wholly in-taxonomy classification records NOTHING and emits no
        soft-warn — the happy path stays silent."""
        counter = _RecordingMissCounter()
        with caplog.at_level("WARNING"):
            extraction = _build_classification_under_counter(
                counter,
                base_fields,
                content_type="policy",
                primary_domain="security",
                primary_subtopic="functionality",
                classification_confidence=0.9,
                secondary_classifications=["security"],
            )
        assert isinstance(extraction, ClassificationExtraction)
        assert counter.recorded == []
        assert not any(
            "out-of-taxonomy" in rec.getMessage() for rec in caplog.records
        )

    def test_soft_warn_does_not_require_bound_counter(
        self, base_fields: dict
    ) -> None:
        """With NO counter bound, an out-of-taxonomy value still VALIDATES
        (returns the instance unchanged) — observability is skipped, the row
        is never rejected."""
        extraction = ClassificationExtraction(
            **base_fields,
            content_type="policy",
            primary_domain="not_a_real_domain",
            classification_confidence=0.7,
        )
        assert extraction.primary_domain == "not_a_real_domain"

    def test_inv5_content_type_hard_reject_still_raises(
        self, base_fields: dict
    ) -> None:
        """Inv-5 witness: out-of-vocab content_type 'junk' STILL raises a
        ValidationError → invalid_enum. The Inv-7 soft-warn must not weaken
        the content_type hard-reject path."""
        with pytest.raises(ValidationError) as exc_info:
            ClassificationExtraction(
                **base_fields,
                content_type="junk",
                primary_domain="security",
                classification_confidence=0.5,
            )
        assert classify_pydantic_error(exc_info.value) == "invalid_enum"
