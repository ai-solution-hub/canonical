#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: launch a Claude Code worker.
#
# Creates a git worktree under <project-root>/.claude/worktrees/<worker-name>,
# opens a cmux workspace, and launches claude inside it with the
# upstream session-driver plugin loaded (for hook injection). Events are
# emitted to <project-root>/.claude/cmux-events/<session-id>/events.jsonl.
#
# Adapted from ~/.claude/session-driver-cmux/launch-worker.sh (Liam's
# cmux adaptation of superpowers/claude-session-driver 1.0.1).
#
# Usage:
#   launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [extra claude args...]
#
# Arguments:
#   <worker-name>  Unique cmux workspace name (e.g. "worker-api").
#   <base-dir>     Project root (use ".") — used to anchor worktree and
#                  events directory paths.
#   --branch <ref> Optional ref to branch from. Defaults to current HEAD.
#
# Exits non-zero with a message on cmux unavailability, name collision, or
# session_start timeout.

WORKER_NAME="${1:?Usage: launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [extra args]}"
BASE_DIR="${2:?Usage: launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [extra args]}"
shift 2

# Parse optional --branch flag
BRANCH_REF=""
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --branch)
      BRANCH_REF="${2:?--branch requires a ref argument}"
      shift 2
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

# --- Validate environment ---

if ! command -v cmux >/dev/null 2>&1; then
  echo "Error: cmux CLI not found on PATH. Install cmux before launching workers." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH (required for event serialisation)." >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: claude CLI not found on PATH." >&2
  exit 1
fi

# Probe cmux daemon — list-workspaces fails fast if no daemon
if ! cmux list-workspaces >/dev/null 2>&1; then
  echo "Error: cmux daemon not reachable (cmux list-workspaces failed)." >&2
  exit 1
fi

# Resolve the upstream plugin directory — Claude loads its hooks
UPSTREAM_PLUGIN="${KH_CMUX_UPSTREAM_PLUGIN:-$HOME/.claude/plugins/cache/superpowers-marketplace/claude-session-driver/1.0.1}"
if [ ! -d "$UPSTREAM_PLUGIN" ]; then
  echo "Error: upstream session-driver plugin not found at $UPSTREAM_PLUGIN" >&2
  echo "       Override with KH_CMUX_UPSTREAM_PLUGIN=<path>." >&2
  exit 1
fi

# Resolve project root from base dir (absolute physical path)
PROJECT_ROOT="$(cd "$BASE_DIR" && pwd -P)"

# Verify project is a git repo
if ! git -C "$PROJECT_ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Error: $PROJECT_ROOT is not inside a git repository." >&2
  exit 1
fi

# --- Set up paths ---

EVENTS_BASE="${PROJECT_ROOT}/.claude/cmux-events"
WORKTREE_BASE="${PROJECT_ROOT}/.claude/worktrees"

SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

EVENTS_DIR="${EVENTS_BASE}/${SESSION_ID}"
META_FILE="${EVENTS_DIR}/meta.json"

mkdir -p "$EVENTS_DIR"
mkdir -p "$WORKTREE_BASE"

# --- Check for cmux workspace name collision ---
#
# cmux auto-updates workspace titles to the currently-running command line,
# which would cause `grep WORKER_NAME` against the human-readable output to
# false-positive (the launch command itself contains WORKER_NAME). Use the
# structured JSON output, filter out the current workspace (it cannot be a
# collision by definition), and require an exact title match.

if cmux --json list-workspaces 2>/dev/null \
   | jq -e --arg name "$WORKER_NAME" \
     '.workspaces[]? | select(.selected != true and .title == $name)' \
     >/dev/null 2>&1; then
  echo "Error: cmux workspace '$WORKER_NAME' already exists" >&2
  rm -rf "$EVENTS_DIR"
  exit 1
fi

# --- Create git worktree ---

WORKTREE_PATH="${WORKTREE_BASE}/${WORKER_NAME}"
if [ -e "$WORKTREE_PATH" ]; then
  echo "Error: worktree path '$WORKTREE_PATH' already exists" >&2
  rm -rf "$EVENTS_DIR"
  exit 1
fi

# Derive branch name. Strategy: cmux-worker-<worker>-<short-sha-of-base>.
BASE_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)
BRANCH_NAME="cmux-worker-${WORKER_NAME}-${BASE_SHA}"

if [ -n "$BRANCH_REF" ]; then
  if ! git -C "$PROJECT_ROOT" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BRANCH_REF" >/dev/null 2>&1; then
    echo "Error: failed to create worktree from ref '$BRANCH_REF'" >&2
    rm -rf "$EVENTS_DIR"
    exit 1
  fi
else
  if ! git -C "$PROJECT_ROOT" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" >/dev/null 2>&1; then
    echo "Error: failed to create worktree at $WORKTREE_PATH" >&2
    rm -rf "$EVENTS_DIR"
    exit 1
  fi
fi

# --- Write meta file (hooks consult this to recognise managed sessions) ---

jq -n \
  --arg worker_name "$WORKER_NAME" \
  --arg session_id "$SESSION_ID" \
  --arg cwd "$WORKTREE_PATH" \
  --arg project_root "$PROJECT_ROOT" \
  --arg branch "$BRANCH_NAME" \
  --arg started_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{worker_name: $worker_name, session_id: $session_id, cwd: $cwd, project_root: $project_root, branch: $branch, started_at: $started_at}' \
  > "$META_FILE"

# --- Create cmux workspace ---

APPROVAL_TIMEOUT="${CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT:-30}"

# Capture workspace list before creation so we can identify the new one
BEFORE=$(cmux list-workspaces 2>/dev/null | grep -oE 'workspace:[0-9]+' | sort)

if ! WS_OUTPUT=$(cmux new-workspace 2>&1); then
  echo "Error: cmux new-workspace failed: $WS_OUTPUT" >&2
  git -C "$PROJECT_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  rm -rf "$EVENTS_DIR"
  exit 1
fi

if ! echo "$WS_OUTPUT" | grep -q '^OK'; then
  echo "Error: cmux new-workspace returned unexpected output: $WS_OUTPUT" >&2
  git -C "$PROJECT_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  rm -rf "$EVENTS_DIR"
  exit 1
fi

AFTER=$(cmux list-workspaces 2>/dev/null | grep -oE 'workspace:[0-9]+' | sort)
WS_REF=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") | head -1)

if [ -z "$WS_REF" ]; then
  echo "Error: could not identify newly-created cmux workspace" >&2
  git -C "$PROJECT_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  rm -rf "$EVENTS_DIR"
  exit 1
fi

cmux rename-workspace --workspace "$WS_REF" "$WORKER_NAME" 2>/dev/null || true

# --- Build the launch command ---

# Note: --plugin-dir loads the upstream plugin, but our KH-adapted hooks live
# beside this script. We export KH_CMUX_EVENTS_DIR so the upstream hooks (if
# we ever swap back) read the right base; but we prefer our local hooks by
# pointing --plugin-dir at the local skill dir.
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"

CLAUDE_CMD="cd ${WORKTREE_PATH} && KH_CMUX_EVENTS_DIR=${EVENTS_BASE} CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT=${APPROVAL_TIMEOUT} claude --session-id ${SESSION_ID} --plugin-dir ${SKILL_DIR} --dangerously-skip-permissions"

# Append extra args, quoted
for arg in "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"; do
  CLAUDE_CMD="${CLAUDE_CMD} '${arg}'"
done

# Send the launch command (\n = Enter to cmux)
cmux send --workspace "$WS_REF" "${CLAUDE_CMD}\n"

# Accept the workspace trust dialog if cmux shows one
sleep 3
cmux send --workspace "$WS_REF" "\n"

# Update meta with the cmux ref for later lookups
jq --arg ws_ref "$WS_REF" '. + {cmux_workspace: $ws_ref}' \
  "$META_FILE" > "${META_FILE}.tmp" && mv "${META_FILE}.tmp" "$META_FILE"

# Wait for session_start event — use upstream wait-for-event.sh with KH dir override
UPSTREAM_WAIT="${UPSTREAM_PLUGIN}/scripts/wait-for-event.sh"

# Upstream wait-for-event.sh polls /tmp/claude-workers/<id>.events.jsonl. We
# need it to poll <events-base>/<id>/events.jsonl. Cleanest fix: poll our
# events file directly here without invoking the upstream script.
EVENT_FILE="${EVENTS_DIR}/events.jsonl"
START_DEADLINE=$((SECONDS + 30))
SESSION_STARTED=0
while [ "$SECONDS" -lt "$START_DEADLINE" ]; do
  if [ -f "$EVENT_FILE" ] && jq -e 'select(.event == "session_start")' < "$EVENT_FILE" >/dev/null 2>&1; then
    SESSION_STARTED=1
    break
  fi
  sleep 0.5
done

if [ "$SESSION_STARTED" -ne 1 ]; then
  echo "Error: worker session failed to start within 30 seconds" >&2
  echo "       (upstream wait helper: $UPSTREAM_WAIT)" >&2
  cmux close-workspace --workspace "$WS_REF" 2>/dev/null || true
  git -C "$PROJECT_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  rm -rf "$EVENTS_DIR"
  exit 1
fi

# --- Output result JSON ---

jq -n \
  --arg session_id "$SESSION_ID" \
  --arg worker_name "$WORKER_NAME" \
  --arg cmux_workspace "$WS_REF" \
  --arg worktree_path "$WORKTREE_PATH" \
  --arg events_file "$EVENT_FILE" \
  --arg events_dir "$EVENTS_DIR" \
  --arg branch "$BRANCH_NAME" \
  '{
    session_id: $session_id,
    worker_name: $worker_name,
    cmux_workspace: $cmux_workspace,
    worktree_path: $worktree_path,
    events_file: $events_file,
    events_dir: $events_dir,
    branch: $branch
  }'
