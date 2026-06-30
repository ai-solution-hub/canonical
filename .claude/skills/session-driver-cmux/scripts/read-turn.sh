#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: render a worker's last turn as markdown.
#
# A "turn" is everything since the worker's last REAL user prompt: thinking
# blocks, tool_use calls, tool_results, and assistant text. converse.sh only
# returns the final assistant text, so this fills the gap when you want the
# full reasoning + tool trace for a worker session.
#
# KH-local: resolves the worker cwd from
# <events-base>/<session-id>/meta.json (.cwd field, written by launch-worker.sh)
# and encodes it to the Claude projects dir name the same way converse.sh does
# (both '/' and '.' -> '-'). The upstream superpowers read-turn.sh reads from
# /tmp/claude-workers/<id>.meta and mis-encodes dotted worktree paths, so it
# cannot be used under the KH layout.
#
# Usage: read-turn.sh <session-id> [--full]
#
#   <session-id>   The worker session id (from launch-worker.sh result JSON).
#   --full         Render tool_result blocks in full (default: first 5 lines).

SESSION_ID="${1:?Usage: read-turn.sh <session-id> [--full]}"
FULL=0
if [ "${2:-}" = "--full" ]; then
  FULL=1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH." >&2
  exit 1
fi

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

META_FILE="${EVENTS_BASE}/${SESSION_ID}/meta.json"

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

if [ ! -f "$LOG_FILE" ]; then
  echo "Error: no session log found at $LOG_FILE" >&2
  exit 1
fi

# --- Find the line of the last REAL user prompt ---
#
# A "real" user prompt is a user-role message whose content is plain text and
# is NOT an injected entry. We exclude:
#   - tool_result lines (user-role messages whose content is tool_result blocks)
#   - <local-command-*> / <command-name> / <command-message> injected entries
#     (slash-command expansions Claude records as user messages)
# Everything from that line to EOF is the current turn.

LAST_USER_LINE=$(awk '
  /"type":"user"/ {
    if (index($0, "\"type\":\"tool_result\"") > 0) next;
    if (index($0, "<local-command") > 0) next;
    if (index($0, "<command-name>") > 0) next;
    if (index($0, "<command-message>") > 0) next;
    last = NR;
  }
  END { if (last) print last }
' "$LOG_FILE")

if [ -z "${LAST_USER_LINE:-}" ]; then
  # No real user prompt found — render the whole log as one turn.
  LAST_USER_LINE=1
fi

# --- Render the slice from the last user prompt to EOF as markdown ---
#
# thinking      -> blockquote
# tool_use      -> fenced ```json (name + input)
# tool_result   -> truncated to 5 lines (or full with --full), fenced as text
# assistant text-> rendered as-is

tail -n +"$LAST_USER_LINE" "$LOG_FILE" \
  | jq -rs --argjson full "$FULL" '
    def trunc(text):
      if $full == 1 then text
      else (text | split("\n") | .[0:5] | join("\n")) end;

    .[] as $line
    | ($line.message // {}) as $msg
    | ($msg.role // $line.type) as $role
    | ($msg.content // []) as $content
    | if ($content | type) == "string" then
        # Plain-text user/assistant message
        (if $role == "user" then "## User\n\n" + $content
         else $content end)
      else
        ($content[]?
          | if .type == "text" then .text
            elif .type == "thinking" then
              "> " + ((.thinking // "") | gsub("\n"; "\n> "))
            elif .type == "tool_use" then
              "**tool_use:** `" + (.name // "?") + "`\n\n```json\n"
                + ((.input // {}) | tojson) + "\n```"
            elif .type == "tool_result" then
              "**tool_result:**\n\n```\n"
                + trunc(
                    (if (.content | type) == "string" then .content
                     elif (.content | type) == "array" then
                       ([.content[]? | (.text // (. | tojson))] | join("\n"))
                     else (. | tojson) end)
                  )
                + "\n```"
            else empty end)
      end
  '
