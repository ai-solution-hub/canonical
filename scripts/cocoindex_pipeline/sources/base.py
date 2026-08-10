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

**The re-home changed no behaviour, no field and no gate** ({427.4} was
explicitly a pure move). It carried `CONCEPT_TYPES` and the {132.36}
overlay-widening contextvar along as a waypoint, because
`ConceptKey.__post_init__` was their sole consumer; **{427.5} has since
deleted both** (DR-141). `ConceptKey.concept_type` is now validated by
`producer/validator.check_type_shape` — the SAME shape rule the BI-13 write
gate and `repo_docs.RepoConceptKey` apply, so there is exactly one
definition of what a concept type may look like, and it is not a set of
permitted values.

**{427.7} adds the GRAIN vocabulary** (`GrainSpec`/`GrainEnumeration`/
`Coverage`, TECH §1) and `ConceptKey.grain`. A grain is the declared object
an adapter enumerates over; `grain` is the dispatch key that replaces the
`concept_type` sniffing every read/sample path used to do. The two are
deliberately separate: `concept_type` is the emitted LABEL (relabellable, and
relabelling must not move a file — PI-5), `grain` is the ROUTE. Keeping one
identifier for both is the inversion DR-141 withdrew, expressed in code.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import (
    Any,
    Awaitable,
    Callable,
    Mapping,
    Protocol,
    TypeAlias,
    TypeVar,
    runtime_checkable,
)

# ID-427 {427.5}: the one shape rule (TECH §2.8). Importing `producer/
# validator.py` keeps collection-safety — neither it nor its own imports
# (`producer/frontmatter.py`, `producer/resource_uri.py`) touch `cocoindex`
# at module scope — and it mirrors what `sources/repo_docs.py` already did.
from scripts.cocoindex_pipeline.producer.validator import check_type_shape

# ── Concept slug minting (ID-427 {427.7}, TECH §2.6 / id-429 IA-3) ───────

_SLUG_INVALID_RE = re.compile(r"[^a-z0-9]+")

RESERVED_CONCEPT_STEMS = frozenset({"index", "log"})
"""OKF §3.1 reserves `index.md` and `log.md` **at any directory level**; they
MUST NOT be concept documents. Held here (not in either adapter) because both
adapters mint concept slugs and the reservation is a property of the FORMAT,
not of one adapter's grains."""


def _slugify(value: str) -> str:
    """Deterministic filename-safe slug for a bundle rel_path segment. Was
    declared identically — and separately — in `l_records.py` and
    `repo_docs.py` until {427.7}; the duplication is retired for the same
    reason {427.4} retired the duplicate `Source` protocol."""
    slug = _SLUG_INVALID_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "untitled"


def mint_concept_slug(value: str) -> str:
    """`_slugify`, then the id-429 **IA-3** reserved-name guard: a slug that
    case-folds to a reserved stem gets a `-concept` suffix.

    **Why this is blocking, not cosmetic** (id-429 {429.5}, landed): the
    producer declares every concept and THEN declares one `index.md` per
    directory (`bundle_writer.write_bundle` — `declare_directory_indexes`
    runs after the concept loop). A concept whose physical path is
    `<dir>/index.md` is therefore ACTIVELY OVERWRITTEN by the emitted index
    in the same run, last write wins, and is then reconciled away. Under the
    closed type vocabulary this was unreachable; {427.5} opened the
    vocabulary, and this is the guard that keeps it unreachable.

    **Rename, not refusal** (TECH §2.6): a client document legitimately
    called "Index" is a data fact, not a configuration error, and aborting a
    whole producer run over one is the opposite of DR-047's narrowly-scoped
    degrade posture. A directory that ends up holding both a reserved
    `index.md` and a genuine `index-concept.md` is unambiguous; a directory
    that would hold two `index-concept` slugs still trips `write_bundle`'s
    existing pre-write collision guard and fails loud before any write.

    A feeder-declared *directory* named `index`/`log` is guarded differently
    — that IS a configuration error, and
    `bundle_writer._validate_concept_feeder_schema` refuses it at read time.
    """
    slug = _slugify(value)
    if slug.casefold() in RESERVED_CONCEPT_STEMS:
        return f"{slug}-concept"
    return slug


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
    """The concept's OKF `type` LABEL — any well-shaped label
    (`producer/validator.check_type_shape`: lowercase snake_case, 3–40
    chars, ≤4 words). ID-427 {427.5}/DR-141: there is no permitted-value
    set and no per-bundle-class set, so a grain may mint a type this
    codebase has never seen without editing any register — that openness is
    the point (OKF §1 lists a fixed concept-type taxonomy under Non-goals).
    Never `'q_a_pair'` (BI-3: a Q&A pair is never a concept —
    unconditional). Validated in `__post_init__`.

    **{427.7}: nothing routes on this field any more.** It is written into
    frontmatter and read by the viewer's bundle-derived type filter, and
    that is all. Every read/sample path routes on `grain` below."""

    grain: str
    """ID-427 {427.7} — the DISPATCH key: the `GrainSpec.name` of the grain
    that enumerated this concept (TECH §1). `read_concept`/`sample_rows`
    resolve `self._grains[key.grain]` instead of sniffing `concept_type`,
    which is what makes adding a grain **one registry entry** and no
    dispatcher edit — the property whose absence produced the inversion
    DR-141 diagnoses.

    Distinct from `concept_type` on purpose, and the distinction is
    load-bearing in both directions: two grains may emit the SAME label
    (the named-client and won-bid `case_study` grains do), and relabelling
    a grain's `type_label` changes the emitted `type` while leaving routing
    and the concept's physical path untouched (PI-5).

    Positioned immediately after `concept_type` per TECH §5 — the "keep new
    fields last for positional compatibility" convention is retired for this
    wave. Measured before taking it: **zero** `ConceptKey(...)` constructions
    anywhere in `scripts/` pass a positional argument (AST projection, S547),
    so the silent-positional-shift hazard TECH §5 warns about does not exist
    in this codebase — the field ordering is chosen for readability, and the
    compile-time break is only that `grain` is required."""

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

    form_instance_id: "str | None" = None
    """The won-bid case_study GRAIN's locator (S443 amendment / DR-029). Set
    by that grain's enumeration, `None` everywhere else.

    **{427.7}: it no longer routes anything.** Its presence used to BE the
    won-bid/named-clients switch inside `read_concept`'s `case_study` arm;
    `grain` now carries that decision, and `l_records.read_concept` keeps a
    fail-loud guard that this locator is only ever set on the grain that
    declares it. The locator-ownership rule left `__post_init__` in the same
    change: it was written as `concept_type != 'case_study'`, and a rule
    keyed on a relabellable LABEL would reject every won-bid key the moment
    that grain's `type_label` changed — PI-5 says a relabel must change the
    emitted `type` and nothing else. The check lives with the registry that
    knows which grain owns the locator, which is `l_records.py`, not here.

    **{145.24} re-point (post-{145.6} W1e workspace-stratum deletion):** this
    field holds the won `form_instances.id`, NOT a `workspaces.id` — the
    procurement `workspaces` stratum no longer exists (W1e wholesale-deletes
    every procurement workspace row; W1c drops the `form_instances.workspace_id`
    column).

    **ID-427 {427.12} — RENAMED here, closing id-358.** The field was called
    `workspace_id` from mint until this change, and {145.24} recorded why it
    was left that way: `producer/flow_def.py` and `producer/bundle_writer.py`
    read it by attribute name from outside that Subtask's file-ownership
    boundary, so renaming it then would have rippled mid-wave. ID-427 rewrites
    those files anyway, which dissolves the reason. The name was the ONLY thing
    wrong with it — the value, its meaning and the BI-28 provenance slot it
    feeds are all unchanged (owner ruling QC3-A, S546: the slot STAYS).

    Sequenced after {427.7} on purpose: that subtask added `grain` to this
    dataclass, and cocoindex fingerprints every field unconditionally, so
    landing both field-set changes under one `version=` bump costs the corpus
    ONE re-draft instead of two (TECH §5 / DR-060). **No second bump was added
    by {427.12}.**

    Note for anyone grepping: `workspace_id` remains a live column name on
    eleven UNRELATED tables (intelligence workspaces, feed, queue,
    `q_a_pair_history`). None of them is read by this producer, and none was
    touched by the rename."""

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
    order (after `form_instance_id`) so every existing positional/keyword
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
                "q_a_pair is never a concept) — this holds unconditionally."
            )
        shape_errors = check_type_shape(self.concept_type)
        if shape_errors:
            raise ValueError(
                f"ConceptKey.concept_type is not a well-formed OKF type "
                f"label: {'; '.join(shape_errors)}"
            )
        if not self.grain:
            raise ValueError(
                "ConceptKey.grain must be non-empty (ID-427 {427.7}: it is "
                "the dispatch key `read_concept`/`sample_rows` resolve the "
                "grain registry on — a concept with no grain cannot be read)"
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


# ── The grain vocabulary (ID-427 {427.7}, TECH §1) ──────────────────────
#
# "A grain is a declared object, and everything about it lives in one place."
# Before this, a grain was four edits in four places (an enumeration method,
# a `read_concept` arm, a `_source_documents_for_key` arm, a `sample_rows`
# arm) plus a directory literal inlined in each — and, until {427.5}, four
# type registries as well. That structure is *why* nobody added a catch-all,
# which is the defect DR-141 names.


@dataclass(frozen=True)
class Coverage:
    """The unit ids one grain's concepts REACH — the input to the residual
    grain's complement (TECH §2.1: coverage cannot be a standalone SQL
    predicate, because the pattern-matched grains select documents by
    data-dependent ILIKE terms, so every grain must declare what it covers).

    **Not yet populated by any grain.** {427.7} introduces the type and the
    seam; **{427.9} is what fills it** (one set-based query per grain) and
    {427.10} is what consumes the complement. An empty `Coverage` here means
    "this grain has not been asked yet", NOT "this grain covers nothing" —
    reading it as a measurement before {427.9} lands would be reading an
    absence as evidence."""

    source_document_ids: "frozenset[str]" = frozenset()
    q_a_pair_ids: "frozenset[str]" = frozenset()


@dataclass(frozen=True)
class GrainEnumeration:
    """One grain's `list` result: the concept keys it enumerated, plus what
    those concepts cover."""

    keys: "tuple[ConceptKey, ...]" = ()
    covers: Coverage = Coverage()


SampledRows: "TypeAlias" = list[Mapping[str, Any]]
"""What a grain's `sample` returns — a bounded slice of its backing rows for
the Pass-1 prompt window.

Declared at module scope rather than inline in `GrainSpec` for a mundane but
real reason: `GrainSpec` follows TECH §1 in naming its enumeration callable
`list`, which shadows the builtin **inside the class namespace**, so a
sibling annotation written as `list[...]` resolves to the field and not the
type (mypy: *"Variable GrainSpec.list is not valid as a type"*). Keeping the
spec's vocabulary and moving the annotation out is the smaller compromise."""


@dataclass(frozen=True)
class GrainSpec:
    """One declared grain. **Adding a grain is one of these; there is no
    dispatcher to edit.**

    *Deviation from TECH §1's sketch, taken deliberately.* The spec typed the
    three callables as `Callable[[Pool], ...]`, i.e. a registry of free
    functions handed a pool. They are typed here as taking the SOURCE
    (`(source, spec, ...)`) instead, because two of the seven grains cannot
    be expressed against a bare pool: the feeder grain is built from
    per-instance config (TECH §2.7 — "a client-declared preferred-routing
    grain"), and `RepoDocsSource`'s grains hold a checkout root, not a pool.
    Taking the source generalises the spec's shape rather than narrowing it —
    the pool is reachable from the source, config is not reachable from the
    pool.

    Passing `spec` back into its own callables is what lets a grain's
    enumeration read its OWN `directory` and `type_label` instead of
    inlining them, which is the mechanical reason relabelling cannot move a
    file (PI-5)."""

    name: str
    """The dispatch key, stamped onto every key this grain mints as
    `ConceptKey.grain`. Unique within one Source's registry."""

    directory: str
    """The bundle directory this grain OWNS (TECH §2.4: "the directory is
    declared by the grain — there is no type→directory function"). Many-to-one
    is fine and is used: both `case_study` grains own `case-studies`
    (id-429 IA-4)."""

    type_label: str
    """The OKF `type` value concepts of this grain carry. A LABEL — changing
    it changes what the bundle says and nothing else."""

    list: "Callable[[Any, GrainSpec], Awaitable[GrainEnumeration]]"
    read: "Callable[[Any, GrainSpec, Any], Awaitable[Any]]"
    sample: "Callable[[Any, GrainSpec, Any, int], Awaitable[SampledRows]]"

    drafts_via: str = "pass1"
    """`"pass1"` (the ordinary agent loop) or `"template"` (a deterministic
    render, no model call). Declared here so {427.10}'s undistilled-document
    grain is a registry entry rather than a special case in the draft loop;
    every grain that exists today is `"pass1"`."""

    sample_kind: str = "q_a_pairs"
    """What `sample` returns: `"q_a_pairs"` rows, or `"source_documents"`
    rows. **This is not decoration.** `producer/enrich.py`'s tool executor
    must mint a BI-6 `canonical://` anchor for every sampled `source_documents`
    row — an unminted one leaks a real record id into the conversation that
    the BI-17 provenance gate must then refuse. Before {427.7} that decision
    was a hand-written `concept_type in ("company", "certification")` test in
    `enrich.py`, a fourth dispatcher mirroring `sample_rows`' fallthrough arm
    across a module boundary; a newly-registered source-documents-sampling
    grain would have silently missed it."""


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
