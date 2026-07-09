"""Git knowledge-sync writer — 3-way human-edit reconcile (ID-132 {132.12}
G-GITSYNC).

Per `docs/specs/id-132-okf-concept-producer/TECH.md` §"Git knowledge-sync +
human-edit reconciliation" (BI-14/BI-18/BI-19/BI-22) + PRODUCT.md BI-27:

    A git writer OUTSIDE cocoindex stages the bundle working tree and
    commits to the CLIENT-OWNED PRIVATE repository — one commit per
    producer run (BI-19, ratified; unconditional — even a fully no-op
    run still commits, `--allow-empty`), with point-in-time rollback via
    git history. This is a discrete POST-FLOW stage, NEVER a cocoindex
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

**One commit per run (BI-19, unconditional).** `sync_bundle` always
commits — `git commit --allow-empty` — even when nothing was staged
(a genuinely no-op run). The commit uses an explicit `-c user.name=
... -c user.email=...` identity so this module works against a fresh
repo with no git identity configured (the client-owned repo's own
provisioning — S453, out of THIS Subtask's scope — may or may not set
one).

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

import subprocess
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
class SyncResult:
    """One `sync_bundle` run's outcome."""

    commit_sha: str
    applied: "tuple[str, ...]" = ()
    removed: "tuple[str, ...]" = ()
    unchanged: "tuple[str, ...]" = ()
    human_edit_conflicts: "tuple[HumanEditConflict, ...]" = ()
    augmentation_guard_refusals: "tuple[AugmentationGuardRefusal, ...]" = ()


@dataclass(frozen=True)
class _PathDecision:
    rel_path: str
    action: str  # "apply" | "remove" | "unchanged" | "conflict" | "refused"
    dropped_citations: "tuple[str, ...]" = ()


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


def _decide_and_apply(repo_path: Path, rel_path: str, desired: "str | None") -> _PathDecision:
    """The per-path 3-way reconcile + augmentation guard + apply. Mutates
    the filesystem (write/delete) for the "apply"/"remove" outcomes only —
    every other outcome leaves `repo_path` untouched for this path."""
    current = _read_current(repo_path, rel_path)
    last = _read_head(repo_path, rel_path)

    if current != last:
        # BI-22: current-repo-state diverges from last-producer-output —
        # a human edit. Flag it; leave the file exactly as it is.
        return _PathDecision(rel_path, "conflict")

    if desired is None:
        # This run wants the path gone. Safe only because current == last
        # (no human edit to protect) — a genuine producer-side removal.
        if last is None:
            return _PathDecision(rel_path, "unchanged")
        _delete(repo_path, rel_path)
        return _PathDecision(rel_path, "remove")

    if desired == last:
        return _PathDecision(rel_path, "unchanged")

    # Content is genuinely changing (no human-edit conflict). BI-27/DR-016
    # augmentation guard: refuse a change that would drop a previously
    # committed citation, via the SAME shared detection function {132.9}'s
    # web_pass.py enforcement half calls.
    shrink = detect_citation_shrink(previous_body=last or "", new_body=desired)
    if shrink:
        return _PathDecision(rel_path, "refused", dropped_citations=tuple(shrink))

    _write(repo_path, rel_path, desired)
    return _PathDecision(rel_path, "apply")


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
) -> SyncResult:
    """The per-run G-GITSYNC orchestration (BI-14/18/19/22/27): 3-way
    reconcile + augmentation-guard EVERY managed path, apply what is safe,
    then ALWAYS commit — one commit per producer run.

    `new_output` maps managed rel_path -> this run's desired content.
    `removed_paths` names managed rel_paths this run wants GONE (no
    corresponding `new_output` entry) — mirrors `bundle_writer.write_bundle`'s
    explicit `moved`-parameter precedent: a removal is caller-supplied, never
    inferred from a content diff.

    `managed_keyset`, when omitted, defaults to
    `frozenset(new_output) | frozenset(removed_paths)` — the producer's own
    manifest for this run. Any path NOT in the managed keyset (e.g. a human
    `notes/` file) is never read, written, or deleted by this function.

    Returns a `SyncResult` — `commit_sha` is always set (this function
    always commits, `--allow-empty` covers the fully-no-op case).
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

    for rel_path in (*applied, *removed):
        _run_git(repo_path, "add", "--", rel_path)

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
    )
