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
# upstream — see knowledge-hub-archive (sibling checkout) plans/phase-0-investigation/session-driver-cmux-divergence.md.
#
# Usage:
#   launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [--brief <file>] [--symlink-deps] [extra claude args...]
#
# Arguments:
#   <worker-name>       Unique cmux workspace name (e.g. "worker-api").
#   <base-dir>          Project root (use ".") — anchors worktree + events.
#   --branch <ref>      Optional ref to branch from. Defaults to current HEAD.
#   --brief <file>      Optional path to a brief file. Copied into the worker's
#                       worktree as `.cmux-brief.md` and an auto-prompt
#                       "Read .cmux-brief.md before any work." is sent after
#                       session_start. Mirrors OQ-escalation channel shape.
#   --symlink-deps      Opt-in (default OFF). Symlink the parent tree's dependency
#                       dirs (node_modules, .venv, .bin — the list in
#                       .claude/settings.local.json `worktree.symlinkDirectories`)
#                       into the new worktree, so compile/test workers skip a
#                       per-worktree `bun install` / `pip install`. Native
#                       `worktree.symlinkDirectories` is Claude-Code-managed-only
#                       and does NOT apply to raw `git worktree add` (SPIKE-27.10),
#                       hence this manual seed. Only existing parent dirs are
#                       linked; missing ones are skipped non-fatally. The three
#                       names are already gitignored at the parent root (shared
#                       .gitignore), so the symlinks never dirty `git status` and
#                       the stop-worker dirty-tree gate stays green. Env-var
#                       equivalent: set KH_CMUX_SYMLINK_DEPS=1. Default (no flag,
#                       no env) keeps doc/research workers on a clean full checkout.
#
# Side effects beyond the worktree + workspace:
#   - `.worktreeinclude` at the project root, if present, is honoured: every
#     literal file path listed (one per line, '#' comments skipped) is copied
#     into the new worktree if the source exists at the project root. Plain
#     file paths only; no glob expansion. `.env.local` is the canonical case.
#
# Exits non-zero with a message on cmux unavailability, name collision,
# safety-gate failure (worktree path not gitignored), or session_start timeout.

USAGE="Usage: launch-worker.sh <worker-name> <base-dir> [--branch <ref>] [--brief <file>] [--symlink-deps] [extra args]"
WORKER_NAME="${1:?$USAGE}"
BASE_DIR="${2:?$USAGE}"
shift 2

# Parse optional flags
BRANCH_REF=""
BRIEF_FILE=""
GATED=0
# Opt-in dependency symlinking (OQ-27-A / ID-27.12). Default OFF — the env var
# provides a non-flag opt-in for callers that cannot pass argv (e.g. wrappers).
SYMLINK_DEPS="${KH_CMUX_SYMLINK_DEPS:-0}"
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
    --symlink-deps)
      SYMLINK_DEPS=1
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

# EVENTS_BASE honours the KH_CMUX_EVENTS_DIR override for symmetry with the
# monitoring scripts (ID-27.6). PROJECT_ROOT stays anchored to the explicit
# BASE_DIR launch argument — launch-worker is the events WRITER, not a
# CWD-relative reader, so it does not use resolve_project_root().
EVENTS_BASE="${KH_CMUX_EVENTS_DIR:-${PROJECT_ROOT}/.claude/cmux-events}"
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

# --- backlog-190: un-ignore .gitnexus/CLAUDE.md in the shared exclude (ID-27.8) ---
#
# Linked worktrees share $GIT_COMMON_DIR/info/exclude. A bare `.gitnexus/` line
# there UNDOES the `!.gitnexus/CLAUDE.md` negation (re-ignoring the tracked
# directive file). Strip that bare line idempotently, preserving the `/**` +
# negation form. Non-fatal — never abort the launch over this.

GNX_COMMON_DIR="$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$GNX_COMMON_DIR" ]; then
  case "$GNX_COMMON_DIR" in
    /*) ;;                                            # already absolute
    *) GNX_COMMON_DIR="${PROJECT_ROOT}/${GNX_COMMON_DIR}" ;;  # absolutise vs PROJECT_ROOT
  esac
  GNX_EXCLUDE="${GNX_COMMON_DIR}/info/exclude"
  if [ -f "$GNX_EXCLUDE" ] && grep -qxF '.gitnexus/' "$GNX_EXCLUDE"; then
    sed -i.bak '/^\.gitnexus\/$/d' "$GNX_EXCLUDE" 2>/dev/null && rm -f "${GNX_EXCLUDE}.bak"
  fi
fi

# --- Seed the parent's gitnexus index into the worker worktree (ID-27.8) ---
#
# Native worktree.symlinkDirectories / sparsePaths do NOT apply to raw
# `git worktree add` (Claude-Code-managed-only — see SPIKE-27.9). So seed
# manually: symlink the parent's ladybugdb `lbug` + `meta.json` (published via
# atomic rename(2), so the worktree's reads stay consistent — see SPIKE-27.9 §3)
# and register the worktree path. Register-only (no local .gitnexus) FAILS, so
# the symlink is mandatory before `gitnexus index`. Both steps are idempotent
# (`ln -sfn` + re-`index`) and NON-FATAL: on any missing-file/error the worker
# falls back to today's "stale (never)" behaviour — never abort the launch.
# Bare `gitnexus` calls assume a SINGLE knowledge-hub registry entry (OQ-5
# re-verified resolved 29/05/2026 — exactly one entry; do NOT add a de-dup step).
# Workers should treat the shared index READ-ONLY (reanalysis stays the parent
# orchestrator's job — a worker `gitnexus analyze` would re-point the shared file).

PARENT_GNX="${PROJECT_ROOT}/.gitnexus"
if [ -f "${PARENT_GNX}/lbug" ] && [ -f "${PARENT_GNX}/meta.json" ]; then
  mkdir -p "${WORKTREE_PATH}/.gitnexus"
  ln -sfn "${PARENT_GNX}/lbug" "${WORKTREE_PATH}/.gitnexus/lbug"
  ln -sfn "${PARENT_GNX}/meta.json" "${WORKTREE_PATH}/.gitnexus/meta.json"
  # Do NOT symlink CLAUDE.md — the worktree has its own tracked .gitnexus/CLAUDE.md.
  if command -v gitnexus >/dev/null 2>&1; then
    gitnexus index "${WORKTREE_PATH}" >/dev/null 2>&1 \
      || echo "Note: gitnexus index seed skipped for ${WORKTREE_PATH} (non-fatal)." >&2
  fi
fi

# --- Opt-in: symlink parent dependency dirs into the worktree (OQ-27-A, ID-27.12) ---
#
# SPIKE-27.10 confirmed the node_modules/.venv/.bin gap is real for cmux subo-*
# worktrees and CANNOT be closed by native `worktree.symlinkDirectories` (that
# setting is Claude-Code-managed-only; cmux uses raw `git worktree add`). When
# --symlink-deps (or KH_CMUX_SYMLINK_DEPS=1) is set, mirror the managed behaviour
# manually: `ln -s` the parent tree's dependency dirs into the worktree so
# compile/test workers skip a per-worktree `bun install` / `pip install`.
#
# The canonical list is .claude/settings.local.json `worktree.symlinkDirectories`
# (read via jq when present); fall back to the hardcoded three if that file or
# key is missing. Only dirs that EXIST in the parent tree are linked — missing
# ones are skipped non-fatally. All three names are already gitignored at the
# parent root (shared .gitignore across linked worktrees), so the symlinks never
# surface in `git ls-files --others --exclude-standard` and the stop-worker
# dirty-tree gate stays green — no .git/info/exclude edit needed (unlike the
# .gitnexus/ case above, which has a TRACKED file requiring negation handling).
# Idempotent (`ln -sfn`) and NON-FATAL — never abort the launch over this.
# Default (no flag, no env) keeps doc/research workers on a clean full checkout.

if [ "$SYMLINK_DEPS" = "1" ]; then
  SETTINGS_LOCAL="${PROJECT_ROOT}/.claude/settings.local.json"
  SYMLINK_DIRS=""
  if [ -f "$SETTINGS_LOCAL" ]; then
    SYMLINK_DIRS=$(jq -r '.worktree.symlinkDirectories[]? // empty' "$SETTINGS_LOCAL" 2>/dev/null || true)
  fi
  # Fall back to the canonical three if settings.local lacks the key.
  if [ -z "$SYMLINK_DIRS" ]; then
    SYMLINK_DIRS=$'node_modules\n.venv\n.bin'
  fi
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    SRC_DEP="${PROJECT_ROOT}/${dep}"
    DST_DEP="${WORKTREE_PATH}/${dep}"
    if [ -e "$SRC_DEP" ]; then
      ln -sfn "$SRC_DEP" "$DST_DEP" 2>/dev/null \
        || echo "Note: --symlink-deps could not link '${dep}' into ${WORKTREE_PATH} (non-fatal)." >&2
    fi
  done <<< "$SYMLINK_DIRS"
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

# --- Install prettier pre-commit hook into the worker worktree (ID-48.12) ---
#
# Belt-and-braces with the project-level format-pre-commit (ID-48.8): every
# worker worktree gets its own .git/hooks/pre-commit that runs prettier on
# staged files, so worker commits land already-formatted. Worktrees use a
# separate hooks dir (`.git/worktrees/<name>/hooks/`) per git, so we install
# into the worktree's own hooks path rather than the shared `.git/hooks/`.
#
# Hook content lives in worktree-pre-commit.sh alongside this script —
# tracked, auditable, easy to update.

SKILL_SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd -P)"
WORKTREE_HOOKS_DIR="$(git -C "$WORKTREE_PATH" rev-parse --git-path hooks 2>/dev/null || true)"
HOOK_SOURCE="${SKILL_SCRIPTS_DIR}/worktree-pre-commit.sh"

if [ -n "$WORKTREE_HOOKS_DIR" ] && [ -f "$HOOK_SOURCE" ]; then
  # rev-parse --git-path returns a path that may be relative to the worktree
  # root. Resolve against $WORKTREE_PATH if not already absolute.
  case "$WORKTREE_HOOKS_DIR" in
    /*) ;;
    *) WORKTREE_HOOKS_DIR="${WORKTREE_PATH}/${WORKTREE_HOOKS_DIR}" ;;
  esac
  mkdir -p "$WORKTREE_HOOKS_DIR"
  cp "$HOOK_SOURCE" "${WORKTREE_HOOKS_DIR}/pre-commit"
  chmod +x "${WORKTREE_HOOKS_DIR}/pre-commit"
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
