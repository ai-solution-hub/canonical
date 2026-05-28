"""Pydantic shapes + Path A LLM extractors for the cocoindex extraction stage.

Hosts:
  - The discriminated-union typed extraction shapes (Q-EX2 §2.1).
  - The 3 `@coco.fn(memo=True)` Path A extractors that call the Anthropic
    SDK directly + validate via Pydantic `TypeAdapter` (Q-EX2 §3.1).
  - `stamp_extraction_base()` for post-validation flow-scope stamping
    of `_ExtractionBase` fields.
  - `_anthropic_retry` — KH-owned tenacity wrapper around the SDK call
    (Inv-23; cocoindex 1.0.3 has no built-in retry primitive for
    `@coco.fn` extractors).

References:
- `docs/specs/cocoindex-extraction-contract/TECH.md` §2.1, §2.2, §3.2, §4.1.
- `lib/validation/schemas.ts:1506-1519` — `VALID_ENTITY_TYPES` (12 values).
- `docs/ontology/26-form-type.md` — `form_type` CV (markdown side of the
  triple-source lockstep per ID-52.6 / TECH §2.6b).
- `scripts/tests/fixtures/taxonomy_snapshot.json` — canonical `content_types`
  + `form_types` arrays (Python consumer of the triple-source lockstep).
"""

from __future__ import annotations

import json
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
)

from scripts.cocoindex_pipeline.prompts import (
    CLASSIFICATION_PROMPT,
    ENTITY_MENTION_PROMPT,
    Q_A_FORM_PROMPT,
)

# `flow_context` is imported LAZILY inside the retry hook (and inside
# `stamp_extraction_base`) — see `_bump_flow_retry_counter` for the
# dual-import-path rationale (test sys.path injection causes two
# `sys.modules` entries for the same physical file, each with its own
# ContextVar storage; lazy `importlib.import_module(f"{__package__}.…")`
# resolves through whichever path the caller used).

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


# ---------------------------------------------------------------------------
# Pydantic shapes per Q-EX2 TECH §2.1
# ---------------------------------------------------------------------------


class _ExtractionBase(BaseModel):
    """Shared fields stamped by the flow wrapper, NOT by the LLM (Inv-5).

    `op_id`, `content_items_id`, `extracted_at` are populated post-validation
    by `stamp_extraction_base()` — keeping them out of the LLM's `output_type`
    contract prevents the model hallucinating UUIDs.
    """

    model_config = ConfigDict(
        # Strict + extra="forbid" — surfaces type drift and prompt drift loud
        # per Q-EX2 PRODUCT inv 13.
        strict=True,
        extra="forbid",
    )

    op_id: UUID = Field(description="Cocoindex per-flow op_id (02-data-flow §5.1).")
    content_items_id: UUID = Field(
        description="FK to content_items row whose content_text was the input."
    )
    extracted_at: datetime = Field(
        description="UTC timestamp set at LLM-call time by the wrapper."
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


class QAFormExtraction(_ExtractionBase):
    """The q_a_form variant (Q-EX2 PRODUCT inv 2).

    Maps downstream to `q_a_extractions` (per QAPair) + `form_templates`
    (per FormMetadata).
    """

    extraction_kind: Literal["q_a_form"] = "q_a_form"
    form_metadata: FormMetadata
    qa_pairs: list[QAPair] = Field(default_factory=list)


class EntityMentionExtraction(_ExtractionBase):
    """The entity_mention variant (Q-EX2 PRODUCT inv 3).

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


class ClassificationExtraction(_ExtractionBase):
    """The classification variant (Q-EX2 PRODUCT inv 4).

    `content_type` is constrained at runtime via `_validate_content_type`
    below, which reads the canonical taxonomy snapshot.
    """

    extraction_kind: Literal["classification"] = "classification"
    content_type: str
    primary_domain: str
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


# Discriminated-union root for code that wants the union type
# (e.g. tests, mocks). The 3 extractors below return concrete variants.
ExtractionOutput = Annotated[
    Union[
        QAFormExtraction,
        EntityMentionExtraction,
        ClassificationExtraction,
    ],
    Field(discriminator="extraction_kind"),
]


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
) -> ClassificationExtraction | QAFormExtraction | EntityMentionExtraction:
    """Stamp `_ExtractionBase` fields post-validation.

    NOT memoised — values change per flow run; `pydantic.model_copy`
    preserves immutability semantics.

    When `op_id` / `content_items_id` are omitted, reads them from the
    currently-bound `FLOW_META_CTX` so the call-site does not have to
    thread metadata through every `.transform()` chain. Explicit kwargs
    take precedence. Raises `RuntimeError` rather than silently stamping
    zero UUIDs when no binding is active.
    """
    if op_id is None or content_items_id is None:
        # Lazy import via `__package__` resolves to whichever sys.modules
        # entry the caller actually used. Without this, tests that inject
        # via `cocoindex_pipeline.…` (sys.path[0]) and runtime imports via
        # `scripts.cocoindex_pipeline.…` create TWO modules with separate
        # ContextVar storage — bound metadata in one is invisible in the
        # other (see flow_context.py module docstring on the
        # `coco.ContextKey` global-uniqueness pitfall).
        from importlib import import_module

        flow_context_module = import_module(f"{__package__}.flow_context")
        meta = flow_context_module.current_flow_meta()
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

    return extraction.model_copy(
        update={
            "op_id": resolved_op_id,
            "content_items_id": resolved_content_items_id,
            "extracted_at": datetime.now(timezone.utc),
        }
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


# Max-tokens budget — accommodates ~3000-word rationales, ~50 QA-pair forms,
# ~200 entity mentions per call. Validation failures on truncated JSON
# raise `ValidationError` → Option A failure path.
_MAX_TOKENS = 4096


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

    Lazy import via `__package__` keeps ContextVar identity consistent
    across the two import paths (see stamp_extraction_base for the
    full rationale). When no counter is bound (e.g. unit tests outside
    `bind_retry_counter`), the bump is silently skipped — the retry
    still happens, only observability is omitted.
    """
    del retry_state  # tenacity API requires the parameter
    from importlib import import_module

    flow_context_module = import_module(f"{__package__}.flow_context")
    counter = flow_context_module.current_retry_counter()
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


@coco.fn(memo=True)
async def extract_classification(content_text: str) -> ClassificationExtraction:
    """Classification extractor — validates LLM JSON into `ClassificationExtraction`.

    `_ExtractionBase` fields remain at placeholders; stamped post-validation
    by `stamp_extraction_base()`. Memo key is `(content_text,)` per Inv-21.
    """
    client = anthropic.AsyncAnthropic()  # picks up ANTHROPIC_API_KEY from env
    response = await _anthropic_retry(
        lambda: client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": f"{CLASSIFICATION_PROMPT}\n\n{content_text}",
                }
            ],
        )
    )
    response_text = response.content[0].text
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
        lambda: client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": f"{Q_A_FORM_PROMPT}\n\n{content_text}",
                }
            ],
        )
    )
    response_text = response.content[0].text
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
        lambda: client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": f"{ENTITY_MENTION_PROMPT}\n\n{content_text}",
                }
            ],
        )
    )
    response_text = response.content[0].text
    return _entity_mentions_adapter.validate_json(response_text)
