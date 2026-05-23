# Dispatch primitives composition

How the three dispatch primitives (`dispatching-parallel-agents`,
`using-git-worktrees`, `session-driver-cmux`) layer, and how to compose a
dispatch brief for any sub-agent.

## How the primitives compose

The three primitives are layered, not interchangeable. They were harmonised so that whichever you pick, the worktree contract is the same:

- **`dispatching-parallel-agents`** — the abstract pattern. Identify
  independent task domains, compose focused sub-tasks, run in parallel,
  integrate results. This is what you reason with when planning a wave; it
  doesn't create worktrees itself.
- **`using-git-worktrees`** — the concrete worktree-creation primitive.
  Carries the safety contract: `git check-ignore` for the worktree path,
  baseline-test gate before the worker starts, post-merge cleanup hooks.
  Used directly for single-Executor worktree creation, or composed under
  `session-driver-cmux` for the fleet.
- **`session-driver-cmux`** — fleet dispatch implementation. cmux terminals
  + Claude sub-sessions + per-worker git worktree + JSONL event stream at
  `.claude/cmux-events/<session-id>/events.jsonl`. Used when you need
  durable attachable terminals, multi-turn workers, or per-worker tool
  gating.

## Composing a dispatch brief

Every dispatch produces a brief the sub-agent receives as its initial
prompt. The brief carries:

- **Subtask reference** — `ID-N.M` plus the Subtask object from
  `task-list.json` (read the relevant Task with `parseTaskListWithWarnings`
  and pass the Subtask through verbatim — its `details` field is the
  load-bearing dispatch brief).
- **Spec-slice reference** — path + anchor to the section of PRODUCT.md /
  TECH.md the subtask references. The Executor reads only this slice.
- **File-ownership boundaries** — explicit allow-list of files this dispatch
  may touch. Everything else is off-limits.
- **Skills to invoke** — list specific KH skills (e.g.
  `test-driven-development`, `incremental-implementation`).
- **Worktree directive** — verification gate as first action (`pwd && git branch --show-current && git fetch origin <track> && git reset --hard origin/<track> && git branch --show-current` — verbatim, no `cd` prefix). Use relative paths throughout. Commit before finishing. **Never `cd` to absolute knowledge-hub paths.**
- **Escalation rule** — if the sub-agent finds unexpected production
  behaviour, STOP and escalate. Do not silently work around (CLAUDE.md
  "Agent escalation rule").
