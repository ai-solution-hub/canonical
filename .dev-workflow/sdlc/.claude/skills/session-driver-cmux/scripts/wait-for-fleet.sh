#!/usr/bin/env bash
set -euo pipefail

# KH session-driver-cmux: wait for any-of or all-of a worker fleet to emit
# the `stop` event.
#
# Polls each worker's events.jsonl directly (the upstream wait-for-event.sh
# is hard-coded to /tmp/claude-workers/ and so cannot be reused without
# path translation; this script duplicates the minimal polling logic).
#
# Exit codes:
#   0  All requested sessions reached `stop` (mode all) or one did (mode any).
#   1  Timeout before satisfying the mode condition.
#   2  Invalid arguments.
#
# On success in --mode any, prints the first session-id that emitted `stop`.
# On success in --mode all, prints each completed session-id, one per line.
#
# Usage:
#   wait-for-fleet.sh --mode any|all [--timeout S] [--after-line-per-session]
#                     <session-id> [<session-id>...]
#
#   --timeout                Total deadline in seconds (default: 600).
#   --after-line-per-session File-list of <session-id>:<n> for partial
#                            replay safety (rarely needed; see notes below).

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq not found on PATH." >&2
  exit 1
fi

MODE=""
TIMEOUT=600
SESSIONS=()
AFTER_LINE_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="${2:?--mode requires any|all}"
      shift 2
      ;;
    --timeout)
      TIMEOUT="${2:?--timeout requires seconds}"
      shift 2
      ;;
    --after-line-per-session)
      AFTER_LINE_FILE="${2:?--after-line-per-session requires a file path}"
      shift 2
      ;;
    --)
      shift
      while [ $# -gt 0 ]; do SESSIONS+=("$1"); shift; done
      ;;
    -*)
      echo "Error: unknown flag '$1'" >&2
      exit 2
      ;;
    *)
      SESSIONS+=("$1")
      shift
      ;;
  esac
done

if [ "$MODE" != "any" ] && [ "$MODE" != "all" ]; then
  echo "Error: --mode must be 'any' or 'all'" >&2
  exit 2
fi

if [ "${#SESSIONS[@]}" -eq 0 ]; then
  echo "Error: at least one session-id required" >&2
  exit 2
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

# Load per-session after-line offsets (optional). File format:
#   <session-id>:<line-count>
#
# bash 3.2 portable: associative arrays unavailable (macOS default).
# Store as newline-delimited "sid=n" records in a flat string; look up
# via awk. POSIX-only constructs throughout this script.
AFTER_LINE_DATA=""
if [ -n "$AFTER_LINE_FILE" ] && [ -f "$AFTER_LINE_FILE" ]; then
  while IFS=: read -r sid n; do
    [ -z "$sid" ] && continue
    AFTER_LINE_DATA="${AFTER_LINE_DATA}${sid}=${n}
"
  done < "$AFTER_LINE_FILE"
fi

after_line_for() {
  # Echo the offset for the given session-id, defaulting to 0.
  local sid="$1"
  local n
  n=$(printf '%s' "$AFTER_LINE_DATA" | awk -F= -v sid="$sid" '$1==sid{print $2; exit}')
  echo "${n:-0}"
}

# Helper: returns 0 if session has a `stop` event past its after-line offset.
session_stopped() {
  local sid="$1"
  local event_file="${EVENTS_BASE}/${sid}/events.jsonl"
  [ -f "$event_file" ] || return 1

  local offset
  offset=$(after_line_for "$sid")
  tail -n +"$((offset + 1))" "$event_file" \
    | jq -e 'select(.event == "stop")' >/dev/null 2>&1
}

DEADLINE=$((SECONDS + TIMEOUT))
# bash 3.2 portable: space-bordered list of completed session-ids,
# membership tested via `case " $COMPLETED_LIST " in *" $sid "*)`.
COMPLETED_LIST=""
COMPLETED_COUNT=0

while [ "$SECONDS" -lt "$DEADLINE" ]; do
  for sid in "${SESSIONS[@]}"; do
    case " $COMPLETED_LIST " in
      *" $sid "*)
        # already completed
        ;;
      *)
        if session_stopped "$sid"; then
          COMPLETED_LIST="${COMPLETED_LIST} ${sid}"
          COMPLETED_COUNT=$((COMPLETED_COUNT + 1))
          if [ "$MODE" = "any" ]; then
            echo "$sid"
            exit 0
          fi
        fi
        ;;
    esac
  done

  if [ "$MODE" = "all" ] && [ "$COMPLETED_COUNT" -eq "${#SESSIONS[@]}" ]; then
    for sid in "${SESSIONS[@]}"; do
      echo "$sid"
    done
    exit 0
  fi

  sleep 0.5
done

# Timeout
{
  # Trim leading/trailing whitespace from COMPLETED_LIST for display.
  COMPLETED_DISPLAY=$(echo "$COMPLETED_LIST" | awk '{$1=$1;print}')
  echo "Error: timeout after ${TIMEOUT}s (mode=$MODE)"
  echo "  Completed: ${COMPLETED_DISPLAY:-<none>}"
  echo "  Pending:"
  for sid in "${SESSIONS[@]}"; do
    case " $COMPLETED_LIST " in
      *" $sid "*)
        ;;
      *)
        echo "    - $sid"
        ;;
    esac
  done
} >&2
exit 1
