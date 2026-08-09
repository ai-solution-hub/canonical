"""The neutral Source-protocol module the two OKF concept-producer Source
adapters share — ID-427 {427.4}, closing id-362 F1 leg 1.

**Origin.** `ConceptKey`, `ConceptRaw` and the `Source` protocol were authored
in `sources/l_records.py` under ID-132 {132.4} G-SOURCE, as a LOCAL structural
mirror of the reference_agent's own `sources/base.py` Source ABC (external,
never vendored here). `sources/repo_docs.py` was then added under ID-163
{163.4} PC-1 and — because no shared module existed to import from — declared
its OWN structurally-identical copy of the protocol, whose docstring recorded
the consequence: *"the two declarations are structurally identical by design
and must be kept in sync by hand"*. That hand-sync obligation is the defect
{427.4} removes. This module is that shared home; the duplicate is deleted.

**What this module is NOT.** It is not a vendored copy of the reference_agent's
`base.py`, and it does not import `cocoindex` — the same collection-safety
posture `url_source.py`/`l_records.py`/`repo_docs.py` all keep (bare-MagicMock
pipeline unit tests, TECH id-132:41/135). A consumer can `isinstance()`-check
any Source implementation by importing this module alone.

**The re-home changed no behaviour, no field and no gate** ({427.4} is
explicitly a pure move). `CONCEPT_TYPES` and the {132.36} overlay-widening
contextvar travel with `ConceptKey` only because `ConceptKey.__post_init__` is
their sole consumer and a dataclass cannot be separated from its own
validation; both are deleted outright by {427.5}, which turns `type` into a
shape-validated label rather than a membership gate.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import (
    Any,
    Iterable,
    Iterator,
    Mapping,
    Protocol,
    TypeVar,
    runtime_checkable,
)

# ── BI-4: the ratified concept-type set (topic/product/company/certification/
# case_study — metric/playbook/dataset stay tags on `topic`, not types). ─────
CONCEPT_TYPES: frozenset[str] = frozenset(
    {"topic", "product", "company", "certification", "case_study"}
)

# ── ID-132 {132.36} G-CONCEPT-FEEDER — overlay-added concept-type widening.
# `ConceptKey.__post_init__`'s BI-4 membership check is closed against
# `CONCEPT_TYPES` by default — UNCHANGED for every call site that never uses
# the mechanism below (every existing test, every base-5-type `_list_*_
# concepts` method). A client-configured `concept-feeder.json` (read by
# `producer/bundle_writer.read_concept_feeder_config`, threaded into
# `LRecordsSource.__init__`) can declare an OVERLAY-added concept type this
# Source adapter should also enumerate/read; `_permit_overlay_concept_types`
# scopes the WIDENED set to exactly the `with`-block that constructs those
# `ConceptKey`s (see `list_concepts`) so no OTHER construction site — a
# test, a future caller — is affected.
#
# A `contextvars.ContextVar` (not a bare module global): `list_concepts`
# `await`s between the `_list_*_concepts` calls it wraps, so a bare mutable
# global would leak across any concurrently-scheduled asyncio Task that ALSO
# constructs a `ConceptKey` during that window; a `ContextVar` does not
# (each Task gets its own context).
#
# Deliberately NOT threaded as a `ConceptKey` field: cocoindex's own
# `_canonicalize_dataclass` (`cocoindex/_internal/memo_fingerprint.py`)
# fingerprints EVERY dataclass field unconditionally (it does not honour
# `field(compare=False)`), so a per-instance "allowed types" field would
# silently invalidate EVERY concept's memo cache — not just feeder-fed
# ones — on any feeder-config edit (a BI-18 memo-hygiene regression this
# module must not introduce).
#
# The ACTUAL legality gate for an overlay-added type remains `producer/
# validator.py`'s OV-8-composed `check_type_membership` — this mechanism
# only lifts the Source adapter's OWN defence-in-depth guard so it does not
# itself block a feeder-constructed key; a feeder-declared type absent from
# the run's `ontology-overlay.json` still drafts (wasted work) but is
# soft-rejected at the BI-13 gate (`RunSummary.validator_failures`), never
# silently published. ───────────────────────────────────────────────────
_permitted_overlay_concept_types: "contextvars.ContextVar[frozenset[str]]" = (
    contextvars.ContextVar(
        "_l_records_permitted_overlay_concept_types", default=frozenset()
    )
)


@contextmanager
def _permit_overlay_concept_types(types: "Iterable[str]") -> "Iterator[None]":
    """Scope `ConceptKey.__post_init__`'s BI-4 check to ALSO accept `types`
    for the duration of this `with` block only — see the constant above for
    the full rationale (async-task-safe, memo-fingerprint-safe)."""
    token = _permitted_overlay_concept_types.set(frozenset(types))
    try:
        yield
    finally:
        _permitted_overlay_concept_types.reset(token)


@dataclass(frozen=True)  # frozen → deterministic cocoindex memo key (BI-18)
class ConceptKey:
    """A concept's identity + the locator fields its `read_concept` join
    needs. Frozen: this is the memo-keyed component argument the {132.8}
    `enrich_concept` component will key `@coco.fn(memo=True)` on (the
    `url_source.py` `UrlItem` / EXECUTOR-VERIFY-1 precedent — equal-valued
    distinct instances memo-hit; a bumped field re-executes).
    """

    rel_path: str
    """Concept identity — the bundle rel_path (BI-2) — the cocoindex memo
    key. A concept has no DB row and no uuid of its own; renaming this path
    changes the concept's identity."""

    concept_type: str
    """One of the BI-4 ratified set (`CONCEPT_TYPES`), OR — ID-132 {132.36}
    G-CONCEPT-FEEDER — a client-configured overlay-added type currently
    permitted via `_permit_overlay_concept_types` (`list_concepts`'s feeder
    pass only; every other construction site is unaffected). Never
    `'q_a_pair'` (BI-3: a Q&A pair is never a concept — unconditional, even
    for an overlay-permitted type). Validated in `__post_init__`."""

    scope_tag: "str | None" = None
    """`topic` locator: a single `q_a_pairs.scope_tag` array element this
    concept clusters — the ONLY topic locator since S531 (the
    domain/subtopic fallback grain retired under DR-125's expiry, mirrors
    `producer/resource_uri.py:build_q_a_pairs_query_uri`'s BI-8 locator
    contract)."""

    entity_id: "str | None" = None
    """`product`/`certification`/`case_study` locator: the entity's
    `entity_mentions.canonical_name` (or, for `product`, the filename-match
    token) identifying which single entity this concept represents. Unused
    (`None`) for `topic` and the singleton `company` type. For the won-bid
    `case_study` grain it carries the buyer identity (the won form's
    `issuing_organisation`)."""

    workspace_id: "str | None" = None
    """`case_study` won-bid grain locator ONLY (S443 amendment / DR-029). Set
    for the won-bid case_study source, `None` for the named-clients case_study
    source and every other type. Its presence is what routes `read_concept` to
    the won-bid read (`derived_from_form_response` q_a_pairs + the won form's
    own `outcome_notes`) instead of the named-clients source_documents grain.

    **{145.24} re-point (post-{145.6} W1e workspace-stratum deletion):** this
    field now holds the won `form_instances.id`, NOT a `workspaces.id` — the
    procurement `workspaces` stratum no longer exists (W1e wholesale-deletes
    every procurement workspace row; W1c drops `form_instances.workspace_id`).
    The field KEEPS the name `workspace_id` deliberately rather than being
    renamed to `form_instance_id`: `producer/flow_def.py` and
    `producer/bundle_writer.py` (both outside this Subtask's file-ownership
    boundary) read `ConceptKey.workspace_id` by attribute name, and renaming
    it would ripple into those files mid-wave. Recommended to the Curator as
    backlog-worthy naming-debt cleanup once those files' own Subtask can land
    the rename alongside its callers."""

    content_version: str = ""
    """**MEMO-FINGERPRINT-ONLY** (ID-132 {132.38} G-MEMO-DELTA, MD-3/MD-4,
    DR-060). A deterministic, per-concept content signal computed by
    `list_concepts()`'s six enumeration methods from the concept's OWN
    backing-table read grid (MD-7) — set-based `count(*) + max(updated_at)`
    terms per table, combined in fixed table order (MD-6: no wall-clock, no
    run timestamp; byte-identical backing content → byte-identical value).
    This is the BI-18 delta lever: `ConceptKey` is frozen and is the
    `@coco.fn(memo=True, memo_key={'source': None})`-keyed argument on
    `producer/enrich.py:enrich_concept`, so two enumerations of the SAME
    concept with an unchanged `content_version` memo-HIT (skip drafting) and
    a changed one memo-MISS (re-draft) — see `_canonicalize_dataclass`
    (`memo_fingerprint.py:131-151`), which fingerprints every field.

    **EXCLUDED from identity** (BI-2/MD-4) — this field participates ONLY in
    the memo fingerprint, never in `__post_init__` validation, `read_concept`
    type routing, `bundle_write_path`/`bundle_write_path_for_key`, the
    won-bid buyer dedup, or `find()`'s `_concept_haystack`. A content change
    must re-draft the SAME concept, not mint a new one. Kept LAST in field
    order (after `workspace_id`) so every existing positional/keyword
    `ConceptKey(...)` construction stays valid with its `""` default."""

    def __post_init__(self) -> None:
        if not self.rel_path:
            raise ValueError(
                "ConceptKey.rel_path must be non-empty (BI-2: concept "
                "identity = bundle rel_path = the cocoindex memo key)"
            )
        if self.concept_type == "q_a_pair":
            raise ValueError(
                "ConceptKey.concept_type may never be 'q_a_pair' (BI-3: a "
                "q_a_pair is never a concept) — this holds unconditionally, "
                "even for a concept type otherwise permitted via the "
                "{132.36} concept-feeder mechanism."
            )
        if (
            self.concept_type not in CONCEPT_TYPES
            and self.concept_type not in _permitted_overlay_concept_types.get()
        ):
            permitted = sorted(_permitted_overlay_concept_types.get())
            raise ValueError(
                f"ConceptKey.concept_type must be one of {sorted(CONCEPT_TYPES)} "
                "(BI-4 ratified set) or a concept type currently permitted "
                "via the {132.36} concept-feeder mechanism "
                f"({permitted or 'none'}); a q_a_pair is never a concept "
                f"(BI-3). Got {self.concept_type!r}."
            )
        if self.workspace_id is not None and self.concept_type != "case_study":
            raise ValueError(
                "ConceptKey.workspace_id is the won-bid case_study locator "
                "(S443 amendment); it may only be set when "
                f"concept_type == 'case_study' (got {self.concept_type!r})"
            )


@dataclass
class ConceptRaw:
    """The raw joined L-record rows backing one concept — `read_concept`'s
    return shape. Each field is populated only where the TECH §"Per-
    concept-type table/join grid" names that table for the concept's
    `concept_type` (e.g. `product`/`case_study` never populate
    `record_lifecycle`/`entity_relationships`; `company`/`certification`
    never populate `q_a_pairs`/`record_lifecycle`/`entity_relationships`).

    `workspaces`/`form_templates` were populated ONLY by the won-bid
    `case_study` grain (S443 amendment / DR-029) — every named-clients /
    topic / product / company / certification read leaves them empty.
    **{145.24}:** post-{145.6} W1e (the procurement workspace-stratum
    delete), `workspaces` is now ALWAYS empty, including for the won-bid
    grain — there is no more `workspaces` row to fetch. `form_templates`
    (kept under its pre-rename field name; the underlying table is now
    `form_instances`) still carries the won-bid grain's one row, now
    self-contained (`issuing_organisation`/`name`/`outcome_notes` live
    directly on the form — no workspace join was ever needed for those).

    Never frozen (unlike `ConceptKey`): this is a per-call return value, not
    a cocoindex memo key.
    """

    source_documents: "list[Mapping[str, Any]]" = field(default_factory=list)
    q_a_pairs: "list[Mapping[str, Any]]" = field(default_factory=list)
    # DR-124/DR-130: NO LONGER POPULATED — the ri evidence legs retired with
    # the ri<->sd join path. The field stays (always []) as the
    # enrich.py-facing seam; reference re-entry into concept building is
    # id-422's open question.
    reference_items: "list[Mapping[str, Any]]" = field(default_factory=list)
    record_lifecycle: "list[Mapping[str, Any]]" = field(default_factory=list)
    entity_mentions: "list[Mapping[str, Any]]" = field(default_factory=list)
    entity_relationships: "list[Mapping[str, Any]]" = field(default_factory=list)
    workspaces: "list[Mapping[str, Any]]" = field(default_factory=list)
    form_templates: "list[Mapping[str, Any]]" = field(default_factory=list)


# ── The Source protocol — ONE declaration, generic over its key/raw pair.
#
# {427.4} design decision. The two adapters are typed over DIFFERENT concept
# models — `LRecordsSource` over `ConceptKey`/`ConceptRaw` (the L-records
# tables), `RepoDocsSource` over `RepoConceptKey`/`RepoConceptRaw` (the
# repo/docs checkout) — so collapsing the two hand-synced declarations into
# one requires the protocol to be PARAMETERISED over that pair rather than
# pinned to either. A protocol pinned to `ConceptKey` would accept
# `RepoDocsSource` at runtime (`runtime_checkable` only checks that the four
# method NAMES exist) while rejecting it statically — precisely the
# silently-divergent state the duplicate declaration already produced.
#
# Variance is not stylistic here:
#   * `KeyT` is INVARIANT — it appears both in return position (`list[KeyT]`,
#     itself an invariant container) and in argument position
#     (`read_concept`/`sample_rows`), so neither co- nor contravariance is
#     sound.
#   * `RawT_co` is COVARIANT — it appears in return position only. Declaring
#     it invariant makes a protocol-variance check fail ("invariant type
#     variable used in protocol where covariant one is expected").
#
# `runtime_checkable` is preserved from both retired declarations: it is the
# public contract id-362 F1 asks for, and `isinstance(x, Source)` (bare, never
# subscripted — a subscripted generic cannot be used in an isinstance check)
# stays available to any consumer. It verifies method PRESENCE only; the
# parameterisation above is what a type checker verifies. ─────────────────
KeyT = TypeVar("KeyT")
RawT_co = TypeVar("RawT_co", covariant=True)


@runtime_checkable
class Source(Protocol[KeyT, RawT_co]):
    """The concept-producer Source contract: `list_concepts()` /
    `read_concept(key)` are the ABC-equivalent abstract methods,
    `sample_rows(key, n)` / `find(query)` the concrete helpers. Structural
    mirror of the reference_agent's `sources/base.py` Source ABC (external,
    not vendored).

    Implemented by `sources/l_records.py:LRecordsSource`
    (`Source[ConceptKey, ConceptRaw]`) and `sources/repo_docs.py:RepoDocsSource`
    (`Source[RepoConceptKey, RepoConceptRaw]`). Conformance is structural —
    neither adapter subclasses this protocol.
    """

    async def list_concepts(self) -> "list[KeyT]": ...

    async def read_concept(self, key: KeyT) -> RawT_co: ...

    async def sample_rows(
        self, key: KeyT, n: int
    ) -> "list[Mapping[str, Any]]": ...

    async def find(self, query: str) -> "list[KeyT]": ...
