#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: send a prompt to a worker (no wait).
#
# Adapted from ~/.claude/session-driver-cmux/send-prompt.sh. cmux interprets
# \n as Enter and \t as Tab when send is invoked; literal backslash-n in
# prompt text will be treated as Enter. This is acceptable for natural-
# language prompts.
#
# Usage: send-prompt.sh <worker-name> <prompt-text>

WORKER_NAME="${1:?Usage: send-prompt.sh <worker-name> <prompt-text>}"
PROMPT_TEXT="${2:?Usage: send-prompt.sh <worker-name> <prompt-text>}"

if ! command -v cmux >/dev/null 2>&1; then
  echo "Error: cmux CLI not found on PATH." >&2
  exit 1
fi

# Resolve workspace ref from name
WS_REF=$(cmux list-workspaces 2>/dev/null | grep -F "$WORKER_NAME" | grep -oE 'workspace:[0-9]+' | head -1)

if [ -z "$WS_REF" ]; then
  echo "Error: cmux workspace '$WORKER_NAME' does not exist" >&2
  exit 1
fi

# Send prompt body, then Enter separately (a combined \n is unreliable in TUI)
cmux send --workspace "$WS_REF" "${PROMPT_TEXT}"
sleep 0.3
cmux send --workspace "$WS_REF" "\n"
