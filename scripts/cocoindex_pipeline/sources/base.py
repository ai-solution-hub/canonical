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
    Generic,
    Iterable,
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

    That rationale was MEASURED at {427.12}, not assumed — the first time in
    this wave the fingerprint claim was probed rather than asserted.
    `memo_fingerprint._canonicalize_dataclass` emits
    `("dataclass", module, qualname, ((field_name, value), ...))`, so field
    NAMES are fingerprinted: the same key under the two names fingerprints
    `#04c7c14f…` vs `#15803fa4…`. And because every field is canonicalised
    regardless of value, a `topic` key whose locator is `None` invalidates
    too — so a rename here is a WHOLE-CORPUS invalidation, exactly like
    adding a field. Sequencing it behind {427.7} is therefore what makes it
    free; run separately it would have cost a second full re-draft.

    Note for anyone grepping: `workspace_id` remains a live column name on
    eleven UNRELATED tables (intelligence workspaces, feed, queue,
    `q_a_pair_history`). None of them is read by this producer, and none was
    touched by the rename."""

    source_document_id: "str | None" = None
    """The residual DOCUMENT grains' locator (ID-427 {427.10}, TECH §2.2) —
    the `source_documents.id` of the published document this concept stands
    for. `None` for every other grain.

    **Why a field rather than reuse `entity_id`.** TECH §2.2's home table
    names `source_document_id` as this home's key, and `entity_id` is
    documented as an `entity_mentions.canonical_name` — putting a uuid in it
    would make `find()`'s haystack and every future reader wrong about what
    the field holds. Locator ownership is enforced the same way
    `form_instance_id`'s is: `l_records.grain_for` refuses a key that carries
    a locator its grain does not declare, so the two residual document grains
    are the only ones that may set it.

    **BI-10 is not at risk from this field.** A `ConceptKey` locator is never
    rendered into frontmatter or body prose — the rendered pointer for a
    residual document is its `sources[]` entry, minted by
    `resource_uri.build_source_document_uri`, which is the sanctioned
    ingress. The concept's `rel_path` carries only the first 8 hex characters
    of the uuid, which `resource_uri.contains_record_pointer` does not match
    (it requires the full `8-4-4-4-12` form).

    Adding it is a whole-corpus memo invalidation, exactly as {427.12}
    measured for a rename: `memo_fingerprint._canonicalize_dataclass`
    canonicalises EVERY field regardless of value, so a `topic` key whose new
    locator is `None` fingerprints differently too. It rides the wave's single
    `version=3` bump ({427.7}, DR-060/TECH §5) rather than adding a second —
    that bump has not been consumed by a producer run yet, so the corpus
    re-draft it already mandates absorbs this change at no extra cost. This
    was MEASURED at {427.10}, not assumed."""

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
    grain routing, the bundle write path, the won-bid buyer dedup, or
    `find()`'s `_concept_haystack`. A content change must re-draft the SAME
    concept, not mint a new one. Kept LAST in field
    order (after `source_document_id`, which {427.10} inserted ahead of it for
    exactly this reason) so every existing positional/keyword
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

KeyT_co = TypeVar("KeyT_co", covariant=True)
"""`GrainEnumeration`'s key type. COVARIANT — it appears in return position
only (`tuple[KeyT_co, ...]`), unlike `Source`'s `KeyT` further down, which
is invariant because `read_concept`/`sample_rows` also take it as an
argument."""


@dataclass(frozen=True)
class Coverage:
    """The corpus unit ids one grain's concepts REACH — the input to both
    the run census ({427.9}) and the residual grain's complement ({427.10}).

    TECH §2.1: coverage cannot be a standalone SQL predicate, because the
    pattern-matched grains select documents by data-dependent ILIKE terms,
    so **every grain must declare what it covers**.

    **Kind-keyed, not field-keyed — a correction to TECH §1 taken on
    measurement.** The spec sketched two named fields, `source_document_ids`
    and `q_a_pair_ids`, and {427.7} shipped exactly that. But the same §1
    also says "`repo_docs.RepoDocsSource` uses the same registry shape", and
    the repo/docs corpus has neither table: its units are files in a
    checkout. Both clauses cannot hold with named DB-table fields, and
    labelling a `lib/mcp/tools/*.ts` file a "source_document" in a
    `system_baseline` bundle's `log.md` would assert a table that bundle
    never reads. `CorpusCensus` below was already kind-keyed in TECH §2.11
    (`("source_documents", 42)`); this makes the two halves of the census
    agree that unit kinds are OPEN, exactly as concept types became open
    under DR-141.

    Each adapter names its own kinds (`l_records.SOURCE_DOCUMENTS` /
    `Q_A_PAIRS`; `repo_docs.TOOL_SOURCE_FILES` / `NAVIGATION_PAGES`).

    **Coverage is a subset of the CORPUS, not of everything a read touches.**
    A grain's `read` may fetch rows outside the corpus definition — the
    pattern-matched `source_documents` reads carry no `publication_status`
    filter, so an unpublished document can back a concept today. Those rows
    are deliberately NOT counted as covered: `routed` is a count of corpus
    units reached, and counting a non-corpus unit would let `routed` exceed
    `considered` and turn `unrouted` negative. `routed <= considered` holds
    by CONSTRUCTION (every coverage query filters to the same published
    corpus `census()` counts), which is why no clamp guards it here —
    an unreachable defensive branch is the DR-139 pattern this programme
    retires.

    **An empty `Coverage` means "this grain covers nothing", and that is now
    a real measurement** — {427.7} introduced this type unpopulated and
    warned that its empty value was not evidence. {427.9} populates it.
    "Not measured at all" is `LRecordsSource._coverage is None`, a distinct
    state that makes `census()` raise rather than report zeros."""

    covered: "tuple[tuple[str, frozenset[str]], ...]" = ()
    """`(unit_kind, ids)` pairs, sorted by kind. A tuple of frozensets, not a
    dict, because `Coverage` is frozen and therefore hashable — a `Mapping`
    field would raise only at the moment something hashed it."""

    @classmethod
    def of(cls, units: "Mapping[str, Iterable[str]]") -> "Coverage":
        """Build from a `{kind: ids}` mapping. Kinds with no ids are KEPT —
        "this grain reached none of the 42 documents" is a different claim
        from "this grain has no opinion about documents", and the census
        renders the first as `routed 0`."""
        return cls(
            covered=tuple(
                (kind, frozenset(str(unit_id) for unit_id in ids))
                for kind, ids in sorted(units.items())
            )
        )

    def ids(self, kind: str) -> "frozenset[str]":
        """The unit ids covered for `kind` (empty when the kind is absent)."""
        for covered_kind, covered_ids in self.covered:
            if covered_kind == kind:
                return covered_ids
        return frozenset()

    def kinds(self) -> "tuple[str, ...]":
        return tuple(kind for kind, _ in self.covered)

    def union(self, other: "Coverage") -> "Coverage":
        """Per-kind set union — **this is where DR-141's S546 rider lives**.
        The guarantee is coverage (>=1), never partition (=1): a unit reached
        by two grains is counted ONCE, because `routed` asks how many corpus
        units are reachable at all, not how many concept slots they fill.
        A summing union would let `routed` exceed `considered` for exactly
        the overlap RESEARCH C4 measured as legitimate evidence reuse."""
        merged: "dict[str, frozenset[str]]" = {
            kind: ids for kind, ids in self.covered
        }
        for kind, ids in other.covered:
            merged[kind] = merged.get(kind, frozenset()) | ids
        return Coverage(covered=tuple(sorted(merged.items())))


@dataclass(frozen=True)
class CorpusCensus:
    """One run's answer to *"how much of the corpus is reachable in the
    bundle?"* — TECH §2.11, closing id-427 AC 4.

    The load-bearing failure DR-141 names is the **negative answer**: a user
    must be able to trust "we do not know this" over "I could not find it",
    and that needs the bundle to be a faithful projection of the corpus. The
    census is what makes the gap between corpus and bundle a MEASURED
    number in `log.md` rather than a silence.

    `considered` and `routed` are `(unit_kind, count)` pairs over the SAME
    ordered kind list, so `unrouted` is a per-kind subtraction.

    **Empty means NOT TAKEN.** A census that ran and found nothing still
    lists its kinds with zeros (`("source_documents", 0)`), so `considered
    == ()` is unambiguously "no census was supplied for this run" — the
    state a direct `bundle_writer.write_bundle(...)` call is in, having been
    handed drafts rather than a corpus. `_render_run_bullets` emits no
    census line for it, because printing `Considered (0)` there would
    manufacture a measurement nobody took."""

    considered: "tuple[tuple[str, int], ...]" = ()
    routed: "tuple[tuple[str, int], ...]" = ()

    @property
    def unrouted(self) -> "tuple[tuple[str, int], ...]":
        """Per-kind `considered - routed`, in `considered` order, kinds with
        zero omitted."""
        routed_by_kind = dict(self.routed)
        return tuple(
            (kind, count - routed_by_kind.get(kind, 0))
            for kind, count in self.considered
            if count - routed_by_kind.get(kind, 0) != 0
        )

    @property
    def unrouted_total(self) -> int:
        """The number PI-8 keys on, and the term `RunSummary.is_no_op` gains:
        a run that leaves knowledge unrouted is never a silent no-op."""
        return sum(count for _, count in self.unrouted)


@dataclass(frozen=True)
class GrainEnumeration(Generic[KeyT_co]):
    """One grain's `list` result: the concept keys it enumerated, plus what
    those concepts cover.

    Generic over the key type ({427.9}) so `RepoDocsSource`'s two pillars
    return the same object `LRecordsSource`'s grains do rather than a
    parallel one — the defect {427.4} retired for the `Source` protocol
    itself, and the reason TECH §1 asks both adapters to share the registry
    shape."""

    keys: "tuple[KeyT_co, ...]" = ()
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
    declared by the grain — there is no type→directory function"). May nest
    (`case-studies/won-bid`); id-429 IA-5 requires every intermediate
    directory to be real, which `declare_directory_indexes` satisfies by
    construction. Many-to-one is permitted (id-429 IA-4) — two grains may
    name one directory, and a client-declared feeder grain may name a
    built-in's. No built-in pair does so since {427.8} gave the won-bid
    `case_study` grain a directory of its own."""

    type_label: str
    """The OKF `type` value concepts of this grain carry. A LABEL — changing
    it changes what the bundle says and nothing else."""

    list: "Callable[[Any, GrainSpec], Awaitable[GrainEnumeration[Any]]]"
    read: "Callable[[Any, GrainSpec, Any], Awaitable[Any]]"
    sample: "Callable[[Any, GrainSpec, Any, int], Awaitable[SampledRows]]"

    drafts_via: str = "pass1"
    """`"pass1"` (the ordinary agent loop) or `"template"` (a deterministic
    render, no model call). Declared here so {427.10}'s undistilled-document
    grain is a registry entry rather than a special case in the draft loop.

    **ID-427 {427.10} — a correction to TECH §2.3, taken on reading.** The
    spec describes the switch per CLUSTER (*"`drafts_via="pass1"` when the
    cluster has >=1 published `q_a_pair` … `"template"` when it has none"*)
    while TECH §1 declares it a per-GRAIN constant, and the two cannot both
    hold for one residual-documents grain whose members differ. It is
    resolved as {427.7}'s own docstring already anticipated — by naming *"the
    undistilled-document grain"* in the singular, distinct from the document
    grain — so the residual document population splits into TWO registry
    entries sharing one `directory` and one `type_label` (id-429 IA-4 permits
    many-to-one) and differing only here. The enumeration already knows which
    half a document falls in, because it counts that document's published
    pairs to build `content_version` anyway.

    A document that gains its first published answer therefore changes GRAIN
    but not `rel_path`: its identity, its file and its BI-9 citation key are
    untouched (PI-5's property, applied to routing rather than to labels), and
    it re-drafts once — which is correct, since it stopped being undistilled.
    """

    runs_last: bool = False
    """ID-427 {427.10}, TECH §1 (*"runs the residual grain last, handed that
    union"*): declares that this grain enumerates the COMPLEMENT of what the
    others cover, so `list_concepts` must call it after every preferred grain
    has contributed its `Coverage`.

    A declared property rather than a position in the registry tuple, because
    position cannot express it: `LRecordsSource` composes its registry as
    `(*_BUILTIN_GRAINS, *self._feeder_grains())`, so a residual grain placed
    last in the built-in tuple would still run BEFORE every client-declared
    feeder grain and would then treat that feeder's units as unrouted. Adding
    a residual grain stays one registry entry, which is the property {427.7}
    exists to preserve."""

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

    async def census(self) -> CorpusCensus:
        """This run's corpus census — how many units of each kind the corpus
        holds, and how many the enumerated concepts reach (ID-427 {427.9},
        TECH §2.11).

        **Part of the contract, not an optional extra.** A Source that
        cannot say what it left behind is precisely the producer DR-141
        diagnoses, so `run_producer_flow` calls this unconditionally rather
        than probing for it — a `getattr(source, "census", None)` tolerance
        would let a Source reintroduce the silence the census exists to
        remove.

        MUST be called after `list_concepts()`: `routed` is the union of the
        coverages that enumeration produced. Both implementations raise
        rather than report zeros when asked first, because a spurious
        `routed 0` reads as a whole unrouted corpus and would flip
        `RunSummary.is_no_op` on a genuinely idle run.
        """
        ...
