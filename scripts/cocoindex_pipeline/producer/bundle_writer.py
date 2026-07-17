"""Bundle-writer — validator-gated `declare_file` per concept, `index.md` /
`log.md` writers, the DR-027 ontology artefact (ID-132 {132.10} G-BUNDLE).

Consumes the {132.7}/{132.8}/{132.9} drafts (`producer.enrich.ConceptDraft`,
`producer.web_pass.ReferenceConceptDraft`) and is the ONLY call site that
turns them into on-disk bundle files, per `docs/specs/id-132-okf-concept-
producer/TECH.md` §"The two-pass loop" (index.md/log.md paragraph) +
§"Proposed changes per invariant" BI-11/13/18:

    Per concept: call the validator gate (id 7) THEN
    localfs.declare_file(bundle_dir/concept_path, markdown,
    create_parent_dirs=True) (BI-11). regenerate_indexes() (BI-5/BI-11):
    render the ~17 client themes as index.md nav sections over the concept
    set (progressive disclosure; themes are nav, NOT concept files). log.md
    (BI-11/BI-18): append one block per producer run.

**S451 rider (BINDING — the shipped {132.14} viewer's parsers are the
format contract), as amended by the OKF v0.1 conformance wave (SPEC
§7/§11).** `regenerate_indexes` and `append_log_entry` emit EXACTLY the
text shape `lib/okf/parse-index.ts` / `lib/okf/parse-log.ts` parse — a
format mismatch degrades `<BundleNav>`/`<BundleLog>` SILENTLY (both
parsers have a graceful type-grouping fallback, so a divergence would not
raise, just quietly degrade). `parse-index.ts`: a §11 frontmatter block
(`okf_version: "0.1"` — the single key; the parser skips it), then
`##`/`###` theme headings, `* [title](path.md) — description` concept
bullets (this writer picks the em-dash separator — the parser's own worked
example glyph; both `-`/`—` are accepted, so a hyphen would ALSO
round-trip, but consistency with the addendum's own example is preferred).
`parse-log.ts` (§7): `## YYYY-MM-DD` DATE headings, newest date FIRST
(prepend); runs within a date are `* **Run <ISO-ts> — <Action> (N):** …`
bullets, newest run first. A committed round-trip fixture
(`__tests__/fixtures/okf/bundle-writer-*.md`, generated FROM this module's
own `regenerate_indexes`/`append_log_entry` output) plus a Vitest
assertion in `__tests__/lib/okf/` prove this module never silently drifts
from the parsers' contract.

**EXECUTOR-VERIFY finding (feeds {132.12} G-GITSYNC — TECH §Git
knowledge-sync).** Confirmed EMPIRICALLY against the real (unsandboxed)
`cocoindex==1.0.7` engine: a bare `localfs.declare_file(path, content)`
call — with NO `DirTarget`/`declare_dir_target` keyset — DOES orphan-delete
a path that was declared in a PRIOR run but is NOT re-declared in the
CURRENT run. Reading `cocoindex/connectors/localfs/_target.py` confirms
WHY: every `declare_file` call registers a root-level target state keyed
by `(base_dir_key, absolute_path)` against the SAME shared
`"cocoindex/localfs"` root provider (`register_root_target_states_
provider`), regardless of whether it was reached via the free
`declare_file` function or a `DirTarget`; the engine's reconcile pass
diffs THIS run's declared keyset for that provider against the PRIOR
run's, and issues a delete action (`_reconcile_entry`'s `NON_EXISTENCE`
branch → `path.unlink`) for any key that dropped out — with NO DirTarget
required. Practical corollary this module relies on: `write_bundle` below
declares ONLY the concepts that should exist THIS run (never calls
`declare_file` for a removed/moved-away path itself) and lets the REAL
engine's own reconciliation perform the physical delete on the next actual
flow update — `write_bundle`'s own `removed`/`moved` bookkeeping is
purely for the `log.md` summary, never a manual `unlink`. A second,
narrower finding germane to {132.12}'s human-edit 3-way reconcile design:
`_reconcile_entry` compares the NEW declared content's fingerprint against
cocoindex's OWN prior TRACKING RECORD (its internal LMDB state), never
against the file's actual CURRENT on-disk bytes — so a human edit made
directly to a managed file, between two producer runs, is invisible to
cocoindex's own dedup and WILL be silently clobbered the next time the
producer's OWN declared content for that concept changes (the exact
BI-22 clobber hazard TECH names {132.12} to solve; cocoindex's engine
provides no help detecting it).

**Cross-grain `case_study` slug collision (ID-132 {132.29}).** A buyer that
is BOTH a named-client entity (`sources/l_records.py:_list_case_study_
concepts`) AND a won-bid `issuing_organisation` (`_list_won_bid_case_study_
concepts`, S443 amendment/DR-029) slugs identically — both grains build the
SAME identity `rel_path` `case-studies/<slug>.md`. The Source adapter is
CORRECT here (READ-ONLY, not touched by this fix): the two `ConceptKey`s
differ by `workspace_id` and therefore memoise as distinct cocoindex cache
entries — the collision is purely a bundle PHYSICAL-write-target clash, not
an identity/memo-key clash. Rejected merging the two drafts into one bundle
file: BI-28 requires the won-bid grain to stay a distinct human-reviewable
accept/edit/reject PROPOSAL, never silently blended into an already-
published named-client page, and two independently-sourced `ConceptDraft`s
(different provenance, frontmatter, body) have no principled "whose content
wins" answer. Chosen instead: `bundle_write_path` redirects every won-bid
`case_study` draft's PHYSICAL write target into a `won-bid/` sibling
directory (`case-studies/won-bid/<slug>.md`) — the draft's identity
`rel_path` (`ConceptKey.rel_path`, the memo key and the DR-016 human-
override key for every OTHER concept type) is untouched; only WHERE this
module's own `declare_file` call lands changes, so the named-client grain's
existing bundle path — and therefore its DR-016 override-keying — is
completely unaffected (zero behaviour change for the common, non-colliding
case). `canonical://` pointer stability is likewise unaffected: those URIs
address DB rows by id (TECH §resource_uri), never a bundle rel_path, so
redirecting a won-bid concept's on-disk location cannot invalidate one.
Different path SHAPE (not merely different content) makes the two grains
structurally non-collidable. `write_bundle` additionally guards the general
case defense-in-depth: ANY two drafts whose write paths coincide in one run
(this scenario, or any future one) raise `ValueError` before either is
written, rather than the second silently clobbering the first.

**Physical-vs-identity key reconciliation (ID-132 {132.29} fix-forward,
post-checker-FAIL).** `bundle_write_path` is PUBLIC (not `_`-prefixed) for
exactly one reason: `producer/flow_def.py` composes `write_bundle`'s
`RunSummary.added`/`.changed` (PHYSICAL write paths) with its own
embed/BI-28-provenance steps, which — before this fix — re-derived a
lookup key via IDENTITY `rel_path` alone, silently missing every won-bid
`case_study` entry (a dict keyed by identity never matches a summary
reported by physical path) and, in the cross-grain same-slug collision
case, risking one concept's embedding clobbering the other's under a
shared identity key. `bundle_write_path`/`bundle_write_path_for_key` are
the single source of truth for the redirect rule (`_won_bid_case_study_
redirect`) so `flow_def.py` can key its own lookups on the IDENTICAL
physical path this module already used to decide where each draft
actually landed, rather than re-implementing (and risking drifting from)
the redirect rule a second time.

**Full flow wiring composed in `producer/flow_def.py` ({132.23}).**
`write_bundle`/`declare_concept` are plain orchestration functions, NOT
`@coco.fn`-decorated components — BI-18's delta-only property already falls
out of (a) `enrich_concept`/`run_web_pass`'s OWN `@coco.fn(memo=True)`
upstream (a concept whose backing records are unchanged never re-executes,
so `write_bundle` receives the IDENTICAL `ConceptDraft` and calls
`declare_file` with byte-identical content, which the ENGINE'S OWN
fingerprint reconcile then no-ops) and (b) `declare_file`'s own per-path
lineage (verified above) — so this module needs no memoisation of its own.
Composing `LRecordsSource.list_concepts()` → `enrich_concept` (Pass-1) →
`write_bundle(...)` → embed → git-sync/publish-gate into ONE producer entry
point was originally deferred to {132.13} (`producer/publish.py`), which
DISCLAIMED it to the parent Task; {132.23} G-FLOWDEF finally owns and closes
that composition in `producer/flow_def.run_producer_flow` — mirroring `{132.8}`/
`{132.9}`'s own deferral of write-target/mount wiring, now likewise resolved
by the composition layer rather than by this module.

**Collection safety.** Like `producer/enrich.py` / `producer/web_pass.py`,
this module transitively requires `cocoindex` at import time — both for
its own `localfs` façade import (`_coco_api.py`, mirrors `flow.py`'s
eager top-level `from _coco_api import (..., localfs, ...)`) and because
it imports `producer/enrich.py` (`@coco.fn`) and `producer/web_pass.py`.
Its test file therefore stubs `cocoindex` (+ `cocoindex.connectors.
localfs`) via `conftest.stubbed_sys_modules` before importing this module,
exactly mirroring `test_producer_web_pass.py`.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Literal, Mapping, Sequence

from scripts.cocoindex_pipeline._coco_api import localfs
from scripts.cocoindex_pipeline.producer.enrich import ConceptDraft
from scripts.cocoindex_pipeline.producer.frontmatter import (
    ConceptFrontmatter,
    render_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer import iri_projection
from scripts.cocoindex_pipeline.producer.validator import (
    ALLOWED_CONCEPT_TYPES,
    ALLOWED_ENTITY_TYPES,
    ALLOWED_RELATIONSHIP_TYPES,
    EffectiveOntology,
    check_concept,
    normalise_citations_section,
)
from scripts.cocoindex_pipeline.producer.web_pass import ReferenceConceptDraft

# Reserved bundle-level filenames — never treated as a concept `.md` path by
# `_existing_concept_paths`'s previous-run keyset scan (BI-11: N concept
# files PLUS exactly one index.md and one log.md; DR-027 adds two more
# bundle-level artefacts, the ontology snapshot + the client-authored
# overlay source; S464 rider R1 additionally reserves the committed bundle
# README, and the OKF v0.1 conformance wave reserves the hand-authored
# bundle-root CONFORMANCE.md, so neither ever surfaces as a false
# `RunSummary.removed` entry — see `_existing_concept_paths`). {132.44}
# (bl-457 G-IRI-PROJECTION IRI-4/9) adds the JSON-LD `@context` artefact —
# a `.jsonld` file, so `_existing_concept_paths`'s `rglob("*.md")` scan
# structurally never picks it up either way; reserved here for
# intent/parity with the other bundle-level artefacts. {132.36}
# G-CONCEPT-FEEDER adds `concept-feeder.json` — the same bl-463
# `index-themes.json` reserved-sibling-file pattern applied to concept-type
# feeding (client-authored, producer reads-only — see
# `read_concept_feeder_config`).
INDEX_FILENAME = "index.md"
LOG_FILENAME = "log.md"
ONTOLOGY_FILENAME = "ontology.json"
README_FILENAME = "README.md"
CONFORMANCE_FILENAME = "CONFORMANCE.md"
OVERLAY_FILENAME = "ontology-overlay.json"
CONTEXT_FILENAME = "context.jsonld"
CONCEPT_FEEDER_FILENAME = "concept-feeder.json"
_RESERVED_BUNDLE_FILENAMES = frozenset(
    {
        INDEX_FILENAME,
        LOG_FILENAME,
        ONTOLOGY_FILENAME,
        README_FILENAME,
        CONFORMANCE_FILENAME,
        OVERLAY_FILENAME,
        CONTEXT_FILENAME,
        CONCEPT_FEEDER_FILENAME,
    }
)

_ConceptLikeDraft = "ConceptDraft | ReferenceConceptDraft"


# ─────────────────────────────────────────────────────────────────────────
# BI-13 gate + BI-11 declare_file — the single per-concept write call site
# ─────────────────────────────────────────────────────────────────────────


def _rel_path_of(draft: Any) -> str:
    """`ConceptDraft` (Pass-1/Pass-2) carries its identity via `.key.rel_path`
    (BI-2); `ReferenceConceptDraft` (Pass-2 `references/<slug>.md`) carries
    it directly via `.rel_path` — the two dataclasses share no base class
    (by design, per `producer/enrich.py`/`producer/web_pass.py`), so this is
    the one place bundle_writer normalises the two shapes to one lookup."""
    rel_path = getattr(draft, "rel_path", None)
    if isinstance(rel_path, str):
        return rel_path
    return draft.key.rel_path


def _won_bid_case_study_redirect(
    rel_path: str, *, concept_type: "str | None", workspace_id: "str | None"
) -> str:
    """The shared {132.29} redirect rule: a won-bid `case_study` concept's
    identity `rel_path` (`case-studies/<slug>.md`) redirects into a distinct
    `won-bid/` sibling directory (`case-studies/won-bid/<slug>.md`) so it
    can never collide with a same-slug named-client `case_study` concept's
    own bundle path; every other concept is returned unredirected. Single
    source of truth for both `bundle_write_path` (keyed off a drafted
    concept) and `bundle_write_path_for_key` (keyed off a bare `ConceptKey`,
    for callers — `flow_def.py`'s BI-28 provenance map — that enumerate
    keys before any concept has been drafted).
    """
    if concept_type != "case_study" or workspace_id is None:
        return rel_path
    path = PurePosixPath(rel_path)
    return str(path.parent / "won-bid" / path.name)


def bundle_write_path(draft: Any) -> str:
    """The PHYSICAL bundle path `declare_concept` writes `draft` to —
    ordinarily identical to `_rel_path_of(draft)` (the concept's identity /
    cocoindex memo key, BI-2), EXCEPT for the won-bid `case_study` grain
    (S443 amendment/DR-029, `ConceptKey.workspace_id` set), which this
    module redirects into a distinct `won-bid/` sibling directory so it can
    never collide with a same-slug named-client `case_study` concept
    sharing the identical identity `rel_path` (ID-132 {132.29} — see this
    module's docstring for the full rationale). Duck-typed on `draft.key`'s
    shape (never imports `sources.l_records.ConceptKey`, mirroring
    `_rel_path_of`'s own duck-typing) — `ReferenceConceptDraft` has no
    `.key` and is therefore always left unredirected.

    PUBLIC (not `_`-prefixed): `flow_def.py` consumes this directly so its
    own embed-step lookup and BI-28 provenance map key on the SAME physical
    path `write_bundle`'s `RunSummary.added`/`.changed` already report,
    instead of re-deriving (and risking drift from) the redirect rule a
    second time (ID-132 {132.29} checker-FAIL remediation).
    """
    rel_path = _rel_path_of(draft)
    key = getattr(draft, "key", None)
    return _won_bid_case_study_redirect(
        rel_path,
        concept_type=getattr(key, "concept_type", None),
        workspace_id=getattr(key, "workspace_id", None),
    )


def bundle_write_path_for_key(key: Any) -> str:
    """`bundle_write_path`'s counterpart for callers that only have a bare
    `ConceptKey` (not a drafted concept) in scope — `flow_def.py`'s BI-28
    provenance map is built from `LRecordsSource.list_concepts()`'s full
    enumerated keyset, before any concept has been drafted. Applies the
    SAME redirect rule (`_won_bid_case_study_redirect`) directly to
    `key.rel_path`."""
    return _won_bid_case_study_redirect(
        key.rel_path,
        concept_type=getattr(key, "concept_type", None),
        workspace_id=getattr(key, "workspace_id", None),
    )


def _read_existing(path: Path) -> "str | None":
    """The file's CURRENT on-disk content, or `None` if absent. Used only
    for the `added`/`changed`/`unchanged` classification `write_bundle`
    reports in `log.md` — never to decide whether to call `declare_file`
    (BI-18: always declare the desired state every run; the ENGINE'S OWN
    lineage — verified, see module docstring — is what makes a no-op
    re-run a no-op *physical* write)."""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


@dataclass(frozen=True)
class ConceptWriteResult:
    """`declare_concept`'s per-concept outcome."""

    rel_path: str
    written: bool
    errors: "tuple[str, ...]" = ()
    is_new: bool = False
    changed: bool = False


def declare_concept(
    bundle_dir: Path,
    draft: Any,
    *,
    entities: "Sequence[Mapping[str, object]] | None" = None,
    relationships: "Sequence[Mapping[str, object]] | None" = None,
    effective_ontology: "EffectiveOntology | None" = None,
    citation_titles: "Mapping[str, str] | None" = None,
) -> ConceptWriteResult:
    """BI-13 gate THEN BI-11 `declare_file` write — the ONLY call site every
    concept write (a Pass-1 draft, a Pass-2-enriched draft, or a Pass-2
    `ReferenceConceptDraft`) must go through.

    A concept FAILING the gate is **NOT written** (BI-13):
    `ConceptWriteResult.written` is `False` and `.errors` carries every
    violation `producer/validator.py:check_concept` found. Non-raising here
    (uses `check_concept`, not the raising `validate_concept`) — a bad
    concept must not abort the whole bundle run; the caller (`write_bundle`)
    aggregates failures into the `log.md` run summary and keeps writing the
    rest of the bundle.

    `ConceptWriteResult.rel_path` is the draft's PHYSICAL bundle write path
    (`bundle_write_path`) — identical to the draft's identity `rel_path`
    for every concept EXCEPT the won-bid `case_study` grain, which is
    redirected into `case-studies/won-bid/<slug>.md` to avoid the {132.29}
    cross-grain slug collision (see module docstring).

    `effective_ontology` (OV-8, ID-132 {132.34}) is the run's composed
    base ∪ client-overlay set (`write_bundle` computes it once per run via
    `read_client_overlay` and passes it to every `declare_concept` call);
    `None` gates against the bare base frozensets, unchanged.

    **SPEC §5.1/§8 write-time trailer normalisation.** The draft body's
    `# Citations` section is deterministically re-emitted in the numbered
    markdown-link form via `validator.normalise_citations_section` BEFORE
    the gate and the write — accepting both the legacy bare-path bullets
    and the link form on input — so the ON-DISK trailer format never
    depends on model formatting. `citation_titles` (concept rel_path ->
    title; `write_bundle` supplies the run-wide map from its draft set)
    resolves cross-link labels to the target concept's title; unresolvable
    cross-links keep the rel_path as label.
    """
    rel_path = bundle_write_path(draft)
    frontmatter: ConceptFrontmatter = draft.frontmatter
    body: str = normalise_citations_section(draft.body, titles=citation_titles)
    errors = check_concept(
        frontmatter,
        body=body,
        entities=entities,
        relationships=relationships,
        effective_ontology=effective_ontology,
    )
    if errors:
        return ConceptWriteResult(rel_path=rel_path, written=False, errors=tuple(errors))

    target_path = bundle_dir / rel_path
    previous = _read_existing(target_path)
    markdown: str = render_concept_frontmatter(frontmatter) + body
    localfs.declare_file(target_path, markdown, create_parent_dirs=True)
    return ConceptWriteResult(
        rel_path=rel_path,
        written=True,
        is_new=previous is None,
        changed=previous is not None and previous != markdown,
    )


# ─────────────────────────────────────────────────────────────────────────
# index.md — BI-5/BI-11 progressive-disclosure nav (pure renderer)
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class IndexConceptEntry:
    """One `* [title](path.md) — description` bullet under a theme heading."""

    title: str
    rel_path: str
    """Bundle-root-relative, WITH the `.md` suffix (matches `ConceptKey.
    rel_path` / `ReferenceConceptDraft.rel_path` verbatim) — `lib/okf/
    parse-index.ts`'s `CONCEPT_BULLET_RE` requires the link target to end
    in `.md`, then strips it to derive `BundleNavConcept.path`."""
    description: str


@dataclass(frozen=True)
class IndexTheme:
    """One `##`/`###` heading node — matches `lib/okf/parse-index.ts`'s
    `BundleNavTheme` shape exactly (level 2 = `##` top theme; level 3 =
    `###` subtheme, nested under its parent via `children`, never emitted
    bare)."""

    heading: str
    level: "Literal[2, 3]" = 2
    concepts: "tuple[IndexConceptEntry, ...]" = ()
    children: "tuple[IndexTheme, ...]" = ()

    def __post_init__(self) -> None:
        if self.level not in (2, 3):
            raise ValueError(
                "IndexTheme.level must be 2 or 3 (## or ###) — matches "
                "lib/okf/parse-index.ts's HEADING_RE"
            )
        if self.level == 3 and self.children:
            raise ValueError(
                "a level-3 (###) subtheme cannot itself carry children — "
                "lib/okf/parse-index.ts only nests ### under ##, never "
                "deeper"
            )


def _render_theme(theme: IndexTheme, lines: "list[str]") -> None:
    lines.append(f"{'#' * theme.level} {theme.heading}")
    lines.append("")
    for concept in theme.concepts:
        lines.append(f"* [{concept.title}]({concept.rel_path}) — {concept.description}")
    if theme.concepts:
        lines.append("")
    for child in theme.children:
        _render_theme(child, lines)


def regenerate_indexes(themes: "Sequence[IndexTheme]") -> str:
    """BI-5/BI-11: pure progressive-disclosure `index.md` renderer.

    Opens with the SPEC §11 / DR-019 house-rule frontmatter block —
    exactly one key, `okf_version: "0.1"` (§11 permits the bundle-root
    `index.md` ONLY a frontmatter block among all indexes; keep it to this
    single key) — then emits `##`/`###` theme headings and
    `* [title](path.md) — description` concept bullets — EXACTLY the
    format `lib/okf/parse-index.ts` parses (S451 rider item b; the parser
    skips the frontmatter block). A level-3 heading is ALWAYS nested under
    its parent level-2 heading (`IndexTheme.children`), never emitted as a
    bare top-level heading — the parser's "no preceding `##`" branch is a
    defensive fallback for malformed input, never this writer's own
    output.

    Does NOT decide which concept belongs under which theme — the real
    ~17-theme-to-concept mapping for a given client deployment is an
    "owner's call" (PRODUCT.md BI-5), not a mechanically derivable
    property of a concept's `type`/`tags` (there are 5 ratified concept
    TYPES but ~17 business-domain THEMES — an orthogonal, per-client
    classification). `themes` is accepted already resolved;
    `build_index_themes` below is the pure-Python bridge from a caller-
    supplied theme→rel_path membership CONFIG to this renderer's input
    shape, guaranteeing no concept is silently dropped from the nav.
    """
    lines: "list[str]" = [
        "---",
        'okf_version: "0.1"',
        "---",
        "# OKF Concept Bundle",
        "",
    ]
    for theme in themes:
        _render_theme(theme, lines)
    return "\n".join(lines).rstrip("\n") + "\n"


def build_index_themes(
    theme_config: "Sequence[tuple[str, Sequence[str]]]",
    concepts: "Mapping[str, ConceptFrontmatter]",
    *,
    unthemed_heading: str = "Other",
) -> "list[IndexTheme]":
    """Resolve a caller-supplied theme→rel_path membership CONFIG
    (`[(heading, [rel_path, ...]), ...]` — the owner's per-client theme map,
    e.g. a de-identified stand-in for the first client's own ~17-theme "BID
    RESPONSE TOPIC INDEX") against `concepts` (the concept catalogue's
    frontmatter, keyed by rel_path) into a renderable `IndexTheme` list.

    Every concept in `concepts` appears under EXACTLY ONE theme: a concept
    no `theme_config` entry claims falls into a trailing `unthemed_heading`
    bucket (alphabetical by rel_path) — so a stale or incomplete theme
    config never silently drops a concept from `index.md`'s nav. A
    `theme_config` entry naming a rel_path NOT present in `concepts` (e.g.
    a not-yet-drafted concept) is skipped rather than inventing an entry.
    """
    claimed: "set[str]" = set()
    themes: "list[IndexTheme]" = []
    for heading, rel_paths in theme_config:
        entries: "list[IndexConceptEntry]" = []
        for rel_path in rel_paths:
            frontmatter = concepts.get(rel_path)
            if frontmatter is None:
                continue
            entries.append(
                IndexConceptEntry(
                    title=frontmatter.title,
                    rel_path=rel_path,
                    description=frontmatter.description,
                )
            )
            claimed.add(rel_path)
        themes.append(IndexTheme(heading=heading, concepts=tuple(entries)))

    leftover = sorted(set(concepts) - claimed)
    if leftover:
        themes.append(
            IndexTheme(
                heading=unthemed_heading,
                concepts=tuple(
                    IndexConceptEntry(
                        title=concepts[rel_path].title,
                        rel_path=rel_path,
                        description=concepts[rel_path].description,
                    )
                    for rel_path in leftover
                ),
            )
        )
    return themes


# ─────────────────────────────────────────────────────────────────────────
# log.md — BI-11/BI-18/BI-22 append-only run log
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RunSummary:
    """One producer run's concept-level diff, for the `log.md` block."""

    added: "tuple[str, ...]" = ()
    changed: "tuple[str, ...]" = ()
    unchanged: "tuple[str, ...]" = ()
    removed: "tuple[str, ...]" = ()
    moved: "tuple[tuple[str, str], ...]" = ()
    orphaned_anchors: "tuple[str, ...]" = ()
    validator_failures: "tuple[tuple[str, tuple[str, ...]], ...]" = ()
    failed: "tuple[str, ...]" = ()
    """G-PARSE-HARDEN Leg 2 (ID-132 {132.45}, {132.35} G-DEPLOY-PROOF Defect
    B, DR-047): the physical bundle write paths of concepts whose draft
    failed THIS run (a caught, transient exception upstream — e.g. an
    unparseable terminal JSON envelope that exhausted enrich.py's own
    sanitise+retry hardening) but are still present in the source
    catalogue. `write_bundle` re-declares their EXISTING on-disk content
    UNCHANGED (never `removed`, never silently dropped) and lists them here
    purely for `log.md` visibility — silent success is forbidden. Distinct
    from `validator_failures` (a drafted-but-REJECTED concept) and from
    `removed` (confirmed absent from the source catalogue's own
    enumeration)."""

    @property
    def is_no_op(self) -> bool:
        """BI-18: True iff this run changed NOTHING relative to the prior
        run — no adds, content changes, removes, moves, findings, or
        transient drafting failures. A no-op run still appends a `log.md`
        block (BI-11's "one block per run" is unconditional) — the block
        just reports zero changes. A run with a transient drafting failure
        (`failed`) is deliberately NOT a no-op — Defect B's "silent success
        is forbidden" — even though the physical bundle content it
        produces may be byte-identical to the prior run's."""
        return not (
            self.added
            or self.changed
            or self.removed
            or self.moved
            or self.orphaned_anchors
            or self.validator_failures
            or self.failed
        )


def _resolve_run_timestamp(timestamp: "str | None") -> str:
    return timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _render_run_bullets(summary: RunSummary, ts: str) -> "list[str]":
    """One producer run's bullet lines (SPEC §7 conformance shape) — every
    category line carries the FULL run timestamp in its bold prefix
    (`* **Run <ISO-ts> — <Action> (N):** …`), preserving BI-11 per-run
    visibility and machine-parseability now that runs are grouped under a
    shared `## YYYY-MM-DD` date heading. A no-op run still emits exactly
    one bullet (BI-11's "one visible record per run" is unconditional).
    Validator-reject per-path detail stays as nested sub-bullets under its
    WARNING bullet."""
    if summary.is_no_op:
        return [f"* **Run {ts} — No changes** (no-op re-run)."]
    lines: "list[str]" = []
    if summary.added:
        lines.append(
            f"* **Run {ts} — Added ({len(summary.added)}):** " + ", ".join(summary.added)
        )
    if summary.changed:
        lines.append(
            f"* **Run {ts} — Changed ({len(summary.changed)}):** "
            + ", ".join(summary.changed)
        )
    if summary.removed:
        lines.append(
            f"* **Run {ts} — Removed ({len(summary.removed)}):** "
            + ", ".join(summary.removed)
        )
    if summary.moved:
        moved_desc = ", ".join(f"{old} -> {new}" for old, new in summary.moved)
        lines.append(f"* **Run {ts} — Moved ({len(summary.moved)}):** {moved_desc}")
    if summary.failed:
        # G-PARSE-HARDEN Leg 2 ({132.45}, Defect B): a transient drafting
        # failure this run — the concept's last-good bundle version was
        # kept (never removed); this line exists so a failure is never
        # silent.
        lines.append(
            f"* **Run {ts} — WARNING Failed drafting "
            f"({len(summary.failed)}):** " + ", ".join(summary.failed)
        )
    if summary.orphaned_anchors:
        lines.append(
            f"* **Run {ts} — WARNING orphaned anchors "
            f"({len(summary.orphaned_anchors)}):** "
            + ", ".join(summary.orphaned_anchors)
        )
    if summary.validator_failures:
        lines.append(
            f"* **Run {ts} — WARNING validator rejected "
            f"({len(summary.validator_failures)}):**"
        )
        for rel_path, errors in summary.validator_failures:
            lines.append(f"  - {rel_path}: {'; '.join(errors)}")
    return lines


def render_log_entry(summary: RunSummary, *, timestamp: "str | None" = None) -> str:
    """BI-11/BI-18/BI-22 + SPEC §7: render ONE run as a fresh date section —
    a `## YYYY-MM-DD` ISO-8601 DATE heading (§7 MUST) followed by the run's
    `* **Run <ISO-ts> — …:**` bullets (`_render_run_bullets`). This is the
    shape a run takes when it OPENS a new date section; `append_log_entry`
    merges a same-date run's bullets into the existing first section
    instead. A no-op run still emits a visible bullet (BI-11).
    """
    ts = _resolve_run_timestamp(timestamp)
    lines = [f"## {ts[:10]}", "", *_render_run_bullets(summary, ts)]
    return "\n".join(lines) + "\n"


def append_log_entry(
    bundle_dir: Path, summary: RunSummary, *, timestamp: "str | None" = None
) -> str:
    """Read `bundle_dir/log.md`'s CURRENT content (if present) and record
    this run's entry — SPEC §7: date-grouped, NEWEST FIRST. `declare_file`
    has no native prepend mode — it always takes the FULL desired content —
    so this function owns full-content reconstruction:

      (a) no existing content — the file is created fresh with this run's
          date section;
      (b) the existing FIRST `## YYYY-MM-DD` heading matches this run's
          date — the run's bullets are inserted at the TOP of that section
          (newest run first within a date);
      (c) otherwise — a new date section is PREPENDED above the existing
          content (newest date first).

    Matches `lib/okf/parse-log.ts`'s "FIRST `##` heading is the most recent
    date; runs are the `**Run <ts> — …**` bullets" contract. Returns the
    new full content.
    """
    ts = _resolve_run_timestamp(timestamp)
    date = ts[:10]
    bullets = _render_run_bullets(summary, ts)
    existing = _read_existing(bundle_dir / LOG_FILENAME) or ""

    if not existing.strip():
        new_content = "\n".join([f"## {date}", "", *bullets]) + "\n"
    else:
        lines = existing.splitlines()
        first_heading = next(
            (i for i, line in enumerate(lines) if line.startswith("## ")), None
        )
        if first_heading is not None and lines[first_heading][3:].strip() == date:
            # (b) same-date merge — insert this run's bullets at the top of
            # the existing first date section (after the heading and its
            # blank separator line).
            insert_at = first_heading + 1
            if insert_at < len(lines) and not lines[insert_at].strip():
                insert_at += 1
            merged = [*lines[:insert_at], *bullets, *lines[insert_at:]]
            new_content = "\n".join(merged).rstrip("\n") + "\n"
        else:
            # (c) prepend a fresh date section above everything.
            section = "\n".join([f"## {date}", "", *bullets])
            new_content = f"{section}\n\n{existing.lstrip()}".rstrip("\n") + "\n"

    localfs.declare_file(bundle_dir / LOG_FILENAME, new_content, create_parent_dirs=True)
    return new_content


# ─────────────────────────────────────────────────────────────────────────
# DR-027 — the materialised effective ontology artefact
# ─────────────────────────────────────────────────────────────────────────


def _base_ontology_snapshot() -> "dict[str, object]":
    """DR-027's "pinned base snapshot" half — sourced from `producer/
    validator.py`'s `ALLOWED_CONCEPT_TYPES`/`ALLOWED_ENTITY_TYPES`/
    `ALLOWED_RELATIONSHIP_TYPES` frozensets, the SAME closed register BI-13
    already gates every concept write against (not invented here — see
    `validator.py`'s own docstring for provenance back to `extraction.py`'s
    Pydantic Literals). Carries all THREE CV dimensions (OV-6a, ID-132
    {132.34}) so every dimension is uniformly overlay-extensible — the
    concept-`type` set joined `entity_types`/`relationship_types` here.
    This is the Python-consumable materialisation source that DOES exist
    in-repo today; `lib/ontology/concept-schema.ts` (ID-133) has no
    Python-consumable export yet (per the {132.10} brief — FLAGGED, see
    this module's own docstring / the {132.10} report)."""
    return {
        "concept_types": sorted(ALLOWED_CONCEPT_TYPES),
        "entity_types": sorted(ALLOWED_ENTITY_TYPES),
        "relationship_types": sorted(ALLOWED_RELATIONSHIP_TYPES),
    }


class OntologyOverlayError(ValueError):
    """OV-5 (ID-132 {132.34}, DR-054): raised when a PRESENT
    `ontology-overlay.json` fails validation — malformed JSON, a non-object
    top level, an unknown top-level key (OV-2/OQ-OV-4 — including a
    removal/redefinition attempt, which has no dedicated mechanism in the
    closed schema and so is ALWAYS an unknown key, OV-3), or a dimension
    value that is not a list of strings. `write_bundle` does NOT catch
    this — a present-but-invalid overlay ABORTS the whole producer run for
    that bundle rather than degrading to a base-only or partial ontology
    (fail-loud, deliberately contra DR-047's narrowly-scoped degrade
    posture; see OV-5's rationale). An ABSENT overlay file is not an error
    (OV-4/OV-11) — it never raises this."""


# OV-10 (ID-132 {132.37} G-OVERLAY-PLATFORM-REJECT, DR-054/DR-079): the
# bundle-CLASS discriminator. DR-079 ratified FOUR bundle classes — only
# "client_business" is a client-owned repo entitled to author a client
# overlay (DR-016); "system_baseline" (bl-465), "showcase" (the synthetic-
# corpus bundle this Subtask's provenance calls "the platform bundle" —
# terminology retired in favour of the class name) and "internal_dev"
# (bl-478) are ALL platform-owned and ride the SAME `write_bundle` spine
# (Path-2/RepoDocsSource) — none of them is ever a client-overlay consumer
# (DR-027: the platform is the base authority for all three). A bare
# boolean would not generalise to this four-class taxonomy; the reject rule
# below is keyed on the class value itself so it already covers every
# platform-owned class, not just one.
BundleClass = Literal["client_business", "system_baseline", "showcase", "internal_dev"]

_CLIENT_BUSINESS_BUNDLE_CLASS: BundleClass = "client_business"


class OntologyOverlayClassError(OntologyOverlayError):
    """OV-10 (ID-132 {132.37}, DR-054/DR-079): raised when `write_bundle`
    discovers a PRESENT, schema-valid `ontology-overlay.json` (`read_client_
    overlay` returned non-`None`) but the run's `bundle_class` is not
    exactly `"client_business"` — only the client-business class may
    compose a client overlay; the other three ratified classes (system-
    baseline, showcase, internal-dev) are all platform-owned and must
    hard-reject a stray overlay exactly like the legacy "platform bundle"
    case OV-10 originally named (OQ-OV-5).

    An unset/`None` `bundle_class` is ALSO rejected here — deliberately NOT
    treated as a safe stand-in for `"client_business"`. `bundle_class` is
    an explicit, caller-supplied signal (`producer/flow_def.py`'s
    `_resolve_bundle_class`, an `OKF_BUNDLE_CLASS` env var read); it is
    never derived from `client_id`'s presence, because a client-business
    run can legitimately exist BEFORE its `OKF_CLIENT_ID` is configured
    (bl-457 IRI-6's own non-gating fallback) — treating "no client_id yet"
    as "not client-business" would misclassify that legitimate run. Given
    that ambiguity, defaulting an unresolved signal to *permissive*
    composition would silently reintroduce the exact bug this error exists
    to kill (a stray overlay file in a non-client-business bundle checkout
    composing instead of hard-rejecting), so the unresolved case is treated
    the same as a confirmed non-client-business class: reject.

    Subclasses `OntologyOverlayError` (not a bare new error family) — this
    is a DISTINCT failure mode from OV-5's schema-validation failure (a
    present-but-INVALID overlay never reaches this check; `read_client_
    overlay` already raised). This fires for a present-and-VALID overlay in
    the WRONG (or unresolved) bundle class.

    **{132.36} G-CONCEPT-FEEDER scope note.** Also raised (via
    `require_client_business_bundle_class` below) when a schema-valid
    `concept-feeder.json` is discovered in a non-`client_business` bundle —
    the SAME class-discriminator failure mode, generalised from "a client
    overlay" to "any client-owned reserved config file"."""


def require_client_business_bundle_class(
    bundle_class: "BundleClass | None", *, filename: str
) -> None:
    """Shared OV-10 class-gate (ID-132 {132.37} original + {132.36}
    G-CONCEPT-FEEDER extension, DR-054/DR-079): a client-owned reserved
    bundle-root config file discovered in a bundle whose resolved
    `bundle_class` is not exactly `"client_business"` is a configuration
    error. `bundle_class=None` (unresolved) is treated the same as a
    confirmed non-client-business class — see `OntologyOverlayClassError`'s
    own docstring for the full non-permissive-default rationale.

    `write_bundle`'s own inline overlay-class check ({132.37}, already
    shipped/tested) is left AS-IS rather than refactored onto this helper —
    minimises blast radius on already-tested code. This helper backs the
    NEW `concept-feeder.json` gate (`producer/flow_def.py`, which resolves
    `bundle_class` before `write_bundle` ever runs, since the feeder config
    is consumed earlier in the flow than overlay composition) and is
    available for a future caller to consolidate onto."""
    if bundle_class != _CLIENT_BUSINESS_BUNDLE_CLASS:
        raise OntologyOverlayClassError(
            f"{filename} was found but bundle_class={bundle_class!r} is not "
            f"{_CLIENT_BUSINESS_BUNDLE_CLASS!r} — only the client-business "
            "bundle class may compose client-owned config (DR-054/DR-079, "
            "OV-10). Aborting rather than silently composing."
        )


# OV-2: the overlay's three permitted top-level keys — closed schema, any
# other key (including a singular typo like `entity_type`, or a `remove`/
# `exclude` mechanism) is a validation failure (OQ-OV-4/OV-3).
_OVERLAY_DIMENSIONS = ("concept_types", "entity_types", "relationship_types")


def _validate_overlay_schema(data: object) -> "dict[str, list[str]]":
    """OV-2 (closed additive schema): `data` must be a JSON object whose
    ONLY permitted keys are `_OVERLAY_DIMENSIONS`, each a list of strings
    (a missing key defaults to an empty list — no extension for that
    dimension). Raises `OntologyOverlayError` on any violation."""
    if not isinstance(data, dict):
        raise OntologyOverlayError(
            f"{OVERLAY_FILENAME} must be a JSON object at the top level, "
            f"got {type(data).__name__} (OV-2)"
        )
    unknown_keys = sorted(set(data) - set(_OVERLAY_DIMENSIONS))
    if unknown_keys:
        raise OntologyOverlayError(
            f"{OVERLAY_FILENAME} has unknown top-level key(s) {unknown_keys} "
            f"— only {list(_OVERLAY_DIMENSIONS)} are permitted (OV-2/OQ-OV-4)"
        )
    dimensions: "dict[str, list[str]]" = {}
    for dimension in _OVERLAY_DIMENSIONS:
        value = data.get(dimension, [])
        if not isinstance(value, list) or not all(isinstance(term, str) for term in value):
            raise OntologyOverlayError(
                f"{OVERLAY_FILENAME}[{dimension!r}] must be a list of "
                f"strings, got {value!r} (OV-2)"
            )
        dimensions[dimension] = value
    return dimensions


def read_client_overlay(bundle_dir: Path) -> "dict[str, object] | None":
    """OV-1/OV-4/OV-6 (ID-132 {132.34}, DR-054): read + validate the
    client-authored `ontology-overlay.json` at `bundle_dir`'s root.

    Returns the OV-6 provenance-wrapped mapping — `source` (the reserved
    filename), `sha256` (of the file's raw bytes), plus the three OV-2
    dimension keys — or `None` when the file is absent (OV-4/OV-11:
    absence is NOT an error, the bundle composes base-only). Raises
    `OntologyOverlayError` for a present-but-invalid file (OV-5, fail-loud)
    — never silently degrades to a base-only or partial result.

    The overlay file is CLIENT-authored (DR-016) — this function only ever
    READS it, never `declare_file`s or deletes it (`OVERLAY_FILENAME` is in
    `_RESERVED_BUNDLE_FILENAMES`, S464 rider R1), so it is immune to
    cocoindex's own orphan-delete reconciliation (module docstring's
    EXECUTOR-VERIFY finding).
    """
    path = bundle_dir / OVERLAY_FILENAME
    try:
        raw = path.read_bytes()
    except (FileNotFoundError, NotADirectoryError):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OntologyOverlayError(f"{OVERLAY_FILENAME} is not valid JSON: {exc}") from exc
    dimensions = _validate_overlay_schema(data)
    return {
        "source": OVERLAY_FILENAME,
        "sha256": hashlib.sha256(raw).hexdigest(),
        **dimensions,
    }


# ─────────────────────────────────────────────────────────────────────────
# ID-132 {132.36} G-CONCEPT-FEEDER — the client-configurable concept-feeder
# config (`concept-feeder.json`), the bl-463 `index-themes.json` reserved-
# sibling-file pattern applied to concept-type feeding. See `sources/
# l_records.py`'s `LRecordsSource` for the CONSUMING half (enumeration/
# read/sample of an overlay-added concept type via the `entity_mention`
# grain).
# ─────────────────────────────────────────────────────────────────────────


class ConceptFeederConfigError(ValueError):
    """ID-132 {132.36} G-CONCEPT-FEEDER, DR-054: raised when a PRESENT
    `concept-feeder.json` fails validation — invalid JSON, a non-object top
    level, an unknown top-level key, a `concept_types` entry naming a type
    that collides with a BASE ratified type (`ALLOWED_CONCEPT_TYPES`) or
    `'q_a_pair'` (BI-3), or a grain config with an unrecognised `grain`
    value or a non-string/empty `entity_type`. Mirrors `OntologyOverlayError`
    (OV-5) — a present-but-invalid feeder config ABORTS the producer run for
    that bundle rather than silently skipping the malformed entry (fail-loud,
    DR-054 posture: composition gates legality, never falls open). An
    ABSENT `concept-feeder.json` is NOT an error — `read_concept_feeder_
    config` returns `None`, mirroring `read_client_overlay`'s OV-4 absence
    posture."""


_CONCEPT_FEEDER_GRAINS = frozenset({"entity_mention"})
"""ID-132 {132.36} v1: the CLOSED set of feeder grain strategies the
producer knows how to route (`sources.l_records.LRecordsSource`). NOT a
client-extensible enum — a new grain is a future Subtask's code change, not
a config-time escape hatch (deliberately narrow, mirroring `sources/
l_records.py`'s own "bespoke, PRODUCT-level judgement call" posture for
which records back which concept type — a generic client-authored SQL DSL
would both contradict that judgement call and open a real query-injection
surface)."""


def _validate_concept_feeder_schema(data: object) -> "dict[str, dict[str, str]]":
    """Closed-schema validation for `concept-feeder.json` (ID-132 {132.36}):
    `data` must be a JSON object whose ONLY permitted top-level key is
    `concept_types`, itself an object mapping a client-chosen concept-type
    name to a grain-config object `{"grain": <one of
    _CONCEPT_FEEDER_GRAINS>, "entity_type": <non-empty string>}`. A declared
    type name may not equal a BASE ratified type (`ALLOWED_CONCEPT_TYPES` —
    those already route via the base `_list_*_concepts` methods; a feeder
    entry for one would be an ambiguous shadow) or `'q_a_pair'` (BI-3,
    defence in depth ahead of `ConceptKey.__post_init__`'s own runtime
    guard). Raises `ConceptFeederConfigError` on any violation."""
    if not isinstance(data, dict):
        raise ConceptFeederConfigError(
            f"{CONCEPT_FEEDER_FILENAME} must be a JSON object at the top "
            f"level, got {type(data).__name__}"
        )
    unknown_top_keys = sorted(set(data) - {"concept_types"})
    if unknown_top_keys:
        raise ConceptFeederConfigError(
            f"{CONCEPT_FEEDER_FILENAME} has unknown top-level key(s) "
            f"{unknown_top_keys} — only ['concept_types'] is permitted"
        )
    concept_types = data.get("concept_types", {})
    if not isinstance(concept_types, dict):
        raise ConceptFeederConfigError(
            f"{CONCEPT_FEEDER_FILENAME}['concept_types'] must be a JSON "
            f"object, got {type(concept_types).__name__}"
        )
    validated: "dict[str, dict[str, str]]" = {}
    for concept_type, grain_config in concept_types.items():
        if not isinstance(concept_type, str) or not concept_type.strip():
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'] keys must be "
                f"non-empty strings, got {concept_type!r}"
            )
        if concept_type == "q_a_pair" or concept_type in ALLOWED_CONCEPT_TYPES:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'] declares "
                f"{concept_type!r}, which is a BASE ratified type or "
                "'q_a_pair' — a feeder entry may only name a NEW, "
                "overlay-added concept type (BI-3/BI-4)"
            )
        if not isinstance(grain_config, dict):
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}] "
                f"must be a JSON object, got {type(grain_config).__name__}"
            )
        unknown_grain_keys = sorted(set(grain_config) - {"grain", "entity_type"})
        if unknown_grain_keys:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}] "
                f"has unknown key(s) {unknown_grain_keys} — only "
                "['grain', 'entity_type'] are permitted"
            )
        grain = grain_config.get("grain")
        if grain not in _CONCEPT_FEEDER_GRAINS:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}]"
                f"['grain'] must be one of {sorted(_CONCEPT_FEEDER_GRAINS)}, "
                f"got {grain!r}"
            )
        entity_type = grain_config.get("entity_type")
        if not isinstance(entity_type, str) or not entity_type.strip():
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}]"
                "['entity_type'] must be a non-empty string, got "
                f"{entity_type!r}"
            )
        validated[concept_type] = {"grain": grain, "entity_type": entity_type}
    return validated


def read_concept_feeder_config(bundle_dir: Path) -> "dict[str, dict[str, str]] | None":
    """OV-1-precedent read (ID-132 {132.36} G-CONCEPT-FEEDER, DR-054): read
    + validate the client-authored `concept-feeder.json` at `bundle_dir`'s
    root — the bl-463 `index-themes.json` reserved-sibling-file pattern
    applied to concept-type feeding. Returns the validated `{concept_type:
    {"grain": ..., "entity_type": ...}, ...}` mapping, or `None` when the
    file is absent (absence is NOT an error — a bundle with no feeder
    config enumerates only the base 5 types, unchanged). Raises
    `ConceptFeederConfigError` for a present-but-invalid file (fail-loud,
    mirrors `read_client_overlay`'s OV-5 posture).

    The file is CLIENT-authored (DR-016) — this function only ever READS
    it, never `declare_file`s or deletes it (`CONCEPT_FEEDER_FILENAME` is in
    `_RESERVED_BUNDLE_FILENAMES`), so it is immune to cocoindex's own
    orphan-delete reconciliation (module docstring's EXECUTOR-VERIFY
    finding). Callers (`producer/flow_def.py`) must additionally gate this
    file's PRESENCE against the run's `bundle_class` via
    `require_client_business_bundle_class` — this function validates only
    the file's OWN schema, mirroring `read_client_overlay`'s own separation
    of "is this file well-formed" from "is this bundle allowed to have it"
    (the latter check lives at the call site, not here)."""
    path = bundle_dir / CONCEPT_FEEDER_FILENAME
    try:
        raw = path.read_bytes()
    except (FileNotFoundError, NotADirectoryError):
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConceptFeederConfigError(
            f"{CONCEPT_FEEDER_FILENAME} is not valid JSON: {exc}"
        ) from exc
    return _validate_concept_feeder_schema(data)


def write_ontology_artefact(
    bundle_dir: Path, *, client_overlay: "Mapping[str, object] | None" = None
) -> str:
    """DR-027: "every bundle repo carries the materialised effective
    ontology (pinned base snapshot + client overlay)". Ships the BASE
    snapshot (`_base_ontology_snapshot`) always; `client_overlay` — the
    OV-6 provenance-wrapped mapping `write_bundle` supplies via
    `read_client_overlay` (or an explicit caller-supplied mapping) — is
    nested verbatim under its own `overlay` key when present.

    Deliberately PLAIN JSON, not a bespoke ontology DSL — the {132.10}
    brief is explicit not to invent an ontology FORMAT; this only
    serialises the already-ratified vocabulary plus an explicit
    `overlay: null` placeholder when no client-overlay source is
    available, so a bundle consumer can detect "no overlay shipped yet"
    (or "platform bundle, never a client-overlay consumer" — OV-10) rather
    than silently assuming a base-only artefact IS the full effective
    ontology. Pure echo of whatever `client_overlay` mapping it is given —
    the provenance-stamping and OV-2/OV-3/OV-5 validation both happen
    upstream, in `read_client_overlay`.
    """
    payload = {
        "base": _base_ontology_snapshot(),
        "overlay": dict(client_overlay) if client_overlay is not None else None,
    }
    content = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    localfs.declare_file(
        bundle_dir / ONTOLOGY_FILENAME, content, create_parent_dirs=True
    )
    return content


def write_context_artefact(
    bundle_dir: Path,
    effective_ontology: "EffectiveOntology",
    *,
    client_id: "str | None" = None,
) -> str:
    """{132.44} bl-457 G-IRI-PROJECTION (IRI-4/5/6/9/12): serialises
    `iri_projection.project_context`'s `@context` term->IRI map to the
    reserved `context.jsonld` bundle artefact — self-contained (IRI-4),
    all three CV dimensions (IRI-5), client-overlay-gated (IRI-6), never
    gating the run (IRI-9), byte-deterministic (IRI-12).

    **Diagnostics-persistence design decision (this Subtask).**
    `project_context` returns `{"@context": {...}, "diagnostics": {...}}`
    — `"diagnostics"` (slug collisions + un-projected overlay terms) is a
    SIBLING key, advisory only (see `iri_projection.py`'s own docstring),
    NOT part of the on-disk shape IRI-PROJECTION.md's §Projection
    mechanics worked example specifies (`{"@context": {...}}` only). This
    function persists ONLY the `"@context"` key to `context.jsonld` —
    `project_context` ALSO already logs every diagnostic finding at
    WARNING as it occurs, so nothing is silently lost by leaving
    `"diagnostics"` out of the file; keeping the on-disk shape to the
    spec-conformant `{"@context": ...}` also avoids coupling {132.39}'s
    JSON-LD consumer to an advisory shape that may evolve independently
    of the `@context` contract.

    Mirrors `write_ontology_artefact`'s serialisation contract exactly
    (`json.dumps(..., indent=2, sort_keys=True)` — IRI-12 byte-
    determinism).
    """
    projection = iri_projection.project_context(effective_ontology, client_id=client_id)
    payload = {"@context": projection["@context"]}
    content = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    localfs.declare_file(
        bundle_dir / CONTEXT_FILENAME, content, create_parent_dirs=True
    )
    return content


# ─────────────────────────────────────────────────────────────────────────
# write_bundle — the per-run G-BUNDLE orchestration
# ─────────────────────────────────────────────────────────────────────────


def _existing_concept_paths(bundle_dir: Path) -> "set[str]":
    """The bundle's CURRENT on-disk concept `.md` files (excluding
    `index.md`/`log.md`/`ontology.json`) — the "previous run" keyset this
    module diffs against for the `log.md` added/changed/removed summary.

    Reading the real directory tree (rather than requiring a caller to
    persist state externally) is sound because `declare_file` writes are
    REAL filesystem writes once a run actually applies (EXECUTOR-VERIFY,
    module docstring) — `bundle_dir` IS the durable record of "what the
    last run declared", and cocoindex's OWN reconciliation phase (which
    performs the physical write/delete) always completes before this
    function's caller runs again for the NEXT producer invocation.
    """
    if not bundle_dir.is_dir():
        return set()
    return {
        rel
        for p in bundle_dir.rglob("*.md")
        if (rel := p.relative_to(bundle_dir).as_posix()) not in _RESERVED_BUNDLE_FILENAMES
    }


def _reaffirm_failed_concepts(bundle_dir: Path, failed_rel_paths: "set[str]") -> None:
    """G-PARSE-HARDEN Leg 2 (ID-132 {132.45}, {132.35} Defect B): re-declare
    the EXISTING on-disk content, byte-for-byte unchanged, for every concept
    whose draft transiently failed THIS run — never a fresh write. This is
    what actually keeps the concept's last-good bundle version alive: the
    module docstring's EXECUTOR-VERIFY finding established that the REAL
    cocoindex engine orphan-deletes any path NOT re-declared this run
    relative to the prior run's own declared keyset, with NO `DirTarget`
    required — so a concept simply left undeclared because its draft failed
    would still be deleted by the engine's own reconciliation on the next
    actual flow update, regardless of what `RunSummary.removed` reports. A
    path with no prior on-disk content (its first-ever draft attempt
    failed) has nothing to reaffirm and is left untouched — `write_bundle`
    still records it in `RunSummary.failed` for `log.md` visibility."""
    for rel_path in failed_rel_paths:
        existing = _read_existing(bundle_dir / rel_path)
        if existing is None:
            continue
        localfs.declare_file(bundle_dir / rel_path, existing, create_parent_dirs=True)


def write_bundle(
    bundle_dir: Path,
    drafts: "Sequence[ConceptDraft]",
    reference_drafts: "Sequence[ReferenceConceptDraft]" = (),
    *,
    theme_config: "Sequence[tuple[str, Sequence[str]]]" = (),
    moved: "Mapping[str, str]" = MappingProxyType({}),
    orphaned_anchors: "Sequence[str]" = (),
    failed_rel_paths: "Sequence[str]" = (),
    client_ontology_overlay: "Mapping[str, object] | None" = None,
    bundle_class: "BundleClass | None" = None,
    client_id: "str | None" = None,
    timestamp: "str | None" = None,
) -> RunSummary:
    """The per-run G-BUNDLE orchestration: validator-gate + `declare_file`
    every concept (BI-13/BI-11), regenerate `index.md` (BI-5), append one
    `log.md` run block (BI-11/BI-18/BI-22), and ship the DR-027 ontology
    artefact plus the {132.44} bl-457 `context.jsonld` IRI-projection
    artefact. Returns the `RunSummary` this run produced.

    `client_id` (bl-457 G-IRI-PROJECTION IRI-2/6/10) threads through to
    `write_context_artefact`'s `iri_projection.project_context` call —
    `None` (the default; no `OKF_CLIENT_ID` resolved at the `flow_def.py`
    call site) mints `context.jsonld` base-only, with every overlay term
    recorded as an advisory un-projected diagnostic rather than guessing a
    client namespace (IRI-6: published IRIs are irreversible, so an
    overlay IRI is never minted under an unconfirmed client-id).

    `moved` is an explicit caller-supplied `{old_rel_path: new_rel_path}`
    map (BI-2/BI-9: "the producer... must record such moves so inbound
    concept→concept references can be re-pointed") — this module CANNOT
    reliably infer a move from a flat rel_path diff alone (a moved concept
    is indistinguishable from "one concept removed + a different one
    added" without a content-similarity heuristic this module deliberately
    does not invent); the caller (a future rename-tracking mechanism, or
    `{132.13}`'s command entry point) supplies it.

    `write_bundle` holds no state of its own across calls beyond
    `bundle_dir`'s own on-disk contents — the returned `RunSummary` is the
    caller's (e.g. `{132.12}`'s git-sync writer) hook to persist/consume
    the diff further.

    **`failed_rel_paths` — transient-drafting-failure retention (ID-132
    {132.45} G-PARSE-HARDEN Leg 2, {132.35} G-DEPLOY-PROOF Defect B,
    DR-047).** The caller's (`flow_def.py`'s `_draft_concepts`) per-run set
    of PHYSICAL bundle write paths whose Pass-1/Pass-2 draft failed THIS
    run (a caught, transient exception) but that are STILL present in the
    source catalogue — as opposed to a concept genuinely absent from the
    catalogue (`removed`). Two effects: (a) excluded from the `removed`
    computation below, so a transient drafting glitch can never look
    identical to a confirmed source deletion; (b) re-declared via
    `_reaffirm_failed_concepts` with their EXISTING on-disk content
    UNCHANGED (never a fresh write) — this is not merely bookkeeping: the
    module docstring's EXECUTOR-VERIFY finding means the REAL cocoindex
    engine orphan-deletes any path NOT re-declared THIS run relative to the
    prior run's declared keyset, regardless of what `RunSummary.removed`
    reports, so re-declaring the identical bytes is what actually keeps the
    concept's last-good bundle version alive. A path with no prior on-disk
    content (its first-ever draft attempt failed) has nothing to reaffirm
    and is left untouched — it is still recorded in `RunSummary.failed` for
    `log.md` visibility (silent success is forbidden), but was never in
    `removed`'s candidate set either way. Defaults to `()` — byte-identical
    to pre-{132.45} behaviour when unused.

    Raises `ValueError` if two drafts in this run resolve to the same
    PHYSICAL write path (`bundle_write_path`) — e.g. a won-bid `case_study`
    concept redirected by ID-132 {132.29} would otherwise still collide
    with another same-slug draft. Fails loudly before either write happens
    rather than letting the second `declare_file` call silently overwrite
    the first.

    **Client-CV-overlay composition (OV-4, ID-132 {132.34}, DR-054).**
    Before anything else this run does, `write_bundle` reads+validates
    `bundle_dir`'s `ontology-overlay.json` via `read_client_overlay` — the
    already-landed `client_ontology_overlay` kwarg remains a raw,
    unvalidated escape hatch for an explicit caller-supplied mapping
    (tests; `write_ontology_artefact`'s own direct-call test), used INSTEAD
    of the read when supplied (and INSTEAD of the OV-10 class gate below —
    a caller passing this kwarg directly has already taken responsibility
    for its provenance). A present-but-invalid overlay file raises
    `OntologyOverlayError` here, BEFORE any `declare_file` call this run
    would otherwise make (OV-5: fail-loud, all-or-nothing — no bundle is
    published for that run). The resulting overlay (or `None`) both (a)
    composes this run's `EffectiveOntology` (OV-7: base ∪ overlay per
    dimension), threaded into every `declare_concept` call so the BI-13
    gate lints against the widened set (OV-8), and (b) reaches
    `write_ontology_artefact` unchanged via the pre-existing
    `client_ontology_overlay` pass-through (the `write_ontology_artefact`
    call below).

    **Bundle-CLASS discriminator (OV-10, ID-132 {132.37}, DR-054/DR-079).**
    When the overlay is DISCOVERED via the `read_client_overlay` file read
    (not the explicit `client_ontology_overlay` kwarg) and is non-`None`,
    `bundle_class` must be exactly `"client_business"` — DR-079's other
    three ratified classes (system-baseline, showcase, internal-dev) are
    all platform-owned and must never self-overlay. `bundle_class` unset
    (`None`, the ambiguous case — see `OntologyOverlayClassError`) is
    treated the same as a confirmed non-client-business class: reject
    rather than silently compose. Raises `OntologyOverlayClassError` before
    any `declare_file` call this run would otherwise make, exactly
    mirroring OV-5's all-or-nothing fail-loud posture.

    **Per-class effective ontology (PC-4, ID-163 {163.17} G-CLASS-EFFECTIVE-
    ONTOLOGY).** The gate above guarantees that by the time `overlay` is
    non-`None` here, either `bundle_class == "client_business"` (the file-
    discovered path) or `client_ontology_overlay` was supplied explicitly
    (a caller-supplied escape hatch that composes regardless of class — see
    that kwarg's own docstring paragraph above). Either way a present
    `overlay` always composes via `EffectiveOntology.compose`. When
    `overlay` is `None`, the effective ontology is resolved from
    `bundle_class` itself: `client_business`/unset stay `base_only()`
    (byte-identical to pre-{163.17} behaviour — every pre-163 call site
    unconditionally composed against the business set); `showcase`/
    `system_baseline` resolve via `EffectiveOntology.base_for_class`
    (showcase's own registry entry is the same business set, kept
    authoritative rather than assumed); `internal_dev` has no ratified BI-4
    type set yet, so `base_for_class` raises `ValueError` (bl-478) HERE —
    fail-loud at gate entry, before any `declare_file` call this run would
    otherwise make, replacing the pre-{163.17} behaviour of silently
    gating every concept against the business set and failing late inside
    the BI-13 `declare_concept` loop instead.
    """
    if client_ontology_overlay is not None:
        overlay = client_ontology_overlay
    else:
        overlay = read_client_overlay(bundle_dir)
        if overlay is not None and bundle_class != _CLIENT_BUSINESS_BUNDLE_CLASS:
            raise OntologyOverlayClassError(
                f"{OVERLAY_FILENAME} was found at {bundle_dir} but "
                f"bundle_class={bundle_class!r} is not "
                f"{_CLIENT_BUSINESS_BUNDLE_CLASS!r} — only the "
                "client-business bundle class may compose a client overlay "
                "(DR-054/DR-079, OV-10). Aborting rather than silently "
                "composing."
            )
    if overlay is not None or bundle_class is None or bundle_class == _CLIENT_BUSINESS_BUNDLE_CLASS:
        effective_ontology = EffectiveOntology.compose(overlay)
    else:
        effective_ontology = EffectiveOntology.base_for_class(bundle_class)

    previous_paths = _existing_concept_paths(bundle_dir)
    moved_from = set(moved)
    failed_set = set(failed_rel_paths)

    written: "dict[str, ConceptFrontmatter]" = {}
    added: "list[str]" = []
    changed: "list[str]" = []
    unchanged: "list[str]" = []
    failures: "list[tuple[str, tuple[str, ...]]]" = []

    all_drafts: "list[Any]" = [*drafts, *reference_drafts]

    # Collision pre-pass (ID-132 {132.29}): resolve every draft's PHYSICAL
    # write path BEFORE any `declare_file` call happens this run. Detecting
    # a duplicate only once the loop below reaches it would be too late —
    # the FIRST draft would already be on disk by the time the SECOND
    # draft's collision is noticed, defeating "no silent overwrite" (the
    # first draft's content would still have been clobbered on the very
    # next run once the second draft's write lands). Failing before any
    # write in this run touches the filesystem keeps the run all-or-nothing
    # rather than leaving a half-written bundle.
    seen_write_paths: "set[str]" = set()
    for draft in all_drafts:
        write_path = bundle_write_path(draft)
        if write_path in seen_write_paths:
            raise ValueError(
                f"bundle write-path collision: more than one concept draft "
                f"resolves to bundle path {write_path!r} in this run — "
                "refusing to silently overwrite one with the other "
                "(ID-132 {132.29})"
            )
        seen_write_paths.add(write_path)

    # SPEC §5.1/§8: the run-wide rel_path -> title map for cross-link
    # LABELS — keyed by IDENTITY rel_path (`_rel_path_of`), the form BI-9
    # cross-link citations cite (never the won-bid PHYSICAL redirect path).
    citation_titles = {
        _rel_path_of(draft): draft.frontmatter.title for draft in all_drafts
    }

    for draft in all_drafts:
        result = declare_concept(
            bundle_dir,
            draft,
            effective_ontology=effective_ontology,
            citation_titles=citation_titles,
        )
        if not result.written:
            failures.append((result.rel_path, result.errors))
            continue
        written[result.rel_path] = draft.frontmatter
        if result.is_new:
            added.append(result.rel_path)
        elif result.changed:
            changed.append(result.rel_path)
        else:
            unchanged.append(result.rel_path)

    # G-PARSE-HARDEN Leg 2 ({132.45}, Defect B): a transiently-failed
    # concept is excluded from `removed` (never mistaken for a confirmed
    # source deletion) and has its EXISTING content re-declared unchanged —
    # never left un-re-declared, which the REAL engine's own orphan-delete
    # reconciliation would treat identically to a genuine removal (module
    # docstring's EXECUTOR-VERIFY finding). Only paths NOT already written
    # this run are reaffirmed — a caller-supplied `failed_rel_paths` entry
    # that also drafted successfully this run (an inconsistent caller
    # state) is left as its fresh write, never double-declared.
    removed = sorted(previous_paths - set(written) - moved_from - failed_set)
    _reaffirm_failed_concepts(bundle_dir, failed_set - set(written))

    summary = RunSummary(
        added=tuple(sorted(added)),
        changed=tuple(sorted(changed)),
        unchanged=tuple(sorted(unchanged)),
        removed=tuple(removed),
        moved=tuple(sorted(moved.items())),
        orphaned_anchors=tuple(orphaned_anchors),
        validator_failures=tuple(failures),
        failed=tuple(sorted(failed_set)),
    )

    themes = build_index_themes(theme_config, written)
    localfs.declare_file(
        bundle_dir / INDEX_FILENAME, regenerate_indexes(themes), create_parent_dirs=True
    )
    write_ontology_artefact(bundle_dir, client_overlay=overlay)
    write_context_artefact(bundle_dir, effective_ontology, client_id=client_id)
    append_log_entry(bundle_dir, summary, timestamp=timestamp)

    return summary
