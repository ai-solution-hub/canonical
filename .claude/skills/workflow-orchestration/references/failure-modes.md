# Failure handling

Six recurring failure patterns and the Orchestrator's standard response
for each. Consult when a dispatch returns red, a Checker FAILs, or an
Executor escalates.

Six recurring failure patterns. Encoded here so the Orchestrator's response
is consistent across sessions:

## Executor commits but produces failing tests

Dispatch a fix-Executor with the test output as the finding packet. New
commit, never `--amend`. The fix-Executor
re-runs `bun run test` before declaring complete.

## Executor exits mid-commit

Run `git status` inside the worktree before tearing it down. If uncommitted changes exist,
rescue them with a manual commit on the worker's branch. Then `git
worktree remove`. Never `--force` without inspecting first.

## Fix-dispatch loop hits its retry budget

Every fix-dispatch loop runs under a **bounded-retry budget**, not an
open-ended retry. The ceiling: **three consecutive fix-dispatch iterations
on the same subtask group** (a Checker FAIL → fix-Executor → re-Check
counting as one iteration). On hitting the ceiling, **PAUSE and escalate to
Liam for a human decision — do not dispatch a fourth fix-Executor.** Three
consecutive FAILs on the same group indicates a spec / plan defect, not an
implementation defect, and a fourth dispatch against a broken spec is thrash,
not progress. The standard human-decision outcome is to re-engage a Planner
to amend PRODUCT.md / TECH.md; Liam may instead re-scope, defer, or accept —
but the loop does not auto-continue past the budget.

The same budget governs any repeated fix-request loop, not only Checker
FAILs: if the same finding is re-dispatched three times without a verified
resolution, stop and escalate rather than re-request a fourth time. The
budget is a ceiling on **iterations**, counted per subtask group per finding.

**Do not re-litigate ignored / won't-fix findings.** Once Liam (or the
recurring-finding loop) has marked a finding `ignored` / `won't-fix`, a later
loop does **not** re-open it and spend budget on it again — unless the finding
is **materially different** (a different root cause, a wider blast radius, or
a new failure signature). An identical recurrence of a won't-fix finding is
closed, not a fresh iteration; only a materially-different recurrence opens a
new bounded loop.

## Worktree leakage on merge

If `git status` after a cherry-pick shows untracked files, run `git clean
-fd` and re-verify the merge produced the expected files. Do not proceed with the next cherry-pick
until the working tree is clean.

## Sub-agent escalation

When an Executor finds production behaviour contradicting its brief, it
stops and reports. The Orchestrator treats this as a scope renegotiation,
not a workaround opportunity. If the
discovery requires spec amendment, re-engage a Planner. If the discovery
reveals a pre-existing bug unrelated to the current Task, dispatch the
Curator — the bug becomes a new subtask or backlog item.
