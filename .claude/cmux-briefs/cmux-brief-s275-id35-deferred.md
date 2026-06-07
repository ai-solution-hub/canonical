# cmux Sub-Orchestrator Brief — S275 / ID-35 deferred follow-ups (35.27-33 + 35.39)

**Worker name:** `subo-id-35` **Parent tip SHA:** `67e93b11` **Worker branch:**
`cmux-worker-subo-id-35-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-35 record (parent `done`); Subtasks
   35.27/28/29/30/31/32/33/39 (all `pending`).
2. `scripts/ledger-cli.ts` — canonical CLI; all 8 Subtasks fix defects here.
3. `lib/validation/{task-list,roadmap,backlog}-schema.ts` — schema layer.
4. `scripts/tests/ledger-cli/` — test bed (110/110 GREEN baseline on `main`).
5. `docs/research/ledger-cli-dogfooding-s270.md` — original S270 findings drove the
   35.27-33 backlog.
6. `.claude/skills/implement-subtask/SKILL.md`.

## Scope — 8 single-file ledger-CLI defect fixes

Per S271 §13.7 single-Executor-per-file discipline: each Subtask owns its file slice;
parallel only when ownership disjoint.

Subtasks:

- **{35.27}** budget-exceeded error mislabels subtask as 'task N' instead of 'subtask
  T.N'.
- **{35.28}** add-subtask --id N stays string (no coerce → schema-error); auto-id
  workaround documented.
- **{35.29}** open-task / update-task --depends N coerces to number (string[] field
  rejects).
- **{35.30}** add-subtask success stdout = 34-67KB warnings dump (suppress / scope to
  mutated record).
- **{35.31}** description char-budget counts multibyte glyphs confusingly (→ § etc).
- **{35.32}** mutating calls print regen-mirrors advice even with --no-regen-mirrors.
- **{35.33}** first session write triggers detached-HEAD task-view clone noise in stdout.
- **{35.39}** ledger-CLI v2 capability bundle + workflow-orch backlog-pickup drift
  (consolidated T-35 OQs from S274 — 3 CLI capability gaps + workflow-orchestration
  drift).

### Phase 1 — Dispatch strategy

35.27/30/31/32/33 likely DISJOINT slices within `scripts/ledger-cli.ts` (different
functions / output paths). 35.28+35.29 may share argument-coercion site → MUST sequence
(not parallel).

Recommended sequencing:

- **Wave 1 (sequential — argument coercion)**: 35.28 → 35.29 (shared coerce site)
- **Wave 2 (parallel — disjoint slices)**: 35.27 + 35.30 + 35.31 + 35.32 + 35.33 — verify
  file-ownership disjoint up front; reduce parallel set if overlap surfaces.
- **Wave 3 (sequential — consolidated)**: 35.39 (touches multiple layers; treat as
  integration sweep).

Use Agent tool `isolation: "worktree"` per Executor.

### Phase 2 — Checker gate per Subtask

After each Executor commit, dispatch `task-checker` (variant=standard). FAIL→fix→re-Check.

### Phase 3 — Cherry-pick + ledger writes

Sequential cherry-pick onto your worker branch in commit-order. Append journal + flip
status `pending` → `done` per Subtask. ID-35 parent stays `done` (no re-flip).

### Phase 4 — Dogfood

Use the ledger CLI to write your own journal blocks. Surface any defect re-encountered as
a fresh finding (record in final_report).

## Open Questions to surface to parent

- **OQ-35-A**: 35.39 scope ambiguity — if "ledger-CLI v2 capability bundle" implies
  architectural changes beyond bug-fixes, escalate before starting (likely needs spec, not
  impl).
- **OQ-35-B**: 35.30 — "warnings dump" suppression strategy. Options: scope warnings to
  mutated record / silent mode flag / move warnings to stderr. Surface Executor's choice +
  rationale.

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner-free (impl Subtasks; defect-fixes against existing
  CLI).
- **Single-Executor-per-file** (S271 §13.7) — verify ownership disjoint before parallel
  dispatch.
- **Fresh Checker per Subtask**.
- **You own ALL ledger writes** (8 status flips + 8 journals).
- **No `AskUserQuestion` — NESTED-AGENT BAN.** Bubble OQs.
- **Tests:** keep ledger-CLI test suite GREEN. If a fix requires a new test case, add it;
  if a fix exposes a broken existing test, escalate not patch-through.
- **Worktree isolation** per Executor.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `subtask_commits`, `checker_verdicts`, `status_flips`, `tests_added`,
  `tests_modified`, `OQs_for_parent`, `dogfood_findings` (defects re-encountered while
  doing the work).

## Success criteria

- 8 Subtasks (35.27/28/29/30/31/32/33/39) all `done` on ledger with journal blocks.
- `scripts/tests/ledger-cli/` test suite still GREEN (110+).
- No new defect introduced (verify with test bed).
- Dogfood findings (if any) flagged for next-wave pickup.
