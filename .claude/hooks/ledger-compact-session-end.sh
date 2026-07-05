#!/usr/bin/env bash
# ledger-compact-session-end.sh — SessionEnd hook.
#
# Runs the WS-B3 journal compaction (scripts/ledger-compact-done.ts) at session
# close, so the DONE/CANCELLED-task journals in task-list.json are archived
# incrementally instead of accumulating until a manual sweep. Pairs with the
# script's own idempotence: already-stubbed details are below the 400-char
# archive threshold and are skipped, so re-runs across sessions are cheap.
#
# CONTRACT — fail-quiet, never hang or fail teardown:
#   - ALWAYS exit 0. A maintenance hook must never fail session teardown.
#   - Skips (0 + one log line) when a prerequisite is missing: bun, the ledgers
#     dir, or a live+healthy ledger patch-server. It deliberately never SPAWNS a
#     server at teardown (the spawn path has a 10s hard deadline and is heavy) —
#     it runs only when a warm daemon is already reachable, which any active
#     ledger session leaves behind (the daemon runs --idle-exit 30). A session
#     that touched no ledgers has nothing new to compact anyway.
#   - Concurrency: an atomic mkdir lock in the SHARED .cache/ (symlinked across
#     worktrees) stops two sessions double-running. A lock older than LOCK_TTL
#     is treated as a crashed-run leftover and reclaimed.
#   - Regen only when something was actually compacted: run with --no-regen, and
#     invoke regen-mirrors.sh afterwards only if N>0 journals moved — keeping the
#     common no-op teardown to a single sub-second bun invocation while still
#     holding mirror body-parity whenever the JSON changed.
#
# KNOWN EDGE (documented, not handled here): if a prior run crashed AFTER writing
# an archive file but BEFORE stubbing all of that task's subtasks, the script's
# "refusing to overwrite existing archive" guard makes the next run exit non-zero
# for that task. This hook logs it and still exits 0; recovery is to delete the
# partial ledgers/archive/ID-N-journals.md and re-run. Rare (needs a mid-run
# kill), and the next full manual run surfaces it in the log.
#
# Input: SessionEnd JSON on stdin (.cwd, .reason, ...). Wired in
# .claude/settings.json under the SessionEnd hook list.
set +e
set +u

LOCK_TTL=1800        # seconds — reclaim a lock older than this (crashed prior run)
HEALTH_TIMEOUT=2     # seconds — per health-probe budget

# Hooks run with a minimal env; make bun/node/curl/jq resolve (cf. quality-gate.sh).
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

INPUT=$(cat 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
REASON=$(printf '%s' "$INPUT" | jq -r '.reason // empty' 2>/dev/null)
[ -n "$CWD" ] || CWD="$PWD"

# Worktree-aware repo root: scripts/ + .cache/ belong to THIS tree (falls back to
# the script's own location if git resolution fails).
REPO=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
[ -n "$REPO" ] || REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)
[ -n "$REPO" ] || exit 0

mkdir -p "$REPO/.cache" 2>/dev/null
LOG="$REPO/.cache/ledger-compact-hook.log"
log() {
  printf '%s [ledger-compact-session-end] %s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >>"$LOG" 2>/dev/null
}

# --- prerequisite: bun -------------------------------------------------------
command -v bun >/dev/null 2>&1 || { log "skip: bun not on PATH"; exit 0; }

# --- prerequisite: relocated ledgers dir (ID-68.35) --------------------------
DOCS="${KH_PRIVATE_DOCS_DIR:-$REPO/../knowledge-hub-docs-site}"
LEDGERS="$DOCS/src/content/docs/ledgers"
[ -f "$LEDGERS/task-list.json" ] || { log "skip: ledgers not found ($LEDGERS)"; exit 0; }

# --- prerequisite: a live, healthy ledger daemon (never spawn at teardown) ---
PORT=""
while IFS= read -r h; do
  p=$(jq -r '.port // empty' "$h" 2>/dev/null)
  [ -n "$p" ] || continue
  if curl -sf -m "$HEALTH_TIMEOUT" "http://127.0.0.1:$p/api/health" >/dev/null 2>&1; then
    PORT="$p"; break
  fi
done < <(find "$REPO/.cache/ledger-server" -name handle.json 2>/dev/null)
[ -n "$PORT" ] || { log "skip: no healthy ledger server reachable (not spawning)"; exit 0; }

# --- concurrency lock (shared .cache; reclaim if stale) ----------------------
LOCK="$REPO/.cache/ledger-compact-hook.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  LOCK_MTIME=$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0)
  AGE=$(( $(date +%s) - LOCK_MTIME ))
  if [ "$AGE" -ge "$LOCK_TTL" ]; then
    rmdir "$LOCK" 2>/dev/null
    if ! mkdir "$LOCK" 2>/dev/null; then log "skip: lock contended"; exit 0; fi
    log "reclaimed stale lock (age ${AGE}s)"
  else
    log "skip: another compaction holds the lock (age ${AGE}s)"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# --- compact (no regen), then regen only if something moved ------------------
log "start: reason=${REASON:-?} repo=$REPO server=127.0.0.1:$PORT"
OUT=$(cd "$REPO" && KH_PRIVATE_DOCS_DIR="$DOCS" bun scripts/ledger-compact-done.ts --no-regen 2>&1)
RC=$?
N=$(printf '%s\n' "$OUT" | sed -nE 's/^compacted ([0-9]+) journals.*/\1/p' | tail -1)

if [ "$RC" -ne 0 ]; then
  log "nonzero exit ($RC): $(printf '%s' "$OUT" | tail -3 | tr '\n' ' ')"
  exit 0
fi

if [ "${N:-0}" -gt 0 ]; then
  RG=$(cd "$REPO" && KH_PRIVATE_DOCS_DIR="$DOCS" bash scripts/regen-mirrors.sh 2>&1)
  RGRC=$?
  log "done: compacted $N journals; regen-mirrors rc=$RGRC"
else
  log "done: no-op (nothing to compact)"
fi
exit 0
