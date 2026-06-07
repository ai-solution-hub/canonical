# cmux Sub-Orchestrator Brief — S275 / ID-53 Wave A (4 parallel executors)

**Worker name:** `subo-id-53-wave-a` **Parent tip SHA:** `67e93b11` **Worker branch:**
`cmux-worker-subo-id-53-wave-a-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-53 record (`in_progress`); Subtasks
   53.5/53.6/53.7/53.8 (all `pending`, all deps `[]`).
2. `docs/specs/id-53-stage-5-entity-resolution/{RESEARCH,PRODUCT,TECH,PLAN}.md` — full
   spec chain (committed S274). PLAN §3 has per-Subtask scope.
3. `scripts/cocoindex_pipeline/flow.py` + `scripts/cocoindex_pipeline/extraction.py` —
   Stage-5 placeholder + extract_entity_mentions baseline.
4. `lib/entities/entity-context.ts:19 extractEntityContext` — TypeScript source for {53.8}
   Python port.
5. `supabase/types/database.types.ts` — `entity_mentions` row shape (verify no `op_id`
   column → {53.5} adds it).
6. `requirements.txt` — alphabetical pin discipline (line 38 = `cocoindex==…`; {53.6} adds
   `faiss-cpu==1.14.2` after).
7. `.claude/skills/implement-subtask/SKILL.md`.

## Scope — Wave A: 4 PARALLEL executors per Liam S274 ratification

Liam: "ONE cmux + 4 parallel task-executors for {53.5/6/7/8} (deps `[]` independent)."

### Phase 1 — Dispatch 4 task-executor Agents in parallel

Use the Agent tool with `isolation: "worktree"` × 4 in a SINGLE message (parallel):

| Subtask    | File ownership                                                                                  | Brief slice                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **{53.5}** | `supabase/migrations/<new>.sql` only                                                            | DDL: `ALTER TABLE entity_mentions ADD COLUMN IF NOT EXISTS op_id uuid NULL` + partial B-tree index + COMMENT + new `entity_pair_resolutions` cache table. Apply via Supabase CLI (NEVER `mcp__supabase__apply_migration`). |
| **{53.6}** | `requirements.txt` only                                                                         | Single-line append `faiss-cpu==1.14.2` alphabetically after `cocoindex==…`. Exact-pin discipline.                                                                                                                          |
| **{53.7}** | NEW `scripts/cocoindex_pipeline/canonicalisation.py` + `scripts/tests/test_canonicalisation.py` | Pure function `canonicalise_entity_name(name, entity_type)`. Per TECH §P-2 algorithm. Tests cover ISO27001/ISO 27001:2022/iso/iec 27001 → 'iso 27001' + idempotent.                                                        |
| **{53.8}** | NEW `scripts/cocoindex_pipeline/entity_context.py` + `scripts/tests/test_entity_context.py`     | Verbatim port of `lib/entities/entity-context.ts:19 extractEntityContext`. Tests cover empty inputs, not-found, start/end/mid-text, case-insensitive. Byte-match vs TS port over fixture set.                              |

File ownership DISJOINT — safe to parallelise.

### Phase 2 — Checker gate per Executor

After each Executor commits, dispatch `task-checker` (variant=standard) against that
single Subtask. FAIL→fix-Executor→re-Check loop. PER-SUBTASK (4 separate Checker
dispatches).

### Phase 3 — Cherry-pick onto worker branch

Sequential cherry-pick of the 4 Executor commits onto your worker branch (deterministic
order: 53.5 → 53.6 → 53.7 → 53.8). On conflict, invoke `resolve-merge-conflicts` skill. If
cherry-pick silently no-ops (S274 OQ-S274-1 aliasing), fall back to
`git format-patch | git am`.

### Phase 4 — Ledger writes

For each of 53.5/53.6/53.7/53.8: append `<info added on …>` journal block + flip status
`pending` → `done` via ledger CLI (`update-subtask --scoped`). DO NOT flip ID-53 parent
(stays `in_progress`).

## Wave B unlock (NEXT-session work, not yours)

After Wave A lands: 53.9 `KhEntityEmbedder` + 53.10 TableTarget mount + 53.12
`KhPairResolver` (deps on Wave A outputs). Out of scope for this brief — flag in
final_report.

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner-free (impl-only Subtasks; specs already
  committed).
- **Fresh Checker per Subtask** (4 separate dispatches).
- **You own ALL ledger writes** (4 status flips + 4 journals).
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Bubble OQs via OQ-escalation channel.
- **CLAUDE.md DDL gotcha:** {53.5} migration ONLY via `supabase migration new` +
  `db push`, NEVER `mcp__supabase__apply_migration`. Verify
  `cat supabase/.temp/project-ref` before any push.
- **Worktree isolation:** 4 Executor worktrees branched from your worker tip; disjoint
  file ownership.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `subtask_commits` (map), `checker_verdicts` (map), `status_flips`,
  `migration_applied_branch`, `tests_added`, `OQs_for_parent` (incl. anything
  Wave-B-blocking surfaced).

## Success criteria

- 53.5/53.6/53.7/53.8 all `done` on ledger with journal blocks.
- Migration applied clean on staging Supabase branch.
- `faiss-cpu==1.14.2` pinned in requirements.txt.
- 2 new Python modules + 2 new test files committed.
- Wave B unblocked.
