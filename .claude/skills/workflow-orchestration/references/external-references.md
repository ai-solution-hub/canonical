# External references

Canonical SDLC doc, sibling agent files, dispatch-primitive skills, schema +
validation modules, side skills the Orchestrator invokes, Curator-side
skills, and project rules.

## Canonical SDLC doc

- `docs/plans/phase-0-investigation/kh-sdlc-workflow.md` — source of
  truth. If this skill body and the canonical doc disagree, the
  canonical doc loses (it documents intent; the skill is operational).
  Specifically: §2 (roles), §3 (lifecycle), §4 (skill routing), §5
  (dispatch primitives), §6 (gates), §8 (failure handling), §9.4
  (orchestrator-becomes-skill ratification).

## Sibling roles

- `.claude/agents/task-planner.md` — Planner agent (opus-4-7, `thinking: 'max'`).
- `.claude/agents/task-executor.md` — Executor agent (sonnet-4-6).
- `.claude/agents/task-checker.md` — Checker agent (sonnet-4-6, two
  variants).
- `.claude/agents/workflow-curator.md` — Curator agent.

## Dispatch primitives (§5)

- `.claude/skills/session-driver-cmux/SKILL.md` — fleet dispatch (cmux +
  worktrees + JSONL events).
- `using-git-worktrees` — worktree-creation primitive (Anthropic plugin).
- `dispatching-parallel-agents` — abstract parallel pattern (Anthropic
  plugin).
- `git-workflow-and-versioning` — Orchestrator-owned merge skill
  (Anthropic plugin).

## Schema + validation

- `lib/validation/task-list-schema.ts` — `TaskListSchema`,
  `parseTaskListWithWarnings` (inv 20 25-Subtask soft-ceiling).
- `docs/reference/task-list.json` — the live Task list.
- `docs/reference/taskmaster-schema-reference.md` — empirical TM shape.

## Side skills the Orchestrator invokes

- `start-session`, `context-engineering`, `spec-driven-implementation`,
  `diagnose-ci-failures`, `update-docs`, `handoff`, `code-simplification`,
  `resolve-merge-conflicts`.

## Curator-side skills

- `.claude/skills/triage-finding/SKILL.md` — Curator's decision skill.
- `.claude/skills/update-roadmap-backlog/SKILL.md` — Curator's write
  skill.

## Project rules

- `CLAUDE.md` — "Implementation Workflow", "Worktree isolation rules",
  "Sub-agents can blow their token budget", "Worktree agents start
  stale", "Bash CWD drifts into worktree dirs after `Read`",
  "Anthropic plugin files invisible to worktree agents", "Git Safety
  Protocol", "Agent escalation rule".
- `docs/reference/test-philosophy.md` — six audit criteria the Checker
  applies.
- `docs/design/warm-meridian-implementation-spec.md` — design tokens the
  Checker enforces.
