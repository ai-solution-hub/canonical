"""Pydantic shapes for the cocoindex LLM-extraction stage (Q-EX2 contract).

This module hosts the discriminated-union typed extraction shapes that gate
the LLM-extraction stage of the Knowledge Hub cocoindex pipeline. The shapes
are consumed by `scripts/cocoindex_pipeline/flow.py` at flow scope via
`doc['content_text'].transform(ExtractByLlm(..., output_type=<Variant>))` —
NOT inside an `@coco.fn` wrapper (per verifier B-3 ratification at
`docs/specs/cocoindex-extraction-contract/TECH.md` §3.1).

References:
- `docs/specs/cocoindex-extraction-contract/TECH.md` §2.1 — Pydantic shapes
  (verbatim).
- `docs/specs/cocoindex-extraction-contract/TECH.md` §2.2 — content_type
  runtime validator reading the canonical taxonomy snapshot.
- `docs/specs/cocoindex-extraction-contract/TECH.md` §3.2 — inner-tier
  post-processing helpers (`@coco.fn(memo=True)` + plain Python).
- `docs/specs/cocoindex-extraction-contract/TECH.md` §4.1 — Pydantic
  strict-mode error mapping to `error_class` strings.
- `lib/validation/schemas.ts:1506-1519` — `VALID_ENTITY_TYPES` (12 values).
- `docs/ontology/26-form-type.md` lines 65-79 — 11-value `form_type` CV.
- `scripts/tests/fixtures/taxonomy_snapshot.json` — canonical `content_types`
  list (15 values at module-load time; resynced via `bun run sync:taxonomy`).

Empirical-grounding (OQ-3): all imports verified against pinned cocoindex
1.0.3 / pydantic 2.12.5 / anthropic 0.79.0. The legacy `ExtractByLlm` /
`LlmSpec` / `LlmApiType` surface was removed in cocoindex 1.0.0; this module
does NOT import it — the flow-scope wiring happens in `flow.py` via the
`@coco.fn`-wrapped anthropic SDK path (Path A, ratified S255).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal, Union
from uuid import UUID

import cocoindex as coco
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
)


# ---------------------------------------------------------------------------
# Content-type runtime validator (per Q-EX2 TECH §2.2)
# ---------------------------------------------------------------------------
#
# The canonical content_types list lives in
# `lib/ontology/content-type-registry.ts` (re-exported by
# `lib/validation/schemas.ts:43-52`). Mirroring it as a Python `Literal` would
# create a third source of drift. Instead, this module loads the snapshot at
# import time and a `@field_validator` on `ClassificationExtraction` asserts
# membership at validation time.
#
# Per CLAUDE.md Gotcha "Taxonomy dual-source — Python pipeline reads taxonomy
# from `scripts/tests/fixtures/taxonomy_snapshot.json`".

_TAXONOMY_SNAPSHOT_PATH = (
    Path(__file__).parent.parent / "tests" / "fixtures" / "taxonomy_snapshot.json"
)


def _load_canonical_content_types() -> frozenset[str]:
    """Read the canonical content_types list from the taxonomy snapshot.

    Raises FileNotFoundError if the snapshot is missing — this is a build-
    breaking condition (the snapshot is committed to the repo and resynced
    via `bun run sync:taxonomy`). A missing snapshot indicates someone has
    deleted committed source data.
    """
    with _TAXONOMY_SNAPSHOT_PATH.open() as fh:
        snapshot = json.load(fh)
    content_types = snapshot.get("content_types")
    if not isinstance(content_types, list) or not content_types:
        raise ValueError(
            f"taxonomy_snapshot.json missing 'content_types' array — "
            f"path={_TAXONOMY_SNAPSHOT_PATH}"
        )
    return frozenset(content_types)


_VALID_CONTENT_TYPES: frozenset[str] = _load_canonical_content_types()


# ---------------------------------------------------------------------------
# Pydantic shapes per Q-EX2 TECH §2.1
# ---------------------------------------------------------------------------


class _ExtractionBase(BaseModel):
    """Shared fields populated by the outer-tier flow wrapper, not by the LLM.

    Per Q-EX2 PRODUCT inv 5 — every variant carries op_id + content_items_id
    + extracted_at. These fields are stamped by the cocoindex flow wrapper
    *after* the LLM response is validated; they are NOT part of the LLM's
    output_type contract (the model would otherwise hallucinate UUIDs).

    Per verifier S-1 suggestion: extractor_kind (the link to
    q_a_extractions.extractor_kind enum) is stamped at outer-tier write time,
    not on the Pydantic shape — it is a per-target column populated by the
    target-binding adapter in flow.py.
    """

    model_config = ConfigDict(
        # Strict mode — Pydantic refuses to coerce mismatched types. A model
        # returning {"extraction_kind": "q_a_form", ...} where a sub-field is
        # the wrong type fails loud per Q-EX2 PRODUCT inv 13.
        strict=True,
        # Forbid unexpected fields — surfacing prompt drift early.
        extra="forbid",
    )

    op_id: UUID = Field(
        description=(
            "Cocoindex per-flow op_id — hybrid op_id pattern per "
            "02-data-flow.md §5.1 N7."
        )
    )
    content_items_id: UUID = Field(
        description=(
            "FK to content_items row whose content_text was the extraction "
            "input — source-attribution marker."
        )
    )
    extracted_at: datetime = Field(
        description=(
            "UTC timestamp set at LLM-call time by the outer-tier flow "
            "wrapper."
        )
    )


class FormMetadata(BaseModel):
    """Block carried inside the q_a_form variant per Q-EX2 PRODUCT inv 2.

    form_type values per docs/ontology/26-form-type.md lines 65-79 — the
    full 11-value canonical CV (8 procurement + 3 non-procurement). Per
    verifier B-2, the earlier 8-value draft omitted checklist /
    questionnaire / sales_proposal_template; this list is the canonical
    contract.
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    form_type: Literal[
        # 8 procurement form_types (Q-OQR1-02 ratification)
        "bid",
        "rfp",
        "pqq",
        "itt",
        "tender",
        "framework",
        "dps",
        "gcloud",
        # 3 non-procurement form_types
        "checklist",
        "questionnaire",
        "sales_proposal_template",
    ]
    form_format: Literal["docx", "xlsx", "pdf", "html", "md"]
    form_title: str | None = None
    issuing_organisation: str | None = None
    deadline: datetime | None = None
    evaluation_methodology: str | None = None


class QAPair(BaseModel):
    """One Q&A pair extracted from a form.

    Per verifier B-1: the field is named `expected_response_kind` (not
    `question_kind`, which collides with `question_matches.question_kind` per
    05-qa-flow.md §7.2). The Literal is the canonical 2-value
    `["mandatory", "optional"]` — `info_only` is unratified.
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    question_text: str = Field(min_length=1)
    answer_text: str | None = None
    expected_response_kind: Literal["mandatory", "optional"]
    evaluation_criteria: str | None = None
    evidence_requirements: list[str] = Field(default_factory=list)
    scope_tags: list[str] = Field(default_factory=list)


class QAFormExtraction(_ExtractionBase):
    """The q_a_form discriminated-union variant per Q-EX2 PRODUCT inv 2.

    Maps downstream to q_a_extractions (per QAPair) + form_templates (per
    FormMetadata).
    """

    extraction_kind: Literal["q_a_form"] = "q_a_form"
    form_metadata: FormMetadata
    qa_pairs: list[QAPair] = Field(default_factory=list)


class EntityMentionExtraction(_ExtractionBase):
    """The entity_mention variant per Q-EX2 PRODUCT inv 3.

    entity_type values mirror VALID_ENTITY_TYPES in
    lib/validation/schemas.ts:1506-1519. The §5.4 parity guard asserts the
    two lists match.
    """

    extraction_kind: Literal["entity_mention"] = "entity_mention"
    entity_type: Literal[
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
    entity_name: str = Field(min_length=1)
    canonical_name: str | None = None
    source_span_start: int = Field(ge=0)
    source_span_end: int = Field(ge=0)
    mention_confidence: float = Field(ge=0.0, le=1.0)


class ClassificationExtraction(_ExtractionBase):
    """The classification variant per Q-EX2 PRODUCT inv 4.

    content_type values mirror the canonical list in
    `scripts/tests/fixtures/taxonomy_snapshot.json` (re-export shim of
    `lib/ontology/content-type-registry.ts`). Validated at runtime via the
    `_validate_content_type` field validator below.
    """

    extraction_kind: Literal["classification"] = "classification"
    content_type: str  # Constrained at runtime — see validator below.
    primary_domain: str
    classification_confidence: float = Field(ge=0.0, le=1.0)
    secondary_classifications: list[str] = Field(default_factory=list)
    rationale: str | None = None

    @field_validator("content_type")
    @classmethod
    def _validate_content_type(cls, value: str) -> str:
        """Reject content_type values not in the canonical taxonomy snapshot.

        Failure raises ValueError, which Pydantic surfaces as a
        ValidationError per Q-EX2 PRODUCT inv 13. The error 'type' is
        'value_error' which maps to 'invalid_enum' in
        `_PYDANTIC_ERROR_TO_ERROR_CLASS`.
        """
        if value not in _VALID_CONTENT_TYPES:
            raise ValueError(
                f"content_type {value!r} not in canonical taxonomy "
                f"(valid: {sorted(_VALID_CONTENT_TYPES)})"
            )
        return value


# The discriminated-union root — flow-scope `ExtractByLlm` calls reference one
# of the three variants directly; ExtractionOutput is the type-checker handle
# for code that wants the union (e.g. tests, mocks).
ExtractionOutput = Annotated[
    Union[
        QAFormExtraction,
        EntityMentionExtraction,
        ClassificationExtraction,
    ],
    Field(discriminator="extraction_kind"),
]


# ---------------------------------------------------------------------------
# Pydantic error → error_class mapping (per Q-EX2 TECH §4.1)
# ---------------------------------------------------------------------------
#
# Per verifier S-2 suggestion, the helper is implemented as an explicit dict
# mapping rather than implicit code-table. The mapping below is empirically
# verified against pydantic 2.12.5 strict-mode error 'type' strings.

_PYDANTIC_ERROR_TO_ERROR_CLASS: dict[str, str] = {
    # Missing required field
    "missing": "missing_required",
    # Literal violation (e.g. entity_type: "junk")
    "literal_error": "invalid_enum",
    # Field validator raising ValueError (content_type runtime check)
    "value_error": "invalid_enum",
    # Discriminator wrong-value or null
    "union_tag_invalid": "invalid_discriminator",
    # Discriminator missing
    "union_tag_not_found": "invalid_discriminator",
    # extra="forbid" violation
    "extra_forbidden": "unexpected_field",
    # Type-shape errors (strict mode)
    "string_type": "type_coercion",
    "int_type": "type_coercion",
    "float_type": "type_coercion",
    "bool_type": "type_coercion",
    "list_type": "type_coercion",
    "dict_type": "type_coercion",
    # JSON-mode UUID / datetime parse errors
    "uuid_parsing": "type_coercion",
    "datetime_parsing": "type_coercion",
    # Strict-mode "expected instance of X" — Python-dict path
    "is_instance_of": "type_coercion",
    # Strict-mode datetime "expected datetime" — Python-dict path
    "datetime_type": "type_coercion",
}


def classify_pydantic_error(exc: ValidationError) -> str:
    """Map the first error in a ValidationError to an error_class string.

    Returns 'type_coercion' as the default — type-coercion errors are the
    broadest category and the safe fallback for unmapped error types. The
    mapping is exhaustive against Pydantic v2.12 strict-mode error types;
    unmapped errors fall back to 'type_coercion' so the failure-write path
    is always populated (per Q-EX2 PRODUCT inv 13).
    """
    if not exc.errors():
        return "type_coercion"
    first_error_type = exc.errors()[0].get("type", "")
    return _PYDANTIC_ERROR_TO_ERROR_CLASS.get(first_error_type, "type_coercion")


# ---------------------------------------------------------------------------
# Inner-tier post-processing helpers (per Q-EX2 TECH §3.2)
# ---------------------------------------------------------------------------


def stamp_extraction_base(
    extraction: ClassificationExtraction
    | QAFormExtraction
    | EntityMentionExtraction,
    *,
    op_id: UUID,
    content_items_id: UUID,
) -> ClassificationExtraction | QAFormExtraction | EntityMentionExtraction:
    """Plain Python helper — NOT @coco.fn.

    Stamps the _ExtractionBase fields with op_id (from cocoindex flow
    context), content_items_id (from the row's primary key in source-binding
    tier), and extracted_at (now-UTC).

    Per Q-EX2 TECH §3.2, this is NOT memoised — the three values change per
    flow run, so memoisation would either stale-cache the values or
    invalidate every run, defeating the purpose. Pydantic v2 `model_copy`
    preserves immutability semantics.
    """
    return extraction.model_copy(
        update={
            "op_id": op_id,
            "content_items_id": content_items_id,
            "extracted_at": datetime.now(timezone.utc),
        }
    )


@coco.fn(memo=True)
async def normalise_entity_span(
    extraction: EntityMentionExtraction,
    content_text: str,
) -> EntityMentionExtraction:
    """Inner-tier post-processing fn — consumes the typed extracted column
    AND the source content_text. Adjusts span offsets so the entity_name
    aligns with whitespace-trimmed boundaries in `content_text`.

    Per S9 §7.2 layered fn-shape: inputs are content (typed value +
    string), NOT FileLike. Metadata-only edits to the source file
    (mtime, owner_change) hit memo cleanly because the memo key is
    (extraction_payload, content_text), not the file handle.

    Behaviour: if the configured span (source_span_start..source_span_end)
    on content_text contains leading or trailing whitespace, the offsets
    are tightened to drop the whitespace. If the span is already tight or
    out-of-bounds, the extraction is returned unchanged.
    """
    start = extraction.source_span_start
    end = extraction.source_span_end
    if start < 0 or end > len(content_text) or end <= start:
        # Out-of-bounds or zero-length span — return unchanged; the caller
        # decides whether to drop the extraction.
        return extraction
    span = content_text[start:end]
    # Tighten leading whitespace
    lstripped = span.lstrip()
    leading_trim = len(span) - len(lstripped)
    # Tighten trailing whitespace
    rstripped = lstripped.rstrip()
    trailing_trim = len(lstripped) - len(rstripped)
    new_start = start + leading_trim
    new_end = end - trailing_trim
    if new_start == start and new_end == end:
        return extraction
    return extraction.model_copy(
        update={
            "source_span_start": new_start,
            "source_span_end": new_end,
        }
    )
