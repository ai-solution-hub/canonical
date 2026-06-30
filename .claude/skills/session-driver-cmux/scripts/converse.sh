#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: send a prompt, wait for the worker to finish,
# print the worker's last assistant text response.
#
# Combines send-prompt + wait-for-stop + read-response into a single call.
# Tracks --after-line automatically so multi-turn dialogues just work.
#
# Adapted from ~/.claude/session-driver-cmux/converse.sh — only the events
# directory layout differs (per-session-id subdirectory under
# <project-root>/.claude/cmux-events).
#
# Usage: converse.sh <worker-name> <session-id> <prompt-text> [timeout=120]

WORKER_NAME="${1:?Usage: converse.sh <worker-name> <session-id> <prompt-text> [timeout=120]}"
SESSION_ID="${2:?Usage: converse.sh <worker-name> <session-id> <prompt-text> [timeout=120]}"
PROMPT_TEXT="${3:?Usage: converse.sh <worker-name> <session-id> <prompt-text> [timeout=120]}"
TIMEOUT="${4:-120}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"

# Resolve project root (assumes converse is called from within the project)
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
EVENT_FILE="${EVENTS_DIR}/events.jsonl"
META_FILE="${EVENTS_DIR}/meta.json"

if [ ! -f "$META_FILE" ]; then
  echo "Error: no meta file for session $SESSION_ID at $META_FILE" >&2
  exit 1
fi

# Resolve the worker's working dir (worktree path) for log lookup
CWD=$(jq -r '.cwd' "$META_FILE" 2>/dev/null)
if [ -z "$CWD" ] || [ "$CWD" = "null" ]; then
  echo "Error: could not determine working directory from meta file" >&2
  exit 1
fi

# Resolve symlinks (e.g. /tmp -> /private/tmp on macOS) to match Claude's encoding
if [ -d "$CWD" ]; then
  CWD=$(cd "$CWD" && pwd -P)
fi

# Claude encodes BOTH '/' and '.' as '-' in project log dir names.
# e.g. '/Users/liamj/.claude/foo' -> '-Users-liamj--claude-foo'
ENCODED_PATH="${CWD//\//-}"
ENCODED_PATH="${ENCODED_PATH//./-}"
LOG_FILE="$HOME/.claude/projects/${ENCODED_PATH}/${SESSION_ID}.jsonl"

# Helper: count assistant messages that contain at least one text block.
count_text_messages() {
  if [ ! -f "$LOG_FILE" ]; then
    echo 0
    return
  fi
  local result
  result=$(grep '"type":"assistant"' "$LOG_FILE" \
    | jq -s '[.[] | select(.message.content | any(.type == "text"))] | length' 2>/dev/null) \
    || result=0
  echo "$result"
}

# Helper: emit the complete text from the last assistant message that has text.
last_text_response() {
  grep '"type":"assistant"' "$LOG_FILE" \
    | jq -rs 'map(select(.message.content | any(.type == "text"))) | last | [.message.content[] | select(.type == "text") | .text] | join("\n")' 2>/dev/null
}

BEFORE_COUNT=$(count_text_messages)

# Record current event line count for --after-line bookkeeping
AFTER_LINE=0
if [ -f "$EVENT_FILE" ]; then
  AFTER_LINE=$(wc -l < "$EVENT_FILE" | tr -d ' ')
fi

# --- Send the prompt ---
bash "$SCRIPT_DIR/send-prompt.sh" "$WORKER_NAME" "$PROMPT_TEXT"

# --- Wait for the worker to emit `stop` after our prompt ---
# Inlined polling (avoids depending on upstream wait-for-event.sh path mapping).
DEADLINE=$((SECONDS + TIMEOUT))
LINES_CHECKED=$AFTER_LINE
STOP_MATCHED=0
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if [ -f "$EVENT_FILE" ]; then
    CURRENT_LINES=$(wc -l < "$EVENT_FILE" | tr -d ' ')
    if [ "$CURRENT_LINES" -gt "$LINES_CHECKED" ]; then
      MATCH=$(tail -n +"$((LINES_CHECKED + 1))" "$EVENT_FILE" \
        | jq -c 'select(.event == "stop")' 2>/dev/null \
        | head -1)
      if [ -n "$MATCH" ]; then
        STOP_MATCHED=1
        break
      fi
      LINES_CHECKED=$CURRENT_LINES
    fi
  fi
  sleep 0.5
done

if [ "$STOP_MATCHED" -ne 1 ]; then
  echo "Error: worker did not finish within ${TIMEOUT}s" >&2
  exit 1
fi

# --- Wait for the new assistant text response to land in the session log ---
# Stop event and log write happen concurrently; the log may lag the stop
# event by several seconds on macOS (observed empirically up to ~5s under
# normal load). Poll for up to 30s before failing — Claude has already
# stopped emitting tokens by this point, so the log is the bottleneck.
for _ in $(seq 1 300); do
  if [ ! -f "$LOG_FILE" ]; then
    sleep 0.1
    continue
  fi
  AFTER_COUNT=$(count_text_messages)
  if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
    RESPONSE=$(last_text_response)
    if [ -n "$RESPONSE" ]; then
      echo "$RESPONSE"
      exit 0
    fi
  fi
  sleep 0.1
done

echo "Error: timed out waiting for assistant response in session log" >&2
exit 1
