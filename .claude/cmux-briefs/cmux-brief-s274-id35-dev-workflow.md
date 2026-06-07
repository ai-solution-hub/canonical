# cmux Sub-Orchestrator Brief — S274 / ID-35 dev-workflow (35.26 + 35.34 + new review subtask)

**Worker name:** `subo-id-35-dev-wf` **Parent tip SHA:** `f63aba0a` **Worker branch:**
`cmux-worker-subo-id-35-dev-wf-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-35 record (currently `done`; Subtasks 35.26
   through 35.34 are S273-promoted defects, `pending`).
2. `lib/ledger/` (full directory) — the ledger-CLI implementation surface.
3. `bin/ledger-cli.ts` + `scripts/regen-mirrors.sh` — entry point + mirror sync.
4. `docs/reference/task-list-discipline.md` — canonical field discipline.
5. `.claude/agents/workflow-curator.md` — agent file to be reviewed in the new Subtask.
6. `.claude/skills/triage-finding/SKILL.md` +
   `.claude/skills/update-roadmap-backlog/SKILL.md` — skills to be reviewed.
7. `.claude/skills/update-skill/SKILL.md` + `.claude/skills/agent-development/SKILL.md` —
   the authoring skills child Executors will invoke.

## Scope — 2 known Subtasks + 1 NEW Subtask + parallel skill/agent review

### Phase 1: Author NEW review Subtask (USER DIRECTIVE)

Per Liam S274: "add a new subtask for reviewing current workflow-curator agent file, and
triage/roadmap promote skills, to update with new ledger CLI context. Review to take place
in parallel with current subtasks, but skill and agent updates MUST be their own
individual subtasks i.e, one task-executor invokes /update-skill, or /agent-development,
per file being updated."

Author the review Subtask under ID-35 (next free subtask id, likely `35.35`). Its scope:

- READ-ONLY review pass over: `.claude/agents/workflow-curator.md` +
  `.claude/skills/triage-finding/SKILL.md` +
  `.claude/skills/update-roadmap-backlog/SKILL.md`.
- Output: a review findings document (e.g.,
  `docs/research/s274-curator-ledger-cli-review.md`) listing each file + concrete update
  items (ledger CLI commands that should replace any stale manual-edit/Edit-tool guidance;
  new defects-handled patterns; budget-precheck / discoverability surfaces).
- Review DOES NOT do the updates — it produces the findings packet.
- After review-Subtask Checker PASS, you author 3 separate update-Subtasks (one per file):
  - `35.36` (or next): update `.claude/agents/workflow-curator.md` — child Executor
    invokes `/agent-development` skill.
  - `35.37` (or next): update `.claude/skills/triage-finding/SKILL.md` — child Executor
    invokes `/update-skill` skill.
  - `35.38` (or next): update `.claude/skills/update-roadmap-backlog/SKILL.md` — child
    Executor invokes `/update-skill` skill.
- **CRITICAL discipline**: one Executor per file; the Executor MUST invoke the relevant
  authoring skill (per ID-48 PLAN.md §13.7 build-phase constraint #2 — no copy-pasting
  patterns by hand).

### Phase 2: ID-35.26 implementation — update-subtask budget-precheck

- Read 35.26 description from `task-list.json` (171-char title: "ledger-CLI:
  update-subtask budget-precheck blocks edits on untouched over-budget description").
- Dispatch ONE `task-executor` via `implement-subtask`.
- Surface: `lib/ledger/operations.ts` (or wherever update-subtask precheck lives) +
  relevant validation in `lib/validation/task-list-schema.ts`.
- Child must invoke GitNexus impact-analysis on the function it modifies (CLAUDE.md gotcha
  — MUST before editing).
- Test added to `__tests__/ledger/` covering the budget-precheck on untouched over-budget
  descriptions.
- `task-checker` gate.

### Phase 3: ID-35.34 implementation — discoverability ("get" alias)

- Read 35.34 description (158-char title: "ledger-CLI: discoverability — no 'show-task' /
  'get' alias; help only shown on error or --help").
- Dispatch ONE `task-executor`.
- Surface: `bin/ledger-cli.ts` (or `lib/ledger/cli.ts`) — add `get` or `show-task` alias
  mapping to existing `show` subcommand; surface help via top-level `--help` not just on
  error.
- Test in `__tests__/ledger/` covering alias resolution + `--help` exit code 0.
- `task-checker` gate.

### Phase 4: Review-Subtask + 3 update-Subtasks (sequential dispatch after Phase 1 author)

Review-Subtask (`35.35` or next) — dispatch ONE `task-executor` (read-only research mode):

- Brief: read the 3 files in scope; identify update items relative to S273 ledger-CLI
  defect list (35.26–34) + current ledger-CLI capability (the agent file may reference
  `Edit` tool for ledger writes — should reference `bun bin/ledger-cli.ts` commands
  instead).
- Output: `docs/research/s274-curator-ledger-cli-review.md` with findings per file.
- `task-checker` gate.

Then 3 update-Subtasks IN PARALLEL (per Liam — "Review to take place in parallel with
current subtasks" — but skill/agent updates themselves MUST be individual Subtasks):

- `35.36`: ONE `task-executor` invoking `/agent-development` skill — applies review
  findings to `.claude/agents/workflow-curator.md`.
- `35.37`: ONE `task-executor` invoking `/update-skill` skill — applies review findings to
  `.claude/skills/triage-finding/SKILL.md`.
- `35.38`: ONE `task-executor` invoking `/update-skill` skill — applies review findings to
  `.claude/skills/update-roadmap-backlog/SKILL.md`.

Per S271 RESEARCH §13.7: **one task-executor per skill invoked, sequential** — no fan-out
across multiple agent/skill files in a single executor. So launch these 3 update-Subtasks
sequentially (not parallel-fan-out within one Executor).

Each gets `task-checker` gate. The sentinel from `/update-skill` / `/agent-development`
must be present in the worktree before the file edit (Hook 1 from ID-48 backstops this —
currently not landed but the discipline applies regardless).

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner / Executor / Checker dispatches only.
- **You own ALL ledger writes.** All Subtask records you author (35.35–35.38 plus journal
  blocks) go via ledger CLI.
- **No `AskUserQuestion` — NESTED-AGENT BAN.**
- **Cherry-pick safety:** child Executors first action =
  `git fetch origin main && git reset --hard origin/main` (you cherry-pick onto your
  worker branch).
- **GitNexus discipline:** child Executors MUST run `gitnexus_impact` before editing
  functions (CLAUDE.md). Report blast-radius if HIGH/CRITICAL.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `subtasks_completed` (35.26, 35.34, 35.35, 35.36, 35.37, 35.38), `commits`,
  `review_doc_path`, `findings_per_file`, `OQs_for_parent`.

## Success criteria

- 35.26 + 35.34 + 35.35 + 35.36 + 35.37 + 35.38 = 6 Subtasks completed.
- 3 SKILL/agent files updated via their respective authoring skills (no hand-edits).
- Review doc at `docs/research/s274-curator-ledger-cli-review.md`.
- All Checker verdicts PASS or PASS_WITH_NOTES-all-resolved.
- Final report YAML present.

## DO NOT

- DO NOT hand-edit `.claude/agents/workflow-curator.md` or the 2 skill files — child
  Executors MUST invoke `/update-skill` or `/agent-development`.
- DO NOT batch the 3 update-Subtasks into one Executor — one Executor per file, sequential
  (S271 RESEARCH §13.7).
- DO NOT touch any Task other than ID-35 (incl. its new subtasks) in `task-list.json`.
- DO NOT push to `origin`.
