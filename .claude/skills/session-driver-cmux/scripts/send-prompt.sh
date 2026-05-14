#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: send a prompt to a worker (no wait).
#
# Resolves the cmux workspace ref from the worker's meta.json (recorded by
# launch-worker.sh) rather than grepping `cmux list-workspaces` output —
# cmux titles drift to track the currently-running command line, so a grep
# match is unreliable.
#
# Usage: send-prompt.sh <worker-name> <prompt-text> [session-id]
#
# When session-id is omitted, scans .claude/cmux-events/*/meta.json for a
# meta with matching worker_name. Errors if zero or >1 match.

WORKER_NAME="${1:?Usage: send-prompt.sh <worker-name> <prompt-text> [session-id]}"
PROMPT_TEXT="${2:?Usage: send-prompt.sh <worker-name> <prompt-text> [session-id]}"
SESSION_ID_HINT="${3:-}"

if ! command -v cmux >/dev/null 2>&1; then
  echo "Error: cmux CLI not found on PATH." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH." >&2
  exit 1
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
EVENTS_BASE="${KH_CMUX_EVENTS_DIR:-${PROJECT_ROOT}/.claude/cmux-events}"

# --- Resolve workspace ref from meta file ---

WS_REF=""
if [ -n "$SESSION_ID_HINT" ]; then
  META_FILE="${EVENTS_BASE}/${SESSION_ID_HINT}/meta.json"
  if [ ! -f "$META_FILE" ]; then
    echo "Error: no meta file at $META_FILE for session-id $SESSION_ID_HINT" >&2
    exit 1
  fi
  WS_REF=$(jq -r '.cmux_workspace // empty' "$META_FILE")
else
  # Scan all event dirs for one with matching worker_name
  MATCHES=()
  if [ -d "$EVENTS_BASE" ]; then
    for meta in "$EVENTS_BASE"/*/meta.json; do
      [ -f "$meta" ] || continue
      mname=$(jq -r '.worker_name // empty' "$meta" 2>/dev/null)
      if [ "$mname" = "$WORKER_NAME" ]; then
        MATCHES+=("$meta")
      fi
    done
  fi

  if [ "${#MATCHES[@]}" -eq 0 ]; then
    echo "Error: no worker named '$WORKER_NAME' found under $EVENTS_BASE" >&2
    exit 1
  fi
  if [ "${#MATCHES[@]}" -gt 1 ]; then
    echo "Error: multiple workers named '$WORKER_NAME' found. Pass session-id explicitly:" >&2
    for m in "${MATCHES[@]}"; do
      echo "  - $m" >&2
    done
    exit 1
  fi
  WS_REF=$(jq -r '.cmux_workspace // empty' "${MATCHES[0]}")
fi

if [ -z "$WS_REF" ]; then
  echo "Error: meta file does not record a cmux_workspace ref for worker '$WORKER_NAME'." >&2
  exit 1
fi

# Send prompt body, then Enter separately (a combined \n is unreliable in TUI).
# Suppress cmux send "OK ..." chatter so converse.sh and pipeline callers see
# a clean stdout.
cmux send --workspace "$WS_REF" "${PROMPT_TEXT}" >/dev/null 2>&1
sleep 0.3
cmux send --workspace "$WS_REF" "\n" >/dev/null 2>&1
