"""Bundle-writer — validator-gated `declare_file` per concept, `index.md` /
`log.md` writers, the DR-027 ontology artefact (ID-132 {132.10} G-BUNDLE).

Consumes the {132.7}/{132.8}/{132.9} drafts (`producer.enrich.ConceptDraft`,
`producer.web_pass.ReferenceConceptDraft`) and is the ONLY call site that
turns them into on-disk bundle files, per `docs/specs/id-132-okf-concept-
producer/TECH.md` §"The two-pass loop" (index.md/log.md paragraph) +
§"Proposed changes per invariant" BI-11/13/18:

    Per concept: call the validator gate (id 7) THEN
    localfs.declare_file(bundle_dir/concept_path, markdown,
    create_parent_dirs=True) (BI-11). log.md (BI-11/BI-18): append one
    block per producer run.

**The index surface is per-directory, and its axis is the directory
(id-429, DESIGN.md D1/D3/D7 — a design decision the owner took, NOT a
conformance fix: §8 says an index MAY appear in any directory and §11
forbids rejecting a bundle for missing ones).** `write_bundle` declares one
`index.md` per directory, root to leaf, each enumerating that directory's
IMMEDIATE members — its concept files and its immediate child directories,
nothing else. BI-5's "~17 client themes as index.md nav sections" is
RETIRED, not replaced ({429.3}): the theme axis had no supplier
(`theme_config` defaulted to `()` at every call site; the sibling config
file the code named as its feed never existed), the only behaviour that
ever shipped was its `unthemed_heading` fallback, and the owner ruled the
originating client theme-index requirement not live (S546, closing id-323).
The bundle-ROOT index still enumerates every concept — D2's directory
listing is {429.6} and is gated on id-439's consumer support.

**S451 rider (BINDING — the shipped {132.14} viewer's parsers are the
format contract), as amended by the OKF conformance waves (v0.2 SPEC
§9/§12, id-426).** `regenerate_indexes` and `append_log_entry` emit EXACTLY
the text shape `lib/okf/parse-index.ts` / `lib/okf/parse-log.ts` parse — a
format mismatch degrades `<BundleNav>`/`<BundleLog>` SILENTLY (both
parsers have a graceful type-grouping fallback, so a divergence would not
raise, just quietly degrade). `parse-index.ts`: a §12 frontmatter block
(`okf_version: "0.2"` — the single key; the parser skips it, and only the
BUNDLE-ROOT index carries one at all), then `##`/`###` section headings,
`* [title](path.md) — description` concept bullets (this writer picks the
em-dash separator — the parser's own worked example glyph; both `-`/`—`
are accepted, so a hyphen would ALSO round-trip. id-429 {429.4} flips it
to the ASCII hyphen §8 shows, riding id-426's fixture wave). Only the
bundle-ROOT index is ever parsed for nav (`app/api/okf/[bundleId]/graph/
route.ts`); a nested index is an ordinary renderable file to the consumer,
and `bundle-graph.ts` skips both by basename.
`parse-log.ts` (§9): `## YYYY-MM-DD` DATE headings, newest date FIRST
(prepend); runs within a date are `* **Run <ISO-ts> — <Action> (N):** …`
bullets, newest run first. A committed round-trip fixture
(`__tests__/fixtures/okf/bundle-writer-*.md`, generated FROM this module's
own `regenerate_indexes`/`append_log_entry` output) plus a Vitest
assertion in `__tests__/lib/okf/` prove this module never silently drifts
from the parsers' contract (the TS-side fixture/parser refresh for v0.2 is
id-439's consumer wave).

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

**Cross-grain `case_study` slug collision (ID-132 {132.29}) — resolved at
the SOURCE since ID-427 {427.8}; this module no longer participates.** A
buyer that is BOTH a named-client entity (`sources/l_records.py:_list_case_
study_concepts`) AND a won-bid `issuing_organisation` (`_list_won_bid_case_
study_concepts`, S443 amendment/DR-029) slugs identically. Merging the two
drafts into one bundle file was rejected and stays rejected: BI-28 requires
the won-bid grain to stay a distinct human-reviewable accept/edit/reject
PROPOSAL, never silently blended into an already-published named-client
page, and two independently-sourced `ConceptDraft`s (different provenance,
frontmatter, body) have no principled "whose content wins" answer.

{132.29} separated them HERE, by redirecting every won-bid draft's physical
write target into a `won-bid/` sibling directory while leaving both grains
minting one shared identity `rel_path`. That fixed the on-disk clash and
nothing else. Identity is what `producer/enrich.py` keys the BI-9 concept
catalogue on (`:970`) and what its Pass-1 `read_concept_raw`/`sample_rows`
router looks concepts up by (`:535`), so a shared identity cost two things,
both measured at the {427.8} base SHA against the buyer the showcase bundle
actually ships twice:

- the catalogue is a SET and the router a DICT, so the two concepts
  collapsed to ONE addressable entry — the won-bid concept could not be
  BI-9 cross-linked, `list_concepts` offered its path twice, and the later
  registry entry won the router;
- a CROSS-read (some other concept asking for that path) was answered with
  the won-bid grain's rows under the named-client path.

**A self-read was NOT affected, and the distinction matters:** `enrich_
concept` pre-seeds `raw_cache[key.rel_path]` with its own `read_concept`
result (`enrich.py:960-961`), and the clobbering key carries the SAME
rel_path string, so the cache hit returned the correct rows. Nothing here
should be read as a claim that shipped named-client concepts were drafted
from won-bid data.

{427.8}'s fix is one line in the grain registry: the won-bid grain declares
`directory="case-studies/won-bid"`, so the two grains mint two DISTINCT
identities and the path this module writes to is simply
`ConceptKey.rel_path`. No file moves — the string is the one the redirect
already produced. `_won_bid_case_study_redirect`/`bundle_write_path`/
`bundle_write_path_for_key` are deleted; there is no longer any rule by
which a concept's identity and its physical location can disagree, and
therefore nothing for `flow_def.py` to keep in sync (its embed lookup and
BI-28 provenance map key on `rel_path` directly).

`write_bundle` still guards the general case defense-in-depth, and that
requirement is UNCHANGED by the collapse: ANY two drafts whose paths
coincide in one run — a feeder grain pointed at a built-in's directory, a
future grain, {427.10}'s residual — raise `ValueError` before either is
written, rather than the second silently clobbering the first.
`canonical://` pointer stability is unaffected either way: those URIs
address DB rows by id (TECH §resource_uri), never a bundle rel_path.

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
from typing import Any, Literal, Mapping, Sequence, TypeAlias

from scripts.cocoindex_pipeline._coco_api import localfs
from scripts.cocoindex_pipeline.producer.enrich import ConceptDraft
from scripts.cocoindex_pipeline.producer.frontmatter import (
    ConceptFrontmatter,
    render_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer import iri_projection
from scripts.cocoindex_pipeline.producer.validator import (
    EffectiveOntology,
    check_concept,
    check_type_shape,
)
from scripts.cocoindex_pipeline.producer.web_pass import ReferenceConceptDraft
from scripts.cocoindex_pipeline.sources.base import RESERVED_CONCEPT_STEMS
from scripts.cocoindex_pipeline.sources.l_records import BUILTIN_GRAIN_TYPE_LABELS

# Reserved bundle-level filenames — never treated as a concept `.md` path by
# `_existing_concept_paths`'s previous-run keyset scan (BI-11: N concept
# files PLUS index.md/log.md; DR-027 adds two more bundle-level artefacts,
# the overlay-carrier `ontology.json` (DR-027 as amended S546 — no longer a
# base snapshot, see its own section below) + the client-authored overlay
# source; S464 rider R1
# additionally reserves the committed bundle README, and the OKF v0.1
# conformance wave reserves the hand-authored bundle-root CONFORMANCE.md, so
# neither ever surfaces as a false `RunSummary.removed` entry — see
# `_existing_concept_paths`). {132.44} (bl-457 G-IRI-PROJECTION IRI-4/9)
# adds the JSON-LD `@context` artefact — a `.jsonld` file, so
# `_existing_concept_paths`'s `rglob("*.md")` scan structurally never picks
# it up either way; reserved here for intent/parity with the other
# bundle-level artefacts. {132.36} G-CONCEPT-FEEDER adds
# `concept-feeder.json` — the same client-authored reserved-sibling-file
# pattern `ontology-overlay.json` established, applied to concept-type
# feeding (producer reads-only — see `read_concept_feeder_config`).
#
# **The reservation has TWO scopes (id-429 {429.2}, SPEC §3.1).** `index.md`
# and `log.md` are reserved AT ANY DEPTH — §3.1 states the reserved names
# hold "at any level of the hierarchy", and MUST NOT be used for concept
# documents anywhere in the tree. Every other name here is reserved at the
# bundle ROOT ONLY: those are single, bundle-level artefacts, and a nested
# `guides/README.md` is a legitimate concept document. This mirrors the TS
# consumer's already-correct split (`lib/okf/bundle-graph.ts` — basename
# skip for index/log, full-relative-path `RESERVED_ROOT_DOCS` for
# README/CONFORMANCE).
INDEX_FILENAME = "index.md"
LOG_FILENAME = "log.md"
ONTOLOGY_FILENAME = "ontology.json"
README_FILENAME = "README.md"
CONFORMANCE_FILENAME = "CONFORMANCE.md"
OVERLAY_FILENAME = "ontology-overlay.json"
CONTEXT_FILENAME = "context.jsonld"
CONCEPT_FEEDER_FILENAME = "concept-feeder.json"
_RESERVED_ANY_DEPTH_FILENAMES = frozenset({INDEX_FILENAME, LOG_FILENAME})
"""SPEC §3.1 — reserved by BASENAME at every level of the hierarchy. Without
this scope, a per-directory `certifications/index.md` (id-429 {429.5}) is
counted as a previous-run CONCEPT by `_existing_concept_paths`, never appears
in `written`, and so lands in `RunSummary.removed` on EVERY run, forever —
polluting `log.md` and the human-edit reconcile set. It also protects a
client-hand-authored nested `log.md`, which §9 permits and DR-016 makes
plausible: the producer never declares one, so it is never orphan-deleted,
and it must never be miscounted as a concept either."""

_RESERVED_ROOT_FILENAMES = frozenset(
    {
        ONTOLOGY_FILENAME,
        README_FILENAME,
        CONFORMANCE_FILENAME,
        OVERLAY_FILENAME,
        CONTEXT_FILENAME,
        CONCEPT_FEEDER_FILENAME,
    }
)
"""Reserved at the bundle ROOT only — matched against the full bundle-relative
path, never a bare basename. A nested `guides/README.md` is a concept
document (deliberate, and the rule `lib/okf/bundle-graph.ts`'s
`RESERVED_ROOT_DOCS` already applies on the consumer side)."""

_RESERVED_BUNDLE_FILENAMES = _RESERVED_ANY_DEPTH_FILENAMES | _RESERVED_ROOT_FILENAMES
"""Every reserved bundle filename, regardless of scope — the membership test
for "is this name the producer's to manage", NOT a path test. Callers
deciding whether an on-disk PATH is reserved must use the two scoped sets
above (see `_is_reserved_bundle_path`)."""


def _is_reserved_bundle_path(rel_path: str) -> bool:
    """True iff `rel_path` (bundle-relative, POSIX) names a reserved bundle
    artefact rather than a concept document — `index.md`/`log.md` at ANY
    depth (§3.1), every other reserved name at the bundle root only
    (id-429 {429.2})."""
    return (
        PurePosixPath(rel_path).name in _RESERVED_ANY_DEPTH_FILENAMES
        or rel_path in _RESERVED_ROOT_FILENAMES
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

    `ConceptWriteResult.rel_path` is the draft's identity `rel_path`
    (`_rel_path_of`), which since ID-427 {427.8} IS its bundle write path
    for every concept without exception — the grain declares the directory,
    so there is no rule that can make the two disagree (see this module's
    docstring on the retired {132.29} redirect).

    `effective_ontology` (OV-8, ID-132 {132.34}) is the run's composed
    base ∪ client-overlay set (`write_bundle` computes it once per run via
    `read_client_overlay` and passes it to every `declare_concept` call);
    `None` gates against the bare base frozensets, unchanged.

    **No write-time trailer normalisation under v0.2 (id-426, S546
    F1-A).** The `# Citations` trailer is retired: a draft's provenance is
    its `sources:` frontmatter (§5.1) plus the `[^id]` footnote
    definitions already rendered into `draft.body` at draft time by the
    single shared emitters (`frontmatter.sources_from_citations` /
    `render_source_footnotes`), so the body is written as-is and the
    on-disk format still never depends on model formatting.
    """
    rel_path = _rel_path_of(draft)
    frontmatter: ConceptFrontmatter = draft.frontmatter
    body: str = draft.body
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
# index.md — BI-11 progressive-disclosure nav (pure renderer)
#
# The axis of every index is THE DIRECTORY IT SITS IN (id-429 D1): an index
# enumerates its own directory's immediate members — the concept files in it
# and its immediate child directories — and nothing else. No taxonomy, no
# cross-cut, no config. The ~17-theme machinery this section used to carry
# is RETIRED, not replaced (D3, {429.3}); see `IndexSection`.
# ─────────────────────────────────────────────────────────────────────────

OKF_VERSION = "0.2"
"""The SPEC revision this producer's bundles declare (id-426). Stamped into
the BUNDLE-ROOT `index.md`'s frontmatter and nowhere else — §12 plus §8's
single exception ("a bundle-root `index.md` MAY carry an `okf_version` key")
make the root index the only index permitted a frontmatter block at all."""

ROOT_INDEX_TITLE = "OKF Concept Bundle"

_ENTRY_SEPARATOR = "—"
"""The separator in `* [Label](target) — description`. **{429.4} flips this
to an ASCII hyphen-minus** to match §8's shown form, riding id-426's fixture
wave — deliberately NOT changed here, so the round-trip fixture moves exactly
once. It is a producer-only change either way: `lib/okf/parse-index.ts`'s
`CONCEPT_BULLET_RE` separator class is already `[-—]`, so both glyphs
round-trip through the consumer today."""


@dataclass(frozen=True)
class IndexConceptEntry:
    """One `* [title](path.md) — description` concept bullet."""

    title: str
    rel_path: str
    """The link target, WITH the `.md` suffix. Relative to the index's OWN
    directory, never bundle-absolute (D5): `certifications/index.md` links
    `iso-27001.md`. `lib/okf/parse-index.ts`'s `CONCEPT_BULLET_RE` requires
    the target to end in `.md`, then strips it to derive
    `BundleNavConcept.path`, which `bundle-nav.tsx:157` compares against a
    graph node id — so for a NESTED index the consumer must join this
    against the index's own directory (id-439's base-dir argument, DESIGN
    §6.2). At the bundle root the two forms coincide."""
    description: str


@dataclass(frozen=True)
class IndexDirectoryEntry:
    """One `* [Label](subdir/) — N concepts[, M subdirectories]` bullet (D6).

    §8's own example shows this form (`* [Subdirectory](subdir/) - short
    description of the subdirectory`). Where §8 says an entry SHOULD carry
    the linked concept's frontmatter `description`, a DIRECTORY has no
    frontmatter, so the SHOULD does not reach it — a derived count of
    immediate members is honest and, unlike a client-authored directory
    blurb, needs no supplier (which is precisely how the theme axis died).
    """

    label: str
    dir_name: str
    """The child directory's basename, WITHOUT a trailing slash — the
    renderer appends it. Directory-relative like every other entry (D5)."""
    description: str


IndexEntry: "TypeAlias" = "IndexConceptEntry | IndexDirectoryEntry"
"""What a section's bullet list holds. Two shapes, one bullet grammar —
`* [label](target) — description` — so `_render_entry` is the single place
the two diverge (a concept's target ends `.md`, a directory's ends `/`)."""


@dataclass(frozen=True)
class IndexSection:
    """One `##`/`###` heading node — the renderer's structural node
    (heading + level + entries + children). Matches `lib/okf/parse-index.ts`'s
    `BundleNavTheme` shape exactly (level 2 = `##` top section; level 3 =
    `###` subsection, nested under its parent via `children`, never emitted
    bare).

    **Renamed from `IndexTheme` (id-429 {429.3}, D3).** The node survived the
    theme retirement because it is structural, not taxonomic: its heading is
    now one of the literals `## Concepts` / `## Directories` (D6), derived
    from the directory the index sits in, not a client-supplied theme name.
    The rename is the point — a node called `IndexTheme` invites the next
    reader to re-introduce an axis the owner ruled not live (S546).
    """

    heading: str
    level: "Literal[2, 3]" = 2
    entries: "tuple[IndexEntry, ...]" = ()
    children: "tuple[IndexSection, ...]" = ()

    def __post_init__(self) -> None:
        if self.level not in (2, 3):
            raise ValueError(
                "IndexSection.level must be 2 or 3 (## or ###) — matches "
                "lib/okf/parse-index.ts's HEADING_RE"
            )
        if self.level == 3 and self.children:
            raise ValueError(
                "a level-3 (###) subsection cannot itself carry children — "
                "lib/okf/parse-index.ts only nests ### under ##, never "
                "deeper"
            )


def _render_entry(entry: "IndexEntry") -> str:
    if isinstance(entry, IndexDirectoryEntry):
        label, target = entry.label, f"{entry.dir_name}/"
    else:
        label, target = entry.title, entry.rel_path
    return f"* [{label}]({target}) {_ENTRY_SEPARATOR} {entry.description}"


def _render_section(section: IndexSection, lines: "list[str]") -> None:
    lines.append(f"{'#' * section.level} {section.heading}")
    lines.append("")
    for entry in section.entries:
        lines.append(_render_entry(entry))
    if section.entries:
        lines.append("")
    for child in section.children:
        _render_section(child, lines)


def regenerate_indexes(
    sections: "Sequence[IndexSection]",
    *,
    title: str = ROOT_INDEX_TITLE,
    okf_version: "str | None",
) -> str:
    """BI-11: the pure progressive-disclosure `index.md` renderer — ONE
    index's text, for whichever directory the caller is rendering.

    Emits a single `#` document title, then `##` section headings with
    `* [label](target) — description` bullets (D4's house-style ruling: the
    spec states no heading-level constraint, and `##`/`###` is what
    `lib/okf/parse-index.ts`'s `HEADING_RE` matches, so `#` group headings
    would make `parseBundleNav` return `[]` and silently degrade the nav).
    A level-3 heading is ALWAYS nested under its parent level-2 heading
    (`IndexSection.children`), never emitted bare — the parser's "no
    preceding `##`" branch is a defensive fallback for malformed input,
    never this writer's own output.

    **`okf_version` is REQUIRED and has no default — that is the point
    (id-429 D7/AC-5).** §12 plus §8's single exception permit a frontmatter
    block in the bundle-ROOT index only, so a nested index must carry none.
    Passing the stamp as a parameter makes "a nested index acquires
    frontmatter" structurally impossible rather than conventionally avoided;
    making it required (rather than defaulting to `None`) closes the other
    direction too — the root index cannot silently lose its stamp because a
    caller forgot the keyword. `None` renders no frontmatter at all; a
    string renders the block with EXACTLY that one key.

    Does NOT decide which concept belongs to which index — that is
    `build_directory_indexes`, and under D1 it is a mechanical projection of
    the concepts' own physical paths, so this renderer's input has a supplier
    by construction. (The ~17-theme axis it replaced did not: `theme_config`
    defaulted to `()` at every call site and the one behaviour that ever
    shipped was its `unthemed_heading` fallback. Retired in {429.3} on the
    owner's S546 ruling that the requirement is not live.)
    """
    lines: "list[str]" = []
    if okf_version is not None:
        lines += ["---", f'okf_version: "{okf_version}"', "---"]
    lines += [f"# {title}", ""]
    for section in sections:
        _render_section(section, lines)
    return "\n".join(lines).rstrip("\n") + "\n"


# ─────────────────────────────────────────────────────────────────────────
# One index per directory (id-429 D1/D6/D7, {429.5})
# ─────────────────────────────────────────────────────────────────────────


def _directory_label(dir_name: str) -> str:
    """D6: `-`/`_` to spaces, then upper-case the first character
    (`case-studies` -> "Case studies"). No lookup table and no title-case
    stop-word list — the function must be TOTAL over directory names id-427
    has not minted yet. Only the first character is touched: lower-casing the
    remainder would mangle an acronym a future directory scheme may carry."""
    words = dir_name.replace("-", " ").replace("_", " ").strip()
    return words[:1].upper() + words[1:]


def _count_phrase(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def _directory_description(concept_count: int, subdirectory_count: int) -> str:
    """D6: the counts are of IMMEDIATE members, never recursive — the entry
    exists to predict the page the reader is about to open, and that page
    lists immediate members only. A recursive count would describe a subtree
    the linked index does not itself show."""
    parts = [_count_phrase(concept_count, "concept", "concepts")]
    if subdirectory_count:
        parts.append(
            _count_phrase(subdirectory_count, "subdirectory", "subdirectories")
        )
    return ", ".join(parts)


def _parent_dir(rel_path: str) -> str:
    """The bundle-relative POSIX parent of `rel_path`, with the bundle root
    spelled `""` rather than `"."`."""
    parent = str(PurePosixPath(rel_path).parent)
    return "" if parent == "." else parent


def build_directory_indexes(
    written: "Mapping[str, ConceptFrontmatter]",
) -> "dict[str, tuple[IndexSection, ...]]":
    """D1/D7: project ONE run's `written` set into the per-directory index
    set — `{bundle-relative directory path: sections}`, the bundle root
    spelled `""`.

    Membership is `written` — this run's VALIDATED set — not the on-disk
    tree. A tree read would include concepts cocoindex's reconciliation is
    about to orphan-delete, and would re-admit the failure mode `written`
    already rules out. Two decided consequences follow (D7): a concept that
    failed to draft this run (`failed_rel_paths`) is absent from its index
    even though `_reaffirm_failed_concepts` keeps its file alive; and a
    directory whose last concept leaves simply stops having an index
    declared, which the engine's own orphan-delete reconciliation then
    cleans up (EXECUTOR-VERIFY, module docstring) — this module never
    unlinks.

    `written` is keyed by the path each concept was actually written to,
    which since ID-427 {427.8} is its identity `rel_path` — a won-bid
    `case_study` is grouped under `case-studies/won-bid` because that is the
    directory its grain declares. Before {427.8} the two could disagree and
    this grouping had to follow the physical path deliberately; there is now
    no second path for it to follow.

    Rules:

    - **Every directory on the path from the root to every concept is
      present**, so an intermediate directory holding only a child directory
      (a `case-studies/` whose concepts all live in `won-bid/`) still gets
      an index and the root->leaf chain is never broken.
    - **The bundle root is ALWAYS present**, even for an empty bundle — it
      carries the §12 `okf_version` stamp, which must not disappear when the
      corpus is empty.
    - **Ordering is ASCII-ascending by link target within each section**, and
      the returned mapping is in ascending directory order. Determinism is
      not cosmetic here: the bundle is a client-owned git repo (DR-016) and a
      non-deterministic index produces a diff on every run.

    **The bundle-root index is deliberately NOT yet a directory listing.**
    D2 makes the root emit directory entries plus a `## Concepts` section for
    bundle-root concept files only — but `parseBundleNav` drops any bullet
    whose target is not `.md`, so a root of directory entries returns
    non-empty sections with zero concepts, which suppresses `<BundleNav>`'s
    absent-index fallback and renders an EMPTY nav rail. That is why D2 is
    carried by {429.6} and gated on id-439's directory-entry support. Until
    then the root keeps enumerating every concept, exactly as it does today,
    and this subtask adds only the nested indexes — which no consumer parses
    for nav (`app/api/okf/[bundleId]/graph/route.ts` reads the bundle-ROOT
    `index.md` alone).
    """
    concepts_by_dir: "dict[str, list[str]]" = {}
    for rel_path in written:
        concepts_by_dir.setdefault(_parent_dir(rel_path), []).append(rel_path)

    directories: "set[str]" = {""}
    for directory in concepts_by_dir:
        if not directory:
            continue
        parts = PurePosixPath(directory).parts
        for depth in range(len(parts)):
            directories.add("/".join(parts[: depth + 1]))

    children_by_dir: "dict[str, list[str]]" = {d: [] for d in directories}
    for directory in directories:
        if directory:
            children_by_dir[_parent_dir(directory)].append(directory)

    indexes: "dict[str, tuple[IndexSection, ...]]" = {}
    for directory in sorted(directories):
        sections: "list[IndexSection]" = []

        # The {429.6} seam: the root still lists EVERY concept (today's
        # behaviour, unchanged); a subdirectory lists its own immediate
        # concepts, linked relative to itself (D5).
        if directory:
            concept_paths = sorted(concepts_by_dir.get(directory, ()))
        else:
            concept_paths = sorted(written)
        if concept_paths:
            sections.append(
                IndexSection(
                    heading="Concepts",
                    entries=tuple(
                        IndexConceptEntry(
                            title=written[rel_path].title,
                            rel_path=(
                                PurePosixPath(rel_path).name if directory else rel_path
                            ),
                            description=written[rel_path].description,
                        )
                        for rel_path in concept_paths
                    ),
                )
            )

        child_dirs = sorted(children_by_dir.get(directory, ()))
        if directory and child_dirs:
            sections.append(
                IndexSection(
                    heading="Directories",
                    entries=tuple(
                        IndexDirectoryEntry(
                            label=_directory_label(PurePosixPath(child).name),
                            dir_name=PurePosixPath(child).name,
                            description=_directory_description(
                                len(concepts_by_dir.get(child, ())),
                                len(children_by_dir.get(child, ())),
                            ),
                        )
                        for child in child_dirs
                    ),
                )
            )

        indexes[directory] = tuple(sections)
    return indexes


def declare_directory_indexes(
    bundle_dir: Path, written: "Mapping[str, ConceptFrontmatter]"
) -> "dict[str, str]":
    """D7: `declare_file` one `index.md` per directory, root to leaf, in the
    SAME declare pass as the concepts and BEFORE `append_log_entry`. Returns
    `{index bundle-relative path: rendered content}` for the caller's own
    inspection; the physical write is the engine's.

    Only the bundle-ROOT index is rendered with the `okf_version` stamp — the
    renderer takes it as a required parameter, so a nested index cannot
    acquire frontmatter it is not permitted (AC-5, structural rather than
    conventional)."""
    declared: "dict[str, str]" = {}
    for directory, sections in build_directory_indexes(written).items():
        is_root = not directory
        index_rel_path = (
            INDEX_FILENAME if is_root else f"{directory}/{INDEX_FILENAME}"
        )
        content = regenerate_indexes(
            sections,
            title=(
                ROOT_INDEX_TITLE
                if is_root
                else _directory_label(PurePosixPath(directory).name)
            ),
            okf_version=OKF_VERSION if is_root else None,
        )
        localfs.declare_file(
            bundle_dir / index_rel_path, content, create_parent_dirs=True
        )
        declared[index_rel_path] = content
    return declared


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
    B, DR-047): the bundle paths of concepts whose draft
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
    """One producer run's bullet lines (SPEC §9 conformance shape) — every
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
    """BI-11/BI-18/BI-22 + SPEC §9: render ONE run as a fresh date section —
    a `## YYYY-MM-DD` ISO-8601 DATE heading (§9 MUST) followed by the run's
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
    this run's entry — SPEC §9: date-grouped, NEWEST FIRST. `declare_file`
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
# DR-027 as amended (S546) — the client-overlay carrier artefact
#
# `ontology.json` was DR-027's "materialised effective ontology (pinned
# base snapshot + client overlay)". ID-427 {427.11} executes the S546
# amendment: the `base` half — `_base_ontology_snapshot`, a pinned
# bundle-shipped copy of the platform entity/relationship registers — is
# RETIRED, and the artefact reduces to DR-054's client-overlay carrier
# (re-affirmed S546 as `ontology.json`'s surviving purpose).
#
# DR-027's platform-repo half is UNCHANGED: the base CVs still live in
# this repo and still version with the linter that enforces them
# (`validator.ALLOWED_ENTITY_TYPES`/`ALLOWED_RELATIONSHIP_TYPES` remain
# the BI-13 gate, and `EffectiveOntology` still composes them). They are
# simply no longer ASSERTED to bundle consumers. Under DR-141's open
# concept vocabulary a closed declaration would assert something false,
# and the bundle self-describes the OKF-native way — through its concepts
# and the id-429 per-directory indexes — rather than by shipping a schema
# registry alongside them ("there is no schema registry, no central
# authority, and no required tooling", OKF §1).
# ─────────────────────────────────────────────────────────────────────────


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
# config (`concept-feeder.json`), the client-authored reserved-sibling-file
# pattern `ontology-overlay.json` established ({132.34}/OV-1), applied to
# concept-type feeding. See `sources/l_records.py`'s `LRecordsSource` for the
# CONSUMING half (enumeration/read/sample of an overlay-added concept type
# via the `entity_mention` grain).
# ─────────────────────────────────────────────────────────────────────────


class ConceptFeederConfigError(ValueError):
    """ID-132 {132.36} G-CONCEPT-FEEDER, DR-054: raised when a PRESENT
    `concept-feeder.json` fails validation — invalid JSON, a non-object top
    level, an unknown top-level key, a `concept_types` entry naming a type
    that collides with a built-in grain's own label
    (`sources.l_records.BUILTIN_GRAIN_TYPE_LABELS`) or `'q_a_pair'` (BI-3),
    a grain config with an unrecognised `grain` value or a
    non-string/empty `entity_type`, or ({427.7}) a `directory` that is empty
    or names an OKF §3.1 reserved stem. Mirrors `OntologyOverlayError`
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
    _CONCEPT_FEEDER_GRAINS>, "entity_type": <non-empty string>,
    "directory": <optional non-empty string>}`.

    A declared type name may not equal a built-in grain's own label
    (`sources.l_records.BUILTIN_GRAIN_TYPE_LABELS` — those already route via
    a built-in registry entry, and a feeder entry for one would enumerate a
    second time as an ambiguous shadow) or `'q_a_pair'` (BI-3, defence in
    depth ahead of `ConceptKey.__post_init__`'s own runtime guard). It is NOT
    otherwise constrained: since ID-427 {427.5} a feeder may declare any
    well-shaped label without an `ontology-overlay.json` entry permitting it
    (DR-141).

    **ID-427 {427.7} — `directory` (TECH §2.7).** Type and directory
    decouple, so a feeder declares its own bundle directory. Omitted, it
    defaults to the declared type name: `iri_projection.slug()` is identity
    on every shape-valid label, so TECH's "defaults to `slug(type)`" and the
    pre-{427.7} `{concept_type}/` layout are the same string — there is no
    config to migrate and no directory moves.

    **`index`/`log` are refused as a directory name** (TECH §2.6, id-429
    IA-3). A concept slug that lands on a reserved stem is deterministically
    renamed (`sources.base.mint_concept_slug`) because a client document
    called "Index" is a data fact; a reserved *directory* name is a
    configuration error, and this module's fail-loud-at-read posture is the
    right place to say so.

    Raises `ConceptFeederConfigError` on any violation."""
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
        if concept_type == "q_a_pair" or concept_type in BUILTIN_GRAIN_TYPE_LABELS:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'] declares "
                f"{concept_type!r}, which is either 'q_a_pair' (BI-3, never "
                "a concept) or a label a BUILT-IN grain already emits — a "
                "feeder entry naming one would enumerate the same concepts "
                "twice, from two grains"
            )
        # ID-427 {427.5}: the declared name must be a well-formed OKF type
        # label. Checked HERE, at read time, to preserve this module's own
        # fail-loud-at-read posture (see `ConceptFeederConfigError`): before
        # {427.5} the {132.36} contextvar widened `ConceptKey`'s gate to
        # accept whatever the config declared, so a malformed name reached
        # enumeration and was soft-rejected at BI-13. `ConceptKey` now
        # applies the shape rule, so without this check a malformed name
        # would raise mid-`list_concepts` and abort the run at a strictly
        # worse point than the config read that could have caught it.
        shape_errors = check_type_shape(concept_type)
        if shape_errors:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'] declares "
                f"{concept_type!r}, which is not a well-formed OKF type "
                f"label: {'; '.join(shape_errors)}"
            )
        if not isinstance(grain_config, dict):
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}] "
                f"must be a JSON object, got {type(grain_config).__name__}"
            )
        unknown_grain_keys = sorted(
            set(grain_config) - {"grain", "entity_type", "directory"}
        )
        if unknown_grain_keys:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}] "
                f"has unknown key(s) {unknown_grain_keys} — only "
                "['directory', 'entity_type', 'grain'] are permitted"
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
        # ID-427 {427.7} (TECH §2.7): the grain's own bundle directory.
        directory = grain_config.get("directory", concept_type)
        if not isinstance(directory, str) or not directory.strip():
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}]"
                "['directory'] must be a non-empty string, got "
                f"{directory!r}"
            )
        # id-429 IA-3 / TECH §2.6. A directory named `index` or `log` puts a
        # reserved OKF §3.1 name in the position the emitted per-directory
        # index occupies; unlike a client document that happens to be called
        # "Index", this is a configuration choice, so it is refused rather
        # than silently renamed.
        if directory.strip().casefold() in RESERVED_CONCEPT_STEMS:
            raise ConceptFeederConfigError(
                f"{CONCEPT_FEEDER_FILENAME}['concept_types'][{concept_type!r}]"
                f"['directory'] is {directory!r}, which OKF §3.1 reserves at "
                "every level of the hierarchy — choose another directory name"
            )
        validated[concept_type] = {
            "grain": grain,
            "entity_type": entity_type,
            "directory": directory,
        }
    return validated


def read_concept_feeder_config(bundle_dir: Path) -> "dict[str, dict[str, str]] | None":
    """OV-1-precedent read (ID-132 {132.36} G-CONCEPT-FEEDER, DR-054): read
    + validate the client-authored `concept-feeder.json` at `bundle_dir`'s
    root — the client-authored reserved-sibling-file pattern
    `ontology-overlay.json` established, applied to concept-type feeding. Returns the validated `{concept_type:
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
    """DR-027 as amended (S546): `ontology.json` is the **client-overlay
    carrier**, and nothing else. The payload is exactly
    `{"overlay": <mapping or null>}` — `client_overlay` is the OV-6
    provenance-wrapped mapping `write_bundle` supplies via
    `read_client_overlay` (or an explicit caller-supplied mapping),
    nested verbatim under its own `overlay` key when present.

    **No `base` key** since ID-427 {427.11}. The pinned base snapshot the
    S441 ruling shipped alongside the overlay retired at S546: the
    platform's entity/relationship CVs stay in this repo, versioned with
    the linter that enforces them, and are no longer asserted to bundle
    consumers. Two dimensions had already stopped matching the three the
    writer emitted, and under DR-141 a closed concept-type declaration
    would have asserted something false.

    Deliberately PLAIN JSON, not a bespoke ontology DSL — the {132.10}
    brief is explicit not to invent an ontology FORMAT. The explicit
    `overlay: null` placeholder STAYS when no client-overlay source is
    available, so a bundle consumer can still distinguish "no overlay
    shipped yet" from "platform-owned bundle, never a client-overlay
    consumer" (OV-10) — and so `lib/okf/bundle-graph.ts`'s
    `readBundleClassSignal` keeps a present-and-null key to read rather
    than falling through to `'unknown'`. Pure echo of whatever
    `client_overlay` mapping it is given — the provenance-stamping and
    OV-2/OV-3/OV-5 validation both happen upstream, in
    `read_client_overlay`.
    """
    payload = {
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
    """The bundle's CURRENT on-disk concept `.md` files (excluding every
    reserved bundle artefact) — the "previous run" keyset this module diffs
    against for the `log.md` added/changed/removed summary.

    Reading the real directory tree (rather than requiring a caller to
    persist state externally) is sound because `declare_file` writes are
    REAL filesystem writes once a run actually applies (EXECUTOR-VERIFY,
    module docstring) — `bundle_dir` IS the durable record of "what the
    last run declared", and cocoindex's OWN reconciliation phase (which
    performs the physical write/delete) always completes before this
    function's caller runs again for the NEXT producer invocation.

    Reservation is SCOPED, not a flat basename set (id-429 {429.2}): the
    previous form compared the full bundle-relative path against a set of
    bare basenames, so `certifications/index.md` matched nothing and was
    counted as a concept. See `_is_reserved_bundle_path`.
    """
    if not bundle_dir.is_dir():
        return set()
    return {
        rel
        for p in bundle_dir.rglob("*.md")
        if not _is_reserved_bundle_path(
            rel := p.relative_to(bundle_dir).as_posix()
        )
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
    moved: "Mapping[str, str]" = MappingProxyType({}),
    orphaned_anchors: "Sequence[str]" = (),
    failed_rel_paths: "Sequence[str]" = (),
    client_ontology_overlay: "Mapping[str, object] | None" = None,
    bundle_class: "BundleClass | None" = None,
    client_id: "str | None" = None,
    timestamp: "str | None" = None,
) -> RunSummary:
    """The per-run G-BUNDLE orchestration: validator-gate + `declare_file`
    every concept (BI-13/BI-11), regenerate ONE `index.md` PER DIRECTORY
    (id-429 D1/D7 — root to leaf, in this same declare pass), append one
    `log.md` run block (BI-11/BI-18/BI-22), and ship the DR-027 ontology
    artefact plus the {132.44} bl-457 `context.jsonld` IRI-projection
    artefact. Returns the `RunSummary` this run produced.

    **The index surface takes no config (id-429 D1/D3, {429.3}/{429.5}).**
    The `theme_config` parameter is gone: each index's axis is the directory
    it sits in, derived from `written`, so the input has a supplier by
    construction. Do not re-add it — the re-entry path for a theme, if the
    requirement is ever shown live again, is a theme as a *concept* (a
    document with links, in its own directory) or a viewer-side facet over
    `tags`, neither of which is a producer index axis (D3).

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
    of bundle paths whose Pass-1/Pass-2 draft failed THIS
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

    Raises `ValueError` if two drafts in this run resolve to the same bundle
    path — a client-declared feeder grain pointed at a built-in grain's
    directory, or any future grain pair minting one slug. Fails loudly
    before either write happens rather than letting the second
    `declare_file` call silently overwrite the first. (The {132.29}
    named-client/won-bid pair no longer reaches this guard: since ID-427
    {427.8} the two grains declare different directories, so they cannot
    coincide. The guard's requirement is the general one, not that pair.)

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

    **The effective ontology is no longer class-scoped (ID-427 {427.5},
    DR-141 + the owner's S546 uniformity ruling).** PC-4/{163.17} scoped
    the BI-4 concept-type dimension per bundle class, and `internal_dev`
    — which had no ratified type set — raised `ValueError` HERE, fail-loud
    at gate entry, before any `declare_file` call. **That fail-loud is
    deleted with the register it guarded:** its requirement was "this class
    has no ratified type set *yet*", and under DR-141 no class has one or
    needs one, so an `internal_dev` run now reaches the write loop like any
    other. `EffectiveOntology` keeps only `entity_types`/`relationship_
    types` — genuinely closed platform CVs, identical for every class — so
    `compose(overlay)` is the single resolution path: it is exactly
    `base_only()` when `overlay` is `None` (OV-4), and base ∪ overlay
    otherwise. The OV-10 class gate above is UNCHANGED and still the thing
    that stops a platform-owned bundle composing a stray client overlay
    (DR-054/DR-079 — a different, live requirement).
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
    effective_ontology = EffectiveOntology.compose(overlay)

    previous_paths = _existing_concept_paths(bundle_dir)
    moved_from = set(moved)
    failed_set = set(failed_rel_paths)

    written: "dict[str, ConceptFrontmatter]" = {}
    added: "list[str]" = []
    changed: "list[str]" = []
    unchanged: "list[str]" = []
    failures: "list[tuple[str, tuple[str, ...]]]" = []

    all_drafts: "list[Any]" = [*drafts, *reference_drafts]

    # Collision pre-pass (ID-132 {132.29}, generalised): resolve every
    # draft's bundle path BEFORE any `declare_file` call happens this run.
    # Detecting
    # a duplicate only once the loop below reaches it would be too late —
    # the FIRST draft would already be on disk by the time the SECOND
    # draft's collision is noticed, defeating "no silent overwrite" (the
    # first draft's content would still have been clobbered on the very
    # next run once the second draft's write lands). Failing before any
    # write in this run touches the filesystem keeps the run all-or-nothing
    # rather than leaving a half-written bundle.
    seen_write_paths: "set[str]" = set()
    for draft in all_drafts:
        write_path = _rel_path_of(draft)
        if write_path in seen_write_paths:
            raise ValueError(
                f"bundle write-path collision: more than one concept draft "
                f"resolves to bundle path {write_path!r} in this run — "
                "refusing to silently overwrite one with the other "
                "(ID-132 {132.29})"
            )
        seen_write_paths.add(write_path)

    for draft in all_drafts:
        result = declare_concept(
            bundle_dir,
            draft,
            effective_ontology=effective_ontology,
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

    declare_directory_indexes(bundle_dir, written)
    write_ontology_artefact(bundle_dir, client_overlay=overlay)
    write_context_artefact(bundle_dir, effective_ontology, client_id=client_id)
    append_log_entry(bundle_dir, summary, timestamp=timestamp)

    return summary
