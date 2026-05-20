# Failure handling (§8)

Six recurring failure patterns and the Orchestrator's standard response
for each. Consult when a dispatch returns red, a Checker FAILs, or an
Executor escalates.

Six recurring failure patterns. Encoded here so the Orchestrator's response
is consistent across sessions:

## Executor commits but produces failing tests

Dispatch a fix-Executor with the test output as the finding packet. New
commit, never `--amend` (CLAUDE.md "Git Safety Protocol"). The fix-Executor
re-runs `bun run test` before declaring complete.

## Executor exits mid-commit (token budget)

Run `git status` inside the worktree before tearing it down (CLAUDE.md
"Sub-agents can blow their token budget"). If uncommitted changes exist,
rescue them with a manual commit on the worker's branch. Then `git
worktree remove`. Never `--force` without inspecting first.

## Checker FAILs three times on the same subtask group

Escalate to Liam. Three consecutive FAILs on the same group indicates a
spec / plan defect, not an implementation defect. Re-engage a Planner to
amend PRODUCT.md / TECH.md — do not keep dispatching fix-Executors against
a broken spec.

## Worktree leakage on merge

If `git status` after a cherry-pick shows untracked files, run `git clean
-fd` and re-verify the merge produced the expected files (CLAUDE.md
"Worktree isolation rules"). Do not proceed with the next cherry-pick
until the working tree is clean.

## Sub-agent escalation

When an Executor finds production behaviour contradicting its brief, it
stops and reports. The Orchestrator treats this as a scope renegotiation,
not a workaround opportunity (CLAUDE.md "Agent escalation rule"). If the
discovery requires spec amendment, re-engage a Planner. If the discovery
reveals a pre-existing bug unrelated to the current Task, dispatch the
Curator — the bug becomes a backlog item, not a current-Task fix.

## Worktree-CWD drift in the Orchestrator (and sub-agents)

The previous mitigation (`cd <main-repo-path> &&`) was the LEAK VECTOR
itself per `docs/research/worktree-isolation-leak-investigation.md`. Bash
shell state does not persist between Bash tool calls, so every call already
starts in the harness's default cwd (which is your worktree). After any
`Read` on a worktree file from the Orchestrator's session, subsequent
git ops continue to run in the Orchestrator's worktree (the main-track
worktree) by default — no prefix needed. **If you find yourself wanting to
`cd /Users/liamj/...`, the answer is no. Use relative paths or `git -C
<relative-path>` instead.** PreToolUse hooks enforce this.
