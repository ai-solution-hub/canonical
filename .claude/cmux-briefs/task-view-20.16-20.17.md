# Brief — task-view Subtasks 20.16 + 20.17 (KH session kh-prod-readiness-S68)

You are a leaf executor running in a **cmux terminal** pinned to a **task-view worktree** under `.claude/worktrees/task-view-20-16-17/`. Your worktree branches from task-view's current HEAD (`8d16ec4` on `feat-30.8-rank-drag-reorder`).

**Working directory:** task-view repo (`/Users/liamj/Documents/development/task-view`, separate from KH).
**Reference repo:** KH production-readiness (`/Users/liamj/Documents/development/knowledge-hub-production-readiness`). Read KH docs via absolute paths.

---

## Read first (in order, don't skip)

1. `AGENTS.md` + `CLAUDE.md` (this repo — task-view's own conventions)
2. `/Users/liamj/Documents/development/knowledge-hub-production-readiness/docs/research/task-view-manual-test-plan-S66.md` (full — 499 lines, 22+4 scenarios)
3. `/Users/liamj/Documents/development/knowledge-hub-production-readiness/docs/reference/task-list.json` Subtasks 20.16 + 20.17 (full `details` + `testStrategy`)
4. `/Users/liamj/Documents/development/knowledge-hub-production-readiness/docs/specs/per-task-md-mirror-generator/PRODUCT.md` (full — 55 invariants you'll cover in 20.16; 14-17 + 18 deferred to 20.18)

---

## Scope — two Subtasks, sequential

### Subtask 20.16 — Manual browser + CLI smoke-test of task-view v0.1.0

- 22+4 scenarios from `task-view-manual-test-plan-S66.md`. 26 total.
- 3 surface tiers: (1) direct HTTP/JSON inspection of `/api/ledger` + `/api/ledger/record/:id` + PATCH; (2) on-disk mirror file rendering via file:// or markdown preview; (3) CLI behaviour verification.
- Stop-the-line on Scenarios 5/6/9/11/12 FAIL.
- Scenario 13 is the SPA-gap acknowledgement.
- Scenarios 14-17 + 18 deferred-with-rationale to 20.18 (post-20.17 SPA wiring).
- Use **agent-browser** skill for UI scenarios; **Bash + curl/jq** for API tier.
- Coordinate sequencing: if 20.12 hasn't shipped yet (KH PR-C reshape), Scenario 1 generates `docs/reference/tasks/*.md` + `roadmap/*.md` + `backlog/*.md` artefacts — copy outputs to `$TMPDIR` rather than committing them.

**Output:** `docs/test-plans/task-view-manual-smoke.md` in **task-view repo** (NOT KH). Markdown table with per-scenario PASS/FAIL verdict + evidence (screenshots/curl-output paste). Coverage matrix against all 55 PRODUCT invariants (KH PRODUCT.md) with deferred-to-20.18 rationale where SPA-required.

**Commit:** `docs(20.16): manual smoke-test of task-view v0.1.0 — N/26 scenarios PASS/FAIL` (in task-view repo).

### Subtask 20.17 — Task-view SPA wiring

- Path A vs Path B decision (TECH judgement call):
  - **Path A**: wire existing Vite SPA at `apps/server/web/index.tsx` to fetch `/api/ledger` on mount + hydrate against record-view component library. Requires Vite dev-server build step (complicates bundled CLI).
  - **Path B**: add Express/Bun route handler in `packages/server/` to render record-view SSR HTML inline + serve from `GET /`. Simpler for loopback-only single-user; matches existing patch-server architecture.
- Default recommendation: **Path B** unless evidence post-S65 codebase shape contradicts.
- Verify: `GET /` returns 200 + HTML body with record-view markup.
- Integration test: add test that asserts GET / response shape.
- Manual smoke: pencil click → textarea hydration + Cmd+Enter PATCH round-trip + Backlog filter URL persistence.
- Baseline guard: full task-view repo test suite still passes (733 pass / 0 fail per S66 close).
- No net-new lint warnings.

**Commits (per task-view conventions):** atomic per-slice — e.g.
- `feat(20.17): add GET / route serving SSR record-view HTML`
- `test(20.17): integration test for GET / response shape`
- `chore(20.17): wire CLI binary entrypoint to new route`

---

## Worktree + git discipline

- Your worktree is `task-view/.claude/worktrees/task-view-20-16-17/` branched from current HEAD.
- Branch name: `cmux-worker-task-view-20-16-17-<sha>` (auto-generated).
- Verify branch via `git branch --show-current` before any work; if it returns parent branch you are leaking.
- Commit on your worker branch only. Cherry-pick / merge back is the parent orchestrator's job.
- **Do NOT push.** Liam-side push to `git@github.com:liam-jons/task-view.git` is required (SSH unreachable from sandbox per S66 carryover).

---

## Coordination with KH session

- KH session is actively executing **ID-30 PR-B Wave 2** ({30.10} migration + {30.11} themes) and possibly **PR-C** ({30.12} schema + {30.13} renderer + back-fill).
- KH session may add backlog entries IDs 87-140 (~54 new entries) — affects 20.16 Scenario 1 if it runs against live KH JSON post-migration.
- If 20.16 runs **AFTER** 30.10 lands, Scenario 1 should expect 114 backlog entries (60 + 54).
- If 20.16 runs **BEFORE** 30.10, expect 60 backlog entries.
- Note your timing in the test report.

---

## Escalation

- Hit a blocker (ambiguous spec, missing dependency, sandbox-blocked tooling)?
- Write OQ packet to: `/Users/liamj/Documents/development/knowledge-hub-production-readiness/docs/research/oq-from-task-view-cmux-S68.md`
- Schema: `{question, context, options_considered, recommendation, blocking}`.
- Then pause (don't /exit) and wait for KH session to ratify via `send-prompt`.

---

## Final report

Before `/exit` (only after both Subtasks done):

Write `.claude/cmux-events/<your-SID>/final_report.yaml` (in **task-view repo**, your worktree) — discover `<your-SID>` via `cat .cmux-brief.md.meta` or events file path.

Schema:

```yaml
summary: |
  Two-paragraph summary of what shipped.
commits:
  - sha: <short-sha>
    subject: <subject line>
    subtask: 20.16 | 20.17
dispositions:
  20.16:
    scenarios_pass: N
    scenarios_fail: M
    scenarios_skip: K
    coverage_matrix_complete: true | false
  20.17:
    path_chosen: A | B
    integration_test_added: true | false
    baseline_passes_held: true | false
OQs_for_parent: []  # or list of OQ packet paths
next_session_handoff: |
  What the parent KH session needs to know to cherry-pick / merge / continue.
```

---

## Budget

~5-8h total (20.16 = ~2-3h; 20.17 = ~3-5h). Save token budget by:
- Skipping known-PASS scenarios after 5 consecutive PASS in a tier.
- Running curl + jq in batches, not one scenario at a time.
- Using `agent-browser` for screenshot evidence (one screenshot per failing scenario; PASS scenarios skip the screenshot).

---

**End of brief.**
