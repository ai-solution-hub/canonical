"""Git knowledge-sync writer — 3-way human-edit reconcile (ID-132 {132.12}
G-GITSYNC).

Per `docs/specs/id-132-okf-concept-producer/TECH.md` §"Git knowledge-sync +
human-edit reconciliation" (BI-14/BI-18/BI-19/BI-22) + PRODUCT.md BI-27:

    A git writer OUTSIDE cocoindex stages the bundle working tree and
    commits to the CLIENT-OWNED PRIVATE repository — one commit per
    producer run THAT CHANGES SOMETHING (BI-19: at most one commit per
    run), with point-in-time rollback via git history. A genuinely no-op
    run — every managed path resolves "unchanged" — makes NO new commit
    (BI-18). This is a discrete POST-FLOW stage, NEVER a cocoindex
    target — preserves the "no out-of-band side effects in the flow"
    property (this module has ZERO `cocoindex` import, unlike every
    sibling `producer/*.py` module).

**The clobber/orphan hazard this module exists to solve (BI-18/BI-22).**
cocoindex's own `declare_file` lineage is self-updating — free BI-18
delta-only behaviour — but on a client-owned directory that may carry
HUMAN edits, that same lineage is a clobber/orphan hazard: cocoindex's
reconcile compares a new write's fingerprint against its OWN internal
tracking record, never against the file's actual on-disk bytes
(`producer/bundle_writer.py`'s EXECUTOR-VERIFY finding). This module is
the SEPARATE, git-layer safety net: it is the SOLE writer into the git
repository (`repo_path`) — the caller supplies this run's freshly
produced content (`new_output`) as a plain string mapping, never by
letting cocoindex declare files directly into the client repo — so
`sync_bundle` can always observe the true 3-way state BEFORE it writes
anything:

1. **last-producer-output** — the previous commit's content for a path
   (`git show HEAD:<path>`; `None` if the path did not exist at HEAD, or
   the repo has no commits yet).
2. **current-repo-state** — the path's CURRENT on-disk bytes in
   `repo_path`, read fresh at call time (untouched by this run so far).
3. **new-producer-output** — the content this run wants for the path
   (`new_output[path]`; absent/`None` means this run wants the path
   GONE).

**Managed-keyset boundary.** Only paths in `managed_keyset` (explicit —
the producer's own manifest: the `list_concepts()` keyset plus
`index.md`/`log.md`/`references/<slug>`, per the TECH design) are ever
read, written, or deleted by this module. A human file living outside
that set (e.g. a reserved `notes/` subtree) is NEVER touched — this
module does not even `stat` it.

**3-way reconcile posture (BI-22 — "flag, never silently re-point/
drop").** For each managed path: if `current-repo-state != last-
producer-output`, something (a human, almost certainly) changed the
file since the last producer commit. This module does NOT silently
overwrite or delete it — it records a `HumanEditConflict`, leaves the
file exactly as it is, and (when `log.md` is itself in the managed set)
appends a warning block to the tail of this run's `log.md` content —
the same posture `producer/bundle_writer.py` uses for BI-22 orphaned-
anchor warnings, extended here to the git-sync layer.

**S436 amendment (BI-27/DR-016 — "flag → capture-as-override →
re-apply").** The BI-22 posture above (flag divergence, leave the file
in place) is the FLOOR; the S436 amendment (PRODUCT.md §S436 Amendments
BI-27, TECH.md §Git knowledge-sync amendment) upgrades it. On a
human-edit conflict this module ALSO CAPTURES the human's edit as a
field-level `ProducerOverride` set (`capture_overrides` — keyed by
`concept_path` + section/frontmatter-field, NEVER a direct file
mutation), so the flow can RE-APPLY the approved override onto every
fresh Pass-1/Pass-2 draft BEFORE `declare_file` (`reapply_overrides`) —
an approved human edit is re-applied, never dropped. Every run also
lands in a STAGING state (`sync_bundle(..., stage_only=True)` — applies
+ `git add`, no commit; the ONE gated commit happens later at the
publish gate, `producer/publish.py`, not per-run) and emits a
machine-readable per-run proposed-change set (`proposed_change_set` —
the DR-013 shape the follow-on accept/edit/reject review UI binds to,
reshaped from the same reconcile decisions this module already renders
into `log.md`). Each proposed-change entry reserves a per-entry
`source_workspace_id` provenance slot that `{132.22}`
G-BIDOUTCOME-PROPOSAL stamps onto won-bid DRAFT proposals (BI-28) — the
extension is a value-set on this shape, never a schema change. The flow
assembly that wires the per-run `stage_only=True` staging call and
feeds approved overrides back through `reapply_overrides` is
`{132.16}`'s job — this module owns only the producer-side contract.

**Augmentation guard (BI-27/DR-016 — S451 rider fold-in; the reference
`write_concept_doc`, `bundle_tools.py:110-155`, "augment, not replace"
precedent).** When a managed path's content is genuinely changing (no
human-edit conflict, `new-producer-output != last-producer-output`),
this module calls `producer.validator.detect_citation_shrink` — the
SAME shared detection function `{132.9}`'s `web_pass.run_web_pass`
already calls to enforce its own half of this guard — comparing
`last-producer-output` (the prior committed `# Citations` state) against
`new-producer-output`. A shrink (the new content would DROP a
previously-committed, record-grounded citation) is REFUSED: the prior
committed content is kept on disk, an `AugmentationGuardRefusal` is
recorded, and (same as a human-edit conflict) a `log.md` warning is
appended. This is the enforcement half at the git-sync boundary — the
THIRD of three call sites sharing ONE detection implementation (`{132.7}`
validator owns detection; `{132.9}` web_pass and this module are the two
enforcement sites), never three divergent re-implementations.

**One commit per run, at most (BI-19); a no-op run makes no commit
(BI-18).** `sync_bundle` commits — `git commit --allow-empty` — only
when this run applied or removed at least one managed path. When every
managed path resolves "unchanged" (a genuinely no-op run — the same
content already committed at HEAD), no new commit is made and the
current HEAD sha is returned unchanged. The commit (when one is made)
uses an explicit `-c user.name=... -c user.email=...` identity so this
module works against a fresh repo with no git identity configured (the
client-owned repo's own provisioning — S453, out of THIS Subtask's
scope — may or may not set one).

**Guard-hook note.** Every git invocation in this module targets the
CALLER-SUPPLIED `repo_path` — the client-owned bundle repo, a SEPARATE
checkout from the canonical app repo. This module never touches the
canonical repo's own `.git`.

**Scope note (real-repo provisioning, S453 — carried forward, not this
Subtask's job).** The client-owned private repo itself still needs to be
CREATED with denylist-compliant naming; that provisioning/push is a
separate, OQ-prone concern. This module is tested exclusively against a
local temporary git repo (a `tmp_path` fixture) — it never creates or
pushes to any remote.

De-identified throughout: no client name appears in this module or its
tests.
"""

from __future__ import annotations

import re
import subprocess
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence

from scripts.cocoindex_pipeline.producer.validator import detect_citation_shrink

# Reserved bundle-level filenames — mirrors `producer/bundle_writer.py`'s
# `_RESERVED_BUNDLE_FILENAMES` naming (duplicated, not imported: importing
# `bundle_writer` would pull in its transitive `cocoindex` import, breaking
# this module's deliberate "zero cocoindex import" property).
INDEX_FILENAME = "index.md"
LOG_FILENAME = "log.md"
ONTOLOGY_FILENAME = "ontology.json"

_COMMITTER_NAME = "OKF Producer"
_COMMITTER_EMAIL = "okf-producer@noreply.invalid"


class GitSyncError(RuntimeError):
    """Raised when a git subprocess invocation fails unexpectedly (i.e. for
    a reason other than "path absent at this revision", which callers
    handle as ordinary `None`)."""


@dataclass(frozen=True)
class HumanEditConflict:
    """A managed path whose current on-disk content diverges from the last
    producer commit — BI-22's "flag, never silently re-point/drop" posture.
    The file is left exactly as-is; this run's new content for it is
    discarded."""

    rel_path: str
    reason: str = "current repo state diverges from the last producer commit (human edit)"


@dataclass(frozen=True)
class AugmentationGuardRefusal:
    """A managed path whose new content would DROP a previously-committed
    `# Citations` entry — BI-27/DR-016. The prior committed content is kept;
    `dropped_citations` carries what `validator.detect_citation_shrink`
    found missing from the new draft."""

    rel_path: str
    dropped_citations: "tuple[str, ...]"


@dataclass(frozen=True)
class ProducerOverride:
    """A captured human edit, folded on top of every fresh producer draft
    (BI-27/DR-016 — S436 amendment) — NEVER a direct file mutation, which
    `declare_file`'s fingerprint-overwrite/orphan-delete would clobber. Keyed
    by `concept_path` + the specific `field` the human changed: a frontmatter
    key (`frontmatter:<key>`), the body preamble (`body`), or a body section
    identified by its heading line (e.g. `## Operator note`). `value` is the
    human's verbatim text for that field."""

    concept_path: str
    field: str
    value: str


@dataclass(frozen=True)
class ProposedFieldChange:
    """One field's before/after within a `ProposedChange` — `None` on either
    side means the field was absent in that version (added / removed)."""

    field: str
    before: "str | None"
    after: "str | None"


@dataclass(frozen=True)
class ProposedChange:
    """One managed path's entry in a run's machine-readable proposed-change
    set (BI-27/DR-016 — the DR-013 shape the follow-on accept/edit/reject
    review UI binds to). `change_kind` is one of `add` / `modify` / `remove`
    / `unchanged` / `human_edit_conflict` / `augmentation_refused`.
    `source_workspace_id` is the per-entry provenance slot `{132.22}`
    G-BIDOUTCOME-PROPOSAL stamps onto won-bid DRAFT proposals (BI-28); it
    defaults to `None` for the ordinary Pass-1/Pass-2 producer flow."""

    concept_path: str
    change_kind: str
    field_changes: "tuple[ProposedFieldChange, ...]" = ()
    dropped_citations: "tuple[str, ...]" = ()
    source_workspace_id: "str | None" = None

    def to_json_dict(self) -> "dict[str, object]":
        """A JSON-serialisable view — the review UI (DR-013 shape) binds to
        this; nothing here is a Python-only type."""
        return {
            "concept_path": self.concept_path,
            "change_kind": self.change_kind,
            "field_changes": [
                {"field": fc.field, "before": fc.before, "after": fc.after}
                for fc in self.field_changes
            ],
            "dropped_citations": list(self.dropped_citations),
            "source_workspace_id": self.source_workspace_id,
        }


@dataclass(frozen=True)
class SyncResult:
    """One `sync_bundle` run's outcome."""

    commit_sha: str
    applied: "tuple[str, ...]" = ()
    removed: "tuple[str, ...]" = ()
    unchanged: "tuple[str, ...]" = ()
    human_edit_conflicts: "tuple[HumanEditConflict, ...]" = ()
    augmentation_guard_refusals: "tuple[AugmentationGuardRefusal, ...]" = ()
    # S436 amendment (BI-27/DR-016) additions — all default so every existing
    # caller (publish.py, the tests) is unaffected.
    staged: bool = False
    captured_overrides: "tuple[ProducerOverride, ...]" = ()
    proposed_changes: "tuple[ProposedChange, ...]" = ()


@dataclass(frozen=True)
class _PathDecision:
    rel_path: str
    action: str  # "apply" | "remove" | "unchanged" | "conflict" | "refused"
    dropped_citations: "tuple[str, ...]" = ()
    before: "str | None" = None  # last-producer-output for this path
    after: "str | None" = None  # what this run resolved to on disk for it
    captured: "tuple[ProducerOverride, ...]" = ()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _run_git(repo_path: Path, *args: str) -> "subprocess.CompletedProcess[str]":
    """Run a git command that MUST succeed — any nonzero exit is an
    unexpected failure (not the ordinary "path absent" case, which
    `_read_head` handles separately without raising)."""
    result = subprocess.run(
        ["git", *args], cwd=repo_path, capture_output=True, text=True
    )
    if result.returncode != 0:
        raise GitSyncError(
            f"git {' '.join(args)} failed (exit {result.returncode}): "
            f"{result.stderr.strip()}"
        )
    return result


def _read_head(repo_path: Path, rel_path: str) -> "str | None":
    """`last-producer-output`: the content committed at HEAD for
    `rel_path`, or `None` if absent — either the repo has no commits yet,
    or `rel_path` did not exist at HEAD. Both cases collapse to the same
    `None` signal; a git failure for either reason is expected, not
    exceptional, so this does NOT raise `GitSyncError`."""
    result = subprocess.run(
        ["git", "show", f"HEAD:{rel_path}"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def _read_current(repo_path: Path, rel_path: str) -> "str | None":
    """`current-repo-state`: the path's actual on-disk bytes right now, or
    `None` if the file does not exist."""
    try:
        return (repo_path / rel_path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def _write(repo_path: Path, rel_path: str, content: str) -> None:
    target = repo_path / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def _delete(repo_path: Path, rel_path: str) -> None:
    (repo_path / rel_path).unlink(missing_ok=True)


# ── Field-level concept-doc model (BI-27/DR-016 capture + re-apply) ──────
#
# An OKF concept doc is optional YAML frontmatter (`---` fenced `key: value`
# lines) then a body of a preamble (before the first heading) + heading-led
# sections. The field-level override machinery splits a doc into named fields
# so a human edit can be captured + re-applied at frontmatter-key / section
# granularity — never as a whole-file clobber.

_HEADING_RE = re.compile(r"^#{1,6}\s")
_FRONTMATTER_FIELD_PREFIX = "frontmatter:"
_BODY_FIELD = "body"


def _parse_concept_doc(
    content: str,
) -> "tuple[OrderedDict[str, str], list[tuple[str, list[str]]]]":
    """Split a concept doc into (frontmatter, body_regions).

    `frontmatter` is an ordered `key -> value` map (value is the text after
    `key:`). `body_regions` is an ordered list of `(heading, content_lines)`
    where `heading` is `""` for the preamble region (before the first
    heading) and the verbatim heading line otherwise, and `content_lines` is
    that region's body split on newlines (heading line excluded). Serialising
    via `_serialise_concept_doc` round-trips producer-shaped docs exactly."""
    lines = content.split("\n")
    fm: "OrderedDict[str, str]" = OrderedDict()
    idx = 0

    if lines and lines[0].strip() == "---":
        close = next(
            (j for j in range(1, len(lines)) if lines[j].strip() == "---"), None
        )
        if close is not None:
            for fm_line in lines[1:close]:
                key, sep, value = fm_line.partition(":")
                if sep:
                    fm[key.strip()] = value.strip()
            idx = close + 1

    regions: "list[tuple[str, list[str]]]" = []
    heading = ""
    body: "list[str]" = []
    for line in lines[idx:]:
        if _HEADING_RE.match(line):
            regions.append((heading, body))
            heading, body = line, []
        else:
            body.append(line)
    regions.append((heading, body))
    return fm, regions


def _serialise_concept_doc(
    fm: "OrderedDict[str, str]", regions: "list[tuple[str, list[str]]]"
) -> str:
    out: "list[str]" = []
    if fm:
        out.append("---")
        out.extend(f"{key}: {value}" for key, value in fm.items())
        out.append("---")
    for heading, body in regions:
        if heading != "":
            out.append(heading)
        out.extend(body)
    return "\n".join(out)


def _concept_fields(content: str) -> "OrderedDict[str, str]":
    """Flat field-map view of a concept doc — frontmatter keys as
    `frontmatter:<key>`, the preamble as `body`, and each section keyed by its
    heading line. The inverse of what `_serialise_concept_doc` reconstructs
    per field, so a captured value re-applies losslessly."""
    fm, regions = _parse_concept_doc(content)
    fields: "OrderedDict[str, str]" = OrderedDict()
    for key, value in fm.items():
        fields[f"{_FRONTMATTER_FIELD_PREFIX}{key}"] = value
    for heading, body in regions:
        fields[_BODY_FIELD if heading == "" else heading] = "\n".join(body)
    return fields


def capture_overrides(
    concept_path: str, *, baseline: str, edited: str
) -> "tuple[ProducerOverride, ...]":
    """Capture the human's field-level delta between `baseline` (the last
    producer output for the path) and `edited` (the current human-edited disk
    content) as a `ProducerOverride` set keyed by `concept_path` + field
    (BI-27/DR-016). Only fields the human ADDED or MODIFIED are captured; a
    field the human left byte-identical is never an override, and a field the
    human deleted is not re-imposed on future drafts."""
    base = _concept_fields(baseline)
    new = _concept_fields(edited)
    return tuple(
        ProducerOverride(concept_path, name, value)
        for name, value in new.items()
        if base.get(name) != value
    )


def _apply_override(
    fm: "OrderedDict[str, str]", regions: "list[tuple[str, list[str]]]", override: ProducerOverride
) -> None:
    if override.field.startswith(_FRONTMATTER_FIELD_PREFIX):
        fm[override.field[len(_FRONTMATTER_FIELD_PREFIX) :]] = override.value
        return

    body = override.value.split("\n")
    target = "" if override.field == _BODY_FIELD else override.field
    for i, (heading, _) in enumerate(regions):
        if heading == target:
            regions[i] = (heading, body)
            return
    # The fresh draft no longer emits this field/section — re-insert the
    # human's edit rather than drop it (BI-27: "never dropped"). A preamble
    # override goes to the front; a section override is appended.
    if target == "":
        regions.insert(0, ("", body))
    else:
        regions.append((target, body))


def reapply_overrides(
    draft: "Mapping[str, str]", overrides: "Sequence[ProducerOverride]"
) -> "dict[str, str]":
    """Fold captured producer overrides on top of a fresh Pass-1/Pass-2 draft
    (BI-27/DR-016) BEFORE it is handed to `declare_file` / `sync_bundle`. Each
    approved human edit is RE-APPLIED to its `concept_path`'s fresh draft —
    replacing the field if the producer still emits it, re-inserting it if the
    producer dropped it — so the edit is never lost. Concepts with no override
    (and overrides for a path absent from this draft) pass through untouched."""
    by_path: "dict[str, list[ProducerOverride]]" = {}
    for override in overrides:
        by_path.setdefault(override.concept_path, []).append(override)

    folded = dict(draft)
    for concept_path, path_overrides in by_path.items():
        if concept_path not in folded:
            continue
        fm, regions = _parse_concept_doc(folded[concept_path])
        for override in path_overrides:
            _apply_override(fm, regions, override)
        folded[concept_path] = _serialise_concept_doc(fm, regions)
    return folded


def _change_kind(decision: _PathDecision) -> str:
    if decision.action == "apply":
        return "add" if decision.before is None else "modify"
    return {
        "remove": "remove",
        "unchanged": "unchanged",
        "conflict": "human_edit_conflict",
        "refused": "augmentation_refused",
    }[decision.action]


def _field_changes(decision: _PathDecision) -> "tuple[ProposedFieldChange, ...]":
    """The before/after field diff for the review UI — computed for content
    changes and human-edit conflicts (where a field-level view is meaningful);
    empty for whole-file add/remove/unchanged."""
    if decision.action not in ("apply", "conflict"):
        return ()
    before = _concept_fields(decision.before or "")
    after = _concept_fields(decision.after or "")
    names = list(OrderedDict.fromkeys([*before, *after]))
    return tuple(
        ProposedFieldChange(name, before.get(name), after.get(name))
        for name in names
        if before.get(name) != after.get(name)
    )


def _decide_and_apply(repo_path: Path, rel_path: str, desired: "str | None") -> _PathDecision:
    """The per-path 3-way reconcile + augmentation guard + apply. Mutates
    the filesystem (write/delete) for the "apply"/"remove" outcomes only —
    every other outcome leaves `repo_path` untouched for this path."""
    current = _read_current(repo_path, rel_path)
    last = _read_head(repo_path, rel_path)

    if current != last:
        # BI-22: current-repo-state diverges from last-producer-output — a
        # human edit. Flag it and leave the file exactly as it is; BI-27
        # additionally CAPTURES the human's field-level delta as an override
        # set so the flow can re-apply it onto future drafts.
        captured = capture_overrides(rel_path, baseline=last or "", edited=current or "")
        return _PathDecision(
            rel_path, "conflict", before=last, after=current, captured=captured
        )

    if desired is None:
        # This run wants the path gone. Safe only because current == last
        # (no human edit to protect) — a genuine producer-side removal.
        if last is None:
            return _PathDecision(rel_path, "unchanged", before=last, after=last)
        _delete(repo_path, rel_path)
        return _PathDecision(rel_path, "remove", before=last, after=None)

    if desired == last:
        return _PathDecision(rel_path, "unchanged", before=last, after=last)

    # Content is genuinely changing (no human-edit conflict). BI-27/DR-016
    # augmentation guard: refuse a change that would drop a previously
    # committed citation, via the SAME shared detection function {132.9}'s
    # web_pass.py enforcement half calls.
    shrink = detect_citation_shrink(previous_body=last or "", new_body=desired)
    if shrink:
        return _PathDecision(
            rel_path, "refused", dropped_citations=tuple(shrink), before=last, after=desired
        )

    _write(repo_path, rel_path, desired)
    return _PathDecision(rel_path, "apply", before=last, after=desired)


def _render_findings(
    conflicts: "Sequence[HumanEditConflict]",
    refusals: "Sequence[AugmentationGuardRefusal]",
) -> str:
    """Renders the git-sync reconcile findings block appended to the tail
    of this run's `log.md` content — an `###` (not `##`) sub-heading, so
    `lib/okf/parse-log.ts`'s `RUN_HEADING_RE` (`^##\\s+`) does not mistake
    it for a second run block; it reads as part of the SAME (last, still-
    open) run block bundle_writer already appended this run."""
    if not conflicts and not refusals:
        return ""
    lines = ["### git-sync reconcile findings"]
    if conflicts:
        lines.append(
            f"- WARNING human-edited managed file(s) left in place ({len(conflicts)}):"
        )
        for conflict in conflicts:
            lines.append(f"  - {conflict.rel_path}: {conflict.reason}")
    if refusals:
        lines.append(
            f"- WARNING augmentation guard refused shrinking sync(s) ({len(refusals)}):"
        )
        for refusal in refusals:
            lines.append(
                f"  - {refusal.rel_path}: would drop {list(refusal.dropped_citations)!r}"
            )
    return "\n".join(lines) + "\n"


def sync_bundle(
    repo_path: Path,
    new_output: Mapping[str, str],
    *,
    removed_paths: Sequence[str] = (),
    managed_keyset: "Sequence[str] | None" = None,
    commit_message: "str | None" = None,
    timestamp: "str | None" = None,
    stage_only: bool = False,
    source_workspace_ids: "Mapping[str, str] | None" = None,
) -> SyncResult:
    """The per-run G-GITSYNC orchestration (BI-14/18/19/22/27): 3-way
    reconcile + augmentation-guard EVERY managed path, apply what is safe,
    then commit when anything changed — one commit per producer run, at
    most (BI-19). A genuinely no-op run (every managed path resolves
    "unchanged") makes no new commit (BI-18).

    `new_output` maps managed rel_path -> this run's desired content.
    `removed_paths` names managed rel_paths this run wants GONE (no
    corresponding `new_output` entry) — mirrors `bundle_writer.write_bundle`'s
    explicit `moved`-parameter precedent: a removal is caller-supplied, never
    inferred from a content diff.

    `managed_keyset`, when omitted, defaults to
    `frozenset(new_output) | frozenset(removed_paths)` — the producer's own
    manifest for this run. Any path NOT in the managed keyset (e.g. a human
    `notes/` file) is never read, written, or deleted by this function.

    `stage_only` (S436 amendment, BI-27/DR-016) selects the STAGING landing:
    when `True`, the reconcile applies to the working tree and `git add`s the
    changed paths but makes NO commit — the ONE gated commit is deferred to
    the publish gate (`producer/publish.py`, which calls this with the default
    `stage_only=False`), not made per-run. `result.staged` reflects the mode.

    `source_workspace_ids` (S443 amendment, BI-28 / {132.22}
    G-BIDOUTCOME-PROPOSAL) is an optional `concept_path -> workspace_id`
    provenance map: for each managed path present in it, the emitted
    `ProposedChange` is stamped with that `source_workspace_id`, so the
    accept/edit/reject review UI can attribute a bid-outcome-seeded (won-bid
    `case_study`) draft to the procurement `workspaces.id` that seeded it (the
    id originates on the won-bid concept's `ConceptKey.workspace_id`,
    {132.21}). This extends the {132.24} substrate BY VALUE — no schema change;
    a path absent from the map keeps the per-entry `None` default. The caller
    (the {132.16}/{132.23} flow assembly) builds this map from the run's
    `ConceptKey`s; when omitted, every entry is unstamped, exactly as the
    ordinary Pass-1/Pass-2 producer flow (and every pre-{132.22} caller)
    expects.

    Every run — staged or committing — also returns `captured_overrides` (the
    field-level human edits captured from any human-edit conflict, for the
    flow to re-apply via `reapply_overrides`) and `proposed_changes` (the
    machine-readable per-run change set; feed to `proposed_change_set` for the
    DR-013-shaped review payload).

    Returns a `SyncResult` — `commit_sha` is the sha of a new commit (a
    committing run that applied and/or removed at least one managed path), the
    unchanged current HEAD sha (a no-op committing run, BI-18, or any staged
    run over a repo that already has a commit), or `""` for a staged run over
    a repo with no commit yet.
    """
    managed = (
        frozenset(managed_keyset)
        if managed_keyset is not None
        else frozenset(new_output) | frozenset(removed_paths)
    )

    non_log_paths = sorted(p for p in managed if p != LOG_FILENAME)

    decisions: "list[_PathDecision]" = [
        _decide_and_apply(repo_path, rel_path, new_output.get(rel_path))
        for rel_path in non_log_paths
    ]

    conflicts = [HumanEditConflict(d.rel_path) for d in decisions if d.action == "conflict"]
    refusals = [
        AugmentationGuardRefusal(d.rel_path, d.dropped_citations)
        for d in decisions
        if d.action == "refused"
    ]

    if LOG_FILENAME in managed:
        base_log = new_output.get(LOG_FILENAME, "")
        findings = _render_findings(conflicts, refusals)
        if findings:
            desired_log = (
                f"{base_log.rstrip()}\n\n{findings}" if base_log.strip() else findings
            )
        else:
            desired_log = base_log
        log_decision = _decide_and_apply(repo_path, LOG_FILENAME, desired_log)
        decisions.append(log_decision)
        if log_decision.action == "conflict":
            conflicts.append(HumanEditConflict(LOG_FILENAME))
        elif log_decision.action == "refused":
            refusals.append(
                AugmentationGuardRefusal(LOG_FILENAME, log_decision.dropped_citations)
            )

    applied = tuple(sorted(d.rel_path for d in decisions if d.action == "apply"))
    removed = tuple(sorted(d.rel_path for d in decisions if d.action == "remove"))
    unchanged = tuple(sorted(d.rel_path for d in decisions if d.action == "unchanged"))

    # BI-27/DR-016 emissions — computed from the same decisions this run
    # already reconciled, independent of staging vs committing.
    captured_overrides = tuple(
        override for d in decisions for override in d.captured
    )
    # BI-28 / {132.22}: stamp the per-entry `source_workspace_id` provenance
    # for bid-outcome-seeded (won-bid case_study) concepts from the supplied
    # `concept_path -> workspace_id` map — a value-set on the {132.24} slot, not
    # a schema change; a path absent from the map keeps the `None` default.
    workspace_provenance = source_workspace_ids or {}
    proposed_changes = tuple(
        ProposedChange(
            concept_path=d.rel_path,
            change_kind=_change_kind(d),
            field_changes=_field_changes(d),
            dropped_citations=d.dropped_citations,
            source_workspace_id=workspace_provenance.get(d.rel_path),
        )
        for d in decisions
    )

    for rel_path in (*applied, *removed):
        _run_git(repo_path, "add", "--", rel_path)

    head_before = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_path, capture_output=True, text=True
    )
    has_prior_commit = head_before.returncode == 0
    head_sha = head_before.stdout.strip() if has_prior_commit else ""

    if stage_only:
        # BI-27/DR-016 STAGING landing: apply + `git add`, but make NO commit
        # this run — the ONE gated commit happens later at the publish gate.
        commit_sha = head_sha
    elif not applied and not removed and has_prior_commit:
        # BI-18: a genuinely no-op run (nothing applied or removed) makes
        # NO new commit — the prior HEAD sha is returned unchanged. BI-19's
        # "one commit per run" bounds a CHANGING run to exactly one commit;
        # it does not mandate a commit when nothing changed at all.
        commit_sha = head_sha
    else:
        message = commit_message or f"okf producer git-sync ({timestamp or _now_iso()})"
        _run_git(
            repo_path,
            "-c",
            f"user.name={_COMMITTER_NAME}",
            "-c",
            f"user.email={_COMMITTER_EMAIL}",
            "commit",
            "--allow-empty",
            "-m",
            message,
        )
        commit_sha = _run_git(repo_path, "rev-parse", "HEAD").stdout.strip()

    return SyncResult(
        commit_sha=commit_sha,
        applied=applied,
        removed=removed,
        unchanged=unchanged,
        human_edit_conflicts=tuple(conflicts),
        augmentation_guard_refusals=tuple(refusals),
        staged=stage_only,
        captured_overrides=captured_overrides,
        proposed_changes=proposed_changes,
    )


def proposed_change_set(
    result: SyncResult, *, run_timestamp: "str | None" = None
) -> "dict[str, object]":
    """Reshape a `SyncResult` into the machine-readable, JSON-serialisable
    per-run proposed-change set (BI-27/DR-016 — the DR-013 shape the follow-on
    accept/edit/reject review UI binds to). This is the same reconcile data
    this module renders into `log.md`, re-projected as structured records
    rather than prose. Every entry carries a per-entry `source_workspace_id`
    provenance slot (`{132.22}` G-BIDOUTCOME-PROPOSAL, BI-28)."""
    return {
        "schema": "okf.producer.proposed-change-set/v1",
        "timestamp": run_timestamp or _now_iso(),
        "staged": result.staged,
        "commit_sha": result.commit_sha,
        "changes": [change.to_json_dict() for change in result.proposed_changes],
        "captured_overrides": [
            {
                "concept_path": override.concept_path,
                "field": override.field,
                "value": override.value,
            }
            for override in result.captured_overrides
        ],
    }
