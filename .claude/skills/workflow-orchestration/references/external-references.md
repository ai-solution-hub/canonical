# External references

Canonical SDLC doc, sibling agent files, dispatch-primitive skills, schema +
validation modules, side skills the Orchestrator invokes, Curator-side
skills, and project rules.

## Canonical SDLC doc

- `${KH_PRIVATE_DOCS_DIR}/src/content/docs/themes/workflow-orchestration/kh-sdlc-workflow.md` — source of
  truth. If this skill body and the canonical doc disagree, the
  canonical doc loses (it documents intent; the skill is operational).
  Specifically: §2 (roles), §3 (lifecycle), §4 (skill routing), §5
  (dispatch primitives), §6 (gates), §8 (failure handling), §9.4
  (orchestrator-becomes-skill ratification).

## Sibling roles

- `.claude/agents/task-planner.md` — Planner agent
- `.claude/agents/task-executor.md` — Executor agent
- `.claude/agents/task-checker.md` — Checker agent (two
  variants).
- `.claude/agents/workflow-curator.md` — Curator agent.

## Dispatch primitives

- `.claude/skills/session-driver-cmux/SKILL.md` — fleet dispatch (cmux +
  worktrees + JSONL events).
- `using-git-worktrees` — worktree-creation primitive.
- `dispatching-parallel-agents` — abstract parallel pattern.
- `git-workflow-and-versioning` — Orchestrator-owned merge skill.

## Schema + validation

- `lib/validation/task-list-schema.ts` — `TaskListSchema`,
  `parseTaskListWithWarnings`.
- `docs/reference/task-list.json` — the live Task list.

## Side skills the Orchestrator invokes

- `start-session`, `context-engineering`, `spec-driven-implementation`,
  `diagnose-ci-failures`, `handoff`, `code-simplification`,
  `resolve-merge-conflicts`.

## Curator-side skills

- `.claude/skills/triage-finding/SKILL.md` — Curator's decision skill.
- `.claude/skills/update-roadmap-backlog/SKILL.md` — Curator's write
  skill.

## Project rules

- `CLAUDE.md`.
- `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/test-philosophy.md` — six audit criteria the Checker
  applies.
- `${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-implementation-spec.md` — design tokens the
  Checker enforces.
