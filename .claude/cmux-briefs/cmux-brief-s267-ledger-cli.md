# cmux sub-orchestrator brief — S267 — ledger-cli (Tasks ID-34 → ID-35)

You are a **sub-orchestrator** in Knowledge Hub's parallel-cmux phase (S267). You drive
**TWO coupled Tasks** end-to-end on your own worktree branch: **ID-34 FIRST** (it defines
the field discipline ID-35's CLI must enforce), **THEN ID-35**. The parent
(orchestrator-of-orchestrators) cherry-picks your commits back to `main` at teardown.

## First actions (orient — you are NOT stale)

Branched from `main` HEAD `73ffb2b4` into your own worktree. Do **NOT**
`git reset --hard origin/main`. Just orient:

1. `pwd && git branch --show-current && git status` — confirm
   `cmux-worker-ledger-cli-73ffb2b4`, clean.
2. Load the **workflow-orchestration** skill — your SDLC backbone.

## Paths: RELATIVE ONLY (`docs/...`, `scripts/...`, `../task-view` for the sibling repo).

## Tooling per worktree: fresh checkout, no `node_modules` — `bun install` at repo root

before running `tsc`/lint/the CLI.

## Commit model: worker-branch-only — incremental commits on YOUR branch, no push, no

`main`. Trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Open Questions: NEVER AskUserQuestion (headless → stalls). Write `OQ-pending.md` at

worktree root (question + options + your provisional default + why), apply the default,
CONTINUE. Parent relays overrides.

## Workflow discipline (load-bearing): validate against INSTALLED code (specs cited

fictional APIs TWICE in S264/265); non-vacuous AC; `bun run format` before commit; test
before each commit.

## Skill edits — hook policy: ID-34's skill updates (workflow-orchestration /

write-product-spec / write-tech-spec / planning-and-task-breakdown) — invoke
**update-skill** (the workflow-security hook may block the FIRST raw `.claude/skills/`
edit once — retry succeeds).

## Final report: write `.claude/cmux-events/final-report-ledger-cli.yaml` (gitignored)

before finishing —
`{summary, commits, subtask_dispositions, OQs_for_parent, next_session_handoff}`.

## Ledger updates: flip ONLY ID-34/ID-35 subtask statuses + journal blocks. Task deps =

STRINGS, subtask deps = NUMBERS. Tasks have NO `details` field. 4 terminals share
task-list.json — keep edits scoped to your two Tasks' records.

---

## TASK 1 (FIRST): ID-34 — Task-list description discipline + content audit (`should`)

Spec chain {34.1–34.4} all pending: 34.1 RESEARCH (per-field length audit + canonical-ref
vs traceability boundary) → 34.2 PRODUCT (per-field discipline invariants + sweep policy)
→ 34.3 TECH (doc-location decision + skill-update map) → 34.4 PLAN (decompose sweep +
skill updates into {34.5+}).

- **The deliverable ID-35 needs:** the **field-discipline DEFINITION** —
  `docs/reference/task-list-discipline.md` OR an extension of
  `docs/reference/taskmaster-schema-reference.md` (34.3 TECH decides location).
- Per-field boundary: `description` (compact what+why) / `status_note` (acute carryover) /
  `details` (subtask dispatch-brief slice) / `testStrategy` (one-line acceptance) /
  `cross_doc_links` (canonical-ref anchors).
- Skill-update targets: workflow-orchestration, write-product-spec, write-tech-spec,
  planning-and-task-breakdown.
- **⚠ Retroactive description sweep (a {34.5+} subtask) = LOWER PRIORITY + integration-
  sensitive.** It is a BROAD `task-list.json` edit; 4 parallel terminals share that file.
  Do the spec chain + discipline doc + skill updates FIRST. Attempt the sweep LAST, and
  write `OQ-pending.md` flagging the parent BEFORE any broad description rewrite — the
  parent sequences it against the other terminals' status flips.

## TASK 2 (THEN): ID-35 — Ledger mutation CLI (`bun scripts/ledger-cli.ts`) (`should`)

deps: ID-20 (DONE — task-view v0.2.0 shipped) + ID-34 (your work above). Spec chain
{35.1–35.4} pending, THEN build {35.5+}. The CLI replaces the cumbersome hand-written
python `/tmp/claude/*.py` ledger-splice scripts.

- {35.1} RESEARCH: inventory the ~10 mutation primitives (open-task, flip-task,
  flip-subtask, add-subtask, append-journal, promote, create/update/delete-backlog, show);
  audit task-view's shipped patch primitives for reuse; resolve workspace-dep-vs-vendor;
  surface OQs. {35.2} PRODUCT → {35.3} TECH → {35.4} PLAN → build.
- **VERIFY against installed task-view** (the sibling repo is at `../task-view`, commit
  `5652135` = v0.2.0). Audit which primitives actually exist: `applyPatches`,
  `atomicWriteFile`, the record-level routes (`/api/ledger/record`,
  `/api/ledger/transaction`) in `packages/server/patch-server.ts`; re-import the Zod
  schemas (`TaskListSchema`/`BacklogSchema`/`RoadmapSchema`).
- **⚠ GATE RISK:** 4 of 10 subcommands (open-task, create-backlog, delete-backlog,
  promote) need NEW record-level primitives the spec marks "gated on ID-20.15". **VERIFY
  whether v0.2.0 ships these or they need extension.** If they need NEW task-view
  primitives that aren't shipped → write `OQ-pending.md` (do not build against fiction;
  surface to parent — may scope the CLI to the supported subcommands + defer the 4).
- First dogfood: open ID-35 itself via the CLI's Promote primitive once built
  (self-bootstrapping).

### Canonical refs

- `docs/research/id-35-crossover-audit.md` (S62E sub-o 2 audit §2/§4)
- ID-35 record in `task-list.json` (10-subcommand surface, REJECTED alternatives)
- the task-view repo at `../task-view` (`packages/server/patch-server.ts`,
  `packages/schemas/`)

### Files

`docs/specs/id-35-ledger-cli/`, `scripts/ledger-cli.ts`, `lib/ledger/` (if vendoring),
`package.json` (if workspace dep `file:../task-view`),
`docs/reference/task-list-discipline.md` (ID-34),
`.claude/skills/{workflow-orchestration,write-product-spec,write-tech-spec,planning-and-task-breakdown}/SKILL.md`
(ID-34 skill updates, via update-skill).
