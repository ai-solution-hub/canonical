#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: launch a Claude Code worker.
#
# Creates a git worktree under <project-root>/.claude/worktrees/<worker-name>,
# opens a cmux workspace, and launches claude inside it loading this skill's
# hooks. Events are emitted to
# <project-root>/.claude/cmux-events/<session-id>/events.jsonl.
#
# Hard-forked from superpowers/claude-session-driver 1.0.1 (cmux transport,
# per-worktree event paths, git-worktree-per-worker). No longer tracks
# upstream — see docs/plans/phase-0-investigation/session-driver-cmux-divergence.md.
#
# Usage:
#   launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [--brief <file>] [extra claude args...]
#
# Arguments:
#   <worker-name>       Unique cmux workspace name (e.g. "worker-api").
#   <base-dir>          Project root (use ".") — anchors worktree + events.
#   --branch <ref>      Optional ref to branch from. Defaults to current HEAD.
#   --brief <file>      Optional path to a brief file. Copied into the worker's
#                       worktree as `.cmux-brief.md` and an auto-prompt
#                       "Read .cmux-brief.md before any work." is sent after
#                       session_start. Mirrors OQ-escalation channel shape.
#
# Side effects beyond the worktree + workspace:
#   - `.worktreeinclude` at the project root, if present, is honoured: every
#     literal file path listed (one per line, '#' comments skipped) is copied
#     into the new worktree if the source exists at the project root. Plain
#     file paths only; no glob expansion. `.env.local` is the canonical case.
#
# Exits non-zero with a message on cmux unavailability, name collision,
# safety-gate failure (worktree path not gitignored), or session_start timeout.

USAGE="Usage: launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [--brief <file>] [extra args]"
WORKER_NAME="${1:?$USAGE}"
BASE_DIR="${2:?$USAGE}"
shift 2

# Parse optional flags
BRANCH_REF=""
BRIEF_FILE=""
GATED=0
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --branch)
      BRANCH_REF="${2:?--branch requires a ref argument}"
      shift 2
      ;;
    --brief)
      BRIEF_FILE="${2:?--brief requires a file path}"
      shift 2
      ;;
    --gated)
      GATED=1
      shift
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

# Validate brief file early (before any side effects)
if [ -n "$BRIEF_FILE" ] && [ ! -f "$BRIEF_FILE" ]; then
  echo "Error: --brief file not found: $BRIEF_FILE" >&2
  exit 1
fi

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

# --- Safety gate: verify worktree + events paths are gitignored ---
#
# Both paths must be gitignored to prevent accidental commits of worker state
# or per-worker scratch into the parent branch. This matches the safety
# contract used by the `using-git-worktrees` skill.

if ! git -C "$PROJECT_ROOT" check-ignore -q "${WORKTREE_BASE}/sentinel" 2>/dev/null; then
  echo "Error: ${WORKTREE_BASE}/ is not gitignored." >&2
  echo "       Add '.claude/worktrees/' to .gitignore before launching workers." >&2
  exit 1
fi
if ! git -C "$PROJECT_ROOT" check-ignore -q "${EVENTS_BASE}/sentinel" 2>/dev/null; then
  echo "Error: ${EVENTS_BASE}/ is not gitignored." >&2
  echo "       Add '.claude/cmux-events/' to .gitignore before launching workers." >&2
  exit 1
fi

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

# --- Pre-flight collision checks (FX-3 ID-28.3 S62C) ---
#
# Distinguish branch-already-exists vs worktree-path-already-exists BEFORE
# the opaque `git worktree add` error. Each shape emits a specific recovery
# hint. When both collide, emit both diagnostics (operator may have a
# stale branch AND a stale worktree from a prior partial cleanup).

WORKTREE_PATH="${WORKTREE_BASE}/${WORKER_NAME}"

# Derive branch name. Strategy: cmux-worker-<worker>-<short-sha-of-base>.
BASE_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)
BRANCH_NAME="cmux-worker-${WORKER_NAME}-${BASE_SHA}"

COLLISION_BRANCH=0
COLLISION_PATH=0

if git -C "$PROJECT_ROOT" rev-parse --verify --quiet "refs/heads/${BRANCH_NAME}" >/dev/null 2>&1; then
  COLLISION_BRANCH=1
fi
if [ -e "$WORKTREE_PATH" ]; then
  COLLISION_PATH=1
fi

if [ "$COLLISION_BRANCH" -eq 1 ] || [ "$COLLISION_PATH" -eq 1 ]; then
  if [ "$COLLISION_BRANCH" -eq 1 ]; then
    echo "Error: branch '${BRANCH_NAME}' already exists." >&2
    echo "       A previous worker may have stopped without --delete-branch." >&2
    echo "       Recover with:  git branch -D ${BRANCH_NAME}" >&2
  fi
  if [ "$COLLISION_PATH" -eq 1 ]; then
    echo "Error: worktree path '${WORKTREE_PATH}' already exists." >&2
    echo "       Recover with:  git worktree remove --force ${WORKTREE_PATH}" >&2
  fi
  rm -rf "$EVENTS_DIR"
  exit 1
fi

# --- Create git worktree ---

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

# --- Honour .worktreeinclude (literal file paths only) ---
#
# Anthropic's `.worktreeinclude` mechanism only triggers under their internal
# worktree-creation paths (`claude --worktree`, Agent-tool isolation, etc.).
# `git worktree add` bypasses it. Mirror minimal semantics here for the
# canonical `.env.local` case: each non-blank non-comment line is treated
# as a literal relative path; if the source exists at PROJECT_ROOT, copy
# into the worker worktree. No glob expansion (kept simple intentionally —
# extend if patterns are needed).

INCLUDE_FILE="${PROJECT_ROOT}/.worktreeinclude"
if [ -f "$INCLUDE_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Strip CR (in case file has CRLF), trim leading/trailing whitespace
    line="${line%$'\r'}"
    line="$(echo "$line" | awk '{$1=$1;print}')"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
    esac
    SRC="${PROJECT_ROOT}/${line}"
    DST="${WORKTREE_PATH}/${line}"
    if [ -e "$SRC" ]; then
      # Ensure destination parent dir exists for nested paths.
      DST_PARENT="$(dirname "$DST")"
      mkdir -p "$DST_PARENT"
      cp -R "$SRC" "$DST" 2>/dev/null || \
        echo "Warning: .worktreeinclude — failed to copy '$line' into worktree." >&2
    fi
  done < "$INCLUDE_FILE"
fi

# --- Copy brief file if provided ---

BRIEF_DEST=""
if [ -n "$BRIEF_FILE" ]; then
  BRIEF_DEST="${WORKTREE_PATH}/.cmux-brief.md"
  if ! cp "$BRIEF_FILE" "$BRIEF_DEST" 2>/dev/null; then
    echo "Error: failed to copy brief file into worktree." >&2
    git -C "$PROJECT_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
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
  --arg brief_path "$BRIEF_DEST" \
  '{worker_name: $worker_name, session_id: $session_id, cwd: $cwd, project_root: $project_root, branch: $branch, started_at: $started_at, brief_path: $brief_path}' \
  > "$META_FILE"

# --- Create cmux workspace ---

# Default: ungated (APPROVAL_TIMEOUT=0) so workers auto-allow tool calls
# immediately (the PreToolUse hook short-circuits after emitting the event) —
# no 30s/tool-call poll tax and no background auto-approver needed. Pass
# --gated to enable orchestrator gating (the hook polls for a tool-decision).
# An explicit CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT env var always wins.
if [ -n "${CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT:-}" ]; then
  APPROVAL_TIMEOUT="$CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT"
elif [ "$GATED" -eq 1 ]; then
  APPROVAL_TIMEOUT=30
else
  APPROVAL_TIMEOUT=0
fi

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

cmux rename-workspace --workspace "$WS_REF" "$WORKER_NAME" >/dev/null 2>&1 || true

# --- Build the launch command ---

# --plugin-dir points at the local KH skill dir so workers load the local
# (per-worktree event-path) hooks rather than the upstream tmux-targeted ones.
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"

CLAUDE_CMD="cd ${WORKTREE_PATH} && KH_CMUX_EVENTS_DIR=${EVENTS_BASE} CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT=${APPROVAL_TIMEOUT} claude --session-id ${SESSION_ID} --plugin-dir ${SKILL_DIR} --dangerously-skip-permissions"

# Append extra args, quoted
for arg in "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"; do
  CLAUDE_CMD="${CLAUDE_CMD} '${arg}'"
done

# Send the launch command (shell context — `\n` works at a shell prompt).
# Stdout/stderr suppressed so launch-worker.sh's own stdout stays JSON-only.
cmux send --workspace "$WS_REF" "${CLAUDE_CMD}" >/dev/null 2>&1
cmux send-key --workspace "$WS_REF" enter >/dev/null 2>&1

# Accept the workspace trust dialog if cmux shows one (Claude TUI is in raw
# mode by this point — use send-key, not a bare "\n" byte).
sleep 3
cmux send-key --workspace "$WS_REF" enter >/dev/null 2>&1

# Update meta with the cmux ref for later lookups
jq --arg ws_ref "$WS_REF" '. + {cmux_workspace: $ws_ref}' \
  "$META_FILE" > "${META_FILE}.tmp" && mv "${META_FILE}.tmp" "$META_FILE"

# Wait for session_start event by polling the KH events file directly. The
# upstream wait-for-event.sh helper polls /tmp/claude-workers/<id>.events.jsonl
# which is the wrong path under KH layout.
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
  cmux close-workspace --workspace "$WS_REF" 2>/dev/null || true
  git -C "$PROJECT_ROOT" worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  rm -rf "$EVENTS_DIR"
  exit 1
fi

# --- Auto-send brief prompt if --brief was provided ---
#
# Worker is now live in the worktree (session_start observed). Sending the
# brief-pointer prompt here means downstream send-prompt.sh calls can assume
# the worker has already read the brief.

if [ -n "$BRIEF_DEST" ]; then
  cmux send --workspace "$WS_REF" "Read .cmux-brief.md before any work." >/dev/null 2>&1 || true
  cmux send-key --workspace "$WS_REF" enter >/dev/null 2>&1 || true
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
  --arg brief_path "$BRIEF_DEST" \
  '{
    session_id: $session_id,
    worker_name: $worker_name,
    cmux_workspace: $cmux_workspace,
    worktree_path: $worktree_path,
    events_file: $events_file,
    events_dir: $events_dir,
    branch: $branch,
    brief_path: $brief_path
  }'
