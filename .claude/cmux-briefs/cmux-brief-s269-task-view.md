# cmux brief — S269 task-view-retest sub-orchestrator

You are a **SUB-ORCHESTRATOR**, not a leaf worker. Load the `workflow-orchestration` skill
first. For every unit of work, **DISPATCH a task-planner and/or task-executor via the
Agent tool, then GATE each with a task-checker (FAIL→fix→PASS) BEFORE committing.** Do NOT
author specs/plans or write code/docs directly as your own deliverable — that is the
Planner/Executor role. This holds even for the test-only and journal-only slices.

**First action (agents start stale):**
`git fetch origin main && git reset --hard origin/main`.

**Paths:** relative only (primer-effect gotcha). The PreToolUse hook blocks `cd` to the KH
repo root — use relative paths / `git -C`. `cd` to the SIBLING `../task-view` repo IS
allowed.

---

## Mission

Re-test and correct **Task ID-20** (per-Task .md mirror + render surface — closed `done`
27/27, but several of its journals are FALSE-PASS). The original ID-20.13/20.16/20.18
tests were **vacuous**: they asserted against on-disk artefacts + hardcoded literals +
unit tests, NOT the live hydrated viewer. That is how three real defects slipped through
as PASS: the `/30.md` link bug (since fixed), the `--version` lie, and the removed inv-50.

Grounding (read first):

- `docs/continuation-prompts/continuation-prompt-kh-s269-cmux-task-view-and-ledger-sweeps.md`
  — the "Session deltas / decisions NOT in the ledger" section is the spec for this work.
- `docs/specs/id-20-per-task-mirror/PRODUCT.md` — inv 43 (one-ledger-per-launch is BY
  DESIGN; relaunch-per-path), plus the inv-50 + inv-2 fork-divergence annotations (commit
  `481112a4`).
- The task-view FORK repo is the sibling clone at `../task-view` (separate git repo).

## Scope — four items, in this order

### 1. RE-TEST ID-20.13 / 20.16 / 20.18 via agent-browser against a LIVE server

Launch the task-view server against a real KH ledger and drive it with the `agent-browser`
skill — assert against the **live hydrated viewer**, not disk. Your KH worktree has
`.env.local` (copied via `.worktreeinclude`); the task-view sibling lives at
`../task-view` (`bun install` + build it there if needed; the S264/S265 gotcha: a fresh
clone resolves deps via the global bun cache). Re-run the three scenarios as TRUE
end-to-end browser assertions. Record PASS/FAIL honestly — the point is to catch what the
vacuous versions missed.

### 2. FIX the `--version` lie (task-view FORK repo)

`../task-view` `apps/server/index.ts:352` hardcodes `"task-view 0.1.0"`; `formatVersion()`
/ `__CLI_VERSION__` are never wired. Fix it in the fork so `--version` reports the real
version. **COMMIT to the fork's branch; do NOT push and do NOT create a tag** — task-view
push/tag is Liam out-of-band (the cmux SSH-push-dead gotcha), and the KH `ci.yml`
`TASK_VIEW_TAG` bump follows his tag. Report the fork commit SHA for his push.

### 3. BUILD cross-ledger navigation (NEW feature)

Cross-ledger nav is a NEW capability (one-ledger-per-launch is by-design, inv 43). Whether
it lands as a **new Task** or an **ID-20 subtask** is a Liam decision — **surface it via
the OQ-escalation channel** (`docs/specs/id-43-oq-escalation/PRODUCT.md`) and do items
1/2/4 first while you await ratification. Once ratified, plan→build→check it in the fork
(commit, no push/tag — same out-of-band rule as item 2).

### 4. ID-20 correction journal (KH ledger)

ID-20 closed `done` 27/27 but its journals falsely claim PASS on the `--version` string
and on inv-50. Append a correction `<info added on 2026-05-26 (S269 task-view re-test)>`
block to the relevant ID-20 subtask `details` recording: the false-PASS (vacuous tests),
the real state, the agent-browser re-test verdicts, and the fork fixes shipped this
session (with the fork commit SHAs). This is the only KH `task-list.json` edit you make.

## Coordination — task-list.json is shared this session

Two sibling terminals are editing `docs/reference/task-list.json` concurrently: the
ID-49.8 executor (touches the **ID-49** record only) and the ledger-sweeps terminal
(ID-34/ID-35 + a broad description sweep). **Touch ONLY the ID-20 record.** Use a
key-order-PRESERVING, per-record scoped splice for your journal write (the S267 `d6c4f4af`
pattern) — NEVER a whole-file re-serialise (it reorders every record's keys and will
collide at integration). Parse via `parseTaskListWithWarnings` from
`lib/validation/task-list-schema.ts`, never raw `JSON.parse`.

## Close-out

- Commit KH-side work on your worker branch via `commit-commands` (Co-Authored-By trailer
  for `Claude Opus 4.7 (1M context)`). Fork-side commits stay in `../task-view`.
- Before `/exit`, write your final report to `<events_dir>/final_report.yaml` — sections
  `{summary, commits (KH branch + fork SHAs), retest_verdicts, dispositions, OQs_for_parent (the nav new-Task-vs-subtask question + its resolution), next_session_handoff}`.
- Surface Open Questions via the OQ-escalation channel — do NOT make the
  new-Task-vs-subtask scope decision yourself.
