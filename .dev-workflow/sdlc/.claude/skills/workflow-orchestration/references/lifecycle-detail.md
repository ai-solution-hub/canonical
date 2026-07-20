# ID-N lifecycle detail

Full per-phase detail for the spec-authoring chain ({N.1}–{N.4}), the implementation phase
({N.5+}), and the closing phases. Consult when planning the Task's subtask structure or
briefing a Planner.

## Spec-authoring phase

When a Task lands with unspec'd surface area, the Orchestrator invokes
`spec-driven-implementation` to create the spec-authoring subtask chain. **All four
artefacts are conditional** — right-size the chain to the task shape via the four named
tiers below. The Orchestrator decides the tier at Task open; the Planner may recommend an
upgrade mid-`{N.1}` if RESEARCH surfaces compound invariants:

- **Full chain** (RESEARCH + PRODUCT + TECH + PLAN) — compound invariants / multiple
  migrations / chain-dependent slices / >2h effort.
- **PRODUCT + PLAN** (skip TECH) — behaviourally rich, implementation-shallow.
- **TECH + PLAN** (skip PRODUCT) — unambiguous behaviour, non-trivial implementation.
- **Spec-free** — trivial / operational.

The chosen tier is recorded in the Task `status_note` as a one-line marker (e.g.
`spec tier: PRODUCT+PLAN`). **The `status_note` is budget-gated at ≤300 characters** —
keep the marker terse. The light tier is a _recorded_ decision: an under-specified Task
that later reveals compound invariants ESCALATES to a heavier tier (a `status_note`
update), never silently proceeds.

- `{N.1}` RESEARCH.md — Planner, when warranted by domain complexity. Domain skills
  (`claude-api`, `supabase-postgres-best-practices`, etc.) are added to the Planner's
  loadout on demand.
- `{N.2}` PRODUCT.md — Conditional (user-facing or behaviourally ambiguous changes).
  Planner invokes `write-product-spec` directly. Output is numbered, testable Behaviour
  invariants per the skill's mandated structure. The Planner cites the gitnexus_impact
  verdict for any symbol the spec slice mandates be modified — verdict level (LOW / MEDIUM
  / HIGH / CRITICAL), caller count, and the names of the top-3 affected execution flows.
  Where no existing symbols match the spec domain, the Planner notes "gitnexus
  orientation: no existing symbols match — greenfield surface" in the spec's Context
  section.
- `{N.3}` TECH.md — Conditional (non-obvious, risky, or multi-subsystem technical
  approach). A **fresh** Planner instance reviews the ratified PRODUCT.md and writes
  TECH.md via `write-tech-spec`. One Planner per subtask — Planners are not persistent
  across waves. The Planner cites the gitnexus_impact verdict for any symbol the spec
  slice mandates be modified — verdict level (LOW / MEDIUM / HIGH / CRITICAL), caller
  count, and the names of the top-3 affected execution flows. Where no existing symbols
  match the spec domain, the Planner notes "gitnexus orientation: no existing symbols
  match — greenfield surface" in the TECH.md Context section.
- `{N.4}` PLAN.md — Planner uses `planning-and-task-breakdown` to decompose specs into
  implementation subtasks.

The Orchestrator dispatches each Planner with the ratified upstream artefact (RESEARCH for
the PRODUCT Planner, RESEARCH and PRODUCT for the TECH Planner; PRODUCT and TECH for the
PLAN Planner) and a Checker gates each output.

After the chain ratifies (Liam's go/no-go), the Planner populates implementation subtasks
`{N.5+}` in `task-list.json`. Each subtask gets:

- `details` — the load-bearing dispatch brief: file paths, function names, "verify X"
  lines, spec-slice references. This is what the Executor reads.
- `testStrategy` — one-line acceptance prose.

## Implementation phase ({N.5+})

One Executor per subtask.

The Orchestrator decides parallel-vs-serial dispatch based on file-ownership boundaries:

- **Parallel** when subtasks touch disjoint file sets. Dispatch concurrently in isolated
  worktrees via the dispatch primitives (see
  [dispatch-primitives.md](dispatch-primitives.md)).
- **Sequential** when subtasks share files, schema migrations have ordering dependencies,
  or one group produces inputs another consumes.

Each Executor reads only its subtask `details` and `journal` records and the spec slice
the brief references. Executors do **not** read the whole PRODUCT.md or TECH.md.

## Closing phases

After every implementation subtask is `done`:

1. **`code-simplification` pass** — Executor (end-of-task) runs the `code-simplification`
   skill over the Task's commit set.
2. **`quality-review` pass** — Checker (end-of-task) runs the `quality-review` variant:
   invokes `security-and-hardening` / `performance-optimization` / `type-design-analyzer`
   based on Task kind and findings.
3. **Task close** — Orchestrator gates Task `in_progress` → `done` only after all subtasks
   are `done`, Curator triage is complete, and task-list/backlog implications are
   recorded.

## Loading task-list.json

Default access is SLICE READS via the ledger CLI
(`bun scripts/ledger-cli.ts show task <id>` / `get task <id> <field>` /
`get task <id>.<subId>`) — never a wholesale Read of the multi-MB ledger. Use
`journal <id>.<sub>` for narrative state, `get <id>.<sub>` details for the spec brief,
`get <id> status_note` for the task-level rollup. When a programmatic FULL-list pass is
genuinely required, invoke `parseTaskListWithWarnings` from
`lib/validation/task-list-schema.ts`:

```ts
import { parseTaskListWithWarnings } from '@/lib/validation/task-list-schema';

const ledgerDir = `${process.env.KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers`;
const raw = JSON.parse(await fs.readFile(`${ledgerDir}/task-list.json`, 'utf8'));
const { value, warnings } = parseTaskListWithWarnings(raw);
```

The helper validates against `TaskListSchema` - throws ZodError on schema violation.
