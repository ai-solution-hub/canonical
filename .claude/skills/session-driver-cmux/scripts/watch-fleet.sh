#!/usr/bin/env bash
# Smart fleet watcher for KH cmux sub-orchestrators (v2).
# Polls every worker's events.jsonl + worktree; EXITS (waking the parent) when
# any worker needs attention. Reports ALL actionable items in the tripping poll.
#
# Per worker (skipped if name in $IGNORE for Ask/stop):
#   - last event == AskUserQuestion, stable 2 polls   -> headless stall
#   - last event == stop, stable 2 polls              -> paused (done / needs nudge / awaiting-decision)
#   - OQ-pending.md (found ANYWHERE in worktree) grew beyond seen lines  (SEEN_OQ="<sid>:<lines> ...")
#   - oq/oq-state.json lifecycle_state=awaiting-decision (skip if sid in SEEN_BLOCKED)
#     -- the SECOND OQ surface; watching only OQ-pending.md left the watcher
#        blind to oq_emit blocking questions (F7 friction, WS-A6).
#   - final_report.* in events dir                    (skip if sid in SEEN_FINAL)
#   - session_end event                               (skip if sid in SEEN_SEND)
# Fleet-wide: no event growth for QUIET_POLLS -> stall/all-idle.
#
# Env: IGNORE, SEEN_OQ, SEEN_BLOCKED, SEEN_FINAL, SEEN_SEND, INTERVAL, MAX_POLLS, QUIET_POLLS.
# Exit: 0 = tripped (report on stdout); 2 = max-poll timeout.

set -uo pipefail
# -e intentionally omitted: the poll loop relies on expected non-zero exits
# (in_list returns 1 on miss, jq -e in conditionals, grep -c on empty files).
# Resolve the MAIN working-tree root even when CWD is inside a linked worktree.
# --git-common-dir points at <main>/.git for every linked worktree; its parent
# is the canonical main root. Falls back to --show-toplevel then pwd. (ID-27.6/27.7)
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
INTERVAL="${INTERVAL:-25}"
MAX_POLLS="${MAX_POLLS:-40}"       # ~16 min at 25s
QUIET_POLLS="${QUIET_POLLS:-28}"   # ~11.6 min zero growth
IGNORE="${IGNORE:-}"
SEEN_OQ="${SEEN_OQ:-}"
SEEN_BLOCKED="${SEEN_BLOCKED:-}"
SEEN_FINAL="${SEEN_FINAL:-}"
SEEN_SEND="${SEEN_SEND:-}"

in_list() { case " $2 " in *" $1 "*) return 0;; *) return 1;; esac; }
seen_oq_lines() { printf '%s' "$SEEN_OQ" | tr ' ' '\n' | awk -F: -v s="$1" '$1==s{print $2; exit}'; }

# Self-seed FINAL/SEND suppression from artefacts ALREADY present at arm time.
# A FINAL_REPORT / SESSION_END check trips on mere existence, so a watcher armed
# against a dirty events dir (prior sessions' completed reports left on disk)
# would otherwise trip and exit on poll 1 — the S291 "watch-fleet exits
# immediately" friction. Anything that APPEARS during the watch window is still
# reported (its sid is not in the seeded set). The caller's SEEN_* (re-arm loop)
# is preserved — we only append, never overwrite.
for _seed_d in "$EVENTS_BASE"/*/; do
  [ -f "${_seed_d}meta.json" ] || continue
  _seed_sid=$(jq -r '.session_id' "${_seed_d}meta.json" 2>/dev/null)
  [ -n "$_seed_sid" ] && [ "$_seed_sid" != "null" ] || continue
  if ls "${_seed_d}"final_report.* >/dev/null 2>&1 && ! in_list "$_seed_sid" "$SEEN_FINAL"; then
    SEEN_FINAL="$SEEN_FINAL $_seed_sid"
  fi
  if [ -f "${_seed_d}events.jsonl" ] \
     && tail -5 "${_seed_d}events.jsonl" | jq -e 'select(.event=="session_end")' >/dev/null 2>&1 \
     && ! in_list "$_seed_sid" "$SEEN_SEND"; then
    SEEN_SEND="$SEEN_SEND $_seed_sid"
  fi
done

prev_ask=""; prev_stop=""; prev_total=-1; quiet_count=0; poll=0

while [ "$poll" -lt "$MAX_POLLS" ]; do
  poll=$((poll + 1)); report=""; cur_ask=""; cur_stop=""; fleet_total=0

  for m in "$EVENTS_BASE"/*/meta.json; do
    [ -f "$m" ] || continue
    name=$(jq -r '.worker_name' "$m" 2>/dev/null)
    sid=$(jq -r '.session_id' "$m" 2>/dev/null)
    cwd=$(jq -r '.cwd' "$m" 2>/dev/null)
    d=$(dirname "$m"); f="$d/events.jsonl"; [ -f "$f" ] || continue

    n=$(wc -l < "$f" 2>/dev/null | tr -d ' '); fleet_total=$((fleet_total + n))
    last=$(tail -1 "$f" 2>/dev/null | jq -rc '(.tool_name // .tool // .event)' 2>/dev/null)
    lastts=$(tail -1 "$f" 2>/dev/null | jq -rc '.ts' 2>/dev/null)

    if ! in_list "$sid" "$SEEN_SEND" && tail -5 "$f" | jq -e 'select(.event=="session_end")' >/dev/null 2>&1; then
      report="${report}
  $name ($sid): SESSION_END (worker exited)"
    fi
    if ! in_list "$sid" "$SEEN_FINAL" && ls "$d"/final_report.* >/dev/null 2>&1; then
      report="${report}
  $name ($sid): FINAL_REPORT in events dir"
    fi
    # OQ-pending.md at worktree ROOT (per S267 brief contract) + events dir only.
    # Root-only by design: a recursive find catches committed historical corpus
    # copies (e.g. the S265 subo-ast OQ-pending.md, 143 lines — session corpus
    # now lives in the private docs-site repo per ID-68 PC-25) in every
    # checkout -> false trips on every worker. Workers are briefed to write at root.
    # Count distinct OQ headings (^## OQ), NOT line count: workers elaborate an
    # already-handled OQ's prose after the parent reads it -> line growth = false
    # trips. A new "## OQ" heading = a genuinely new question. SEEN_OQ holds
    # "<sid>:<headingcount>".
    # grep -c emits exactly one integer; capture it into a var (the old inline
    # `|| echo 0` double-emitted "0\n0" on a zero-match file -> arithmetic crash).
    oq_heads=0
    for oqf in "$cwd/OQ-pending.md" "$d/OQ-pending.md"; do
      [ -f "$oqf" ] || continue
      oqc=$(grep -c '^## OQ' "$oqf" 2>/dev/null) || oqc=0
      oq_heads=$(( oq_heads + ${oqc:-0} ))
    done
    if [ "$oq_heads" -gt 0 ]; then
      seen=$(seen_oq_lines "$sid"); seen="${seen:-0}"
      [ "$oq_heads" -gt "$seen" ] && report="${report}
  $name ($sid): OQ count grew to $oq_heads (seen=$seen)"
    fi
    # Second OQ surface: oq/oq-state.json lifecycle marker (oq_emit blocking
    # channel). awaiting-decision = worker is BLOCKED on a parent decision —
    # trip unless the caller already handled it (sid in SEEN_BLOCKED). (WS-A6)
    sfile="$d/oq/oq-state.json"
    if [ -f "$sfile" ] && ! in_list "$sid" "$SEEN_BLOCKED"; then
      lstate=$(jq -r '.lifecycle_state // empty' "$sfile" 2>/dev/null)
      [ "$lstate" = "awaiting-decision" ] && report="${report}
  $name ($sid): OQ-STATE awaiting-decision (oq/oq-state.json — blocking)"
    fi
    if [ "$last" = "AskUserQuestion" ]; then
      cur_ask="$cur_ask $name"
      if ! in_list "$name" "$IGNORE"; then
        case " $prev_ask " in *" $name "*) report="${report}
  $name ($sid): STALLED on AskUserQuestion (since $lastts)";; esac
      fi
    fi
    if [ "$last" = "stop" ]; then
      cur_stop="$cur_stop $name"
      if ! in_list "$name" "$IGNORE"; then
        case " $prev_stop " in *" $name "*) report="${report}
  $name ($sid): PAUSED at stop (done / nudge / awaiting-decision) since $lastts";; esac
      fi
    fi
  done

  if [ "$fleet_total" -eq "$prev_total" ]; then quiet_count=$((quiet_count + 1)); else quiet_count=0; fi
  prev_total="$fleet_total"
  if [ "$quiet_count" -ge "$QUIET_POLLS" ]; then
    report="${report}
  FLEET: no event growth ~$((QUIET_POLLS * INTERVAL / 60)) min (stall/all-idle) total=$fleet_total"
  fi

  if [ -n "$report" ]; then
    printf '=== WATCHER TRIP poll=%s %s ===%s\n' "$poll" "$(date -u +%H:%M:%SZ)" "$report"
    exit 0
  fi
  prev_ask="$cur_ask"; prev_stop="$cur_stop"
  sleep "$INTERVAL"
done

printf '=== WATCHER timeout after %s polls (%s) — re-arm + sweep ===\n' "$MAX_POLLS" "$(date -u +%H:%M:%SZ)"
exit 2
