---
name: implement-subtask
description:
  Use when implementing one Subtask brief dispatched by the Orchestrator. Reads the
  Subtask details field; drives TDD slice loop; commits per subtask; appends <info added
  on ...> block to details on completion. Triggered by the task-executor agent.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# implement-subtask — Atomic Subtask Execution

Implements **one** `ID-N.M` Subtask end-to-end against a dispatched brief.

## Input

The dispatch brief carries:

| Field                                             | Source                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subtask id (`<N>.<M>`)                            | Composite-id prose used in the dispatch message.                                                                                                                                                                                                                |
| `task-list.json` path                             | Access the single Subtask via `bun scripts/ledger-cli.ts get task <id>.<subId>` (subtask path — no whole-task fetch); ledger lives in `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/task-list.json`.                                                         |
| Location of the Subtask `details` field within it | Parent Task id (`id`) + Subtask id (`subId`).                                                                                                                                                                                                                   |
| Spec-slice path                                   | The `details` field references something like `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<task-slug>/PRODUCT.md#<section>` or `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<task-slug>/TECH.md#<section>`. Read only that slice — not the whole document. |
| `testStrategy`                                    | One-line prose acceptance statement.                                                                                                                                                                                                                            |

If any of these are missing from the dispatch brief, escalate to the Orchestrator before
starting — do not guess.

## Process

### Step 1 — Read the brief

Obtain the Subtask directly via `bun scripts/ledger-cli.ts get task <id>.<subId>`. Read
the `details` markdown field in full. The appended `<info added on …>` journal blocks may
record course-corrections that supersede the preamble brief — read them too
(`journal <id>.<subId>` for narrative state`); the latest block wins.

Then read the spec-slice the `details` references. Use Read with a section anchor (e.g.
`#step-3-commit`) only when the slice is small; for larger files, read the file in full
once and ignore non-referenced sections. Read additionally:

- `CLAUDE.md` Gotchas for the surface area you'll touch (Supabase / Testing / Frontend /
  etc.).
- The CLAUDE.md Architecture table (or GitNexus `gitnexus_query`) when you don't know
  where a module lives.
- `supabase/types/database.types.ts` (+ `supabase/types/database-overrides.ts` for JSONB
  domain types) when the change touches the database schema — consume via `Tables<'x'>` /
  `Enums<'x'>`, see CLAUDE.md "TypeScript conventions".

Move the Subtask status `pending → in_progress`. This is the only state transition you may
set — the Checker owns `done`.

**Worktree-dispatch variant:** when you are dispatched into a worktree (Agent-tool
`isolation: "worktree"` or cmux), ledger writes are FORBIDDEN in-branch — do NOT run the
status move or the Step 5 `append-journal` yourself. Return the status transition and the
journal text as INTENTS in your Step 6 report; the Orchestrator applies both via
`ledger-cli.ts` on MAIN. (Canonical rule: workflow-orchestration SKILL.md → Ledger
field-discipline.)

### Step 2 — Test-first

Invoke the `test-driven-development` skill before writing any production code, when the
Subtask touches logic with observable behaviour. Write the failing test against the
Subtask's `testStrategy`.

The Canonical platform test framework is Vitest. Run with `bun run test` (NOT `bun test`).
Vitest paths mirror the production tree under `__tests__/`.

If the Subtask is genuinely pure-documentation or pure-rename with no behaviour change,
skip the test step — but record the rationale in the journal block at Step 5.

### Step 3 — Slice loop

For multi-file changes, invoke `incremental-implementation` to interleave small slices
with their tests. Each slice cycle:

1. Write the slice.
2. Run the scoped test (`bun run test -- path/to/specific.test.ts`).
3. Commit the slice.

Slicing keeps the diff reviewable and the rollback unit small. A Subtask that produces one
giant commit is harder for the Checker to audit and harder to revert if a downstream wave
fails.

### Step 4 — Commit

Invoke `commit-commands`. Atomic commit per Subtask, with the commit message body
referencing `ID-N.M` for traceability:

**Pre-commit scope check (manual gate):** Before invoking `commit-commands`, run
`gitnexus_detect_changes()` to verify that the symbols modified in your diff match the
expected set for this Subtask. If the detected changes include symbols outside the
Subtask's file-ownership boundary — functions, classes, or types in files not referenced
in the `details` brief — STOP and escalate to the Orchestrator before committing. Do not
rationalise incidental changes as "safe"; the Checker will audit the blast radius and any
unexplained symbol drift will produce a FAIL verdict. This is a manual gate, canonical
until tooling automates the boundary check. See `.gitnexus/CLAUDE.md` for the canonical
`gitnexus_detect_changes` invocation pattern.

```
<conventional-commit-type>(<scope>): <one-line summary>

<wrapped body explaining the change.>

ID-N.M — <subtask-title>
```

If you complete multiple slices via `incremental-implementation`, the intermediate commits
stay; the final Subtask commit references `ID-N.M` and closes the slice.

### Step 5 — Journal

Append an `<info added on YYYY-MM-DDTHH:MM:SS.sssZ>` block to the Subtask `details` field
in `task-list.json`. This provides the Checker — who reads only the brief, the spec slice,
your journal, and the diff — a record of what shipped and any in-flight discoveries.

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
`date -u +%Y-%m-%dT%H:%M:%S.%3NZ` (or equivalent) at append time — do not reuse a stale
value.

The `<info added on …>` blocks accumulate over the Subtask's lifetime (if a fix-Executor
runs against the same Subtask post-Checker, it appends a fresh block — never edits earlier
blocks). This preserves the journal as a per-Subtask audit trail.

### Step 6 — Report

Return to the Orchestrator or Parent with:

- Branch name + final commit SHA.
- Acceptance criteria status (PASS / partial / unmet, with reason).

If there were any out-of-scope observations for Curator routing, notify the
Orchestrator/Parent so that they can review the journal entry for the detail.

## Escalation

If, while executing, you discover production behaviour that contradicts the brief, or the
brief references a spec slice that disagrees with the codebase, **STOP and escalate** to
the Orchestrator with evidence — never silently work around (canonical rule:
`.claude/agents/references/shared-discipline.md` §Escalation rule). The Orchestrator may
re-engage the Planner to amend the spec, or re-scope the Subtask.

## Canonical-specific quality bars

Apply the KH quality bars to every change — non-negotiable, audited by the Checker per
Subtask: semantic tokens only, UK English, `auth.success` + `authFailureResponse(auth)`,
`sb()`/`tryQuery()` Supabase safety, no barrel re-exports, TanStack Query only,
`bun run test` (never `bun test`), stable empty defaults.
