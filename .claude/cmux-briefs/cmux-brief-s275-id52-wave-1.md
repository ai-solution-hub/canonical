# cmux Sub-Orchestrator Brief — S275 / ID-52 Wave-1 form-extraction kick-off

**Worker name:** `subo-id-52-wave-1` **Parent tip SHA:** `67e93b11` **Worker branch:**
`cmux-worker-subo-id-52-wave-1-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-52 record (`in_progress`); Subtasks
   52.5/52.6/52.7/52.8 (all `pending`).
2. `docs/specs/id-52-form-extraction/{RESEARCH,PRODUCT,TECH,PLAN}.md` — full spec chain
   (committed S274; PLAN has 12 impl Subtasks across 6 waves).
3. PLAN §Wave-1 (52.5/6/7/8) — scope detail.
4. `lib/ontology/` (R4 CV-loader site) — {52.5} re-baseline target.
5. `scripts/tests/fixtures/taxonomy_snapshot.json` — Python pipeline taxonomy source (per
   CLAUDE.md gotcha).
6. `lib/taxonomy/taxonomy.ts` — 24-line shim (content types + platforms only).
7. `.claude/skills/implement-subtask/SKILL.md`.

## Scope — Wave-1: gated then fan-out

Dependency shape (verified from task-list):

- {52.5} CV-loader re-baseline + stale-claim correction — deps `[]`
- {52.6} form_type triple-source lockstep — deps `[5]`
- {52.7} Migration M1 schema additions — deps `[5]`
- {52.8} Workspace manifest schema + folder→workspace resolver — deps `[]`

### Phase 1 — Sequential gate: {52.5} FIRST

Dispatch ONE `task-executor` for {52.5}. CV-loader re-baseline + stale-claim correction —
this is the R4 ontology gate that ratifies the foundational claim for the remainder of the
form-extraction wave. PLAN §Wave-1 prerequisite per Liam S274.

Checker gate (variant=standard). FAIL→fix→re-Check.

Commit + cherry-pick to worker branch BEFORE proceeding to Phase 2.

### Phase 2 — Parallel fan-out: {52.6}, {52.7}, {52.8}

After {52.5} `done`, dispatch 3 `task-executor` Agents in parallel (single message,
`isolation: "worktree"` × 3):

| Subtask    | File ownership                                                                                              | Brief slice                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **{52.6}** | Snapshot fixture + Vitest parity test file                                                                  | form_type triple-source lockstep. Test asserts identical enum across {DB form_type CHECK constraint, Python taxonomy snapshot, TS shim if applicable}. |
| **{52.7}** | `supabase/migrations/<new>.sql` only                                                                        | Migration M1: schema additions + CHECK widening on `form_template_fields` + `form_templates`. CLI-only DDL.                                            |
| **{52.8}** | NEW Python module under `scripts/cocoindex_pipeline/` (or `scripts/kb_pipeline/` per workspace conventions) | Workspace manifest schema + folder→workspace resolver.                                                                                                 |

File ownership DISJOINT.

### Phase 3 — Per-Executor Checker gate + sequential cherry-pick

Same shape as ID-53 Wave A — Checker per Subtask, sequential cherry-pick (52.6 → 52.7 →
52.8) onto worker branch. format-patch+am fallback on aliasing.

### Phase 4 — Ledger writes

Append journal blocks + flip statuses for 52.5/52.6/52.7/52.8 via ledger CLI. DO NOT flip
ID-52 parent (stays `in_progress`).

## Cross-Task coordination — FLAGGED

**ID-52.15 (analyse/route.ts retirement)** must sequence BEFORE any ID-50 wave touching
`procurement/[id]/templates`. NOT in Wave-1 scope but parent-Orchestrator must remember
when ID-50 dispatch happens. Surface in final_report as cross-Task dependency reminder.

## Open Questions to surface to parent

- **OQ-52-WAVE-1-A**: If CV-loader baseline ({52.5}) reveals deeper ontology drift than
  Phase-0 expected, escalate before starting {52.6/7/8}.
- **OQ-52-WAVE-1-B**: M1 migration ({52.7}) — if widening CHECK constraints requires
  backfill of existing rows, defer impl + escalate (no silent data migration).

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner-free (specs committed; impl-only).
- **Fresh Checker per Subtask** (4 separate dispatches).
- **You own ALL ledger writes** (4 status flips + 4 journals).
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Bubble OQs.
- **CLAUDE.md DDL gotcha:** {52.7} migration CLI-only.
- **CLAUDE.md taxonomy gotcha:** Python pipeline reads
  `scripts/tests/fixtures/taxonomy_snapshot.json` — {52.6} parity test must verify all 3
  sources in lockstep.
- **Worktree isolation:** Phase-1 sequential; Phase-2 parallel (3 Executors disjoint).
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `subtask_commits`, `checker_verdicts`, `status_flips`,
  `migration_applied_branch`, `cv_loader_findings` (re-baseline result),
  `cross_task_reminder_id_52_15`, `OQs_for_parent`.

## Success criteria

- 52.5/52.6/52.7/52.8 all `done` on ledger with journal blocks.
- Migration applied clean on staging.
- form_type triple-source parity test GREEN.
- CV-loader baseline ratified.
- Wave-2 ({52.9/10/11}) unblocked.
