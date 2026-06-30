#!/usr/bin/env bash
# mempal-recall.sh — SessionStart recall: inject a bounded digest of prior MemPalace
# context seeded by the current branch + cwd basename, read lock-free from chroma.sqlite3.
#
# Closes the write-only loop on MemPalace: the palace is written at session close but was
# never read at start. This hook does the read side. Design constraints (DR-003, DR-009):
#   - LOCK-FREE READ ONLY: opens chroma.sqlite3 with mode=ro (never a chromadb writer), so
#     it coexists with the single MCP/daemon writer and never corrupts the index.
#   - GRACEFUL NO-OP: any error (DB absent, locked, sqlite missing) exits 0 with no output —
#     a recall hook must never block or fail a session start.
#   - BOUNDED: a handful of rows, ~1.8 KB cap, CHECKPOINT auto-noise filtered, diary
#     (curated narrative) ranked ahead of auto-mined chunks.
# Wired in .claude/settings.json under SessionStart matcher "startup|clear" (NOT resume).
set +e
set +u

DB="$HOME/.mempalace/palace/chroma.sqlite3"
[ -f "$DB" ] || exit 0
command -v sqlite3 >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] || CWD="$PWD"

# --- seed terms: branch slug + cwd basename ---
BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null)
BASENAME=$(basename "$CWD" 2>/dev/null)

# Collect distinct seed tokens (>=3 chars, drop generic prefixes + FTS keywords).
declare -a TOKENS=()
seen=" "
for raw in ${BRANCH//[^a-zA-Z0-9]/ } "$BASENAME"; do
  tok=$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')
  case "$tok" in
    ""|ca|the|and|or|not|near|main|dev|wip) continue ;;
  esac
  [ "${#tok}" -ge 3 ] || continue
  case "$seen" in *" $tok "*) continue ;; esac
  seen="$seen$tok "
  TOKENS+=("$tok")
done
[ "${#TOKENS[@]}" -gt 0 ] || exit 0

# Build the FTS5 MATCH string EXPLICITLY as "tok1 OR tok2 OR ..."
# (do NOT use `paste -sd' OR '` — cyclic single-char delimiters do not join with " OR ").
QUERY=""
for tok in "${TOKENS[@]}"; do
  if [ -z "$QUERY" ]; then QUERY="$tok"; else QUERY="$QUERY OR $tok"; fi
done

# Lock-free read: mode=ro + immutable=1 takes NO locks and never blocks on the live
# writer (the palace runs WAL with no -wal when checkpointed, where plain mode=ro cannot
# open read-only); any failure → no-op.
SQL="
PRAGMA query_only=1;
SELECT '• ['||w.string_value||'/'||r.string_value||'] '||
       substr(replace(replace(f.string_value, char(10), ' '), char(13), ' '), 1, 200)
FROM embedding_fulltext_search f
JOIN embedding_metadata r ON r.id = f.rowid AND r.key = 'room'
JOIN embedding_metadata w ON w.id = f.rowid AND w.key = 'wing'
WHERE f.string_value MATCH '$(printf '%s' "$QUERY" | sed "s/'/''/g")'
  AND f.string_value NOT LIKE 'CHECKPOINT:%'
  AND f.string_value NOT LIKE '%Base directory for this skill%'
  AND NOT EXISTS (SELECT 1 FROM embedding_metadata t
                  WHERE t.id = f.rowid AND t.key = 'topic' AND t.string_value = 'checkpoint')
ORDER BY (CASE WHEN r.string_value = 'diary' THEN 0 ELSE 1 END), f.rowid DESC
LIMIT 6;
"
ROWS=$(sqlite3 "file:${DB}?mode=ro&immutable=1" "$SQL" 2>/dev/null)
[ -n "$ROWS" ] || exit 0

# Bound to ~1.8 KB and wrap in a labelled block.
BODY=$(printf 'MemPalace recall (lock-free FTS; seed: %s):\n%s' "${TOKENS[*]}" "$ROWS" | head -c 1800)

printf '%s' "$BODY" | jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}' 2>/dev/null || exit 0
exit 0
