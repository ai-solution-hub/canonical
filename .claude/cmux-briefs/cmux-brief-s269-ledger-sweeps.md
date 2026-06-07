# cmux brief — S269 ledger-sweeps sub-orchestrator

You are a **SUB-ORCHESTRATOR**, not a leaf worker. Load the `workflow-orchestration` skill
first. For every Subtask, **DISPATCH a task-executor via the Agent tool, then GATE it with
a task-checker (FAIL→fix→PASS) BEFORE committing.** Do NOT write the code/docs directly as
your own deliverable — that is the Executor role.

**First action (agents start stale):**
`git fetch origin main && git reset --hard origin/main`.

**Paths:** relative only. The PreToolUse hook blocks `cd` to the KH repo root — use
relative paths / `git -C`.

---

## Mission

Two coupled ledger Subtasks: **ID-35.11** (scoped-write CLI mode) then **ID-34.8**
(retroactive description sweep). Read both records in `docs/reference/task-list.json`
(parse via `parseTaskListWithWarnings` from `lib/validation/task-list-schema.ts`, never
raw `JSON.parse`). Grounding: `docs/specs/id-35-ledger-cli/PLAN.md` (follow-up section)
and the ID-34 PRODUCT.md §4 sweep policy (`docs/specs/id-34-task-list-discipline/` —
confirm path from the ID-34 `cross_doc_links`; the canonical discipline doc is
`docs/reference/task-list-discipline.md`).

## Order of work

### 1. ID-35.11 — scoped-write CLI mode (do this FIRST; it is the enabler)

Add a scoped write mode to `scripts/ledger-cli.ts` that re-emits ONLY the mutated
record(s), preserving the untouched records' bytes (the default
`JSON.stringify(parsed, null, 2)` write normalises key order across ALL records via the
Zod re-parse — too broad for the shared ledger). This is a disjoint code file —
parallel-safe with the sibling terminals. testStrategy: a mutation to one record leaves
all other records byte-identical (git diff touches only the mutated record's lines).

### 2. ID-34.8 — retroactive description sweep (USE the new scoped-write mode)

Relocate over-budget fields per the ID-34 PRODUCT §4 policy: rationale → `docs/` +
`cross_doc_links`; session narrative → `details` journal blocks. Worklist = the
over-budget records from the `parseTaskListWithWarnings` warning set (~228 warnings).
Apply each record's edit via the {35.11} scoped-write mode so each swept record's diff is
localized and cherry-pickable.

**EXCLUDE ID-20 and ID-49 from the sweep** — both are under concurrent edit by sibling
terminals this session (task-view-retest journals ID-20; the ID-49.8 executor journals
ID-49). Sweeping them would collide at integration. Target the genuinely over-budget
long-description Tasks (the original ID-30 / ID-31 ~3000-char descriptions and the rest of
the worklist) that no other track touches. ID-34 and ID-35 themselves are yours to sweep.

### DEFER — the ID-35.11 one-time whole-file key-order normalisation pass

35.11's record notes pair the scoped-write mode with a "one-time normalisation pass at the
CLI-becomes-sole-writer transition." That transition is NOT now: this session has THREE
concurrent `task-list.json` writers. A whole-file key-order normalisation mid-cmux would
collide with every sibling branch. **Do NOT run it this session.** Journal it as deferred
to the next genuine sole-writer moment, in the ID-35.11 `details`.

## Coordination — task-list.json is shared this session

Sibling terminals touch the ID-20 (task-view) and ID-49 (49.8 executor) records. You own
ID-34, ID-35, and the swept over-budget records (excluding ID-20/ID-49). Every write goes
through the scoped-write mode (key-order-preserving, per-record) — NEVER a whole-file
re-serialise this session.

## Close-out

- Commit on your worker branch via `commit-commands` (Co-Authored-By trailer for
  `Claude Opus 4.7 (1M context)`). Separate commits for {35.11} code and {34.8} sweep.
- Move ID-35.11 and ID-34.8 status `pending → in-progress`; the task-checker you gate with
  marks them `done` on PASS.
- Before `/exit`, write your final report to `<events_dir>/final_report.yaml` — sections
  `{summary, commits, swept_records (and the explicit ID-20/ID-49 exclusions), deferred (the one-time normalisation), dispositions, OQs_for_parent, next_session_handoff}`.
- Surface Open Questions via the OQ-escalation channel
  (`docs/specs/id-43-oq-escalation/PRODUCT.md`).
