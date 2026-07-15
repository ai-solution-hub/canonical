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
# `RunSummary.removed` entry — see `_existing_concept_paths`).
INDEX_FILENAME = "index.md"
LOG_FILENAME = "log.md"
ONTOLOGY_FILENAME = "ontology.json"
README_FILENAME = "README.md"
CONFORMANCE_FILENAME = "CONFORMANCE.md"
OVERLAY_FILENAME = "ontology-overlay.json"
_RESERVED_BUNDLE_FILENAMES = frozenset(
    {
        INDEX_FILENAME,
        LOG_FILENAME,
        ONTOLOGY_FILENAME,
        README_FILENAME,
        CONFORMANCE_FILENAME,
        OVERLAY_FILENAME,
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

    @property
    def is_no_op(self) -> bool:
        """BI-18: True iff this run changed NOTHING relative to the prior
        run — no adds, content changes, removes, moves, or findings. A
        no-op run still appends a `log.md` block (BI-11's "one block per
        run" is unconditional) — the block just reports zero changes."""
        return not (
            self.added
            or self.changed
            or self.removed
            or self.moved
            or self.orphaned_anchors
            or self.validator_failures
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


def write_bundle(
    bundle_dir: Path,
    drafts: "Sequence[ConceptDraft]",
    reference_drafts: "Sequence[ReferenceConceptDraft]" = (),
    *,
    theme_config: "Sequence[tuple[str, Sequence[str]]]" = (),
    moved: "Mapping[str, str]" = MappingProxyType({}),
    orphaned_anchors: "Sequence[str]" = (),
    client_ontology_overlay: "Mapping[str, object] | None" = None,
    timestamp: "str | None" = None,
) -> RunSummary:
    """The per-run G-BUNDLE orchestration: validator-gate + `declare_file`
    every concept (BI-13/BI-11), regenerate `index.md` (BI-5), append one
    `log.md` run block (BI-11/BI-18/BI-22), and ship the DR-027 ontology
    artefact. Returns the `RunSummary` this run produced.

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
    of the read when supplied. A present-but-invalid overlay file raises
    `OntologyOverlayError` here, BEFORE any `declare_file` call this run
    would otherwise make (OV-5: fail-loud, all-or-nothing — no bundle is
    published for that run). The resulting overlay (or `None`) both (a)
    composes this run's `EffectiveOntology` (OV-7: base ∪ overlay per
    dimension), threaded into every `declare_concept` call so the BI-13
    gate lints against the widened set (OV-8), and (b) reaches
    `write_ontology_artefact` unchanged via the pre-existing
    `client_ontology_overlay` pass-through (the `write_ontology_artefact`
    call below).
    """
    overlay = (
        client_ontology_overlay
        if client_ontology_overlay is not None
        else read_client_overlay(bundle_dir)
    )
    effective_ontology = EffectiveOntology.compose(overlay)

    previous_paths = _existing_concept_paths(bundle_dir)
    moved_from = set(moved)

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

    removed = sorted(previous_paths - set(written) - moved_from)

    summary = RunSummary(
        added=tuple(sorted(added)),
        changed=tuple(sorted(changed)),
        unchanged=tuple(sorted(unchanged)),
        removed=tuple(removed),
        moved=tuple(sorted(moved.items())),
        orphaned_anchors=tuple(orphaned_anchors),
        validator_failures=tuple(failures),
    )

    themes = build_index_themes(theme_config, written)
    localfs.declare_file(
        bundle_dir / INDEX_FILENAME, regenerate_indexes(themes), create_parent_dirs=True
    )
    write_ontology_artefact(bundle_dir, client_overlay=overlay)
    append_log_entry(bundle_dir, summary, timestamp=timestamp)

    return summary
