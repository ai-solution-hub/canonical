#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: stop a worker gracefully.
#
# Order of operations:
# 1. Send /exit to the cmux workspace.
# 2. Wait up to 10s for session_end.
# 3. SAFETY: dirty-tree check on the worker's worktree (BEFORE workspace close
#    to preserve operator recovery path — exit 2 leaves cmux workspace alive).
# 4. Close the cmux workspace (only after dirty-tree clean OR --force).
# 5. Remove the git worktree.
# 6. Delete the events directory.
# 7. Optionally delete the worker branch (--delete-branch).
#
# Usage: stop-worker.sh <worker-name> <session-id> [--force] [--delete-branch] [--delete-branch-force] [--archive <dir>] [--no-archive]
#
# Flags:
#   --force          Remove the worktree even if it has uncommitted changes
#                    (DATA LOSS — only use after the worker has cherry-picked
#                    or merged its commits elsewhere).
#   --delete-branch  After worktree removal, delete the worker branch
#                    (cmux-worker-<name>-<sha>). Falls back to `git worktree
#                    list` lookup when meta file is absent (post-failure
#                    re-run scenario). Default: branch retained, parent
#                    orchestrator owns its lifecycle.
#                    SAFETY: deletion is GATED on an unmerged-commit
#                    pre-check against the integration ref (default `main`,
#                    override via $KH_CMUX_INTEGRATION_REF). If the branch has
#                    commits not in that ref (by patch-id), deletion is REFUSED
#                    and the orphan SHAs are printed — preventing the
#                    "cherry-pick BEFORE stop" data-loss footgun.
#   --delete-branch-force
#                    Bypass the unmerged-commit gate and force-delete (git
#                    branch -D). Use only to deliberately discard unwanted work.
#   --archive <dir>  Archive worker corpus artefacts to <dir>/<worker-name>/
#                    BEFORE the teardown rm -rf $EVENTS_DIR. The 4 canonical
#                    artefacts copied are
#                    {events.jsonl, oq-pending.md, final_report.yaml, meta.json}
#                    — any missing files are logged + skipped (best-effort,
#                    forward-compatible with workers that do not emit all four).
#                    Required by the workflow-evaluator data layer so historical
#                    session corpus survives teardown. Callers typically point
#                    <dir> at
#                    ${KH_PRIVATE_DOCS_DIR}/src/content/docs/workflow-evaluation/sessions/S<NNN>/
#                    (the private docs-site checkout).
#
#                    After copying, the just-archived SESSION SEGMENT dir is
#                    auto-committed + pushed in the docs-site checkout
#                    (OQ-2A, ID-150.1) — a SCOPED `git add` of ONLY that
#                    segment dir (never `git add -A` / `.`), then a commit
#                    and a best-effort `git push`. Commit/push failures warn
#                    loudly on stderr (a failed push additionally drops an
#                    `archive-push-FAILED` marker file in the archived
#                    worker dir) but NEVER abort teardown — copying-but-
#                    never-committing was a root cause of S472's silent
#                    archival stall. Only engages when the archive target
#                    resolves inside the KH_PRIVATE_DOCS_DIR checkout; a
#                    custom --archive <dir> elsewhere is left as a plain
#                    file copy (unchanged from prior behaviour).
#
#                    ARCHIVE IS THE DEFAULT (an opt-in archive silently lost
#                    worker corpus on teardown). When neither --archive nor
#                    --no-archive is given, the corpus is archived to a DERIVED
#                    default dir (see --no-archive). Pass --archive <dir> to
#                    override the target.
#   --no-archive     Opt OUT of the default archive (the prior opt-in teardown
#                    behaviour). Use for throwaway / experimental workers whose
#                    corpus is not worth preserving.
#
#                    At archive time the per-worker token roll-up
#                    (lib/workflow-evaluation/token-rollup.ts) is invoked over
#                    meta.json.session_id and writes token_usage_by_role +
#                    token_usage_total into the ARCHIVED final_report.yaml. This
#                    runs at archive time (not at evaluator run-time) because the
#                    session transcript is uncommitted + retention-windowed.
#                    Worker-level attribution today =
#                    token_usage_by_role:{sub_orchestrator:{...}}; child-role
#                    (Executor/Checker) attribution is a v2 follow-up (needs the
#                    deeper child agent-<hash>/sidechain transcripts).

USAGE="Usage: stop-worker.sh <worker-name> <session-id> [--force] [--delete-branch] [--archive <dir>] [--no-archive]"
WORKER_NAME="${1:?$USAGE}"
SESSION_ID="${2:?$USAGE}"
shift 2

FORCE=0
DELETE_BRANCH=0
FORCE_DELETE_BRANCH=0
# Archive is the DEFAULT: ARCHIVE=1 unless --no-archive is passed.
# ARCHIVE_DIR empty + ARCHIVE=1 => derive a default target from meta.json (see
# the archive block below). An explicit --archive <dir> sets ARCHIVE_DIR.
ARCHIVE=1
ARCHIVE_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    --delete-branch)
      DELETE_BRANCH=1
      shift
      ;;
    --delete-branch-force)
      DELETE_BRANCH=1
      FORCE_DELETE_BRANCH=1
      shift
      ;;
    --archive)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "Error: --archive requires a directory argument" >&2
        echo "$USAGE" >&2
        exit 2
      fi
      ARCHIVE=1
      ARCHIVE_DIR="$2"
      shift 2
      ;;
    --no-archive)
      ARCHIVE=0
      shift
      ;;
    *)
      echo "Error: unknown flag '$1'" >&2
      echo "$USAGE" >&2
      exit 2
      ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH." >&2
  exit 1
fi

# Resolve the MAIN working-tree root even when CWD is inside a linked worktree.
# --git-common-dir points at <main>/.git for every linked worktree; its parent
# is the canonical main root. Falls back to --show-toplevel then pwd.
resolve_project_root() {
  local common_dir
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" \
    || { git rev-parse --show-toplevel 2>/dev/null || pwd -P; return; }
  case "$common_dir" in
    /*) ;;                                   # absolute
    *) common_dir="$(pwd -P)/$common_dir" ;; # relative -> absolutise
  esac
  ( cd "$(dirname "$common_dir")" && pwd -P )
}
PROJECT_ROOT="$(resolve_project_root)"
EVENTS_BASE="${KH_CMUX_EVENTS_DIR:-${PROJECT_ROOT}/.claude/cmux-events}"
EVENTS_DIR="${EVENTS_BASE}/${SESSION_ID}"
META_FILE="${EVENTS_DIR}/meta.json"
EVENT_FILE="${EVENTS_DIR}/events.jsonl"

if [ ! -f "$META_FILE" ]; then
  echo "Warning: no meta file for session $SESSION_ID at $META_FILE — cleanup may be incomplete." >&2
fi

WORKTREE_PATH=""
WS_REF=""
BRANCH_NAME=""
if [ -f "$META_FILE" ]; then
  WORKTREE_PATH=$(jq -r '.cwd // empty' "$META_FILE")
  WS_REF=$(jq -r '.cmux_workspace // empty' "$META_FILE")
  BRANCH_NAME=$(jq -r '.branch // empty' "$META_FILE")
fi

# --- Fallback resolution when meta is missing or partial (FX-1 sub-issue 3) ---
#
# Re-run scenarios (e.g. operator retried after exit 2) may have a torn or
# missing meta file. Fall back to launch-worker.sh naming conventions:
#   * Worktree: <project-root>/.claude/worktrees/<worker-name>
#   * Branch:   resolved via `git worktree list --porcelain` lookup by path
# These derivations let --delete-branch succeed without a manual --branch arg.

if [ -z "$WORKTREE_PATH" ]; then
  CANDIDATE_PATH="${PROJECT_ROOT}/.claude/worktrees/${WORKER_NAME}"
  if [ -d "$CANDIDATE_PATH" ]; then
    WORKTREE_PATH="$CANDIDATE_PATH"
  fi
fi

if [ -z "$BRANCH_NAME" ] && [ -n "$WORKTREE_PATH" ]; then
  BRANCH_NAME=$(git -C "$PROJECT_ROOT" worktree list --porcelain 2>/dev/null \
    | awk -v p="$WORKTREE_PATH" '
        $1=="worktree" { wt=$2 }
        $1=="branch" && wt==p { sub(/^refs\/heads\//,"",$2); print $2; exit }
      ' || true)
fi

# --- Resolve and send /exit to cmux workspace ---
#
# Workspace ref comes from the meta file recorded at launch — cmux titles
# drift to track the currently-running command, so a grep-based lookup is
# unreliable. If the meta is gone or empty, fall back to a JSON title
# scan that excludes the current workspace.

if command -v cmux >/dev/null 2>&1; then
  if [ -z "$WS_REF" ]; then
    WS_REF=$(cmux --json list-workspaces 2>/dev/null \
      | jq -r --arg name "$WORKER_NAME" \
        '[.workspaces[]? | select(.selected != true and .title == $name) | .ref] | first // ""' \
      2>/dev/null || true)
  fi

  if [ -n "$WS_REF" ]; then
    # Send /exit as text body, then Enter as a key event — Claude TUI runs in
    # raw mode and a bare "\n" byte does not register as Return. Stdout/stderr
    # suppressed so the wrapper's stdout stays clean for pipeline callers.
    cmux send --workspace "$WS_REF" "/exit" >/dev/null 2>&1 || true
    cmux send-key --workspace "$WS_REF" enter >/dev/null 2>&1 || true

    # Poll the event file for session_end (avoids upstream path dependency)
    DEADLINE=$((SECONDS + 10))
    while [ "$SECONDS" -lt "$DEADLINE" ]; do
      if [ -f "$EVENT_FILE" ] && jq -e 'select(.event == "session_end")' < "$EVENT_FILE" >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done

    sleep 1
  else
    echo "Note: cmux workspace for worker '$WORKER_NAME' not found (already closed?)." >&2
  fi
else
  echo "Warning: cmux CLI not available — skipping workspace cleanup." >&2
fi

# --- SAFETY GATE: verify worktree is clean BEFORE workspace close (FX-1 sub-issue 2) ---
#
# Moved BEFORE the cmux close-workspace call so exit-2 dirty-tree failures
# leave the cmux workspace alive — operator can re-attach, inspect, and
# either commit work or re-run with --force.

if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
  # Check for uncommitted changes (staged, unstaged, or untracked)
  DIRTY=0
  if ! git -C "$WORKTREE_PATH" diff --quiet 2>/dev/null; then
    DIRTY=1
  fi
  if ! git -C "$WORKTREE_PATH" diff --cached --quiet 2>/dev/null; then
    DIRTY=1
  fi
  # Untracked files — carve out .cmux-brief.md (FX-1 sub-issue 1: script-managed
  # artefact placed by launch-worker.sh --brief, never worker output).
  UNTRACKED=$(git -C "$WORKTREE_PATH" ls-files --others --exclude-standard 2>/dev/null \
    | grep -Fvx '.cmux-brief.md' || true)
  if [ -n "$UNTRACKED" ]; then
    DIRTY=1
  fi

  if [ "$DIRTY" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    echo "Error: worktree at $WORKTREE_PATH has uncommitted changes." >&2
    echo "       This usually means the worker exited before its final git commit." >&2
    echo "       Inspect with:  git -C $WORKTREE_PATH status" >&2
    echo "       cmux workspace remains open — re-attach to inspect or commit." >&2
    echo "       To force removal anyway (DATA LOSS), re-run with --force." >&2
    exit 2
  fi
fi

# --- Close cmux workspace (only after dirty-tree clean OR --force) ---

if command -v cmux >/dev/null 2>&1 && [ -n "$WS_REF" ]; then
  # Confirm the workspace still exists before close (it may have exited cleanly)
  if cmux --json list-workspaces 2>/dev/null \
     | jq -e --arg ref "$WS_REF" '.workspaces[]? | select(.ref == $ref)' \
       >/dev/null 2>&1; then
    cmux close-workspace --workspace "$WS_REF" >/dev/null 2>&1 || true
  fi
fi

# --- Remove the git worktree ---
#
# Auto-delete the script-managed `.cmux-brief.md` artefact before invoking
# `git worktree remove` (FX-1 sub-issue 1 follow-up, S62C WP4 verification):
# the in-script dirty-tree check carves out `.cmux-brief.md`, but
# `git worktree remove` itself ALSO refuses dirty trees. Without this
# pre-delete, worktree-remove fails post-clean-exit with "contains modified
# or untracked files" even though stop-worker.sh's dirty-check passed.

if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
  if [ -f "${WORKTREE_PATH}/.cmux-brief.md" ]; then
    rm -f "${WORKTREE_PATH}/.cmux-brief.md"
  fi

  REMOVE_ARGS=()
  if [ "$FORCE" -eq 1 ]; then
    REMOVE_ARGS+=("--force")
  fi
  if ! git -C "$PROJECT_ROOT" worktree remove "${REMOVE_ARGS[@]+"${REMOVE_ARGS[@]}"}" "$WORKTREE_PATH" 2>/dev/null; then
    echo "Warning: git worktree remove failed for $WORKTREE_PATH (may already be gone)." >&2
  fi
fi

# --- Optional: delete the worker branch ---
#
# Off by default — parent orchestrator usually wants the branch alive long
# enough to cherry-pick / merge. With --delete-branch the caller asserts
# the branch is no longer needed (work landed elsewhere or being discarded).
# BRANCH_NAME may have been resolved from meta OR via the worktree-list
# fallback at script-start (FX-1 sub-issue 3).

if [ "$DELETE_BRANCH" -eq 1 ]; then
  if [ -z "$BRANCH_NAME" ]; then
    echo "Warning: --delete-branch requested but no branch resolvable (meta missing and worktree list lookup empty) — skipping." >&2
  elif ! git -C "$PROJECT_ROOT" show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
    echo "Note: branch '$BRANCH_NAME' already gone — nothing to delete." >&2
  else
    # P1 SAFETY — guard the default --delete-branch path:
    # gate the default delete on an explicit unmerged-commit pre-check so a
    # clean stop can never silently destroy worker SHAs that were never
    # cherry-picked / merged. `git cherry <ref> <branch>` flags commits absent
    # (by patch-id) from the integration ref with '+'. --delete-branch-force
    # bypasses the gate for a deliberate discard.
    DO_DELETE=1
    if [ "$FORCE_DELETE_BRANCH" -eq 0 ]; then
      INTEGRATION_REF="${KH_CMUX_INTEGRATION_REF:-main}"
      if git -C "$PROJECT_ROOT" show-ref --verify --quiet "refs/heads/${INTEGRATION_REF}"; then
        UNMERGED=$(git -C "$PROJECT_ROOT" cherry "$INTEGRATION_REF" "$BRANCH_NAME" 2>/dev/null | grep '^+' || true)
      else
        UNMERGED="(integration ref '$INTEGRATION_REF' not found — cannot verify merge state)"
      fi
      if [ -n "$UNMERGED" ]; then
        DO_DELETE=0
        echo "Refusing to delete '$BRANCH_NAME': it has commits not in '$INTEGRATION_REF' — cherry-pick/merge first, or pass --delete-branch-force to discard:" >&2
        printf '%s\n' "$UNMERGED" | sed 's/^/  /' >&2
      fi
    fi
    if [ "$DO_DELETE" -eq 1 ]; then
      if ! git -C "$PROJECT_ROOT" branch -D "$BRANCH_NAME" >/dev/null 2>&1; then
        echo "Warning: git branch -D '$BRANCH_NAME' failed (may have unmerged commits not reachable from any other ref)." >&2
      fi
    fi
  fi
fi

# --- Archive worker corpus BEFORE teardown ---
#
# Archive is the DEFAULT teardown behaviour. When ARCHIVE=1 (i.e. --no-archive
# was NOT passed) we copy the 4 canonical artefacts the evaluator data layer
# depends on into <archive-dir>/<worker-name>/ before the teardown rm -rf
# destroys them. Best-effort: any missing file is logged + skipped (workers that
# do not emit all four — e.g. an early-failure worker with no final_report.yaml
# — still archive what they did produce).
#
# Default dir derivation (when no explicit --archive <dir> is given):
#   base    = ${KH_PRIVATE_DOCS_DIR}/src/content/docs/workflow-evaluation/sessions/
#   segment = meta.json.session_number (e.g. "S282") if present,
#             else "S<session_number>" stripped of any leading S,
#             else a "session-<SESSION_ID>" fallback so the corpus is never lost.
# We derive a sensible default so a bare `stop-worker.sh <name> <sid>` still
# preserves the corpus, rather than silently dropping it.
#
# The session corpus lives in the PRIVATE docs-site repo. The default base
# resolves via the standing bridge knob KH_PRIVATE_DOCS_DIR and FAILS LOUDLY
# when unset (no silent fallback to the in-repo docs/ tree).
# Pass --archive <dir> to override, or --no-archive to skip archiving.

if [ "$ARCHIVE" -eq 1 ] && [ -d "$EVENTS_DIR" ]; then
  # Resolve the archive base/segment when --archive <dir> was not supplied.
  if [ -z "$ARCHIVE_DIR" ]; then
    ARCHIVE_BASE="${KH_PRIVATE_DOCS_DIR:?KH_PRIVATE_DOCS_DIR not set — point it at the knowledge-hub-docs-site checkout (sibling clone locally; GitHub-App token checkout in CI)}/src/content/docs/workflow-evaluation/sessions"
    SESSION_SEGMENT=""
    if [ -f "$META_FILE" ]; then
      # Prefer an explicit session-number field; tolerate either a bare number
      # ("282") or an already-prefixed value ("S282").
      RAW_SEGMENT=$(jq -r '.session_number // .session // empty' "$META_FILE" 2>/dev/null || true)
      if [ -n "$RAW_SEGMENT" ] && [ "$RAW_SEGMENT" != "null" ]; then
        case "$RAW_SEGMENT" in
          S*) SESSION_SEGMENT="$RAW_SEGMENT" ;;
          *) SESSION_SEGMENT="S${RAW_SEGMENT}" ;;
        esac
      fi
    fi
    if [ -z "$SESSION_SEGMENT" ]; then
      # Fallback: no session-number field — key off the session id so the
      # corpus still lands somewhere deterministic + recoverable.
      SESSION_SEGMENT="session-${SESSION_ID}"
    fi
    ARCHIVE_DIR="${ARCHIVE_BASE}/${SESSION_SEGMENT}"
  fi

  ARCHIVE_TARGET="${ARCHIVE_DIR%/}/${WORKER_NAME}"
  if ! mkdir -p "$ARCHIVE_TARGET" 2>/dev/null; then
    echo "Warning: archive failed to create $ARCHIVE_TARGET — skipping archive step." >&2
  else
    for ARTEFACT in events.jsonl oq-pending.md final_report.yaml meta.json; do
      SRC="${EVENTS_DIR}/${ARTEFACT}"
      if [ -f "$SRC" ]; then
        if ! cp "$SRC" "${ARCHIVE_TARGET}/${ARTEFACT}" 2>/dev/null; then
          echo "Warning: archive failed to copy $ARTEFACT to $ARCHIVE_TARGET." >&2
        fi
      else
        echo "Note: archive skipped absent artefact $ARTEFACT (worker did not emit it)." >&2
      fi
    done

    # --- Token roll-up into the ARCHIVED final_report.yaml ---
    #
    # Join meta.json.session_id -> the worker's Claude Code session transcript
    # and sum the real message.usage per assistant turn, then patch
    # token_usage_by_role + token_usage_total into the just-copied
    # final_report.yaml. MUST run here (archive time), not at evaluator run-time:
    # transcripts are uncommitted + retention-windowed. A missing/purged
    # transcript yields a null role entry + a token_usage_note (the rollup util
    # never throws), so teardown is never blocked. The rollup binds YAML I/O in
    # TS so this shell never hand-edits YAML.
    ARCHIVED_REPORT="${ARCHIVE_TARGET}/final_report.yaml"
    ROLLUP_SCRIPT="${PROJECT_ROOT}/lib/workflow-evaluation/token-rollup.ts"
    ROLLUP_SESSION_ID=""
    if [ -f "$META_FILE" ]; then
      ROLLUP_SESSION_ID=$(jq -r '.session_id // empty' "$META_FILE" 2>/dev/null || true)
    fi
    # Fall back to the positional SESSION_ID arg when meta omits session_id.
    if [ -z "$ROLLUP_SESSION_ID" ] || [ "$ROLLUP_SESSION_ID" = "null" ]; then
      ROLLUP_SESSION_ID="$SESSION_ID"
    fi
    if [ -f "$ARCHIVED_REPORT" ] && [ -f "$ROLLUP_SCRIPT" ] && command -v bun >/dev/null 2>&1; then
      if ! bun run "$ROLLUP_SCRIPT" \
        --session-id "$ROLLUP_SESSION_ID" \
        --report "$ARCHIVED_REPORT" \
        --role sub_orchestrator >/dev/null 2>&1; then
        echo "Warning: token roll-up failed for session $ROLLUP_SESSION_ID — final_report.yaml left without token totals." >&2
      fi
    elif [ -f "$ARCHIVED_REPORT" ]; then
      echo "Note: skipped token roll-up (bun or token-rollup.ts unavailable) — final_report.yaml left without token totals." >&2
    fi

    # --- Auto-commit + push the archived session segment (OQ-2A, ID-150.1) ---
    #
    # Copying into the docs-site working tree is not enough — S472 found
    # archived corpus sitting uncommitted for days because nothing ran
    # `git commit` in the docs-site checkout. Commit + push the SESSION
    # SEGMENT dir just written (may hold multiple workers' subdirs for the
    # same session) so the corpus survives without a manual step.
    #
    # RATIFIED constraints (OQ-2A):
    #   - SCOPED `git add` of ONLY the archived session segment dir under
    #     workflow-evaluation/sessions/ — NEVER `git add -A` / `git add .`
    #     (the docs-site checkout has PARALLEL WRITERS; other lanes'
    #     uncommitted work must never be swept in).
    #   - Commit failure warns loud (stderr) but never aborts teardown.
    #   - Push is fail-open: failure warns loud AND drops an
    #     `archive-push-FAILED` marker in the archived worker dir, but
    #     NEVER aborts teardown (worker teardown must complete regardless).
    #   - No-op guard: nothing newly staged (e.g. a re-run over an
    #     already-committed archive) => skip cleanly, no empty commit.
    #
    # Only engages when the archive target actually lives inside the
    # KH_PRIVATE_DOCS_DIR git checkout (the default-derivation case, or an
    # explicit --archive <dir> that still points inside it). A custom
    # --archive <dir> elsewhere (test fixtures, a non-git target) is left
    # as a plain file copy — same behaviour as before this change.
    if [ -n "${KH_PRIVATE_DOCS_DIR:-}" ]; then
      case "$ARCHIVE_DIR" in
        "${KH_PRIVATE_DOCS_DIR%/}"/*)
          REL_SEGMENT_PATH="${ARCHIVE_DIR#"${KH_PRIVATE_DOCS_DIR%/}"/}"
          SEGMENT_NAME="${ARCHIVE_DIR%/}"
          SEGMENT_NAME="${SEGMENT_NAME##*/}"
          if ! git -C "$KH_PRIVATE_DOCS_DIR" rev-parse --git-dir >/dev/null 2>&1; then
            echo "Note: KH_PRIVATE_DOCS_DIR ('$KH_PRIVATE_DOCS_DIR') is not a git checkout — skipping archive auto-commit." >&2
          elif ! git -C "$KH_PRIVATE_DOCS_DIR" add -- "$REL_SEGMENT_PATH" 2>/dev/null; then
            echo "Warning: git add failed for '$REL_SEGMENT_PATH' in the docs-site checkout — corpus is copied but not staged/committed." >&2
          elif git -C "$KH_PRIVATE_DOCS_DIR" diff --cached --quiet -- "$REL_SEGMENT_PATH" 2>/dev/null; then
            : # No-op guard: nothing newly staged (already committed) — nothing to commit.
          else
            COMMIT_MSG="chore(workflow-eval): archive session ${SEGMENT_NAME} (${WORKER_NAME})"
            if git -C "$KH_PRIVATE_DOCS_DIR" commit -q -m "$COMMIT_MSG" -- "$REL_SEGMENT_PATH" >/dev/null 2>&1; then
              if ! git -C "$KH_PRIVATE_DOCS_DIR" push >/dev/null 2>&1; then
                echo "Warning: archive commit for '$REL_SEGMENT_PATH' committed locally but PUSH FAILED — push manually from the docs-site checkout." >&2
                touch "${ARCHIVE_TARGET}/archive-push-FAILED" 2>/dev/null || true
              fi
            else
              echo "Warning: archive commit failed for '$REL_SEGMENT_PATH' — corpus is copied but not committed in the docs-site checkout. Commit manually." >&2
            fi
          fi
          ;;
        *)
          echo "Note: archive target '$ARCHIVE_DIR' is outside KH_PRIVATE_DOCS_DIR — skipping archive auto-commit (custom --archive target)." >&2
          ;;
      esac
    fi
  fi
fi

# --- Clean up events directory ---

if [ -d "$EVENTS_DIR" ]; then
  rm -rf "$EVENTS_DIR"
fi

echo "Worker $WORKER_NAME ($SESSION_ID) stopped and cleaned up"
