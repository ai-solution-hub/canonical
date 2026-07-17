"""The repo/docs Source adapter — ID-163 {163.4} PC-1, the KA3 two-extractor
PROTOTYPE for the canonical-okf-system baseline bundle (Path-2
direct-producer authoring lane).

Structural SIBLING of `sources/l_records.py`'s `LRecordsSource`: implements
the SAME local `@runtime_checkable Source` protocol (`list_concepts()` /
`read_concept(key)` / `sample_rows(key, n)` / `find(query)`) so
`producer/flow_def.py`'s draft loop consumes either Source unchanged
(PC-2, a later Subtask). Unlike `LRecordsSource` (constructed over an
asyncpg-shaped `pool`), this adapter is constructed over a **repo/docs
ROOT PATH** — the persistent-volume checkout the producer already mounts
(`OKF_SOURCE_REPO_PATH`, PC-2). Never imports `cocoindex` (collection
safety for the bare-MagicMock pipeline unit tests — the SAME posture
`url_source.py`/`l_records.py` keep, TECH id-132:41/135).

**KA3 judged gate (doctrine key-assumption 3, "Path A balloons").** The
ratified TECH (id-163 §PC-1) claims the S1 system-bundle's five pillars
(`tool`/`api`/`schema`/`navigation`/`playbook`) split into exactly TWO
extractor families:

- **E1 — code-symbol grain** (`tool`, `api`, `schema`): identity + backing
  content resolve from a code symbol. THIS Subtask prototypes the `tool`
  pillar only — `tool`-name resolution from `defineTool(server, '<name>',
  ...)` call sites in `lib/mcp/tools/*.ts` (excludes `index.ts`'s
  `registerTools` barrel and `shared.ts`'s `defineTool` DEFINITION itself,
  since neither issues a call matching the pattern). `source_ref` is a
  `file#Lstart-Lend` locator spanning the matched `defineTool(...)` call
  (paren-depth-aware, so a `)` embedded in a tool's description prose does
  not truncate the span early).
- **E2 — markdown-page grain** (`navigation`, `playbook`): one concept per
  doc page, the page's own repo-relative path emitted as the free anchor
  (the `/understand-knowledge` precedent). THIS Subtask prototypes the
  `navigation` pillar only — every `*.md` file directly under
  `navigation_docs_dir` (default `docs/navigation/`, a constructor
  parameter since no such directory is ratified content yet — the
  PROTOTYPE proves the GRAIN, not a specific real corpus).

Both pillars resolve to the SAME `RepoConceptKey` shape below — no bespoke
per-pillar key type or read grid was needed, which is the KA3 verdict this
Subtask exists to prove (see `scripts/tests/test_repo_docs_source.py`'s
`TestKA3TwoExtractorPrototype`). The `api`/`schema`/`playbook` pillars are
explicitly NOT built here — the TECH's escalation trigger is "STOP before
authoring beyond the prototype" once KA3 holds on this minimal slice; a
future Subtask adds the remaining per-pillar LOCATOR resolvers (never a
third concept model) once KA3 is signed off.

**S4 — the `git_blob_sha` change signal (BI-18 delta lever analogue).**
`list_concepts()` computes, per concept, `git rev-parse HEAD:<file path>`
(subprocess) — the SAME `git_sync.py:264` `_run_git` subprocess posture
(no new git library; `dulwich`/`pygit2` are not in `requirements.txt`).
This is FILE-grained (a git blob SHA is a whole-file digest, not a
line-range digest) — two `tool` concepts backed by the same `.ts` file
share one `git_blob_sha` and invalidate TOGETHER on any edit to that file,
even one that only touches the OTHER tool's registration. This is expected
E1 granularity, not a bug: the alternative (a synthetic per-span hash) is
NOT "reusing the `git_sync.py` posture" and is out of this Subtask's scope.
A path absent at `HEAD` (an uncommitted fixture file, or the very first
producer run before any commit exists) resolves to `""` rather than
raising — mirrors `git_sync.py`'s `_read_head` treating "path absent" as
expected, not exceptional.

**PC-5 — citation provenance, generalised (ID-163 TECH, DR-086).** The
BI-17 discipline L-records enforces via `enrich.py`'s `_mint`/`seen_anchors`
per-row `canonical://` pattern applies here too, on a DIFFERENT anchor
scheme: a system concept has no DB row, so it cites a git-pinned PUBLIC
blob URL instead (DR-086 — the `canonical` repo is public and is the
citation base directly). `read_concept` is the sole mint site: every call
mints the artefact's `resource_uri.py:build_git_blob_citation` anchor into
`self.seen_anchors` and returns it on `RepoConceptRaw.resource` — an
artefact this run did not read cannot be cited. `producer/enrich.py:
_validate_citation` / `producer/web_pass.py:_validate_pass2_citation`
accept this scheme as an ADDITIVE branch (keyed on `resource_uri.py:
is_git_blob_citation`), leaving the `canonical://` L-records path
byte-identical. Reuses `git_blob_sha` (S4, above) as the citation's pin —
no new hash, no per-span synthetic hash (checker FYI: a stricter S4
granularity ruling is queued separately, out of this Subtask's scope).
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol, runtime_checkable

from scripts.cocoindex_pipeline.producer.resource_uri import build_git_blob_citation
from scripts.cocoindex_pipeline.producer.validator import EffectiveOntology

# ── PC-4 (ID-163 TECH, DR-079): the `system_baseline` bundle-class base
# concept-type set (163.3's `EffectiveOntology.base_for_class`) — the ONLY
# set a `RepoConceptKey.concept_type` may belong to. Computed once at
# import time (a cheap dict lookup + frozen-dataclass construction,
# `validator.py`'s own `_CLASS_CONCEPT_TYPES` registry is the single
# source of truth — never duplicated here). Unlike `ConceptKey` (BI-4),
# there is no overlay-widening mechanism for a `RepoConceptKey`: PC-6
# hard-rejects a discovered `ontology-overlay.json` for `system_baseline`
# runs upstream of this module, so the base set IS the effective set. ────
SYSTEM_BASELINE_CONCEPT_TYPES: "frozenset[str]" = EffectiveOntology.base_for_class(
    "system_baseline"
).concept_types


@dataclass(frozen=True)  # frozen → deterministic cocoindex memo key (BI-18 analogue)
class RepoConceptKey:
    """A system-bundle concept's identity + the locator fields
    `read_concept` needs — the repo/docs analogue of `l_records.py`'s
    `ConceptKey`. Frozen for the same reason: this is the memo-keyed
    component argument a future `enrich_concept` wiring keys
    `@coco.fn(memo=True)` on."""

    rel_path: str
    """Concept identity — the bundle rel_path. A system concept has no DB
    row and no uuid of its own; renaming this path changes the concept's
    identity (mirrors `ConceptKey.rel_path`, BI-2)."""

    concept_type: str
    """One of `SYSTEM_BASELINE_CONCEPT_TYPES` (PC-4) — validated in
    `__post_init__`. Never a `client_business` type (e.g. `company`); the
    two bundle-class type sets are disjoint, and a `RepoConceptKey` never
    widens via the {132.36} overlay mechanism (PC-6 rejects overlays for
    `system_baseline` outright)."""

    source_ref: str
    """The backing-artefact locator: `file#Lstart-Lend` for the E1
    code-symbol grain (the matched call site's span), or a bare doc-page
    repo-relative path for the E2 markdown-page grain (no line range — the
    whole page IS the concept)."""

    git_blob_sha: str = ""
    """**MEMO-FINGERPRINT-ONLY** (S4, the `ConceptKey.content_version`
    analogue). `list_concepts()`'s two enumeration methods compute this
    per concept via `git rev-parse HEAD:<source_ref's file path>` — a
    byte-identical backing artefact produces an unchanged
    `RepoConceptKey` (cocoindex memo-**HIT**, skip redraft); an edited one
    produces a changed key (memo-**MISS**, redraft). Kept LAST in field
    order (mirrors `ConceptKey.content_version`) so every positional
    `RepoConceptKey(...)` construction stays valid with its `""` default.
    Participates in `__eq__`/`__hash__` like every other field — that
    participation IS the delta lever, not an oversight (cocoindex's own
    `_canonicalize_dataclass` fingerprints every field unconditionally, so
    no `field(compare=False)` would even suppress it)."""

    def __post_init__(self) -> None:
        if not self.rel_path:
            raise ValueError(
                "RepoConceptKey.rel_path must be non-empty (identity = "
                "bundle rel_path = the cocoindex memo key)"
            )
        if self.concept_type not in SYSTEM_BASELINE_CONCEPT_TYPES:
            raise ValueError(
                "RepoConceptKey.concept_type must be one of "
                f"{sorted(SYSTEM_BASELINE_CONCEPT_TYPES)} (PC-4 "
                "system_baseline base type set); got "
                f"{self.concept_type!r}. A client_business type "
                "(e.g. 'company') is never valid here — the two "
                "bundle-class type sets are disjoint."
            )


@dataclass
class RepoConceptRaw:
    """The raw backing text for one repo/docs concept — `read_concept`'s
    return shape. `text` is the full artefact content this concept was
    resolved from: the matched `defineTool(...)` call span for E1, or the
    whole doc page for E2 — the Pass-1 draft prompt's context. Never
    frozen (unlike `RepoConceptKey`): a per-call return value, not a
    cocoindex memo key (mirrors `ConceptRaw`)."""

    text: str = ""

    resource: str = ""
    """PC-5 (ID-163 TECH, DR-086): the git-blob/doc-page citation anchor
    `read_concept` minted for this artefact (`producer/resource_uri.py:
    build_git_blob_citation`) — the system-bundle analogue of L-records'
    per-row `resource` field (`enrich.py:_with_resource`). Empty when the
    artefact's `git_blob_sha` is empty (absent at HEAD — an uncommitted
    fixture, or a repo with no commits yet): an unpinned artefact cannot
    resolve a public URL and must not be citable."""


@runtime_checkable
class Source(Protocol):
    """Structural mirror of the local `Source` protocol declared in
    `sources/l_records.py` (itself a mirror of the reference_agent's
    `sources/base.py`, external, not vendored). Declared LOCALLY here too
    — rather than imported from `l_records.py` — so a future consumer can
    `isinstance()`-check EITHER Source implementation without importing
    the other; the two declarations are structurally identical by
    design and must be kept in sync by hand."""

    async def list_concepts(self) -> "list[RepoConceptKey]": ...

    async def read_concept(self, key: RepoConceptKey) -> RepoConceptRaw: ...

    async def sample_rows(
        self, key: RepoConceptKey, n: int
    ) -> "list[Mapping[str, Any]]": ...

    async def find(self, query: str) -> "list[RepoConceptKey]": ...


# ── E1 (tool pillar) — `defineTool(server, '<name>', ...)` call-site scan.
# `lib/mcp/tools/shared.ts` DEFINES `defineTool`; `lib/mcp/tools/index.ts`
# only imports + calls the per-file `registerXTools` barrel — neither
# issues a call matching this pattern, so no filename exclusion is needed
# beyond the pattern itself. ─────────────────────────────────────────────

_TOOLS_DIR = Path("lib/mcp/tools")

_DEFINE_TOOL_CALL_RE = re.compile(
    r"defineTool\(\s*server\s*,\s*(['\"])(?P<name>[^'\"]+)\1"
)


def _match_closing_paren(text: str, open_idx: int) -> int:
    """Return the index of the ')' that closes the '(' at `open_idx`,
    skipping over string/template literals (a `)` inside a tool's
    `description` prose is common and must not perturb the depth count).
    Assumes `text[open_idx] == '('`."""
    if text[open_idx] != "(":
        raise ValueError(f"expected '(' at index {open_idx}, got {text[open_idx]!r}")
    depth = 0
    i = open_idx
    n = len(text)
    quote: "str | None" = None
    while i < n:
        ch = text[i]
        if quote is not None:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in "'\"`":
            quote = ch
            i += 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unbalanced parentheses scanning from index {open_idx}")


# ── E2 (navigation pillar) — one concept per `*.md` doc page. ───────────

_SLUG_INVALID_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    """Deterministic filename-safe slug for a bundle rel_path segment
    (mirrors `l_records.py`'s own `_slugify` — duplicated, not imported,
    since that helper is module-private and this module has no other
    dependency on `l_records.py`)."""
    slug = _SLUG_INVALID_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "untitled"


def _concept_haystack(key: RepoConceptKey) -> str:
    return " ".join((key.rel_path, key.concept_type, key.source_ref)).casefold()


_SOURCE_REF_RANGE_RE = re.compile(r"^(?P<path>[^#]+)#L(?P<start>\d+)-L(?P<end>\d+)$")


def _git_blob_sha(root: Path, rel_path: str) -> str:
    """The S4 change signal for one backing artefact:
    `git rev-parse HEAD:<rel_path>`, mirroring `git_sync.py:264`'s
    `_run_git` subprocess posture (no new git library — `dulwich`/
    `pygit2` are not in `requirements.txt`). Returns `""` if the path is
    absent at `HEAD` (an uncommitted fixture file, or a repo with no
    commits yet) rather than raising — mirrors `git_sync.py`'s
    `_read_head` treating "path absent" as expected, not exceptional."""
    result = subprocess.run(
        ["git", "rev-parse", f"HEAD:{rel_path}"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _read_source_ref(root: Path, source_ref: str) -> str:
    """The backing text a `source_ref` locator points at: a
    `file#Lstart-Lend` span for E1 (just the matched call, not the whole
    file), or the whole file for E2 (a bare path, no line range)."""
    match = _SOURCE_REF_RANGE_RE.match(source_ref)
    if match is None:
        return (root / source_ref).read_text(encoding="utf-8")
    file_path = root / match.group("path")
    lstart = int(match.group("start"))
    lend = int(match.group("end"))
    lines = file_path.read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join(lines[lstart - 1 : lend])


def _mint_git_blob_citation(key: RepoConceptKey, seen_anchors: "set[str]") -> str:
    """PC-5 (ID-163 TECH, DR-086): mint `key`'s backing artefact into a
    git-blob/doc-page citation anchor (`producer/resource_uri.py:
    build_git_blob_citation`) and record it into `seen_anchors` — the
    exact analogue of `enrich.py`'s `_mint`/`seen_anchors` per-row
    `canonical://` pattern, generalised to the system-bundle's public
    blob-URL scheme. Parses `key.source_ref` via the SAME
    `_SOURCE_REF_RANGE_RE` `_read_source_ref` uses, so the citation's line
    range always matches exactly what was actually read.

    `key.git_blob_sha` empty (an artefact absent at HEAD — an uncommitted
    fixture, or a repo with no commits yet) mints NOTHING and returns
    `""`: an unpinned artefact cannot resolve a public URL and must not be
    citable — mirrors `_git_blob_sha`'s own "path absent" posture (expected,
    not exceptional), just non-citable here rather than raising."""
    if not key.git_blob_sha:
        return ""
    match = _SOURCE_REF_RANGE_RE.match(key.source_ref)
    if match is None:
        anchor = build_git_blob_citation(key.git_blob_sha, key.source_ref)
    else:
        anchor = build_git_blob_citation(
            key.git_blob_sha,
            match.group("path"),
            line_start=int(match.group("start")),
            line_end=int(match.group("end")),
        )
    seen_anchors.add(anchor)
    return anchor


class RepoDocsSource:
    """cocoindex Source adapter over the repo/docs checkout backing the
    canonical-okf-system baseline bundle (ID-163 {163.4} PC-1). Structural
    sibling of `LRecordsSource` (`sources/l_records.py`): same local
    `Source` protocol shape, never imports `cocoindex`. Constructed over a
    **root path** (the repo/docs checkout), not a pool.

    **KA3 PROTOTYPE scope (this Subtask).** Only the `tool` pillar (E1)
    and the `navigation` pillar (E2) are wired — see the module
    docstring's KA3 gate. The remaining S1 pillars (`api`/`schema`/
    `playbook`) are future-Subtask work, added only once KA3 holds; adding
    a per-pillar LOCATOR resolver is in-model (E1/E2 already cover it),
    but a pillar needing a bespoke `RepoConceptKey` shape or read grid is
    a third family — the doctrine's STOP-and-escalate trigger."""

    def __init__(
        self,
        root: "str | Path",
        *,
        navigation_docs_dir: "str | Path" = "docs/navigation",
    ) -> None:
        self._root = Path(root)
        self._navigation_docs_dir = Path(navigation_docs_dir)
        self.seen_anchors: "set[str]" = set()
        """PC-5 (ID-163 TECH, DR-086): the per-run provenance ledger
        `read_concept` mints into — one git-blob/doc-page anchor per
        backing artefact actually READ this run, the exact analogue of
        L-records' per-row `canonical://` `seen_anchors` set
        (`enrich.py:_mint`). A future caller (a later Subtask's tool-
        executor wiring) plumbs this into `_validate_citation`'s
        `seen_anchors` argument; this Subtask's scope is the mint +
        validate PAIR, not that wiring."""

    # ── list_concepts (abstract, base.py) ───────────────────────────────

    async def list_concepts(self) -> "list[RepoConceptKey]":
        """Enumerate the KA3-prototyped concept set: every `defineTool(...)`
        call site under `lib/mcp/tools/*.ts` (E1, `tool`), PLUS every
        `*.md` page directly under `navigation_docs_dir` (E2,
        `navigation`)."""
        keys: "list[RepoConceptKey]" = []
        keys.extend(self._list_tool_concepts())
        keys.extend(self._list_navigation_concepts())
        return keys

    def _list_tool_concepts(self) -> "list[RepoConceptKey]":
        keys: "list[RepoConceptKey]" = []
        tools_dir = self._root / _TOOLS_DIR
        if not tools_dir.is_dir():
            return keys
        for file_path in sorted(tools_dir.glob("*.ts")):
            text = file_path.read_text(encoding="utf-8")
            rel_file = (_TOOLS_DIR / file_path.name).as_posix()
            blob_sha = _git_blob_sha(self._root, rel_file)
            for match in _DEFINE_TOOL_CALL_RE.finditer(text):
                name = match.group("name")
                open_idx = match.start() + len("defineTool")
                close_idx = _match_closing_paren(text, open_idx)
                lstart = text.count("\n", 0, match.start()) + 1
                lend = text.count("\n", 0, close_idx) + 1
                keys.append(
                    RepoConceptKey(
                        rel_path=f"tool/{name}.md",
                        concept_type="tool",
                        source_ref=f"{rel_file}#L{lstart}-L{lend}",
                        git_blob_sha=blob_sha,
                    )
                )
        return keys

    def _list_navigation_concepts(self) -> "list[RepoConceptKey]":
        keys: "list[RepoConceptKey]" = []
        nav_dir = self._root / self._navigation_docs_dir
        if not nav_dir.is_dir():
            return keys
        for file_path in sorted(nav_dir.glob("*.md")):
            rel_file = file_path.relative_to(self._root).as_posix()
            blob_sha = _git_blob_sha(self._root, rel_file)
            keys.append(
                RepoConceptKey(
                    rel_path=f"navigation/{_slugify(file_path.stem)}.md",
                    concept_type="navigation",
                    source_ref=rel_file,
                    git_blob_sha=blob_sha,
                )
            )
        return keys

    # ── read_concept (abstract, base.py) ────────────────────────────────

    async def read_concept(self, key: RepoConceptKey) -> RepoConceptRaw:
        """The concept's backing text: the matched call span for a `tool`
        concept (E1), the whole page for a `navigation` concept (E2).
        Also mints (PC-5) the artefact's git-blob citation anchor into
        `self.seen_anchors` and returns it as `RepoConceptRaw.resource` —
        an artefact this run did not read cannot be cited."""
        text = _read_source_ref(self._root, key.source_ref)
        resource = _mint_git_blob_citation(key, self.seen_anchors)
        return RepoConceptRaw(text=text, resource=resource)

    # ── sample_rows (concrete helper, base.py) ──────────────────────────

    async def sample_rows(
        self, key: RepoConceptKey, n: int
    ) -> "list[Mapping[str, Any]]":
        """A bounded line-sample of the concept's backing text for the
        Pass-1 prompt context window (mirrors `LRecordsSource.sample_rows`'
        role; repo/docs concepts have no DB rows, so a "row" here is one
        line of the backing artefact)."""
        if n <= 0:
            return []
        raw = await self.read_concept(key)
        lines = raw.text.splitlines()
        return [{"line": i + 1, "text": line} for i, line in enumerate(lines[:n])]

    # ── find (concrete helper, base.py) ─────────────────────────────────

    async def find(self, query: str) -> "list[RepoConceptKey]":
        """Case-insensitive substring search over the enumerated concept
        set's identity fields — a thin filter over `list_concepts()`, not
        a bespoke query (mirrors `LRecordsSource.find`)."""
        if not query:
            return []
        needle = query.casefold()
        keys = await self.list_concepts()
        return [k for k in keys if needle in _concept_haystack(k)]
