# cmux brief — S270 nav-build sub-orchestrator

You are a **SUB-ORCHESTRATOR**, not a leaf worker. Load the `workflow-orchestration` skill
first. For every unit of work, **DISPATCH a task-planner and/or task-executor via the
Agent tool, then GATE each with a task-checker (FAIL→fix→PASS) BEFORE committing.** Do NOT
author specs/plans or write code directly as your own deliverable — that is the
Planner/Executor role.

**First action (agents start stale):**
`git fetch origin main && git reset --hard origin/main` (your KH worktree only — do NOT
reset the `../task-view` fork; it carries unpushed local work).

**Paths:** relative only. The PreToolUse hook blocks `cd` to the KH repo root — use
relative paths / `git -C`. `cd` to the SIBLING `../task-view` repo IS allowed.

---

## Mission

Build **cross-ledger navigation** in the task-view FORK (`../task-view`). Liam ratified it
lands as **ID-20 subtask `{20.29}`** (NOT a new Task; OQ-S269-A option (b)). task-view
launches one-ledger-per-launch (inv 43, BY DESIGN); cross-ledger nav is the NEW capability
to traverse between records that live in DIFFERENT ledgers (task-list ↔ roadmap ↔ backlog)
via their cross-ledger relationships (`cross_doc_links`, promote / `linked_tasks`).

Grounding (read first):

- `docs/specs/id-20-per-task-mirror/PRODUCT.md` — inv 43 (one-ledger-per-launch) + the
  inv-50/inv-2 fork-divergence annotations.
- ID-20.15 record — the record-level CREATE/DELETE + **cross-ledger transaction patch
  endpoints** already shipped (the nav substrate).
- `docs/continuation-prompts/s269-worker-reports/tv-retest-final-report.yaml` — the nav OQ
  resolution + the S269 live-viewer re-test lesson.
- The task-view FORK is the sibling clone at `../task-view` (separate git repo, SSH
  remote).

## CRITICAL — fork-only; do NOT touch KH `task-list.json`

The sibling ledger-finalise terminal is concurrently running a whole-file `task-list.json`
normalisation. **Make ZERO edits to KH `docs/reference/task-list.json`.** You do not
create the `{20.29}` record — the orchestrator owns it (created after the normalisation
lands). Report a `{20.29}` record spec in your final report for the orchestrator to write.
Your KH worktree is for RUNNING task-view against the three live KH ledgers (test data)
only.

## Order of work

1. **Plan (task-planner):** design the cross-ledger nav slice — UX (how a record
   links/jumps across ledgers), the data model (which cross-ledger relationships drive
   nav), and how it composes with the existing 20.15 cross-ledger transaction endpoints +
   the one-ledger-per-launch model.
2. **Build (task-executor, in the FORK):** branch off the fork's current head —
   `git -C ../task-view checkout -b feat/20.29-cross-ledger-nav s269-retest-version-fix`.
   Implement nav there. (`bun install` + build in `../task-view` if needed; a fresh clone
   resolves deps via the global bun cache.)
3. **Gate (task-checker):** assert against the **LIVE hydrated viewer** via the
   `agent-browser` skill driving the task-view server against the real KH ledgers — NOT
   on-disk artefacts / hardcoded literals / unit tests (that vacuity is exactly how the
   S269 ID-20.13/16/18 false-PASSes slipped).

## Close-out

- Fork-side commits stay in `../task-view` on `feat/20.29-cross-ledger-nav` — **do NOT
  push, do NOT tag** (task-view push/tag is Liam out-of-band; cmux SSH-push is dead).
  Report the fork commit SHAs.
- NO KH `task-list.json` edit. (No KH worker-branch commit unless you produce a non-ledger
  KH artefact — unlikely.)
- Before `/exit`, write `<events_dir>/final_report.yaml` — sections
  `{summary, nav_design, fork_commits (SHAs on feat/20.29-cross-ledger-nav), agent_browser_verdicts, proposed_20_29_record (title + description + testStrategy + details for the orchestrator to create), OQs_for_parent, next_session_handoff}`.
- Surface Open Questions via the OQ-escalation channel
  (`docs/specs/id-43-oq-escalation/PRODUCT.md`).
