#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: stop a worker gracefully.
#
# 1. Send /exit to the cmux workspace.
# 2. Wait up to 10s for session_end.
# 3. Close the cmux workspace if it's still open.
# 4. SAFETY: run `git status` inside the worker's worktree. If there are
#    uncommitted changes, abort with an error and leave the worktree intact
#    (CLAUDE.md: "Sub-agents can blow their token budget before final
#    git commit"). Pass --force to remove anyway.
# 5. Remove the git worktree.
# 6. Delete the events directory.
# 7. Optionally delete the worker branch (--delete-branch).
#
# Usage: stop-worker.sh <worker-name> <session-id> [--force] [--delete-branch]
#
# Flags:
#   --force          Remove the worktree even if it has uncommitted changes
#                    (DATA LOSS — only use after the worker has cherry-picked
#                    or merged its commits elsewhere).
#   --delete-branch  After worktree removal, delete the worker branch
#                    (cmux-worker-<name>-<sha>) recorded in the meta file.
#                    Default: branch retained, parent orchestrator owns its
#                    lifecycle. Pass once cherry-pick / merge is confirmed.

USAGE="Usage: stop-worker.sh <worker-name> <session-id> [--force] [--delete-branch]"
WORKER_NAME="${1:?$USAGE}"
SESSION_ID="${2:?$USAGE}"
shift 2

FORCE=0
DELETE_BRANCH=0
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

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
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

# --- Resolve and exit cmux workspace ---
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

    # Confirm the workspace still exists before close (it may have exited cleanly)
    if cmux --json list-workspaces 2>/dev/null \
       | jq -e --arg ref "$WS_REF" '.workspaces[]? | select(.ref == $ref)' \
         >/dev/null 2>&1; then
      cmux close-workspace --workspace "$WS_REF" >/dev/null 2>&1 || true
    fi
  else
    echo "Note: cmux workspace for worker '$WORKER_NAME' not found (already closed?)." >&2
  fi
else
  echo "Warning: cmux CLI not available — skipping workspace cleanup." >&2
fi

# --- SAFETY GATE: verify worktree is clean before removal ---

if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
  # Check for uncommitted changes (staged, unstaged, or untracked)
  DIRTY=0
  if ! git -C "$WORKTREE_PATH" diff --quiet 2>/dev/null; then
    DIRTY=1
  fi
  if ! git -C "$WORKTREE_PATH" diff --cached --quiet 2>/dev/null; then
    DIRTY=1
  fi
  # Untracked files
  if [ -n "$(git -C "$WORKTREE_PATH" ls-files --others --exclude-standard 2>/dev/null)" ]; then
    DIRTY=1
  fi

  if [ "$DIRTY" -eq 1 ] && [ "$FORCE" -ne 1 ]; then
    echo "Error: worktree at $WORKTREE_PATH has uncommitted changes." >&2
    echo "       This usually means the worker exited before its final git commit." >&2
    echo "       Inspect with:  git -C $WORKTREE_PATH status" >&2
    echo "       To force removal anyway (DATA LOSS), re-run with --force." >&2
    exit 2
  fi

  # Remove the worktree (use --force for dirty when caller opted in)
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

if [ "$DELETE_BRANCH" -eq 1 ]; then
  if [ -z "$BRANCH_NAME" ]; then
    echo "Warning: --delete-branch requested but no branch recorded in meta — skipping." >&2
  elif ! git -C "$PROJECT_ROOT" show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
    echo "Note: branch '$BRANCH_NAME' already gone — nothing to delete." >&2
  else
    if ! git -C "$PROJECT_ROOT" branch -D "$BRANCH_NAME" >/dev/null 2>&1; then
      echo "Warning: git branch -D '$BRANCH_NAME' failed (may have unmerged commits not reachable from any other ref)." >&2
    fi
  fi
fi

# --- Clean up events directory ---

if [ -d "$EVENTS_DIR" ]; then
  rm -rf "$EVENTS_DIR"
fi

echo "Worker $WORKER_NAME ($SESSION_ID) stopped and cleaned up"
