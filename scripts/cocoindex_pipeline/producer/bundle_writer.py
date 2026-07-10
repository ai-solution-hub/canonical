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
format contract).** `regenerate_indexes` and `render_log_entry` emit
EXACTLY the text shape `lib/okf/parse-index.ts` / `lib/okf/parse-log.ts`
parse — a format mismatch degrades `<BundleNav>`/`<BundleLog>` SILENTLY
(both parsers have a graceful type-grouping fallback, so a divergence would
not raise, just quietly degrade). `parse-index.ts`: `##`/`###` theme
headings, `* [title](path.md) — description` concept bullets (this writer
picks the em-dash separator — the parser's own worked example glyph; both
`-`/`—` are accepted, so a hyphen would ALSO round-trip, but consistency
with the addendum's own example is preferred). `parse-log.ts`: `##
<ISO-8601 timestamp>` run-block headings (`RUN_HEADING_RE`), most-recent
block LAST in the file (append-only; the parser reverses on read). A
committed round-trip fixture (`__tests__/fixtures/okf/bundle-writer-*.md`,
generated FROM this module's own `regenerate_indexes`/`render_log_entry`
output) plus a Vitest assertion in `__tests__/lib/okf/` prove this module
never silently drifts from the parsers' contract.

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

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Literal, Mapping, Sequence

from scripts.cocoindex_pipeline._coco_api import localfs
from scripts.cocoindex_pipeline.producer.enrich import ConceptDraft
from scripts.cocoindex_pipeline.producer.frontmatter import ConceptFrontmatter
from scripts.cocoindex_pipeline.producer.validator import (
    ALLOWED_ENTITY_TYPES,
    ALLOWED_RELATIONSHIP_TYPES,
    check_concept,
)
from scripts.cocoindex_pipeline.producer.web_pass import ReferenceConceptDraft

# Reserved bundle-level filenames — never treated as a concept `.md` path by
# `_existing_concept_paths`'s previous-run keyset scan (BI-11: N concept
# files PLUS exactly one index.md and one log.md; DR-027 adds one more
# bundle-level artefact, the ontology snapshot).
INDEX_FILENAME = "index.md"
LOG_FILENAME = "log.md"
ONTOLOGY_FILENAME = "ontology.json"
_RESERVED_BUNDLE_FILENAMES = frozenset({INDEX_FILENAME, LOG_FILENAME, ONTOLOGY_FILENAME})

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
    """
    rel_path = bundle_write_path(draft)
    frontmatter: ConceptFrontmatter = draft.frontmatter
    body: str = draft.body
    errors = check_concept(
        frontmatter, body=body, entities=entities, relationships=relationships
    )
    if errors:
        return ConceptWriteResult(rel_path=rel_path, written=False, errors=tuple(errors))

    target_path = bundle_dir / rel_path
    previous = _read_existing(target_path)
    markdown: str = draft.rendered_markdown
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

    Emits `##`/`###` theme headings and `* [title](path.md) — description`
    concept bullets — EXACTLY the format `lib/okf/parse-index.ts` parses
    (S451 rider item b). A level-3 heading is ALWAYS nested under its
    parent level-2 heading (`IndexTheme.children`), never emitted as a bare
    top-level heading — the parser's "no preceding `##`" branch is a
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
    lines: "list[str]" = ["# OKF Concept Bundle", ""]
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


def render_log_entry(summary: RunSummary, *, timestamp: "str | None" = None) -> str:
    """BI-11/BI-18/BI-22: render ONE run block — a `## <ISO-8601 timestamp>`
    heading (S451 rider item a — the EXACT convention `lib/okf/parse-log.ts`
    adopted) followed by a change summary. A no-op run still emits a block
    (BI-11's "one block per run" is unconditional); its body says so
    explicitly rather than being empty (an empty body would be
    indistinguishable from a parse failure to a human reading `log.md`).
    """
    ts = timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    lines = [f"## {ts}", ""]
    if summary.is_no_op:
        lines.append("No changes (no-op re-run).")
        return "\n".join(lines) + "\n"
    if summary.added:
        lines.append(f"- Added ({len(summary.added)}): " + ", ".join(summary.added))
    if summary.changed:
        lines.append(f"- Changed ({len(summary.changed)}): " + ", ".join(summary.changed))
    if summary.removed:
        lines.append(f"- Removed ({len(summary.removed)}): " + ", ".join(summary.removed))
    if summary.moved:
        moved_desc = ", ".join(f"{old} -> {new}" for old, new in summary.moved)
        lines.append(f"- Moved ({len(summary.moved)}): {moved_desc}")
    if summary.orphaned_anchors:
        lines.append(
            f"- WARNING orphaned anchors ({len(summary.orphaned_anchors)}): "
            + ", ".join(summary.orphaned_anchors)
        )
    if summary.validator_failures:
        lines.append(
            f"- WARNING validator rejected ({len(summary.validator_failures)}):"
        )
        for rel_path, errors in summary.validator_failures:
            lines.append(f"  - {rel_path}: {'; '.join(errors)}")
    return "\n".join(lines) + "\n"


def append_log_entry(
    bundle_dir: Path, summary: RunSummary, *, timestamp: "str | None" = None
) -> str:
    """Read `bundle_dir/log.md`'s CURRENT content (if present) and append
    this run's block. `declare_file` has no native "append" mode — it
    always takes the FULL desired content — so this function owns
    full-content reconstruction; the new block is appended AFTER the
    existing content (append-only, most-recent-last, matching `lib/okf/
    parse-log.ts`'s "LAST `##` heading is the most recent run" contract).
    Returns the new full content.
    """
    existing = _read_existing(bundle_dir / LOG_FILENAME) or ""
    entry = render_log_entry(summary, timestamp=timestamp)
    new_content = f"{existing.rstrip()}\n\n{entry}" if existing.strip() else entry
    localfs.declare_file(bundle_dir / LOG_FILENAME, new_content, create_parent_dirs=True)
    return new_content


# ─────────────────────────────────────────────────────────────────────────
# DR-027 — the materialised effective ontology artefact
# ─────────────────────────────────────────────────────────────────────────


def _base_ontology_snapshot() -> "dict[str, object]":
    """DR-027's "pinned base snapshot" half — sourced from `producer/
    validator.py`'s `ALLOWED_ENTITY_TYPES`/`ALLOWED_RELATIONSHIP_TYPES`
    frozensets, the SAME closed 12-entity/10-relation register BI-13
    already gates every concept write against (not invented here — see
    `validator.py`'s own docstring for provenance back to `extraction.py`'s
    Pydantic Literals). This is the Python-consumable materialisation
    source that DOES exist in-repo today; `lib/ontology/concept-schema.ts`
    (ID-133) has no Python-consumable export yet (per the {132.10} brief —
    FLAGGED, see this module's own docstring / the {132.10} report)."""
    return {
        "entity_types": sorted(ALLOWED_ENTITY_TYPES),
        "relationship_types": sorted(ALLOWED_RELATIONSHIP_TYPES),
    }


def write_ontology_artefact(
    bundle_dir: Path, *, client_overlay: "Mapping[str, object] | None" = None
) -> str:
    """DR-027: "every bundle repo carries the materialised effective
    ontology (pinned base snapshot + client overlay)". Ships the BASE
    snapshot (`_base_ontology_snapshot`) always; `client_overlay`, when
    supplied by a future per-client config (no such config exists in-repo
    yet — FLAGGED), is nested under its own `overlay` key.

    Deliberately PLAIN JSON, not a bespoke ontology DSL — the {132.10}
    brief is explicit not to invent an ontology FORMAT; this only
    serialises the already-ratified entity/relation vocabulary plus an
    explicit `overlay: null` placeholder when no client-overlay source is
    available, so a bundle consumer can detect "no overlay shipped yet"
    rather than silently assuming a base-only artefact IS the full
    effective ontology.
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
    """
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

    for draft in all_drafts:
        result = declare_concept(bundle_dir, draft)
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
    write_ontology_artefact(bundle_dir, client_overlay=client_ontology_overlay)
    append_log_entry(bundle_dir, summary, timestamp=timestamp)

    return summary
