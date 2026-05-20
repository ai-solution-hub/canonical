# ID-N lifecycle detail (§3)

Full per-phase detail for the spec-authoring chain ({N.1}–{N.4}), the
implementation phase ({N.5+}), and the closing phases. Consult when
planning the Task's subtask structure or briefing a Planner.

## Spec-authoring phase ({N.1}–{N.4})

When a Task lands with unspec'd surface area, the Orchestrator invokes
`spec-driven-implementation` to create the spec-authoring subtask chain:

- `{N.1}` RESEARCH.md — Planner, when warranted by domain complexity. Domain
  skills (`claude-api`, `supabase-postgres-best-practices`, etc.) are added
  to the Planner's loadout on demand by Liam (§4.4 of the canonical doc).
- `{N.2}` PRODUCT.md — Planner invokes `write-product-spec` directly. Output
  is numbered, testable Behaviour invariants per the skill's mandated
  structure.
- `{N.3}` TECH.md — A **fresh** Planner instance reviews the ratified
  PRODUCT.md and writes TECH.md via `write-tech-spec`. One Planner per
  subtask — Planners are not persistent across waves (per Q-PLANNER-2
  ratification).
- `{N.4}` PLAN.md — Conditional; only when `planning-and-task-breakdown`
  decomposition is needed to populate implementation subtasks.

Each Planner is opus-4-7 with `thinking: 'max'` per Q-PLANNER-1. The
Orchestrator dispatches each Planner with the ratified upstream artefact
(PRODUCT for the TECH Planner; both for the PLAN Planner) and a Checker
gates each output.

After the chain ratifies (Liam's go/no-go), the Planner populates
implementation subtasks `{N.5+}` in `task-list.json`. Each subtask gets:

- `details` — the load-bearing dispatch brief: file paths, function names,
  "verify X" lines, spec-slice references. This is what the Executor reads.
- `testStrategy` — one-line acceptance prose.

## Implementation phase ({N.5+})

One Executor per **logical subtask group** — a contiguous sequence of subtasks
that share file ownership and can be committed atomically (per A7). Not one
Executor per individual subtask.

The Orchestrator decides parallel-vs-serial dispatch based on file-ownership
boundaries between groups:

- **Parallel** when groups touch disjoint file sets. Dispatch concurrently
  in isolated worktrees via the dispatch primitives (see
  [dispatch-primitives.md](dispatch-primitives.md)).
- **Sequential** when groups share files, schema migrations have ordering
  dependencies, or one group produces inputs another consumes.

Each Executor reads only its subtask `details` and the spec slice the brief
references. Executors do **not** read the whole PRODUCT.md or TECH.md.

## Closing phases

After every implementation subtask group is `done`:

1. **`code-simplification` pass** — Executor (end-of-task) runs the
   `code-simplification` skill over the Task's commit set.
2. **`quality-review` pass** — Checker (end-of-task) runs the
   `quality-review` variant: invokes `security-and-hardening` /
   `performance-optimization` / `type-design-analyzer` based on Task kind
   and findings.
3. **Task close** — Orchestrator gates Task `in_progress` → `done` only
   after all subtasks are `done`, Curator triage is complete, and
   roadmap/backlog implications are recorded.

## Loading task-list.json (soft-ceiling surfacing)

When reading `docs/reference/task-list.json`, do **not** call `JSON.parse`
directly — invoke `parseTaskListWithWarnings` from
`lib/validation/task-list-schema.ts`:

```ts
import { parseTaskListWithWarnings } from '@/lib/validation/task-list-schema';

const raw = JSON.parse(await fs.readFile('docs/reference/task-list.json', 'utf8'));
const { value, warnings } = parseTaskListWithWarnings(raw);
```

The helper validates against `TaskListSchema` (throws ZodError on schema
violation) and surfaces a `TaskListWarning[]` for any Task with more than 25
Subtasks (PRODUCT inv 20). The 25-Subtask ceiling is a planning signal, not a
hard cap — present the warnings to Liam at session start and treat them as a
Task-boundary problem (split the Task) rather than an error.

This is the only ingress path for the Task list in the Orchestrator skill.
Skipping the helper means missing the soft-ceiling signal — that's the whole
reason the helper exists.
