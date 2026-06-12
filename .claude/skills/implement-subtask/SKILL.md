---
name: implement-subtask
description:
  Use when implementing one Subtask brief dispatched by the Orchestrator.
  Reads the Subtask details field; drives TDD slice loop; commits per
  subtask; appends <info added on ...> block to details on completion.
  Triggered by the task-executor agent.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# implement-subtask — Atomic Subtask Execution for the KH Executor

Implements **one** `ID-N.M` Subtask end-to-end against a dispatched
brief. The Executor's single entry point for spec-anchored work.

This skill is **NOT** for full-feature implementation against a complete
PRODUCT.md + TECH.md pair — that is `spec-driven-implementation`'s job
(which authors the spec chain `{N.1}` → `{N.2}` → `{N.3}` → `{N.4}` for
a new Task). `implement-subtask` runs **after** the spec chain ratifies
and the Planner has populated implementation subtasks `{N.5+}` with
dispatch briefs in their `details` field.

## Overview

The Knowledge Hub SDLC workflow (see
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/themes/workflow-orchestration/kh-sdlc-workflow.md` §3.4 and §4.2)
decomposes any non-trivial Task into discrete Subtasks. Each Subtask
carries a load-bearing `details` field — the Planner's dispatch brief
for the Executor — and a `testStrategy` acceptance criterion. The
Orchestrator dispatches one Executor per Subtask group (contiguous
sibling Subtasks with disjoint file ownership) and the Executor invokes
this skill as its first action.

The reason for the strict per-Subtask scope: the Executor must NOT
read full PRODUCT.md / TECH.md, NOT decompose work in-flight, and NOT
mark Subtasks `done`. Those responsibilities belong to the Planner and
Checker respectively (per §6.3 + B12 state machine). Concentrating
Executor context on the brief + spec slice produces tighter diffs,
honest Checker audits, and a deterministic state machine.

## Input

The dispatch brief from the Orchestrator (or `task-executor` agent
wrapper) carries:

| Field | Source |
|---|---|
| Subtask id (`ID-N.M`) | Composite-id prose used in the dispatch message. |
| `task-list.json` path | Defaults to `docs/reference/task-list.json` — repo-relative. |
| Location of the Subtask `details` field within it | Parent Task id (`N`) + Subtask id (`M`). |
| Spec-slice path | The `details` field references something like `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<task-slug>/PRODUCT.md#<section>` or `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<task-slug>/TECH.md#<section>`. Read only that slice — not the whole document. |
| `testStrategy` | One-line prose acceptance statement (Planner-populated, per PRODUCT inv 9). |

If any of these are missing from the dispatch brief, escalate to the
Orchestrator before starting — do not guess.

## Process

### Step 1 — Read the brief

Load `docs/reference/task-list.json`. Locate the parent Task by `id`
(string, e.g. `"8"`), then locate the Subtask by integer `id` within
`task.subtasks[]`. Read the `details` markdown field in full —
**this is your primary input**, more authoritative than the dispatch
message itself.

Then read the spec-slice the `details` references. Use Read with a
section anchor (e.g. `#step-3-commit`) only when the slice is small;
for larger files, read the file in full once and ignore non-referenced
sections. Read additionally:

- `CLAUDE.md` Gotchas for the surface area you'll touch
  (Supabase / Testing / Frontend / etc.).
- The CLAUDE.md Architecture table (or GitNexus `gitnexus_query`) when you
  don't know where a module lives (`.planning/codebase/` is retired).
- `supabase/types/database.types.ts` (+ `supabase/types/database-overrides.ts`
  for JSONB domain types) when the change touches the database schema — consume
  via `Tables<'x'>` / `Enums<'x'>`, see CLAUDE.md "TypeScript conventions".

Move the Subtask status `pending → in_progress` (per §6.3 + B12). This
is the only state transition you may set — the Checker owns `done`.

### Step 2 — Test-first

Invoke the `test-driven-development` skill before writing any
production code, when the Subtask touches logic with observable
behaviour. Write the failing test against the Subtask's `testStrategy`.

The Knowledge Hub test framework is Vitest. Run with `bun run test`
(NOT `bun test` — see CLAUDE.md Gotchas). Vitest paths mirror the
production tree under `__tests__/`.

If the Subtask is genuinely pure-documentation or pure-rename with no
behaviour change, skip the test step — but record the rationale in the
journal block at Step 5. Pure-documentation Subtasks are uncommon;
default to writing a test.

### Step 3 — Slice loop

For multi-file changes, invoke `incremental-implementation` to
interleave small slices with their tests. Each slice cycle:

1. Write the slice.
2. Run the scoped test (`bun run test -- path/to/specific.test.ts`).
3. Commit the slice (Step 4 covers the commit mechanics).

The point of slicing is to keep the diff reviewable and the rollback
unit small. A Subtask that produces one giant commit is harder for the
Checker to audit and harder to revert if a downstream wave fails.

### Step 4 — Commit

Invoke `commit-commands` (NOT `git-workflow-and-versioning` — per
kh-sdlc-workflow.md B9, the Executor commits per Subtask; the
Orchestrator owns merges). Atomic commit per Subtask, with the commit
message body referencing `ID-N.M` for traceability:

**Pre-commit scope check (manual gate):** Before invoking `commit-commands`,
run `gitnexus_detect_changes()` to verify that the symbols modified in
your diff match the expected set for this Subtask. If the detected changes
include symbols outside the Subtask's file-ownership boundary — functions,
classes, or types in files not referenced in the `details` brief — STOP
and escalate to the Orchestrator before committing. Do not rationalise
incidental changes as "safe"; the Checker will audit the blast radius and
any unexplained symbol drift will produce a FAIL verdict. This is a manual
gate, canonical until tooling automates the boundary check. See
`.gitnexus/CLAUDE.md` for the canonical `gitnexus_detect_changes` invocation
pattern (T-OQ-4 — name and path reference only; do not copy contents here).

```
<conventional-commit-type>(<scope>): <one-line summary>

<wrapped body explaining the change.>

ID-N.M — <subtask-title>
```

If you complete multiple slices via `incremental-implementation`, the
intermediate commits stay; the final Subtask commit references
`ID-N.M` and closes the slice.

### Step 5 — Journal

Append an `<info added on YYYY-MM-DDTHH:MM:SS.sssZ>` block to the
Subtask `details` field in `task-list.json`. This pattern is mandated
by PRODUCT inv 13 (append-extensibility of `details`) and provides the
Checker — who reads only the brief, the spec slice, your journal, and
the diff — a record of what shipped and any in-flight discoveries.

Block structure:

```
<info added on 2026-05-18T16:42:11.123Z>
**Shipped:** <one-line summary of what landed>
**Commit:** <short SHA>
**Files touched:** <comma-separated repo-relative paths>
**Acceptance:** <testStrategy mapping — what verifies it>
**Blast radius:** <verdict> (<caller-count> callers)
**Scope verified:** gitnexus_detect_changes matched expected symbol set
**Deviations:** <anything you did differently from the brief, with reason; "none" if unchanged>
**Out-of-scope observations:** <findings the Curator should triage; "none" if clean>
</info added on 2026-05-18T16:42:11.123Z>
```

The timestamp uses ISO 8601 with millisecond precision, UTC (`Z`). Use
`date -u +%Y-%m-%dT%H:%M:%S.%3NZ` (or equivalent) at append time —
do not reuse a stale value.

The `<info added on …>` blocks accumulate over the Subtask's lifetime
(if a fix-Executor runs against the same Subtask post-Checker, it
appends a fresh block — never edits earlier blocks). This preserves the
journal as a per-Subtask audit trail.

### Step 6 — Report

Return to the Orchestrator (or wrapping `task-executor` agent) with:

- Branch name + final commit SHA.
- Files touched (repo-relative).
- Acceptance criteria status (PASS / partial / unmet, with reason).
- Any out-of-scope observations for Curator routing — mirroring the
  `<info added on …>` block's "Out-of-scope observations" line.

The Orchestrator dispatches the Checker against your commit, and
routes any out-of-scope findings to the Curator via `triage-finding`.

## State machine

Per kh-sdlc-workflow.md §6.3 and B12: you move `pending → in_progress` ONLY; the
Checker alone sets `done` (Executor self-attestation would create a loophole
around the verification gate — if you believe a Subtask is complete, leave it
`in_progress`, journal what shipped, and the Checker decides); the Orchestrator
owns `deferred`. Full state tables:
`.claude/skills/workflow-orchestration/references/state-machines.md` (summary in
`.claude/agents/references/shared-discipline.md` §State machine).

## Escalation

If, while executing, you discover production behaviour that contradicts the
brief, or the brief references a spec slice that disagrees with the codebase,
**STOP and escalate** to the Orchestrator with evidence — never silently work
around (canonical rule: `.claude/agents/references/shared-discipline.md`
§Escalation rule). The Orchestrator may re-engage the Planner to amend the spec,
or re-scope the Subtask.

## Forbidden

These actions belong to other roles; performing them as Executor
breaks the workflow's verification gates:

- **`planning-and-task-breakdown` invocation.** Decomposition is the
  Planner's job at `{N.4}`-time (see kh-sdlc-workflow.md §3.3). An
  Executor who thinks the Subtask needs further decomposition must
  escalate — not decompose in-flight.
- **Reading full PRODUCT.md / TECH.md.** Read only the spec slice the
  `details` field references. Full-spec reads bloat context, and the
  Executor's job is anchored to the slice, not the whole feature.
- **Setting Subtask status to `done`.** Checker only. See §State
  machine above.
- **Editing roadmap / backlog.** Curator's job via
  `update-roadmap-backlog`. An Executor surfacing a finding flags it
  in the Step 5 journal and Step 6 report; the Curator decides what
  happens next.
- **Cross-Task scope.** A Subtask belongs to exactly one parent Task.
  If you find yourself reaching into another Task's files, the Task
  boundary is wrong — escalate, do not silently expand.

## KH-specific quality bars

Apply the KH quality bars to every change — non-negotiable, audited by the
Checker per Subtask: semantic tokens only, UK English, `auth.success` +
`authFailureResponse(auth)`, `sb()`/`tryQuery()` Supabase safety, no barrel
re-exports, TanStack Query only, `bun run test` (never `bun test`), stable
empty defaults, PL/pgSQL `search_path` + anon REVOKE. Full list and
elaboration: `.claude/agents/references/shared-discipline.md` §KH quality bars.

## Related skills

- `test-driven-development` — mandatory for behaviour change.
- `incremental-implementation` — for multi-file Subtasks.
- `commit-commands` — for the Subtask commit (replaces
  `git-workflow-and-versioning` for Executor scope per B9).
- `resolve-merge-conflicts` — if a fix-Executor lands on a worktree
  with conflicts.
- `spec-driven-implementation` — the **inverse** skill, for authoring
  the spec chain `{N.1}` → `{N.2}` → `{N.3}` → `{N.4}` of a NEW Task.
  This skill (`implement-subtask`) runs against Subtasks `{N.5+}`
  populated AFTER that chain ratifies.

## References

- `${KH_PRIVATE_DOCS_DIR}/src/content/docs/themes/workflow-orchestration/kh-sdlc-workflow.md` §3.4
  (Implement phase), §4.2 (Executor skills), §6.3 (state machine).
- `knowledge-hub-archive (sibling checkout) plans/phase-0-investigation/s49-open-resolutions.md` A1
  (rationale for NEW skill, not adapting `implement-specs`).
- `lib/validation/task-list-schema.ts` — Subtask schema, PRODUCT inv
  9–13.
- `CLAUDE.md` — Worktree, Testing, Supabase, UI Gotchas.
