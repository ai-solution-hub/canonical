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

## Checker FAILs three times on the same subtask group

Escalate to Liam. Three consecutive FAILs on the same group indicates a
spec / plan defect, not an implementation defect. Re-engage a Planner to
amend PRODUCT.md / TECH.md — do not keep dispatching fix-Executors against
a broken spec.

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
