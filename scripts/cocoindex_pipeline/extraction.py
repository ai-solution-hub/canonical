"""Pydantic shapes + Path A LLM extractors for the cocoindex extraction stage.

Hosts:
  - The discriminated-union typed extraction shapes (Q-EX2 §2.1).
  - The 3 `@coco.fn(memo=True)` Path A extractors that call the Anthropic
    SDK directly + validate via Pydantic `TypeAdapter` (Q-EX2 §3.1).
  - `stamp_extraction_base()` for post-memo flow-scope stamping — it
    CONSTRUCTS a full `*Stamped` type from a stamp-free core + the resolved
    op_id / content_items_id / extracted_at (bl-220 / ID-74).
  - `_anthropic_retry` — KH-owned tenacity wrapper around the SDK call
    (Inv-23; cocoindex 1.0.3 has no built-in retry primitive for
    `@coco.fn` extractors).

References:
- `docs/specs/id-36-cocoindex-extraction-contract/TECH.md` §2.1, §2.2, §3.2, §4.1.
- `lib/validation/schemas.ts:1506-1519` — `VALID_ENTITY_TYPES` (12 values).
- `docs/ontology/26-form-type.md` — `form_type` CV (markdown side of the
  triple-source lockstep per ID-52.6 / TECH §2.6b).
- `scripts/tests/fixtures/taxonomy_snapshot.json` — canonical `content_types`
  + `form_types` arrays (Python consumer of the triple-source lockstep).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal, Union
from uuid import UUID

import anthropic
import cocoindex as coco
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

from scripts.cocoindex_pipeline.prompts import (
    CLASSIFICATION_PROMPT,
    ENTITY_MENTION_PROMPT,
    Q_A_FORM_PROMPT,
)

# `flow_context` is imported LAZILY (function-local) inside the retry hook,
# `stamp_extraction_base`, and the taxonomy-miss path — preserving the original
# lazy-import timing. Post-{67.2} the pipeline is canonicalised onto the single
# `scripts.cocoindex_pipeline.*` namespace, so these now use the absolute
# `from scripts.cocoindex_pipeline import flow_context` form; the prior
# `__package__`-relative `import_module` indirection (which existed only to
# tolerate the dual namespace) is retired. One module copy means a single
# ContextVar store, so bound state is always visible to the caller.

from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


# Production Anthropic model — single source of truth for the 3 extractors
# below; mirrors lib/anthropic.ts + scripts/kb_pipeline/config.py.
ANTHROPIC_MODEL = "claude-opus-4-6"


# Content-type runtime validator (Q-EX2 TECH §2.2). The canonical
# `content_types` list lives in `lib/ontology/content-type-registry.ts`;
# Python reads it from `scripts/tests/fixtures/taxonomy_snapshot.json` per
# CLAUDE.md "Taxonomy dual-source" gotcha to avoid a third source of drift.

_TAXONOMY_SNAPSHOT_PATH = (
    Path(__file__).parent.parent / "tests" / "fixtures" / "taxonomy_snapshot.json"
)


def _load_canonical_content_types() -> frozenset[str]:
    """Read the canonical content_types list from the taxonomy snapshot."""
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


def _load_canonical_form_types() -> frozenset[str]:
    """Read the canonical form_types keys from the taxonomy snapshot.

    Mirrors `_load_canonical_content_types` per ID-52.6 / TECH §2.6b
    (`form_type` triple-source lockstep). The snapshot is regenerated from
    the live `form_types` Postgres table by `bun run sync:taxonomy`; the TS
    side is guarded by `__tests__/lib/ontology/form-type-parity.test.ts`.
    """
    with _TAXONOMY_SNAPSHOT_PATH.open() as fh:
        snapshot = json.load(fh)
    form_types = snapshot.get("form_types")
    if not isinstance(form_types, list) or not form_types:
        raise ValueError(
            f"taxonomy_snapshot.json missing 'form_types' array — "
            f"path={_TAXONOMY_SNAPSHOT_PATH}"
        )
    keys: list[str] = []
    for row in form_types:
        if not isinstance(row, dict):
            raise ValueError(
                f"taxonomy_snapshot.json form_types entry must be an object "
                f"with 'key' + 'label' — got {row!r}"
            )
        key = row.get("key")
        if not isinstance(key, str) or not key:
            raise ValueError(
                f"taxonomy_snapshot.json form_types entry missing string "
                f"'key' — got {row!r}"
            )
        keys.append(key)
    return frozenset(keys)


_VALID_FORM_TYPES: frozenset[str] = _load_canonical_form_types()


def _load_canonical_name_set(array_key: str) -> frozenset[str]:
    """Read a canonical name set (`name`-keyed objects) from the snapshot.

    Shared body for `domains` (ID-63.8 / TECH §3.5) and `subtopics`
    (TECH §3.6), both of which carry an array of objects each holding a string
    `name`. Mirrors `_load_canonical_form_types`' fail-loud discipline: it
    raises only if `array_key`'s array is structurally malformed (missing /
    empty, or an entry lacking a string `name`), surfacing taxonomy-sync drift
    loudly at import time rather than silently degrading the downstream
    soft-warn. Membership itself is enforced as a NON-RAISING soft-warn on
    `ClassificationExtraction` (PRODUCT Inv-6/7).
    """
    with _TAXONOMY_SNAPSHOT_PATH.open() as fh:
        snapshot = json.load(fh)
    rows = snapshot.get(array_key)
    if not isinstance(rows, list) or not rows:
        raise ValueError(
            f"taxonomy_snapshot.json missing '{array_key}' array — "
            f"path={_TAXONOMY_SNAPSHOT_PATH}"
        )
    names: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(
                f"taxonomy_snapshot.json {array_key} entry must be an object "
                f"with a string 'name' — got {row!r}"
            )
        name = row.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(
                f"taxonomy_snapshot.json {array_key} entry missing string "
                f"'name' — got {row!r}"
            )
        names.append(name)
    return frozenset(names)


# Subtopic names are GLOBALLY UNIQUE across domains (56 distinct values at v1 —
# TECH §1.6), so a FLAT subtopic set is the correct v1 contract: no
# `domain_id`-scoping is needed to disambiguate.
_VALID_DOMAINS: frozenset[str] = _load_canonical_name_set("domains")
_VALID_SUBTOPICS: frozenset[str] = _load_canonical_name_set("subtopics")


_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic shapes per Q-EX2 TECH §2.1
# ---------------------------------------------------------------------------


# Post-validation stamp placeholders (PRODUCT Inv-5 — the LLM "does not
# generate" op_id / content_items_id / extracted_at). They live on the
# `_ExtractionStamp` mixin (below), which only the post-memo `*Stamped` types
# inherit — NOT the stamp-free CORE shapes the memo extractors return. An
# all-zero UUID / epoch timestamp is an unmistakable "unstamped" marker;
# `stamp_extraction_base()` overwrites them with the resolved flow values when it
# constructs the full `*Stamped` type post-memo.
#
# NB (bl-220 / ID-74 — memo-boundary fix): the 3 `@coco.fn(memo=True)` LLM
# extractors return the stamp-FREE core types (`ClassificationExtraction` /
# `QAFormExtraction` / `EntityMentionExtraction`). cocoindex memo serde
# round-trips the memoised return value as JSON (UUID/datetime → strings) and on
# a memo HIT deserialises via STRICT pydantic `validate_python(raw)`; strict mode
# rejects the string forms (`is_instance_of UUID` / `datetime_type`), so a
# stamp-BEARING return type made every memo HIT raise `DeserializationError` —
# defeating idempotent re-walk and re-burning Anthropic (a re-ingest idempotency
# blocker). The fix SPLITS the models: the memo returns a stamp-free core (no
# UUID/datetime fields cross the memo boundary), and `flow.py::ingest_file`
# stamps each extraction OUTSIDE that boundary via `_stamp_if_model` →
# `stamp_extraction_base()`, which CONSTRUCTS the full stamped type (`*Stamped`,
# below) from the core + the flow-level `op_id` + the row's deterministic
# `content_item_id`. This is LOSSLESS: `flow.py` already stamped post-memo, so the
# values the memo cached for these three fields were ALWAYS the `_UNSTAMPED_*`
# sentinels — the real values are written post-memo (Inv-5: "the flow wrapper
# stamps each ExtractionOutput"). Row writes are unchanged — declare_row uses the
# SAME flow-level `op_id`, so Inv-15 holds independently of the object stamp.
_UNSTAMPED_UUID: UUID = UUID(int=0)
_UNSTAMPED_AT: datetime = datetime(1970, 1, 1, tzinfo=timezone.utc)


# Shared strict config for ALL extraction shapes (core + stamp + stamped).
# `strict=True` + `extra="forbid"` surfaces type drift and prompt drift loud per
# Q-EX2 PRODUCT inv 13; bl-220 keeps this on every shape (C3 — strictness is NOT
# relaxed anywhere; this is explicitly NOT the lax string→UUID coercion of
# option (a)).
_EXTRACTION_MODEL_CONFIG = ConfigDict(strict=True, extra="forbid")


class _ExtractionCore(BaseModel):
    """Stamp-FREE base for the LLM-derived core shapes (bl-220 / ID-74).

    The 3 `@coco.fn(memo=True)` extractors return subclasses of this — they hold
    ONLY the LLM-generated fields + the `extraction_kind` discriminator, NO UUID /
    datetime stamp fields — so cocoindex memo serde never round-trips a value that
    strict re-validation would reject on a memo HIT. The stamp fields are added
    only on the post-memo `*Stamped` types (via `_ExtractionStamp`).
    """

    model_config = _EXTRACTION_MODEL_CONFIG


class _ExtractionStamp(BaseModel):
    """The 3 flow-stamped fields, added ONLY to the post-memo `*Stamped` types.

    `op_id`, `content_items_id`, `extracted_at` are NOT emitted by the LLM
    (PRODUCT Inv-5: "the model does not generate them") AND must NOT live on the
    memoised return type: cocoindex memo serde JSON-round-trips them (UUID /
    datetime → strings) and re-validates STRICT on a memo HIT, which rejects the
    string forms (bl-220 / ID-74). So they are split off here, onto a mixin that
    the stamp-free core shapes do NOT inherit; only the full `*Stamped` types
    (built post-memo by `stamp_extraction_base()`) carry them. They DEFAULT to the
    `_UNSTAMPED_*` sentinels so a `*Stamped` instance is constructible before
    resolution; `stamp_extraction_base()` overwrites them with the resolved flow
    values. Defaults are never serde-round-tripped through the memo (they live
    outside the memo boundary), so the strict-deser bug cannot recur here.
    """

    model_config = _EXTRACTION_MODEL_CONFIG

    op_id: UUID = Field(
        default=_UNSTAMPED_UUID,
        description="Cocoindex per-flow op_id (02-data-flow §5.1).",
    )
    content_items_id: UUID = Field(
        default=_UNSTAMPED_UUID,
        description="FK to content_items row whose content_text was the input.",
    )
    extracted_at: datetime = Field(
        default=_UNSTAMPED_AT,
        description="UTC timestamp set at LLM-call time by the wrapper.",
    )


class FormMetadata(BaseModel):
    """Block carried inside the q_a_form variant (Q-EX2 PRODUCT inv 2).

    `form_type` is validated at runtime against the canonical taxonomy
    snapshot (`scripts/tests/fixtures/taxonomy_snapshot.json:form_types`),
    which is regenerated from the live `form_types` Postgres table by
    `bun run sync:taxonomy`. This mirrors the `_validate_content_type`
    pattern on `ClassificationExtraction` and avoids a third drift-prone
    source per ID-52.6 / TECH §2.6b (`form_type` triple-source lockstep).
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    form_type: str
    form_format: Literal["docx", "xlsx", "pdf", "html", "md"]
    form_title: str | None = None
    issuing_organisation: str | None = None
    deadline: datetime | None = None
    evaluation_methodology: str | None = None

    @field_validator("form_type")
    @classmethod
    def _validate_form_type(cls, value: str) -> str:
        # Pydantic surfaces this `ValueError` as a `ValidationError` with
        # `error['type'] == 'value_error'`, mapped to `invalid_enum` in
        # `_PYDANTIC_ERROR_TO_ERROR_CLASS` (mirrors the content_type path).
        if value not in _VALID_FORM_TYPES:
            raise ValueError(
                f"form_type {value!r} not in canonical taxonomy "
                f"(valid: {sorted(_VALID_FORM_TYPES)})"
            )
        return value


class QAPair(BaseModel):
    """One Q&A pair extracted from a form (Q-EX2 PRODUCT inv 2).

    `expected_response_kind` is named to avoid collision with
    `question_matches.question_kind` per 05-qa-flow.md §7.2; the 2-value
    CV is canonical (`info_only` unratified).
    """

    model_config = ConfigDict(strict=True, extra="forbid")

    question_text: str = Field(min_length=1)
    answer_text: str | None = None
    expected_response_kind: Literal["mandatory", "optional"]
    evaluation_criteria: str | None = None
    evidence_requirements: list[str] = Field(default_factory=list)
    scope_tags: list[str] = Field(default_factory=list)


class QAFormExtraction(_ExtractionCore):
    """The q_a_form variant CORE shape (Q-EX2 PRODUCT inv 2; bl-220 stamp-free).

    Returned by the `extract_qa_form` memo extractor — holds ONLY the
    LLM-generated fields + the `extraction_kind` discriminator (NO stamp fields,
    so the memo serde round-trip is strict-safe; bl-220 / ID-74). The post-memo
    stamped shape is `QAFormExtractionStamped` (built by `stamp_extraction_base`).

    Maps downstream to `q_a_extractions` (per QAPair) only. The `form_metadata`
    block is NOT persisted by this LLM variant — `form_templates` /
    `form_template_fields` are written by the deterministic Path-B extractor
    (`ExtractedForm`, ID-52); Inv-19 keeps Path A off the form tables.
    (Reconciled S287 / bl-184(a).)
    """

    extraction_kind: Literal["q_a_form"] = "q_a_form"
    form_metadata: FormMetadata
    qa_pairs: list[QAPair] = Field(default_factory=list)


class EntityMentionExtraction(_ExtractionCore):
    """The entity_mention variant CORE shape (Q-EX2 PRODUCT inv 3; bl-220 stamp-free).

    Returned (in a list) by the `extract_entity_mentions` memo extractor — holds
    ONLY the LLM-generated fields + the `extraction_kind` discriminator (NO stamp
    fields; bl-220 / ID-74). The post-memo stamped shape is
    `EntityMentionExtractionStamped`.

    `entity_type` values mirror `VALID_ENTITY_TYPES` in
    `lib/validation/schemas.ts:1506-1519`; the §5.4 parity guard asserts
    the two lists match.
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


class ClassificationExtraction(_ExtractionCore):
    """The classification variant CORE shape (Q-EX2 PRODUCT inv 4; bl-220 stamp-free).

    Returned by the `extract_classification` memo extractor — holds ONLY the
    LLM-generated fields + the `extraction_kind` discriminator (NO stamp fields;
    bl-220 / ID-74). The post-memo stamped shape is
    `ClassificationExtractionStamped` (built by `stamp_extraction_base`).

    `content_type` is constrained at runtime via `_validate_content_type`
    below, which reads the canonical taxonomy snapshot.
    """

    extraction_kind: Literal["classification"] = "classification"
    content_type: str
    primary_domain: str
    # ID-63.7 (OQ-63-9): nullable subtopic dimension persisted alongside
    # primary_domain. Optional/nullable so it is backward-compatible with
    # existing callers under ConfigDict(extra='forbid') — it is a declared
    # field, not an extra. Taxonomy-membership enforcement is the
    # snapshot-backed soft-warn added in {63.8}; no field_validator here.
    primary_subtopic: str | None = None
    # ID-64.10 (S296): human-readable title the classifier proposes for the
    # document. Nullable/defaulted so it is backward-compatible under
    # ConfigDict(extra='forbid') and degrades gracefully when an older prompt
    # omits it. Consumed by the content_items write-path: title =
    # suggested_title ?? filename-stem (flow.py ci_target.declare_row).
    suggested_title: str | None = None
    classification_confidence: float = Field(ge=0.0, le=1.0)
    secondary_classifications: list[str] = Field(default_factory=list)
    rationale: str | None = None

    @field_validator("content_type")
    @classmethod
    def _validate_content_type(cls, value: str) -> str:
        # Pydantic surfaces this `ValueError` as a `ValidationError` with
        # `error['type'] == 'value_error'`, mapped to `invalid_enum` in
        # `_PYDANTIC_ERROR_TO_ERROR_CLASS` below.
        if value not in _VALID_CONTENT_TYPES:
            raise ValueError(
                f"content_type {value!r} not in canonical taxonomy "
                f"(valid: {sorted(_VALID_CONTENT_TYPES)})"
            )
        return value

    @model_validator(mode="after")
    def _surface_out_of_taxonomy_classification(
        self,
    ) -> "ClassificationExtraction":
        """Soft-warn out-of-taxonomy domain / subtopic / secondary values.

        PRODUCT Inv-6/7 (TECH §3.5-§3.7): the LLM may propose a
        `primary_domain`, `primary_subtopic`, or `secondary_classifications[]`
        value outside the canonical taxonomy snapshot. Unlike `content_type`
        (Inv-5 HARD-reject via the `_validate_content_type` field-validator),
        these dimensions are OBSERVABILITY-ONLY: the row is written UNCHANGED.

        For each miss we (1) bump the flow-bound `TaxonomyMissCounter` when one
        is bound, and (2) emit a `logging.warning`. We deliberately do NOT
        coerce-to-first-valid (cf. the TS `validateDomain` /
        `coerceSubtopic` smells) and do NOT drop / reject. Because this
        validator ALWAYS returns `self` and NEVER raises, it never produces a
        pydantic error and therefore never routes through
        `_PYDANTIC_ERROR_TO_ERROR_CLASS` — the Inv-5 `content_type` hard-reject
        path is left entirely intact.
        """
        misses: list[tuple[str, str]] = []
        if self.primary_domain not in _VALID_DOMAINS:
            misses.append(("primary_domain", self.primary_domain))
        if (
            self.primary_subtopic is not None
            and self.primary_subtopic not in _VALID_SUBTOPICS
        ):
            misses.append(("primary_subtopic", self.primary_subtopic))
        for secondary in self.secondary_classifications:
            if secondary not in _VALID_DOMAINS:
                misses.append(("secondary_classification", secondary))

        if misses:
            # Canonical single-namespace import post-{67.2} (kept function-local
            # to preserve the original lazy-import timing; flow_context imports
            # neither extraction nor flow, so this is cycle-free).
            from scripts.cocoindex_pipeline import flow_context

            counter = flow_context.current_taxonomy_miss_counter()
            for field, value in misses:
                if counter is not None:
                    counter.record(field=field, value=value)
                _logger.warning(
                    "out-of-taxonomy %s %r — row written (soft-warn per "
                    "ID-63 Inv-7)",
                    field,
                    value,
                )
        return self


# ---------------------------------------------------------------------------
# Post-memo STAMPED shapes (bl-220 / ID-74). Each adds the 3 flow-stamp fields
# (`_ExtractionStamp`) to the matching stamp-free core. These are constructed
# OUTSIDE the memo boundary by `stamp_extraction_base()` (called from
# `flow.py::_stamp_if_model`), so the UUID/datetime fields never cross cocoindex
# memo serde and the strict-deser memo-HIT bug cannot recur. The `extraction_kind`
# discriminator + all LLM fields + validators are inherited from the core via MRO
# (`class XStamped(XCore, _ExtractionStamp)`), so downstream readers that switch
# on `extraction_kind` or read LLM fields work unchanged on the stamped shape.
#
# Inv-5 is preserved: the full stamped shape (op_id / content_items_id /
# extracted_at present) is what flow.py's row writers see — the LLM does not
# generate these; the flow wrapper stamps them.
# ---------------------------------------------------------------------------


class ClassificationExtractionStamped(ClassificationExtraction, _ExtractionStamp):
    """`ClassificationExtraction` core + the 3 flow-stamp fields (bl-220)."""


class QAFormExtractionStamped(QAFormExtraction, _ExtractionStamp):
    """`QAFormExtraction` core + the 3 flow-stamp fields (bl-220)."""


class EntityMentionExtractionStamped(EntityMentionExtraction, _ExtractionStamp):
    """`EntityMentionExtraction` core + the 3 flow-stamp fields (bl-220)."""


# Discriminated-union root over the stamp-FREE CORE variants — this is what the
# memo extractors return and what cocoindex memo serde round-trips (code that
# wants the LLM-output union: tests, mocks). The 3 extractors below return
# concrete core variants.
ExtractionOutput = Annotated[
    Union[
        QAFormExtraction,
        EntityMentionExtraction,
        ClassificationExtraction,
    ],
    Field(discriminator="extraction_kind"),
]


# Discriminated-union root over the post-memo STAMPED variants (the full shape
# flow.py's row writers consume after `stamp_extraction_base`). Kept distinct
# from `ExtractionOutput` so the memo boundary (stamp-free) and the post-stamp
# boundary (stamp-bearing) are each typed precisely.
ExtractionOutputStamped = Annotated[
    Union[
        QAFormExtractionStamped,
        EntityMentionExtractionStamped,
        ClassificationExtractionStamped,
    ],
    Field(discriminator="extraction_kind"),
]


# Core → Stamped class mapping, used by `stamp_extraction_base` to pick the
# correct full type for a given core instance (constructed OUTSIDE the memo
# boundary). Keyed on the EXACT core class (not isinstance) so a stamped instance
# passed back in does not double-resolve.
_CORE_TO_STAMPED: dict[type, type] = {
    ClassificationExtraction: ClassificationExtractionStamped,
    QAFormExtraction: QAFormExtractionStamped,
    EntityMentionExtraction: EntityMentionExtractionStamped,
}


# Pydantic error → error_class mapping (Q-EX2 TECH §4.1). Empirically
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
    """Map the first error in a `ValidationError` to an error_class string.

    Defaults to `'type_coercion'` for unmapped error types — the broadest
    category, so the failure-write path is always populated (Q-EX2 inv 13).
    """
    if not exc.errors():
        return "type_coercion"
    first_error_type = exc.errors()[0].get("type", "")
    return _PYDANTIC_ERROR_TO_ERROR_CLASS.get(first_error_type, "type_coercion")


def _strip_code_fence(text: str) -> str:
    """Strip an enclosing Markdown code fence from an LLM JSON response.

    Anthropic models intermittently wrap JSON output in a ```json … ``` (or a
    bare ``` … ```) fence despite the prompt asking for raw JSON, which makes
    `TypeAdapter.validate_json` fail with a `json_invalid` error ("expected
    value at line 1 column 1" — {66.16} S295 live-ingest, surfaced on
    `extract_qa_form` once the Inv-5 stamp-field defaults let validation run).
    This normalises the response to the bare JSON document; no-op when the
    response is already unfenced. Applied to ALL three extractors because the
    fencing is non-deterministic per call.
    """
    s = text.strip()
    if not s.startswith("```"):
        return s
    # Drop the opening fence line (``` or ```json …) up to its first newline.
    newline = s.find("\n")
    s = s[newline + 1 :] if newline != -1 else s[3:]
    # Drop the trailing closing fence.
    s = s.rstrip()
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()


# ---------------------------------------------------------------------------
# Inner-tier post-processing helpers (per Q-EX2 TECH §3.2)
# ---------------------------------------------------------------------------


def stamp_extraction_base(
    extraction: ClassificationExtraction
    | QAFormExtraction
    | EntityMentionExtraction,
    *,
    op_id: UUID | None = None,
    content_items_id: UUID | None = None,
) -> (
    ClassificationExtractionStamped
    | QAFormExtractionStamped
    | EntityMentionExtractionStamped
):
    """Construct the post-memo STAMPED extraction from a stamp-free core (bl-220).

    NOT memoised — values change per flow run, and this runs OUTSIDE the memo
    boundary (PRODUCT Inv-5: "the flow wrapper stamps each ExtractionOutput";
    the LLM does not generate op_id / content_items_id / extracted_at).

    bl-220 / ID-74: the memo extractors now return a stamp-FREE core
    (`ClassificationExtraction` / `QAFormExtraction` / `EntityMentionExtraction`),
    so this CONSTRUCTS the matching full `*Stamped` type from the core's fields +
    the resolved op_id / content_items_id / `datetime.now(timezone.utc)` — it does
    NOT `model_copy(update=...)` (the core has no stamp fields to update). The
    stamp fields therefore never cross cocoindex memo serde, so the strict
    UUID/datetime memo-HIT deser failure cannot recur. Passing an already-`*Stamped`
    instance back in is tolerated (re-resolved to the same stamped class).

    When `op_id` / `content_items_id` are omitted, reads them from the
    currently-bound `FLOW_META_CTX` so the call-site does not have to
    thread metadata through every `.transform()` chain. Explicit kwargs
    take precedence. Raises `RuntimeError` rather than silently stamping
    zero UUIDs when no binding is active.
    """
    if op_id is None or content_items_id is None:
        # Canonical single-namespace import post-{67.2} (kept function-local to
        # preserve lazy-import timing). One module copy means a single
        # ContextVar store, so bound metadata is always visible here.
        from scripts.cocoindex_pipeline import flow_context

        meta = flow_context.current_flow_meta()
        if meta is None:
            raise RuntimeError(
                "stamp_extraction_base() called without explicit op_id / "
                "content_items_id AND no FLOW_META_CTX binding is active. "
                "Wrap the call in `async with bind_flow_meta(op_id=..., "
                "content_items_id=...):` or pass explicit kwargs."
            )
        resolved_op_id = op_id if op_id is not None else meta.op_id
        if content_items_id is None:
            if meta.content_items_id is None:
                raise RuntimeError(
                    "stamp_extraction_base() called without explicit "
                    "content_items_id AND FLOW_META_CTX has content_items_id=None. "
                    "Rebind FLOW_META_CTX with a non-None content_items_id "
                    "before invoking the per-row stamping path."
                )
            resolved_content_items_id = meta.content_items_id
        else:
            resolved_content_items_id = content_items_id
    else:
        resolved_op_id = op_id
        resolved_content_items_id = content_items_id

    # Pick the full stamped class for this core (constructed OUTSIDE the memo
    # boundary). Resolve on the EXACT class so an already-stamped instance passed
    # back in keeps its own (stamped) class rather than mis-resolving.
    stamped_cls = _CORE_TO_STAMPED.get(type(extraction), type(extraction))
    # Carry over the core's LLM fields, then add the 3 resolved stamp fields. We
    # dump excluding any stamp fields already present (idempotent re-stamp) so the
    # construct call sets them exactly once from the resolved values.
    core_fields = extraction.model_dump(
        exclude={"op_id", "content_items_id", "extracted_at"}
    )
    return stamped_cls(
        **core_fields,
        op_id=resolved_op_id,
        content_items_id=resolved_content_items_id,
        extracted_at=datetime.now(timezone.utc),
    )


@coco.fn(memo=True)
async def normalise_entity_span(
    extraction: EntityMentionExtraction,
    content_text: str,
) -> EntityMentionExtraction:
    """Tighten whitespace at the span boundaries on `content_text`.

    Inner-tier post-processing fn (S9 §7.2): inputs are typed value + str,
    NOT FileLike. Memo key is `(extraction_payload, content_text)` so
    metadata-only edits to the source file (mtime, owner_change) hit
    memo cleanly.

    Returns the extraction unchanged when the span is already tight or
    out-of-bounds.
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


# Path A canonical LLM extractors. `@coco.fn(memo=True)` content-hashes
# the `content_text` arg so re-runs of identical content skip the LLM call
# (Inv-21). On `ValidationError` the extractor RAISES; cocoindex's flow-
# scope try/except in `app_main()` catches and emits the rollup webhook
# with `error_class=type(exc).__name__` (Option A; structured per-
# extraction-kind routing via `classify_pydantic_error()` is owned by
# the failure-write path in 28.13).
#
# Each `client.messages.create()` call is wrapped by `_anthropic_retry`
# (tenacity). cocoindex 1.0.3 has NO retry primitive around @coco.fn
# extractors — KH owns the surface (Inv-23 / P-OQ2). 3 retries +
# exponential backoff (1 s base, 30 s cap); retries fire on
# `InternalServerError` / `RateLimitError` / `APIConnectionError`;
# auth/bad-request/permission errors propagate immediately.

# Module-level TypeAdapter instances — built once on import, reused per call
# (TypeAdapter construction compiles the validation core per pydantic v2 docs).
_classification_adapter: TypeAdapter[ClassificationExtraction] = TypeAdapter(
    ClassificationExtraction
)
_qa_form_adapter: TypeAdapter[QAFormExtraction] = TypeAdapter(QAFormExtraction)
_entity_mentions_adapter: TypeAdapter[list[EntityMentionExtraction]] = TypeAdapter(
    list[EntityMentionExtraction]
)


# Per-extractor max-tokens ceilings ({73.1} S300 Path-B re-smoke fix).
#
# `max_tokens` is a CEILING, not a reservation — you only pay for tokens
# actually generated, so a generous ceiling costs nothing on small outputs
# while preventing silent truncation on large ones. The old shared 4096 budget
# truncated the `qa_pairs` array of a large charnwood ITT (op 3d1334ba),
# producing a cryptic downstream `Invalid JSON: EOF while parsing` from
# `validate_json` rather than a diagnosable error.
#
# Sized per relative output volume; all <= 64k (claude-opus-4-6 output limit):
#   - qa_form          → largest (a big ITT can produce dozens of long
#                        question/guidance pairs).
#   - entity_mentions  → moderate (~hundreds of short mention objects).
#   - classification   → bounded (one object + a single rationale string).
_MAX_TOKENS_QA_FORM = 32768
_MAX_TOKENS_ENTITY_MENTIONS = 16384
_MAX_TOKENS_CLASSIFICATION = 4096


class TruncatedExtractionError(ValueError):
    """Raised when an Anthropic extraction response was cut off by the
    `max_tokens` ceiling (`stop_reason == 'max_tokens'`).

    Subclasses `ValueError` (NOT `pydantic.ValidationError`) so it:
      - propagates immediately through `_anthropic_retry` (not in the
        retryable-exception set — a truncated response will truncate again);
      - is caught by `app_main()`'s flow-scope try/except alongside
        `ValidationError` (Option A failure path), so a truncated extraction
        still emits the rollup webhook rather than crashing the flow;
      - surfaces a CLEAR, diagnosable message (naming the extractor + the
        token ceiling) instead of the cryptic downstream JSON-parse EOF that
        a silent `max_tokens` cutoff produced pre-{73.1}.
    """


def _guard_not_truncated(response, extractor_name: str, max_tokens: int) -> None:
    """Raise `TruncatedExtractionError` if the Anthropic response was cut off
    by the `max_tokens` ceiling.

    Called by all 3 extractors immediately after the SDK call and BEFORE
    `validate_json`, so a `max_tokens` cutoff surfaces loudly instead of as a
    downstream JSON-parse error on the truncated body ({73.1})."""
    if getattr(response, "stop_reason", None) == "max_tokens":
        raise TruncatedExtractionError(
            f"{extractor_name}: Anthropic response truncated at the "
            f"max_tokens={max_tokens} ceiling (stop_reason='max_tokens'). "
            f"The output JSON is incomplete; raise the per-extractor ceiling "
            f"or chunk the input. See {extractor_name}'s _MAX_TOKENS_* "
            f"constant in extraction.py."
        )


# Anthropic 503-retry wrapper (Inv-23 / P-OQ2). Module-level constants so
# unit tests can monkeypatch to zero (avoids the 1-2-4 s ladder in CI);
# production defaults: 1 s base, 30 s cap, 2× exponent.
_ANTHROPIC_RETRY_WAIT_SECONDS_MIN: float = 1.0
_ANTHROPIC_RETRY_WAIT_SECONDS_MAX: float = 30.0

# Total attempt cap — 1 initial + 3 retries.
_ANTHROPIC_RETRY_TOTAL_ATTEMPTS: int = 4

# Retry only on transient infrastructure failures; auth / bad-request /
# permission errors propagate immediately.
_RETRYABLE_ANTHROPIC_EXCEPTIONS: tuple[type[BaseException], ...] = (
    anthropic.InternalServerError,
    anthropic.RateLimitError,
    anthropic.APIConnectionError,
)


def _bump_flow_retry_counter(retry_state: RetryCallState) -> None:
    """Tenacity `before_sleep` hook — bumps the flow-bound retry counter
    once per retry attempt.

    The function-local lazy import preserves the original import timing
    (canonical single namespace post-{67.2} — see stamp_extraction_base).
    When no counter is bound (e.g. unit tests outside `bind_retry_counter`),
    the bump is silently skipped — the retry still happens, only
    observability is omitted.
    """
    del retry_state  # tenacity API requires the parameter
    # Canonical single-namespace import post-{67.2} (kept function-local).
    from scripts.cocoindex_pipeline import flow_context

    counter = flow_context.current_retry_counter()
    if counter is not None:
        counter.increment()


async def _anthropic_retry(call, /):
    """Async retry helper for `anthropic.AsyncAnthropic.messages.create`.

    The `call` parameter is a zero-arg callable returning the awaitable —
    wrapping in a closure lets tenacity rebuild the SDK call on each
    retry (a single pre-built awaitable would be exhausted after the
    first await).

    Up to 4 attempts (1 + 3 retries), exponential backoff via
    `_ANTHROPIC_RETRY_WAIT_SECONDS_*`. Retries on the 3
    `_RETRYABLE_ANTHROPIC_EXCEPTIONS`; everything else (auth, bad-request,
    `ValidationError`) propagates immediately. `_bump_flow_retry_counter`
    fires via the `before_sleep` hook on each retry attempt.
    """
    retrying = AsyncRetrying(
        stop=stop_after_attempt(_ANTHROPIC_RETRY_TOTAL_ATTEMPTS),
        wait=wait_exponential(
            multiplier=1,
            min=_ANTHROPIC_RETRY_WAIT_SECONDS_MIN,
            max=_ANTHROPIC_RETRY_WAIT_SECONDS_MAX,
        ),
        retry=retry_if_exception_type(_RETRYABLE_ANTHROPIC_EXCEPTIONS),
        before_sleep=_bump_flow_retry_counter,
        reraise=True,
    )
    async for attempt in retrying:
        with attempt:
            return await call()


async def _anthropic_message(client, /, **create_kwargs) -> anthropic.types.Message:
    """Streaming wrapper around `client.messages.create(...)` — bl-222.

    The non-streaming `messages.create(...)` path calls the SDK's
    `_calculate_nonstreaming_timeout(max_tokens, ...)`, which raises
    `ValueError: Streaming is required for operations that may take longer
    than 10 minutes` whenever `max_tokens` exceeds the model's non-streaming
    output cap. bl-221 raised the qa_form ceiling to 32768, which trips this
    guard DETERMINISTICALLY, client-side, before any API call — and because
    it is NOT one of `_RETRYABLE_ANTHROPIC_EXCEPTIONS` it propagates
    immediately and aborts the whole cocoindex ingest (zero rows persist).

    Routing through `messages.stream(...)` is exactly what the SDK mandates
    for large `max_tokens` (and what bl-221 wanted: large form output without
    truncation or the 10-min cap). `stream(**kwargs)` is a SYNCHRONOUS call
    returning an `AsyncMessageStreamManager` (async context manager);
    `get_final_message()` accumulates the streamed deltas into a fully-formed
    `anthropic.types.Message` exposing the SAME interface the non-streaming
    path returned — `.content[0].text` and `.stop_reason` — so the callers'
    `_strip_code_fence`, the TypeAdapters, and `_guard_not_truncated` are
    unchanged. Verified against anthropic 0.79.0.

    Transient streaming failures surface the same
    `InternalServerError` / `RateLimitError` / `APIConnectionError`, so
    `_anthropic_retry` still retries them; this helper is meant to run INSIDE
    the retry closure (`_anthropic_retry(lambda: _anthropic_message(...))`).
    """
    async with client.messages.stream(**create_kwargs) as stream:
        return await stream.get_final_message()


@coco.fn(memo=True)
async def extract_classification(content_text: str) -> ClassificationExtraction:
    """Classification extractor — validates LLM JSON into `ClassificationExtraction`.

    Returns the STAMP-FREE core (bl-220 / ID-74): no op_id / content_items_id /
    extracted_at cross the memo boundary. The flow wrapper stamps the full
    `*Stamped` shape post-memo via `stamp_extraction_base()`. Memo key is
    `(content_text,)` per Inv-21.
    """
    client = anthropic.AsyncAnthropic()  # picks up ANTHROPIC_API_KEY from env
    response = await _anthropic_retry(
        lambda: _anthropic_message(
            client,
            model=ANTHROPIC_MODEL,
            max_tokens=_MAX_TOKENS_CLASSIFICATION,
            messages=[
                {
                    "role": "user",
                    "content": f"{CLASSIFICATION_PROMPT}\n\n{content_text}",
                }
            ],
        )
    )
    _guard_not_truncated(
        response, "extract_classification", _MAX_TOKENS_CLASSIFICATION
    )
    response_text = _strip_code_fence(response.content[0].text)
    return _classification_adapter.validate_json(response_text)


@coco.fn(memo=True)
async def extract_qa_form(content_text: str) -> QAFormExtraction:
    """Q&A form extractor — validates LLM JSON into `QAFormExtraction`.

    Per PRODUCT inv 2 the prompt instructs the LLM to return
    `qa_pairs: []` for non-form documents (rather than synthesising
    pairs). Same memoisation + validation-failure contract as
    `extract_classification`.
    """
    client = anthropic.AsyncAnthropic()
    response = await _anthropic_retry(
        lambda: _anthropic_message(
            client,
            model=ANTHROPIC_MODEL,
            max_tokens=_MAX_TOKENS_QA_FORM,
            messages=[
                {
                    "role": "user",
                    "content": f"{Q_A_FORM_PROMPT}\n\n{content_text}",
                }
            ],
        )
    )
    _guard_not_truncated(response, "extract_qa_form", _MAX_TOKENS_QA_FORM)
    response_text = _strip_code_fence(response.content[0].text)
    return _qa_form_adapter.validate_json(response_text)


@coco.fn(memo=True)
async def extract_entity_mentions(
    content_text: str,
) -> list[EntityMentionExtraction]:
    """Entity-mentions extractor — returns a list (empty if no entities).

    The LLM is instructed to return a JSON array (not an object wrapping
    an array), so the TypeAdapter is `list[EntityMentionExtraction]`.
    Same memoisation + validation-failure contract as `extract_classification`.
    """
    client = anthropic.AsyncAnthropic()
    response = await _anthropic_retry(
        lambda: _anthropic_message(
            client,
            model=ANTHROPIC_MODEL,
            max_tokens=_MAX_TOKENS_ENTITY_MENTIONS,
            messages=[
                {
                    "role": "user",
                    "content": f"{ENTITY_MENTION_PROMPT}\n\n{content_text}",
                }
            ],
        )
    )
    _guard_not_truncated(
        response, "extract_entity_mentions", _MAX_TOKENS_ENTITY_MENTIONS
    )
    response_text = _strip_code_fence(response.content[0].text)
    return _entity_mentions_adapter.validate_json(response_text)
