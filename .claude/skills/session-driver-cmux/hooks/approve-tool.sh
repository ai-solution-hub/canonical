#!/usr/bin/env bash
set -euo pipefail

# KH-adapted PreToolUse hook: emits a pre_tool_use event and gives the
# orchestrator a chance to approve or deny the tool call. Auto-approves on
# timeout so the worker never hangs indefinitely.
#
# Only activates for worker sessions launched by the KH session driver
# (identified by the presence of <events-dir>/<session_id>/meta.json).
# Non-worker sessions are auto-approved immediately.
#
# Adapted from superpowers/claude-session-driver 1.0.1
# hooks/approve-tool.sh — only the events-dir base path changes.
#
# Flow:
# 1. Read tool details from stdin
# 2. Check if this is a managed worker session (has meta.json)
# 3. If not a worker, auto-approve immediately
# 4. Append pre_tool_use event to <events-dir>/<id>/events.jsonl
# 5. Write tool details to <events-dir>/<id>/tool-pending
# 6. Poll for <events-dir>/<id>/tool-decision (orchestrator writes this)
# 7. Return the decision (or auto-approve on timeout)
# 8. Clean up pending/decision files

APPROVAL_TIMEOUT="${CLAUDE_SESSION_DRIVER_APPROVAL_TIMEOUT:-0}"

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')

EVENTS_BASE="${KH_CMUX_EVENTS_DIR:-.claude/cmux-events}"
META_FILE="${EVENTS_BASE}/${SESSION_ID}/meta.json"

# Only activate for managed worker sessions.
if [ ! -f "$META_FILE" ]; then
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')

EVENTS_DIR="${EVENTS_BASE}/${SESSION_ID}"
PENDING_FILE="${EVENTS_DIR}/tool-pending"
DECISION_FILE="${EVENTS_DIR}/tool-decision"
EVENT_FILE="${EVENTS_DIR}/events.jsonl"

mkdir -p "$EVENTS_DIR"

# Emit pre_tool_use event
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq -cn --arg ts "$TIMESTAMP" --arg event "pre_tool_use" --arg tool "$TOOL_NAME" --arg input "$TOOL_INPUT" \
  '{ts: $ts, event: $event, tool: $tool, tool_input: ($input | fromjson)}' >> "$EVENT_FILE"

# Ungated (default, APPROVAL_TIMEOUT<=0): allow immediately. The pre_tool_use
# event is already emitted above for observability; skip the pending-file write
# + poll so the worker is never taxed (no 30s/tool-call hook latency, no
# background auto-approver needed). Launch --gated (APPROVAL_TIMEOUT>0) to gate.
if [ "$APPROVAL_TIMEOUT" -le 0 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
fi

# Write pending approval request
jq -cn --arg tool "$TOOL_NAME" --arg input "$TOOL_INPUT" \
  '{tool_name: $tool, tool_input: ($input | fromjson)}' > "$PENDING_FILE"

# Clean up any stale decision file
rm -f "$DECISION_FILE"

# Poll for orchestrator decision
DEADLINE=$((SECONDS + APPROVAL_TIMEOUT))
DECISION="allow"

while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if [ -f "$DECISION_FILE" ]; then
    DECISION=$(jq -r '.decision // "allow"' "$DECISION_FILE" 2>/dev/null) || DECISION="allow"
    break
  fi
  sleep 0.5
done

# Clean up
rm -f "$PENDING_FILE" "$DECISION_FILE"

# Map decision to hook output.
# `hookEventName: "PreToolUse"` is required as of Claude Code 2.1.x (S61 finding —
# upstream omitted it; sub-cmux workers logged `Hook JSON output validation failed
# — hookSpecificOutput is missing required field "hookEventName"`).
case "$DECISION" in
  allow)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    ;;
  deny)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}'
    ;;
  *)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    ;;
esac
