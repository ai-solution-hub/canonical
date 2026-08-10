"""The repo/docs Source adapter — ID-163 {163.4} PC-1, the KA3 two-extractor
PROTOTYPE for the canonical-okf-system baseline bundle (Path-2
direct-producer authoring lane).

Structural SIBLING of `sources/l_records.py`'s `LRecordsSource`: implements
the SAME `@runtime_checkable Source` protocol (`list_concepts()` /
`read_concept(key)` / `sample_rows(key, n)` / `find(query)`) so
`producer/flow_def.py`'s draft loop consumes either Source unchanged
(PC-2, a later Subtask). Unlike `LRecordsSource` (constructed over an
asyncpg-shaped `pool`), this adapter is constructed over a **repo/docs
ROOT PATH** — the persistent-volume checkout the producer already mounts
(`OKF_SOURCE_REPO_PATH`, PC-2). Never imports `cocoindex` (collection
safety for the bare-MagicMock pipeline unit tests — the SAME posture
`url_source.py`/`l_records.py` keep, TECH id-132:41/135).

**"the SAME protocol" is literal since ID-427 {427.4}** (id-362 F1 leg 1).
Until then this module declared its OWN structurally-identical copy of the
protocol `l_records.py` also declared, and said so: *"the two declarations
are structurally identical by design and must be kept in sync by hand"*.
Both copies are now retired in favour of the single declaration in
`sources/base.py`, which is generic over its key/raw pair — `RepoDocsSource`
satisfies it as `Source[RepoConceptKey, RepoConceptRaw]`, `LRecordsSource`
as `Source[ConceptKey, ConceptRaw]`. This module imports no `Source` name of
its own: conformance is structural, and a consumer that wants to check it
imports `sources/base.py` directly.

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

**S4 — the memo change signal (BI-18 delta lever analogue), grain-split
per {163.18}/G-SPAN-HASH (owner-ratified S488).** Each grain carries a
DIFFERENT memo lever, so a concept redrafts iff ITS OWN backing content
changes:

- **E2 (markdown-page grain)** keeps `git_blob_sha` — `git rev-parse
  HEAD:<file path>` (subprocess, the SAME `git_sync.py:264` `_run_git`
  posture; no new git library — `dulwich`/`pygit2` are not in
  `requirements.txt`). A page IS a whole file, so this file-grained blob
  digest is ALREADY per-concept for E2. A path absent at `HEAD` (an
  uncommitted fixture, or the first producer run before any commit)
  resolves to `""` rather than raising — mirrors `git_sync.py`'s
  `_read_head` treating "path absent" as expected, not exceptional.
- **E1 (code-symbol grain)** keeps `git_blob_sha == ""` and carries a
  per-span `span_content_hash` instead (sha256 of the matched
  `defineTool(...)` span's backing text). A git blob SHA is a whole-FILE
  digest, so two `tool` concepts backed by the same `.ts` file would
  invalidate TOGETHER on any edit to that file (even one touching only the
  OTHER tool). {163.18} honours TECH S4's literal "redrafts exactly that
  one concept" by keying E1 memo on the SPAN, not the file: editing one
  `defineTool` span changes only that concept's key; its file-siblings and
  an unrelated-line edit leave every span key untouched. The file-level
  `git_blob_sha` is deliberately kept OFF E1 keys because every
  `RepoConceptKey` field fingerprints unconditionally ({132.36}: no
  `field(compare=False)` exemption) — storing it would re-leak the
  file-grained invalidation the span hash exists to avoid.

**PC-5 — citation provenance, generalised (ID-163 TECH, DR-086b).** The
BI-17 discipline L-records enforces via `enrich.py`'s `_mint`/`seen_anchors`
per-row `canonical://` pattern applies here too, on a DIFFERENT anchor
scheme: a system concept has no DB row, so it cites a git-pinned PUBLIC
blob URL instead (DR-086b — the `canonical` repo is public and is the
citation base directly). `read_concept` is the sole mint site: every call
mints the artefact's `resource_uri.py:build_git_blob_citation` anchor into
`self.seen_anchors` and returns it on `RepoConceptRaw.resource` — an
artefact this run did not read cannot be cited. `producer/enrich.py:
_validate_citation` / `producer/web_pass.py:_validate_pass2_citation`
accept this scheme as an ADDITIVE branch (keyed on `resource_uri.py:
is_git_blob_citation`), leaving the `canonical://` L-records path
byte-identical. The citation pin stays the REAL, file-blob-based
`git rev-parse HEAD:<file>` sha for BOTH grains — {163.18} moved only the
E1 MEMO lever to a per-span hash, never the citation. For E2 the pin is
`key.git_blob_sha` (already on the key). For E1, whose key carries no file
sha (S4, above), `read_concept` resolves the file blob sha fresh at the
sole mint site — so `build_git_blob_citation` is unchanged and every
citation still pins a real public git blob.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from scripts.cocoindex_pipeline.producer.resource_uri import build_git_blob_citation
from scripts.cocoindex_pipeline.producer.validator import check_type_shape

# ID-427 {427.7}: this module carried its OWN copy of `_slugify`, whose
# docstring recorded the duplication ("mirrors `l_records.py`'s own
# `_slugify` — duplicated, not imported"). `mint_concept_slug` is that
# helper plus the id-429 IA-3 reserved-name guard, and it lives in the
# neutral module because the reservation is a property of the FORMAT, not
# of one adapter — a `docs/navigation/index.md` page would otherwise mint
# `navigation/index.md` and be overwritten by that directory's emitted
# index exactly as an L-records concept would.
from scripts.cocoindex_pipeline.sources.base import (
    RESERVED_CONCEPT_STEMS,
    CorpusCensus,
    Coverage,
    GrainEnumeration,
    mint_concept_slug,
)

# ── The corpus unit kinds THIS adapter's census counts (ID-427 {427.9},
# TECH §2.11).
#
# The `system_baseline`/`internal_dev` corpus is a repo checkout, not the
# L-records tables: it has no `source_documents` row and no `q_a_pairs` row
# to count, which is the measurement behind {427.9}'s correction to TECH §1
# (see `base.Coverage` — a kind-keyed `Coverage`, not two DB-table-named
# fields). Reporting `source_documents 9` in a system-baseline bundle's
# `log.md` would name a table that bundle never reads.
#
# The unit is the ARTEFACT FILE, not the concept: a `*.ts` file with no
# `defineTool(...)` call site backs no concept, and that is exactly the
# repo-side analogue of RESEARCH's hole 1 (a published document that
# produced nothing). Measured against this checkout at {427.9}: 9 files
# under `lib/mcp/tools/`, of which `index.ts` and `shared.ts` define no
# tool — the census reports `tool_source_files 9 (routed 7)`, so this is a
# real reading and not a tautology. ────────────────────────────────────────
TOOL_SOURCE_FILES = "tool_source_files"
NAVIGATION_PAGES = "navigation_pages"


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
    """The concept's OKF `type` LABEL — validated in `__post_init__` by the
    SAME `producer/validator.check_type_shape` rule `ConceptKey` and the
    BI-13 write gate apply (ID-427 {427.5}).

    **The per-bundle-class type sets are gone** (DR-141 + the owner's S546
    uniformity ruling: *"we should be conformant and uniform across bundle
    classes"*). There is no `SYSTEM_BASELINE_CONCEPT_TYPES` and no
    disjointness rule — a system-bundle grain may mint `document` or any
    other well-shaped label exactly as a client-bundle grain may. The five
    labels this adapter's grains actually emit (`schema`, `tool`, `api`,
    `navigation`, `playbook`) are properties of the grains, not of a
    register."""

    source_ref: str
    """The backing-artefact locator: `file#Lstart-Lend` for the E1
    code-symbol grain (the matched call site's span), or a bare doc-page
    repo-relative path for the E2 markdown-page grain (no line range — the
    whole page IS the concept)."""

    git_blob_sha: str = ""
    """**E2 MEMO LEVER + citation pin** (S4, the `ConceptKey.content_version`
    analogue). The E2 (markdown-page grain) whole-file change signal:
    `_list_navigation_concepts` computes it per page via `git rev-parse
    HEAD:<source_ref's file path>` — a byte-identical page produces an
    unchanged `RepoConceptKey` (cocoindex memo-**HIT**); an edited one a
    changed key (memo-**MISS**). A page IS a whole file, so this file-grained
    digest is already per-concept for E2.

    **E1 (code-symbol grain) keeps this `""`** ({163.18}/S488): a git blob
    SHA is a whole-FILE digest, so on an E1 key it would re-invalidate every
    `defineTool` concept in a file on ANY edit to that file, breaking the
    per-span isolation `span_content_hash` provides. E1 memo therefore keys
    on `span_content_hash`, and E1's citation resolves the real file blob sha
    fresh at `read_concept` (mint) time rather than storing it here.

    Participates in `__eq__`/`__hash__` like every other field — that
    participation IS the delta lever, not an oversight (cocoindex's own
    `_canonicalize_dataclass` fingerprints every field unconditionally, so
    no `field(compare=False)` would even suppress it). That unconditional
    fingerprinting is EXACTLY why E1 must keep this empty rather than store a
    file-level sha it cannot exempt."""

    span_content_hash: str = ""
    """**E1 MEMO LEVER** ({163.18}/G-SPAN-HASH, owner-ratified S488). The
    per-span change signal for the E1 (code-symbol grain) `tool` concept:
    `_list_tool_concepts` sets it to `sha256(<matched defineTool span
    text>)` — the SAME line-range text `read_concept` drafts from — so a
    single-tool edit changes ONLY that concept's key (memo-**MISS**), while
    its file-siblings and any unrelated-line edit leave every span key
    unchanged (memo-**HIT**). Honours TECH S4's literal "redrafts exactly
    that one concept", superseding the file-grained interim from {163.4}.

    Empty (`""`) for E2 concepts, whose memo lever is the file-grained
    `git_blob_sha` (a whole page is already one concept). Kept LAST in field
    order so every positional `RepoConceptKey(...)` construction stays valid
    with its `""` default. Participates in `__eq__`/`__hash__` like every
    other field — that participation IS the E1 delta lever."""

    def __post_init__(self) -> None:
        if not self.rel_path:
            raise ValueError(
                "RepoConceptKey.rel_path must be non-empty (identity = "
                "bundle rel_path = the cocoindex memo key)"
            )
        shape_errors = check_type_shape(self.concept_type)
        if shape_errors:
            raise ValueError(
                f"RepoConceptKey.concept_type is not a well-formed OKF type "
                f"label: {'; '.join(shape_errors)}"
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
    """PC-5 (ID-163 TECH, DR-086b): the git-blob/doc-page citation anchor
    `read_concept` minted for this artefact (`producer/resource_uri.py:
    build_git_blob_citation`) — the system-bundle analogue of L-records'
    per-row `resource` field (`enrich.py:_with_resource`). Empty when the
    artefact's `git_blob_sha` is empty (absent at HEAD — an uncommitted
    fixture, or a repo with no commits yet): an unpinned artefact cannot
    resolve a public URL and must not be citable."""


# ── E1 (tool pillar) — `defineTool(server, '<name>', ...)` call-site scan.
# `lib/mcp/tools/shared.ts` DEFINES `defineTool`; `lib/mcp/tools/index.ts`
# only imports + calls the per-file `registerXTools` barrel — neither
# issues a call matching this pattern, so no filename exclusion is needed
# beyond the pattern itself. ─────────────────────────────────────────────

_TOOLS_DIR = Path("lib/mcp/tools")

_DEFINE_TOOL_CALL_RE = re.compile(
    r"defineTool\(\s*server\s*,\s*(['\"])(?P<name>[^'\"]+)\1"
)


_REGEX_PRECEDING_KEYWORDS = frozenset(
    {
        "await",
        "case",
        "delete",
        "do",
        "else",
        "in",
        "instanceof",
        "new",
        "of",
        "return",
        "throw",
        "typeof",
        "void",
        "yield",
    }
)
"""Keywords after which a `/` opens a regex literal, not division — the
one place the last-significant-char heuristic in `_match_closing_paren`
is wrong on its own (`return /re/.test(x)` ends on an identifier char,
which otherwise reads as an expression end → division)."""


def _skip_string(text: str, start: int) -> int:
    """Index just past the single/double-quoted string opening at `start`,
    honouring backslash escapes. A raw newline terminates the scan at that
    newline (TS `'`/`"` strings are single-line; self-healing there keeps
    one stray apostrophe — `// the table's rows` was the real-corpus F2
    trigger before comments were skipped — from swallowing the file)."""
    quote = text[start]
    i = start + 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == quote:
            return i + 1
        if ch == "\n":
            return i
        i += 1
    return n


def _skip_regex(text: str, start: int) -> int:
    """Index just past the regex literal opening at `start`, honouring
    backslash escapes and `[...]` character classes (an unescaped `/`
    inside a class does not close the regex). A raw newline terminates at
    that newline — regex literals are single-line, so hitting one means
    the `/` was not a regex after all (self-heal, mirrors `_skip_string`).
    Trailing flags are plain identifier chars the caller's code state
    consumes harmlessly."""
    i = start + 1
    n = len(text)
    in_class = False
    while i < n:
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "\n":
            return i
        if in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
        elif ch == "/":
            return i + 1
        i += 1
    return n


def _match_closing_paren(text: str, open_idx: int) -> int:
    """Return the index of the ')' that closes the '(' at `open_idx`,
    counting paren depth through a small TS-state scanner ({163.19}): the
    depth count skips single/double-quoted strings, template literals
    (INCLUDING nested `${...}` interpolation, where code state — and the
    count — resumes), regex literals, and line + block comments. The
    original quote-only scanner died on the real corpus (F2, `ValueError`
    at content.ts index 55376): an apostrophe inside a line comment
    (`workspaces.ts` — "the `workspaces` table's") flipped it into string
    state and every subsequent paren was swallowed. Assumes
    `text[open_idx] == '('`."""
    if text[open_idx] != "(":
        raise ValueError(f"expected '(' at index {open_idx}, got {text[open_idx]!r}")
    depth = 0
    i = open_idx
    n = len(text)
    # Frame stack: "code" counts parens; a backtick pushes "template"; a
    # `${` inside a template pushes "interp" — code state again, popped by
    # the `}` that closes the interpolation (per-frame brace depth keeps
    # object literals inside the interpolation from popping early).
    frames: "list[list]" = [["code", 0]]
    # Regex-vs-division disambiguation: a `/` opens a regex iff the last
    # significant code char cannot END an expression (or the identifier it
    # ends is a keyword — `_REGEX_PRECEDING_KEYWORDS`). `word` carries the
    # most recent identifier across whitespace/comments for that check.
    prev_sig = ""
    word = ""
    while i < n:
        ch = text[i]
        if frames[-1][0] == "template":
            if ch == "\\":
                i += 2
                continue
            if ch == "`":
                frames.pop()
                prev_sig = "`"
                word = ""
                i += 1
                continue
            if ch == "$" and i + 1 < n and text[i + 1] == "{":
                frames.append(["interp", 0])
                prev_sig = "{"
                word = ""
                i += 2
                continue
            i += 1
            continue
        # "code" / "interp" frame — real TS code state.
        if ch in "'\"":
            i = _skip_string(text, i)
            prev_sig = ch
            word = ""
            continue
        if ch == "`":
            frames.append(["template", 0])
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            eol = text.find("\n", i)
            i = n if eol == -1 else eol
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if ch == "/":
            is_ident_end = prev_sig.isalnum() or prev_sig in "_$"
            regex_ok = (
                not prev_sig
                or (word in _REGEX_PRECEDING_KEYWORDS if is_ident_end else True)
            ) and prev_sig not in ")]'\"`"
            if regex_ok:
                i = _skip_regex(text, i)
            else:
                i += 1
            prev_sig = "'"  # expression end either way — next `/` is division
            word = ""
            continue
        if frames[-1][0] == "interp" and ch in "{}":
            if ch == "{":
                frames[-1][1] += 1
            elif frames[-1][1] == 0:
                frames.pop()
                prev_sig = "`"
                word = ""
                i += 1
                continue
            else:
                frames[-1][1] -= 1
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        if not ch.isspace():
            if ch.isalnum() or ch in "_$":
                word = word + ch if (prev_sig.isalnum() or prev_sig in "_$") else ch
            prev_sig = ch
        i += 1
    raise ValueError(f"unbalanced parentheses scanning from index {open_idx}")


def _span_content_hash(span_text: str) -> str:
    """The E1 per-span memo lever ({163.18}/G-SPAN-HASH, S488): a synthetic
    `sha256` digest of one `defineTool(...)` span's backing text — the SAME
    line-range text `read_concept` returns for that concept, so the memo key
    changes iff the drafted content changes. This is a per-SPAN signal, not
    the file-grained `git_blob_sha` (S4): it lets a single-tool edit redraft
    exactly that one concept, leaving its file-siblings' keys untouched.
    Encodes as UTF-8 (the same encoding `read_text`/`_read_source_ref` use),
    so a byte-identical span always hashes identically."""
    return hashlib.sha256(span_text.encode("utf-8")).hexdigest()


# ── E2 (navigation pillar) — one concept per `*.md` doc page. ───────────


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


def _mint_git_blob_citation(
    root: Path, key: RepoConceptKey, seen_anchors: "set[str]"
) -> str:
    """PC-5 (ID-163 TECH, DR-086b): mint `key`'s backing artefact into a
    git-blob/doc-page citation anchor (`producer/resource_uri.py:
    build_git_blob_citation`) and record it into `seen_anchors` — the
    exact analogue of `enrich.py`'s `_mint`/`seen_anchors` per-row
    `canonical://` pattern, generalised to the system-bundle's public
    blob-URL scheme. Parses `key.source_ref` via the SAME
    `_SOURCE_REF_RANGE_RE` `_read_source_ref` uses, so the citation's line
    range always matches exactly what was actually read.

    The pin is the REAL, file-blob-based `git rev-parse HEAD:<file>` sha for
    BOTH grains — {163.18} moved only the E1 MEMO lever to a per-span hash,
    never the citation. For an E2 whole-file ref the pin is `key.git_blob_sha`
    (already the E2 memo lever, list-time pinned). For an E1 span ref — whose
    key deliberately carries no file sha (S4, to keep file-grained
    invalidation out of the per-span memo key) — the file blob sha is
    resolved FRESH here; `read_concept` is the sole mint site, so this one
    extra `_git_blob_sha` call keeps provenance honest without re-leaking the
    file signal into the E1 key.

    An empty resolved sha (an artefact absent at HEAD — an uncommitted
    fixture, or a repo with no commits yet) mints NOTHING and returns `""`:
    an unpinned artefact cannot resolve a public URL and must not be
    citable — mirrors `_git_blob_sha`'s own "path absent" posture (expected,
    not exceptional), just non-citable here rather than raising."""
    match = _SOURCE_REF_RANGE_RE.match(key.source_ref)
    if match is None:
        blob_sha = key.git_blob_sha
        if not blob_sha:
            return ""
        anchor = build_git_blob_citation(blob_sha, key.source_ref)
    else:
        blob_sha = _git_blob_sha(root, match.group("path"))
        if not blob_sha:
            return ""
        anchor = build_git_blob_citation(
            blob_sha,
            match.group("path"),
            line_start=int(match.group("start")),
            line_end=int(match.group("end")),
        )
    seen_anchors.add(anchor)
    return anchor


class RepoDocsSource:
    """cocoindex Source adapter over the repo/docs checkout backing the
    canonical-okf-system baseline bundle (ID-163 {163.4} PC-1). Structural
    sibling of `LRecordsSource` (`sources/l_records.py`): conforms to
    `sources/base.py`'s shared `Source` protocol as
    `Source[RepoConceptKey, RepoConceptRaw]` ({427.4}), never imports
    `cocoindex`. Constructed over a **root path** (the repo/docs checkout),
    not a pool.

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
        self._coverage: "Coverage | None" = None
        """ID-427 {427.9}: the union of both pillars' `Coverage` from the
        most recent `list_concepts()`. `None` means not enumerated yet, and
        `census()` refuses rather than reporting `routed 0` — the same
        not-measured/measured-zero distinction `LRecordsSource` keeps."""
        self.seen_anchors: "set[str]" = set()
        """PC-5 (ID-163 TECH, DR-086b): the per-run provenance ledger
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
        `navigation`).

        ID-427 {427.9}: each pillar now returns a `GrainEnumeration` and
        this method unions their `Coverage`, exactly as
        `LRecordsSource.list_concepts` does — the two adapters answer the
        census question the same way even though their corpora share no
        table."""
        keys: "list[RepoConceptKey]" = []
        coverage = Coverage()
        for enumeration in (
            self._list_tool_concepts(),
            self._list_navigation_concepts(),
        ):
            keys.extend(enumeration.keys)
            coverage = coverage.union(enumeration.covers)
        self._coverage = coverage
        return keys

    async def census(self) -> CorpusCensus:
        """This run's corpus census (ID-427 {427.9}, TECH §2.11) — the
        artefact files this checkout holds, and how many of them back at
        least one enumerated concept.

        The `considered` side is re-globbed here rather than carried out of
        `list_concepts`, because that method only ever SEES the files a
        pillar walked; a `considered` count derived from it could never
        exceed `routed`, and a census that cannot report a hole is not a
        census. Raises before enumeration for the same reason
        `LRecordsSource.census` does."""
        if self._coverage is None:
            raise ValueError(
                "RepoDocsSource.census() was called before list_concepts() — "
                "`routed` is the union of the coverages enumeration produces, "
                "and reporting zeros here would report the whole checkout as "
                "unrouted (ID-427 {427.9})"
            )
        considered = (
            (TOOL_SOURCE_FILES, len(self._tool_source_files())),
            (NAVIGATION_PAGES, len(self._navigation_pages())),
        )
        return CorpusCensus(
            considered=considered,
            routed=tuple(
                (kind, len(self._coverage.ids(kind))) for kind, _ in considered
            ),
        )

    def _tool_source_files(self) -> "list[Path]":
        tools_dir = self._root / _TOOLS_DIR
        return sorted(tools_dir.glob("*.ts")) if tools_dir.is_dir() else []

    def _navigation_pages(self) -> "list[Path]":
        nav_dir = self._root / self._navigation_docs_dir
        return sorted(nav_dir.glob("*.md")) if nav_dir.is_dir() else []

    def _list_tool_concepts(self) -> "GrainEnumeration[RepoConceptKey]":
        keys: "list[RepoConceptKey]" = []
        covered: "list[str]" = []
        for file_path in self._tool_source_files():
            text = file_path.read_text(encoding="utf-8")
            rel_file = (_TOOLS_DIR / file_path.name).as_posix()
            # E1 keeps git_blob_sha="" ({163.18}/S488): a file-grained blob
            # digest would re-invalidate every tool in this file on any edit
            # (every RepoConceptKey field fingerprints unconditionally,
            # {132.36}). The per-span `span_content_hash` is the E1 memo
            # lever instead; the citation's real file blob sha is resolved
            # fresh at read_concept (mint) time.
            file_lines = text.splitlines(keepends=True)
            matches = list(_DEFINE_TOOL_CALL_RE.finditer(text))
            if matches:
                # {427.9}: the file is COVERED once it backs at least one
                # concept. A `*.ts` file under this directory that defines no
                # tool (`index.ts`, `shared.ts`) backs none and stays
                # unrouted — the repo-side analogue of a published document
                # that produced no pair.
                covered.append(rel_file)
            for match in matches:
                name = match.group("name")
                open_idx = match.start() + len("defineTool")
                close_idx = _match_closing_paren(text, open_idx)
                lstart = text.count("\n", 0, match.start()) + 1
                lend = text.count("\n", 0, close_idx) + 1
                # The SAME line-range text `_read_source_ref` returns for this
                # concept, so the memo lever tracks exactly the drafted span.
                span_text = "".join(file_lines[lstart - 1 : lend])
                keys.append(
                    RepoConceptKey(
                        # ID-429 IA-3, over the TOOL pillar. {427.7} left this
                        # pillar behind: the navigation pillar below mints through
                        # `mint_concept_slug`, this one interpolated the raw
                        # `defineTool` name. IA-3 is a property of the FORMAT, not
                        # of one pillar — `index` and `log` are well-formed
                        # snake_case tool names, and `tool/index.md` is ACTIVELY
                        # OVERWRITTEN by the emitted directory index in the same run
                        # (indexes declare after concepts, last write wins). Found
                        # by the S548 independent spec-compliance audit.
                        #
                        # The guard ONLY, deliberately not `mint_concept_slug`:
                        # `_slugify` folds `_` to `-`, so minting through it would
                        # rewrite `create_content_item` to `create-content-item` and
                        # move every multi-word tool concept on disk. An MCP tool
                        # name is already slug-shaped by the `defineTool`
                        # snake_case convention; the reserved stem is the only
                        # thing it can get wrong. `RESERVED_CONCEPT_STEMS` stays
                        # single-declared in `sources/base.py`.
                        rel_path=(
                            f"tool/{name}-concept.md"
                            if name.casefold() in RESERVED_CONCEPT_STEMS
                            else f"tool/{name}.md"
                        ),
                        concept_type="tool",
                        source_ref=f"{rel_file}#L{lstart}-L{lend}",
                        span_content_hash=_span_content_hash(span_text),
                    )
                )
        return GrainEnumeration(
            keys=tuple(keys), covers=Coverage.of({TOOL_SOURCE_FILES: covered})
        )

    def _list_navigation_concepts(self) -> "GrainEnumeration[RepoConceptKey]":
        keys: "list[RepoConceptKey]" = []
        covered: "list[str]" = []
        for file_path in self._navigation_pages():
            rel_file = file_path.relative_to(self._root).as_posix()
            blob_sha = _git_blob_sha(self._root, rel_file)
            keys.append(
                RepoConceptKey(
                    rel_path=f"navigation/{mint_concept_slug(file_path.stem)}.md",
                    concept_type="navigation",
                    source_ref=rel_file,
                    git_blob_sha=blob_sha,
                )
            )
            # E2 is 1:1 today — every page mints a concept — so this kind
            # reports `considered == routed` on any checkout. That is a true
            # statement about the pillar, not a placeholder: if a future
            # filter (a draft marker, a front-matter opt-out) ever skips a
            # page, the census reports it the same run, with no edit here.
            covered.append(rel_file)
        return GrainEnumeration(
            keys=tuple(keys), covers=Coverage.of({NAVIGATION_PAGES: covered})
        )

    # ── read_concept (abstract, base.py) ────────────────────────────────

    async def read_concept(self, key: RepoConceptKey) -> RepoConceptRaw:
        """The concept's backing text: the matched call span for a `tool`
        concept (E1), the whole page for a `navigation` concept (E2).
        Also mints (PC-5) the artefact's git-blob citation anchor into
        `self.seen_anchors` and returns it as `RepoConceptRaw.resource` —
        an artefact this run did not read cannot be cited."""
        text = _read_source_ref(self._root, key.source_ref)
        resource = _mint_git_blob_citation(self._root, key, self.seen_anchors)
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
