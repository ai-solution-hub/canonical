#!/usr/bin/env bash
set -euo pipefail

# KH-adapted lifecycle hook called by Claude Code for session events.
# Reads hook input JSON from stdin and appends a JSONL event line to
# ${KH_CMUX_EVENTS_DIR}/<session_id>/events.jsonl.
#
# Only activates for worker sessions launched by the KH session driver
# (identified by the presence of <events-dir>/<session_id>/meta.json).
# Non-worker sessions are no-ops.
#
# Adapted from superpowers/claude-session-driver 1.0.1
# hooks/emit-event.sh — only the events-dir base path changes.

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

# Resolve the events base directory. Launch-worker exports KH_CMUX_EVENTS_DIR
# pointing at the project's <root>/.claude/cmux-events. Fall back to a
# project-local default so the script never silently writes outside the tree.
EVENTS_BASE="${KH_CMUX_EVENTS_DIR:-.claude/cmux-events}"

# Only emit events for managed worker sessions.
META_FILE="${EVENTS_BASE}/${SESSION_ID}/meta.json"
if [ ! -f "$META_FILE" ]; then
  exit 0
fi

HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Map hook event names to snake_case
case "$HOOK_EVENT" in
  SessionStart)     EVENT="session_start" ;;
  Stop)             EVENT="stop" ;;
  UserPromptSubmit) EVENT="user_prompt_submit" ;;
  SessionEnd)       EVENT="session_end" ;;
  *)                EVENT=$(echo "$HOOK_EVENT" | sed 's/\([A-Z]\)/_\L\1/g' | sed 's/^_//') ;;
esac

EVENTS_DIR="${EVENTS_BASE}/${SESSION_ID}"
mkdir -p "$EVENTS_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# SessionStart includes cwd; other events do not
if [ "$EVENT" = "session_start" ] && [ -n "$CWD" ]; then
  EVENT_JSON=$(jq -cn --arg ts "$TIMESTAMP" --arg event "$EVENT" --arg cwd "$CWD" \
    '{ts: $ts, event: $event, cwd: $cwd}')
else
  EVENT_JSON=$(jq -cn --arg ts "$TIMESTAMP" --arg event "$EVENT" \
    '{ts: $ts, event: $event}')
fi

EVENT_FILE="${EVENTS_DIR}/events.jsonl"
echo "$EVENT_JSON" >> "$EVENT_FILE"

# For Stop events, approve so we never block the agent
if [ "$HOOK_EVENT" = "Stop" ]; then
  echo '{"decision":"approve"}'
fi
