# State machine

Subtask + Task state-machine reference: who sets which status, when, and why those role
boundaries are non-negotiable.

Who sets which status is part of the role boundary. Crossing these lines breaks the
workflow's evidence chain.

## Subtask state machine

| State         | Set by           | Trigger                                                |
| ------------- | ---------------- | ------------------------------------------------------ |
| `pending`     | Planner          | Subtask creation                                       |
| `in_progress` | Executor         | Executor accepts the dispatch brief                    |
| `done`        | **Checker only** | PASS verdict with zero further-action findings         |
| `deferred`    | Orchestrator     | Subtask parked (e.g. blocked on external precondition) |
| `cancelled`   | Orchestrator     | Subtask dropped (scope removed, made redundant, etc.)  |

The Executor moves `pending` → `in_progress` only. The Checker is the only role that can
move a Subtask to `done` — and only when the verdict is PASS with no findings requiring
Executor action.

## Task state machine

| State         | Set by                | Trigger                                                                                 |
| ------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `pending`     | Orchestrator          | Task creation via `spec-driven-implementation`                                          |
| `in_progress` | Orchestrator          | First subtask moves to `in_progress`                                                    |
| `done`        | **Orchestrator only** | All subtasks `done` + Curator triage complete + task-list/backlog implications recorded |
| `cancelled`   | Orchestrator          | Task abandoned (scope removed, deferred to later, etc.)                                 |

The Orchestrator is the only role that closes a Task.

The schema enforces the subtask-status subset via
`SubtaskStatus = TaskListStatus.exclude(['spec_needed', 'imp_deferred'])` in
`lib/validation/task-list-schema.ts`. `spec_needed` and `imp_deferred` remain
Task-level-only and cannot be written to subtasks. `cancelled` is valid at both Task and
Subtask level.
