# Degraded recall — the lock-free FTS fallthrough and the cold stores

Read this when `mempalace_search` / `mempalace_kg_query` errors (`-32002`,
integrity-check refusal, or anything else), when a filtered search behaves
oddly, or when the live palace comes up empty on older work. The `SKILL.md`
body carries the hot rules; this file carries the recipe and the diagnosis.

## 1. The lock-free FTS read

**`.claude/hooks/mempal-recall.sh` is the canonical implementation of this
query.** It executes at every session start, so it is the copy that stays
honest. The block below is *derived from it*, and exists only because a
mid-session fallback needs **your** seed terms — the hook auto-seeds from
branch + cwd and exits silently. If the two ever disagree the hook wins:
re-sync this block against it rather than editing around it.

```bash
sqlite3 "file:$HOME/.mempalace/palace/chroma.sqlite3?mode=ro&immutable=1" "
SELECT '['||w.string_value||'/'||r.string_value||'] '||
       substr(replace(f.string_value, char(10),' '),1,200)
FROM embedding_fulltext_search f
JOIN embedding_metadata r ON r.id = f.rowid AND r.key = 'room'
JOIN embedding_metadata w ON w.id = f.rowid AND w.key = 'wing'
WHERE f.string_value MATCH '\"id-145\" OR \"DR-104\" OR \"okf\"'
  AND f.string_value NOT LIKE 'CHECKPOINT:%'
  AND f.string_value NOT LIKE '%Base directory for this skill%'
  AND NOT EXISTS (SELECT 1 FROM embedding_metadata t
                  WHERE t.id = f.rowid AND t.key = 'topic' AND t.string_value = 'checkpoint')
ORDER BY (CASE r.string_value
            WHEN 'diary'     THEN 0   -- curated narrative, highest signal
            WHEN 'decisions' THEN 1   -- DR/ADR records: settled rulings
            WHEN 'retros'    THEN 2   -- durable session findings
            WHEN 'tasks'     THEN 3   -- ordna task state
            WHEN 'archive'   THEN 9   -- DR-106 stale families
            WHEN 'emotional' THEN 9   -- misfiring classifier (id-411 / id-446)
            ELSE 5
          END), f.rowid DESC
LIMIT 8"
```

Constraints (non-negotiable):

- **Escape the MATCH quotes as `\"`, on the seeds you substitute in too.**
  FTS5 reads `-` as a column filter, so a bare hyphenated seed fails:
  `MATCH 'id-145 OR okf'` → `Error: stepping, no such column: 145`. The trap is
  that the SQL sits inside a double-quoted shell argument, so a plain `"` is
  eaten by the shell and you silently get the bare form back. Only `\"`
  survives to sqlite. This bites exactly when the fallback is needed — the
  seeds are task ids and `DR-NNN`s, and MCP recall is already down.
- **Lock-free only** — `mode=ro&immutable=1`, WAL sqlite read. NEVER open a
  chromadb writer, and NEVER route through a mempalace CLI write in this path.
- **`wing=`/`room=` filters are safe here** — on this direct read they are
  plain sqlite metadata joins. Filter freely.
- **Seed with what the conclusion needs** — the task id(s), `DR-NNN`, topic
  keywords — never a bare wildcard.

**Fail open, but only after this read has itself failed.** The sequence is: MCP
recall errors → run the read above → *if that errors too*, or the palace file is
absent or corrupt, tell the user memory is degraded and proceed. Never block on
recall; equally, never claim degraded memory while the lock-free path is
untried. This is a sqlite read of a file on disk — it survives the outages that
take the MCP server down.

## 2. When a *filtered* MCP search degrades

A `mempalace_search` scoped by `room:`/`wing:` is a first-class move — those are
genuine ChromaDB pre-filters, not post-filters. If a filtered query errors or
returns 0 for terms that match unfiltered, that is
`_query_drawers_with_filter_fallback` degrading because the HNSW index is
inconsistent with the metadata store.

The remedy is a palace repair + `mempalace_reconnect`, **not** filter avoidance.
An unscoped pass filtered client-side is only the stopgap until that runs, and
the noise filters still apply to it — `CHECKPOINT:` drawers live inside
`room='diary'` too.

Two repair-adjacent caveats:

- A plain `repair --mode from-sqlite` resets `hnsw:sync_threshold` to 2 and
  silently re-arms the vector-search outage — every rebuild must re-pin it to
  1000 (DR-110).
- While HNSW divergence exceeds tolerance, recall silently degrades to
  `bm25_only_via_sqlite`: filtered searches still answer, riding BM25, until the
  repair/compaction catches up.

Depth: docs-site `runbooks/mempalace-repair.md` (§10.5 for the diary-ranking
rationale).

## 3. On-demand historic stores

The live palace is not the whole record. Reach for these only when it comes up
empty on older work.

- **Palace snapshots.** Every repair/rebuild leaves a dated copy beside the live
  palace, carrying pre-reset transcript history the live palace no longer holds.
  Each is a plain chroma sqlite file, so §1's recipe reads it unchanged with
  only the path swapped:

  ```bash
  ls -1d "$HOME"/.mempalace/palace.backup-* "$HOME"/.mempalace/palace.pre-rebuild-*
  # re-run the §1 query against <snapshot>/chroma.sqlite3, same lock-free URI
  ```

  Point-in-time by construction — verify anything they return against the
  current docs-site before trusting it.

- **The `knowledge-hub-archive` repo** — pre-cutover planning as files, not
  drawers. No palace and no MCP surface: `git log` / `grep` the checkout
  directly (CLAUDE.md § Key References names it as the historical-planning
  home). Reach here when the question is "what did the plan say then" —
  archaeology the palace was never the best surface for.
