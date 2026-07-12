"""First-publish HARD gate + the `producer publish` command entry — BI-20/
BI-21/BI-23 (ID-132 {132.13} G-PUBLISH-GATE).

Per `docs/specs/id-132-okf-concept-producer/TECH.md` §"The bundle vector
index (BI-25) + first-publish gate (BI-20/BI-21/BI-23)" + PRODUCT.md §E
(BI-20/21/23):

- **BI-20** — the FIRST publication of the bundle to the client-owned repo
  is the irreversible act of the entire programme: it pins deterministic
  record uuids (BI-7) into a durable, client-owned artefact. Before first
  publish the whole stack is re-seedable pre-launch (ID-131 BI-2); after
  it, a `canonical://source_documents/<uuid>` in a shipped concept is a
  contract.
- **BI-21 (HARD GATE)** — the publish step MUST NOT proceed unless ID-131's
  frozen `{131.5}` seed-contract freeze test
  (`__tests__/pipeline/seed-contract.test.ts` — asserts `_KH_PIPELINE_DOC_NS`
  + the `sd:`/`ri:`/`qa:` seed-string formats **and**, per BI-26,
  `_KH_CONCEPT_NS`) is CI-green. This module checks that test's **CI
  status as a reference** — it never re-runs the test itself.
- **BI-23 (sequencing)** — concept vector indexing (G-EMBED, `{132.11}`)
  and first publish both wait on ID-131 (a Task-level dependency, already
  satisfied — ID-131 is done). In-Task, this Subtask depends on G-GITSYNC
  (`{132.12}`, `producer/git_sync.py:sync_bundle` — publish *is* the gated
  commit) and G-EMBED (`{132.11}`, `producer/embed.py` — no direct call
  from this module; G-EMBED's write happens earlier in the flow, before
  the bundle is handed to this gate).

**Scope fence (deliberate, per the {132.13} dispatch brief).** This module
does NOT assemble the full producer flow
(`LRecordsSource.list_concepts() -> mount_each(enrich_concept) ->
write_bundle -> embed -> git_sync`) — composing that flow_def is an
UNOWNED gap tracked separately ({132.16}, routed to the parent Task). This
module's job starts one step later: given an ALREADY-WRITTEN bundle
working tree (produced by `producer/bundle_writer.write_bundle` +
`append_log_entry` upstream — a fixture/temp directory in this Subtask's
tests), gate on BI-21 and then perform the ONE gated commit via
`producer/git_sync.sync_bundle`.

**The injectable status source (BI-21 CI-status wiring — ENVIRONMENT-
DEPENDENT FOLLOW-UP, not this deliverable).** A live GitHub Checks-API
lookup for the `{131.5}` freeze test's CI status fails in this sandbox
(TLS x509 trust chain to `api.github.com` — confirmed empirically during
this Subtask). So the gate is built as **pure logic** over an injected
`SeedContractStatusSource` callable — `() -> SeedContractCheckResult` —
supplied by the caller. `read_status_file` below is a network-free DEFAULT
that reads a small JSON status artefact (the shape a CI job that has
already run/checked the freeze test could easily emit); a live
`api.github.com` Checks-API implementation is the documented follow-up,
wired in when this runs inside real CI rather than this sandbox. The gate
logic + abort-on-red behaviour — not the live wiring — is what this
Subtask delivers and tests (with injected green/red statuses).

**The gated commit + the `{132.12}` log.md tension (surfaced, not fixed
here).** On green, `publish_bundle` delegates the ONE commit to
`git_sync.sync_bundle` — `git_sync.py` remains the SOLE writer into the
client-owned repo; this module performs no git operation of its own.
`{132.12}`'s `sync_bundle` skips the commit only when a run applies/removes
NOTHING relative to the last commit (BI-18's no-op-run guarantee). But
`producer/bundle_writer.append_log_entry` appends a **freshly-timestamped**
`## <ISO-8601>` block to `log.md` on EVERY run — including a fully no-op
run over the concept files (`RunSummary.is_no_op` still renders a block,
just one that says "No changes (no-op re-run)."). If `log.md` is included
in the `new_output`/`managed_keyset` a caller hands to `publish_bundle` (as
it will be for a real bundle directory, since `log.md` is one of the
producer's own managed-keyset filenames), `log.md`'s desired content
differs from the last-committed `log.md` on EVERY run purely because of
the new timestamp — so `sync_bundle`'s "genuinely no-op" branch is
practically unreachable for a real publish call, even when every concept
file is byte-identical to the last publish. This module does not attempt
to fix that here (it is `{132.12}`'s open tension, not this Subtask's file
ownership) — `TestLogMdNoOpTension` in the paired test file demonstrates
it executably so it stays visible rather than silently forgotten.

De-identified throughout (per the {132.13} brief: "the first client") — no
client name appears in this module or its tests.

**DR-055 post-publish push lane (ID-132 {132.35} G-DEPLOY-PROOF, S465 fix
wave).** `git_sync.py` is commit-local BY CONTRACT (its own S453 scope note:
"never creates or pushes to any remote") — this module is the deliberately
SEPARATE, OUTSIDE-git_sync push step DR-055 calls for: after `publish_bundle`
lands its one gated commit, `push_bundle_repo` optionally `git push`es
`repo_path` (the SAME caller-supplied client-owned bundle repo `publish_bundle`
just committed into — never this canonical repo's own `.git`). Configuration
is env-gated on `OKF_BUNDLE_DEPLOY_KEY_PATH` (a repo-scoped read-write SSH
deploy key file path — owner-provisioned as a Coolify runtime secret,
DR-055; the key itself does not exist in every environment yet, per the
S465 journal, so this module must default to a clean no-op rather than
assume it is configured). A push failure is logged LOUD but never raises —
the local commit already landed via `publish_bundle` before this ever runs,
so a push failure must not be mistaken for (or cause) a failed publish.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from scripts.cocoindex_pipeline.producer.git_sync import SyncResult, sync_bundle

_logger = logging.getLogger(__name__)

# The ID-131 {131.5} freeze test this gate checks the CI status OF — a
# reference for error messages / the default status source, never
# re-executed by this module.
SEED_CONTRACT_FREEZE_TEST_PATH = "__tests__/pipeline/seed-contract.test.ts"


@dataclass(frozen=True)
class SeedContractCheckResult:
    """The ID-131 `{131.5}` seed-contract freeze test's CI status, as
    OBSERVED by the publish gate (never re-derived by re-running the test).
    `is_green=True` means the freeze test's last known CI run passed;
    `detail` is an optional human-readable note (e.g. which check/run this
    came from, or why a status could not be determined — treated as
    RED/unknown, never silently green, when detail explains an absence)."""

    is_green: bool
    detail: str = ""


# The injectable seam BI-21 gates on — a zero-argument callable returning
# the freeze test's current CI status. Tests inject fixed green/red
# results; `read_status_file` below is the network-free default; a live
# GitHub Checks-API source is the documented follow-up (see module
# docstring).
SeedContractStatusSource = Callable[[], SeedContractCheckResult]


class PublishAbortedError(RuntimeError):
    """Raised by `ensure_seed_contract_green`/`publish_bundle` when BI-21's
    HARD gate finds the ID-131 seed-contract freeze test is NOT CI-green.
    No filesystem or git mutation happens before this is raised — an abort
    leaves the client-owned repo exactly as it was."""


def read_status_file(status_path: "Path | None") -> SeedContractCheckResult:
    """Network-free default `SeedContractStatusSource` implementation:
    reads a small JSON artefact — `{"green": bool, "detail": "..."}` — most
    naturally emitted by an earlier CI step that has already run (or
    checked) the `{131.5}` freeze test. A `None` path (no `--status-file`
    supplied), a missing file, unparseable content, or a missing `"green"`
    key are ALL treated as RED (fail-closed — BI-21 is a HARD gate, so an
    indeterminate status must never read as green).
    """
    if status_path is None:
        return SeedContractCheckResult(
            is_green=False, detail="no --status-file supplied (fail-closed)"
        )
    try:
        payload = json.loads(status_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return SeedContractCheckResult(
            is_green=False,
            detail=f"could not read/parse status file {status_path}: {exc}",
        )
    if not isinstance(payload, dict) or "green" not in payload:
        return SeedContractCheckResult(
            is_green=False,
            detail=f"status file {status_path} missing a 'green' key (fail-closed)",
        )
    return SeedContractCheckResult(
        is_green=bool(payload["green"]), detail=str(payload.get("detail", ""))
    )


def ensure_seed_contract_green(
    status_source: SeedContractStatusSource,
) -> SeedContractCheckResult:
    """BI-21 HARD GATE — pure abort-on-red logic. Calls the injected
    `status_source` exactly once and raises `PublishAbortedError` unless it
    reports green. Contains NO knowledge of how the status was obtained
    (a live CI-status API, a status file, a test stub) — that is entirely
    `status_source`'s concern, which is the point of the injectable seam.
    """
    result = status_source()
    if not result.is_green:
        detail = f" ({result.detail})" if result.detail else ""
        raise PublishAbortedError(
            "BI-21 HARD GATE: refusing to publish — the ID-131 {131.5} "
            f"seed-contract freeze test ({SEED_CONTRACT_FREEZE_TEST_PATH}) "
            f"is not CI-green{detail}. First publish pins deterministic "
            "record uuids into a durable client-owned artefact (BI-20); it "
            "must not proceed while the seed contract is red (a later "
            "'tidy' of the namespace/seed strings would silently orphan "
            "every pinned canonical://<table>/<uuid> already shipped)."
        )
    return result


def publish_bundle(
    repo_path: Path,
    new_output: Mapping[str, str],
    *,
    status_source: SeedContractStatusSource,
    removed_paths: Sequence[str] = (),
    managed_keyset: "Sequence[str] | None" = None,
    commit_message: "str | None" = None,
    timestamp: "str | None" = None,
) -> SyncResult:
    """The G-PUBLISH-GATE action (BI-20/21/23): gate, then perform the ONE
    gated commit.

    1. **BI-21 HARD GATE.** `ensure_seed_contract_green(status_source)` —
       raises `PublishAbortedError` on red. Runs BEFORE any filesystem or
       git operation, so a red gate leaves `repo_path` completely
       untouched: no partial write, no partial commit.
    2. **The gated commit.** On green, delegates to
       `git_sync.sync_bundle(repo_path, new_output, ...)` — `{132.12}`'s
       sole writer into the client-owned repo. This module performs no git
       operation of its own; `sync_bundle` still applies its own BI-18/19/
       22/27 behaviour (3-way reconcile, augmentation guard, at-most-one
       commit) exactly as it does for any other caller.

    `new_output`/`removed_paths`/`managed_keyset` are passed straight
    through to `sync_bundle` — see its docstring. Per the module docstring
    above, note the `{132.12}` log.md tension if `new_output` includes
    `log.md` content produced by `bundle_writer.append_log_entry`.
    """
    ensure_seed_contract_green(status_source)
    return sync_bundle(
        repo_path,
        new_output,
        removed_paths=removed_paths,
        managed_keyset=managed_keyset,
        commit_message=commit_message,
        timestamp=timestamp,
    )


# ─────────────────────────────────────────────────────────────────────────
# DR-055 post-publish push lane (ID-132 {132.35} G-DEPLOY-PROOF)
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PushResult:
    """`push_bundle_repo`'s outcome. `attempted=False` means the push lane is
    unconfigured (clean no-op — DR-055's deploy key does not exist in every
    environment yet). `attempted=True, pushed=False` means a push was tried
    and failed; `error` carries the loud-logged detail for the caller to
    surface in its own run summary."""

    attempted: bool
    pushed: bool
    error: "str | None" = None


def push_bundle_repo(
    repo_path: Path,
    *,
    deploy_key_path: "str | None" = None,
) -> PushResult:
    """DR-055 post-publish push lane — deliberately OUTSIDE `git_sync.py`'s
    commit-local contract (see module docstring). Called once, AFTER a
    successful `publish_bundle` commit — this function performs no commit of
    its own, only `git push` of whatever `repo_path`'s current HEAD already
    is.

    Configuration: `deploy_key_path` (or, when omitted, the
    `OKF_BUNDLE_DEPLOY_KEY_PATH` env var) names an SSH private-key file for a
    repo-scoped read-write deploy key (DR-055; owner-provisioned as a
    Coolify runtime secret — a MOUNTED FILE PATH, never the key material
    itself). When NEITHER is set, this is a clean no-op (`attempted=False`)
    — never a loud failure, since the key legitimately does not exist yet in
    most environments (S465 journal).

    Assumes `repo_path` is ALREADY a configured clone with an `origin`
    remote + upstream tracking branch (the DR-055 persistent-volume clone) —
    this function does not create or configure a remote; it runs a plain
    `git push`.

    Failure semantics (owner position, S465 fix wave): the run's local
    commit already landed via `publish_bundle`/`sync_bundle` before this is
    ever called, so a push failure NEVER rolls back or raises — it is
    logged LOUD (`_logger.error`) and returned in `PushResult.error` for the
    caller to surface in its own run summary/log, but the completed
    producer run is never failed because of it (DR-047 does not extend to
    silently swallowing the failure — it is always visible, just never
    fatal).

    Every git invocation targets `repo_path` exclusively (mirrors
    `git_sync.py`'s own guard-hook discipline) — never this canonical repo's
    own `.git`.
    """
    resolved_key_path = deploy_key_path or os.environ.get(
        "OKF_BUNDLE_DEPLOY_KEY_PATH"
    )
    if not resolved_key_path:
        _logger.info(
            "producer publish: OKF_BUNDLE_DEPLOY_KEY_PATH not set — DR-055 "
            "push lane disabled (clean no-op); the local commit at %s stands "
            "unpushed.",
            repo_path,
        )
        return PushResult(attempted=False, pushed=False)

    push_env = dict(os.environ)
    push_env["GIT_SSH_COMMAND"] = (
        f"ssh -i {resolved_key_path} -o IdentitiesOnly=yes "
        "-o StrictHostKeyChecking=accept-new"
    )
    try:
        subprocess.run(
            ["git", "push"],
            cwd=repo_path,
            env=push_env,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, OSError) as exc:
        detail = (
            exc.stderr.strip()
            if isinstance(exc, subprocess.CalledProcessError) and exc.stderr
            else str(exc)
        )
        _logger.error(
            "producer publish: DR-055 push FAILED (repo_path=%s): %s — the "
            "local commit stands; this run is NOT failed by a push failure.",
            repo_path,
            detail,
        )
        return PushResult(attempted=True, pushed=False, error=detail)

    _logger.info(
        "producer publish: DR-055 push succeeded (repo_path=%s).", repo_path
    )
    return PushResult(attempted=True, pushed=True)


# ─────────────────────────────────────────────────────────────────────────
# `producer publish` command entry
# ─────────────────────────────────────────────────────────────────────────


def _read_bundle_dir(bundle_dir: Path) -> "dict[str, str]":
    """Reads an ALREADY-WRITTEN bundle working directory (produced upstream
    by `bundle_writer.write_bundle`/`append_log_entry` — assembling that
    flow is explicitly out of THIS Subtask's scope, see module docstring)
    into the `{rel_path: content}` mapping `publish_bundle`/`sync_bundle`
    expect. Every regular file under `bundle_dir` is read as UTF-8 text and
    keyed by its POSIX-style path relative to `bundle_dir`.

    **`.git`-safe (ID-132 {132.35} G-DEPLOY-PROOF Defect B, mirrors
    `flow_def._read_bundle_dir`'s identical fix).** `bundle_dir` is ALWAYS a
    git clone in deployment (DR-016), so its working tree carries `.git/`
    (config, HEAD, index, `objects/**` binary blobs) — the {132.35} deploy
    proof crashed here on the first git-internal binary file (`UnicodeDecode
    Error: 'utf-8' codec can't decode byte 0xe2`), a hazard this module's own
    git-less `tmp_path` fixtures never exercised before. Any path component
    starting with `.` is skipped (mirrors the {132.32} explorer's dotdir
    convention, commit 6c54f26a — `.git/` and any other hidden file/dir, not
    a hardcoded `.git` special-case); a file that survives that filter but
    still isn't valid UTF-8 is skipped with a loud warning rather than
    crashing the whole read (fails open, mirrors the {132.32} frontmatter-
    parse posture).
    """
    output: "dict[str, str]" = {}
    for path in sorted(bundle_dir.rglob("*")):
        if not path.is_file():
            continue
        rel_path = path.relative_to(bundle_dir)
        if any(part.startswith(".") for part in rel_path.parts):
            continue
        rel_path_str = rel_path.as_posix()
        try:
            output[rel_path_str] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            _logger.warning(
                "producer publish: skipping non-UTF-8 file under bundle_dir "
                "(not a valid bundle artefact): %s",
                rel_path_str,
            )
    return output


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m scripts.cocoindex_pipeline.producer.publish",
        description=(
            "BI-20/21/23 G-PUBLISH-GATE: publish an already-written OKF "
            "concept bundle directory to the client-owned bundle repo. "
            "Refuses (no repo mutation) unless the ID-131 {131.5} "
            "seed-contract freeze test's CI status is green."
        ),
    )
    parser.add_argument(
        "--bundle-dir",
        required=True,
        type=Path,
        help="Already-written bundle working directory to publish (concept "
        ".md files + index.md + log.md, produced upstream).",
    )
    parser.add_argument(
        "--repo-path",
        required=True,
        type=Path,
        help="The client-owned bundle git repository to commit into.",
    )
    parser.add_argument(
        "--status-file",
        type=Path,
        default=None,
        help="JSON status artefact {'green': bool, 'detail': str} reporting "
        "the ID-131 {131.5} seed-contract freeze test's CI status (BI-21 "
        "gate). A missing/unreadable file is treated as RED (fail-closed). "
        "Live GitHub Checks-API wiring is a documented follow-up, not yet "
        "implemented — see module docstring.",
    )
    parser.add_argument(
        "--removed",
        nargs="*",
        default=(),
        help="Managed rel_paths this run wants removed from the bundle repo "
        "(not present under --bundle-dir).",
    )
    return parser


def run(
    argv: "list[str] | None" = None,
    *,
    status_source: "SeedContractStatusSource | None" = None,
) -> int:
    """Runs the `producer publish` command; returns the process exit code
    (0 on a successful publish, 1 on a BI-21 abort). `status_source` is
    injected by the test harness; the CLI's own default reads
    `--status-file` via `read_status_file`.
    """
    args = _build_parser().parse_args(argv)
    source = status_source or (lambda: read_status_file(args.status_file))

    new_output = _read_bundle_dir(args.bundle_dir)

    try:
        result = publish_bundle(
            args.repo_path,
            new_output,
            status_source=source,
            removed_paths=tuple(args.removed),
        )
    except PublishAbortedError as exc:
        print(f"producer publish: ABORTED — {exc}", file=sys.stderr)
        return 1

    # DR-055 push lane (ID-132 {132.35}) — runs AFTER the gated commit above
    # has already landed; a push failure is surfaced but never turns this
    # into a nonzero exit (see push_bundle_repo's own failure-semantics
    # docstring — the completed publish must not be reported as failed
    # because of a downstream push issue).
    push_result = push_bundle_repo(args.repo_path)
    if push_result.attempted and not push_result.pushed:
        print(
            f"producer publish: DR-055 push FAILED — {push_result.error} "
            "(the local commit above stands; this is NOT a publish failure)",
            file=sys.stderr,
        )
    elif push_result.pushed:
        print("producer publish: DR-055 push succeeded", file=sys.stderr)

    if result.applied or result.removed:
        print(
            f"producer publish: committed {result.commit_sha} "
            f"(applied {len(result.applied)}, removed {len(result.removed)})",
            file=sys.stderr,
        )
    else:
        print(
            f"producer publish: no-op run — HEAD unchanged at {result.commit_sha}",
            file=sys.stderr,
        )
    if result.human_edit_conflicts:
        print(
            f"producer publish: {len(result.human_edit_conflicts)} human-edit "
            "conflict(s) flagged — see log.md",
            file=sys.stderr,
        )
    if result.augmentation_guard_refusals:
        print(
            f"producer publish: {len(result.augmentation_guard_refusals)} "
            "augmentation-guard refusal(s) — see log.md",
            file=sys.stderr,
        )
    return 0


def main() -> None:
    """Module entry point —
    `python3 -m scripts.cocoindex_pipeline.producer.publish`."""
    sys.exit(run())


if __name__ == "__main__":
    main()
