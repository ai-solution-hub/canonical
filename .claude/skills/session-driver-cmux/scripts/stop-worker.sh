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
#
# Usage: stop-worker.sh <worker-name> <session-id> [--force]

WORKER_NAME="${1:?Usage: stop-worker.sh <worker-name> <session-id> [--force]}"
SESSION_ID="${2:?Usage: stop-worker.sh <worker-name> <session-id> [--force]}"
FORCE=0
if [ "${3:-}" = "--force" ]; then
  FORCE=1
fi

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
if [ -f "$META_FILE" ]; then
  WORKTREE_PATH=$(jq -r '.cwd // empty' "$META_FILE")
fi

# --- Resolve and exit cmux workspace ---

if command -v cmux >/dev/null 2>&1; then
  WS_REF=$(cmux list-workspaces 2>/dev/null | grep -F "$WORKER_NAME" | grep -oE 'workspace:[0-9]+' | head -1 || true)

  if [ -n "$WS_REF" ]; then
    cmux send --workspace "$WS_REF" "/exit\n" 2>/dev/null || true

    # Poll the event file for session_end (avoids upstream path dependency)
    DEADLINE=$((SECONDS + 10))
    while [ "$SECONDS" -lt "$DEADLINE" ]; do
      if [ -f "$EVENT_FILE" ] && jq -e 'select(.event == "session_end")' < "$EVENT_FILE" >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done

    sleep 1

    WS_CHECK=$(cmux list-workspaces 2>/dev/null | grep -F "$WORKER_NAME" | grep -oE 'workspace:[0-9]+' | head -1 || true)
    if [ -n "$WS_CHECK" ]; then
      cmux close-workspace --workspace "$WS_CHECK" 2>/dev/null || true
    fi
  else
    echo "Note: cmux workspace '$WORKER_NAME' not found (already closed?)." >&2
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

# --- Clean up events directory ---

if [ -d "$EVENTS_DIR" ]; then
  rm -rf "$EVENTS_DIR"
fi

echo "Worker $WORKER_NAME ($SESSION_ID) stopped and cleaned up"
