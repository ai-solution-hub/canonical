---
name: spec-driven-implementation
description:
  Drive a spec-first workflow for substantial features by writing PRODUCT.md
  before implementation, writing TECH.md when warranted, and keeping both specs
  updated as implementation evolves. Use when starting a significant feature,
  planning agent-driven implementation, or when the user wants product and tech
  specs checked into source control.
---

# spec-driven-implementation

Drive a spec-first workflow for substantial features in Knowledge Hub.

## Overview

Use this skill for significant features where a written spec will improve
implementation quality, reduce ambiguity, or make review easier. Be pragmatic:
not every change needs specs.

This skill orchestrates the **spec-authoring chain** for a NEW Task ID-N —
`{N.1}` RESEARCH (when warranted) → `{N.2}` PRODUCT → `{N.3}` TECH → `{N.4}`
PLAN. Spec ratification is followed by per-Subtask dispatch via the
`implement-subtask` skill, which carries each `ID-N.M` implementation Subtask.
Use `implement-subtask` (not this skill) for per-Subtask implementation
within an already-spec'd Task.

Specs should usually live in:

- `docs/specs/<id>/PRODUCT.md`
- `docs/specs/<id>/TECH.md`

Where `<id>` is one of (matches `write-product-spec` / `write-tech-spec`
conventions):

- a GitHub issue id, prefixed with `gh-` (e.g. `docs/specs/gh-4567/PRODUCT.md`)
- a Linear ticket number if Liam is using one for the feature (e.g.
  `docs/specs/APP-1234/PRODUCT.md`)
- a short kebab-case feature name (e.g.
  `docs/specs/q-a-workspace-scoping/PRODUCT.md`)
- once Taskmaster is installed (S232 WP4+), align `<id>` with the Taskmaster
  task ID for the feature so `docs/specs/<id>/` maps cleanly to the task tree.

`docs/specs/` should contain only id-named directories as direct children. Do
not create engineer-named subdirectories or feature-slug-plus-suffix variants
there.

Ticket / issue references are optional. If Liam has a GitHub issue or Linear
ticket, use its id. If not, ask for a feature name to use as the directory. Only
create a new GitHub issue or Linear ticket when explicitly asked; in that case
use `gh` CLI for GitHub or Linear MCP tools for Linear (and `AskUserQuestion` if
labels or repo are unclear).

These specs should largely be written by agents, not by hand, and should be
checked into source control so they can be reviewed and kept current with the
code.

## When specs are required

Strongly prefer specs when the change is substantial, such as:

- product or architectural ambiguity
- expected implementation size around 1k+ LOC
- deep or cross-cutting stack changes (e.g. schema + Python pipeline + Next.js +
  MCP)
- risky behavior changes where regressions would be expensive
- work where agent quality will improve materially from clearer inputs

Specs are often unnecessary for:

- small, local bug fixes
- straightforward refactors
- narrow UI tweaks with little ambiguity

For pure UI changes, the product spec is often useful while the tech spec may be
unnecessary.

## Workflow

### 1. Decide whether the feature needs specs

Evaluate the size, ambiguity, and risk of the feature. If specs will not
meaningfully improve execution or review, skip them and focus on verification
instead.

### 2. Write the product spec first

Before implementation, create `PRODUCT.md` describing the desired user-facing
behavior.

Use the `write-product-spec` skill to produce it. The product spec should
define:

- what problem is being solved
- the desired user experience
- invariants and edge cases
- success criteria
- how the behavior will be validated

If the feature has UI or interaction design, ask for a Figma mock if one exists.
If there is no mock, continue but call that out explicitly in the product spec.

Reference the GitHub issue or Linear ticket in the spec when one exists. Because
specs live under `docs/specs/<id>/...`, this should usually be straightforward.

### 3. Write the tech spec when warranted

Use the `write-tech-spec` skill for substantial or ambiguous implementation
work.

Prefer a tech spec when:

- the implementation spans multiple subsystems (e.g. Supabase + Python
  pipeline + Next.js + MCP)
- architecture or extensibility matters
- there are meaningful tradeoffs to document
- reviewers will benefit more from reviewing the plan than the raw code

It is acceptable to write the tech spec after an e2e prototype if that leads to
a more accurate implementation plan. Do not force a premature tech spec when the
implementation details are still too uncertain.

### 4. Implement approved specs

After the spec chain ratifies, the Planner decomposes the work into
implementation Subtasks `{N.5+}` (via `planning-and-task-breakdown` when
warranted). Each Subtask carries a dispatch brief in its `details` field,
and the Orchestrator dispatches one Executor per Subtask group; each
Executor invokes `implement-subtask` against the brief.

The `implement-specs` skill remains available for whole-feature implementation
when a Task is genuinely atomic (one Subtask) and the Planner has elected a
single-Executor strategy. The KH-native default is per-Subtask via
`implement-subtask`.

The implementation can often be pushed in the same PR as the product and tech
specs. As the engineer iterates, keep `PRODUCT.md`, `TECH.md`, code changes, and
tests in that same PR so the review reflects the feature that will actually
ship.

For large features, the implementer may optionally offer:

- `PROJECT_LOG.md` to track explored paths, checkpoints, and current
  implementation state
- `DECISIONS.md` to capture concrete product and technical decisions made during
  design and implementation

These are optional aids, not required outputs.

### 5. Keep specs current during implementation

If implementation changes from the spec, update the spec rather than leaving it
stale.

Update `PRODUCT.md` when:

- user-facing behavior changes
- success criteria change
- UX details or edge cases change

Update `TECH.md` when:

- the implementation approach changes
- architectural boundaries move
- risks, dependencies, or rollout details change
- the testing or validation plan changes

The checked-in specs should describe the feature that actually ships, not just
the initial intent. Keep those spec updates in the same PR as the related code
changes whenever practical.

### 6. Verify behavior against the spec

Before considering the work complete, make sure verification maps back to the
specs. Prefer tests and artifacts that validate the product behavior directly:

- Vitest unit / integration tests under `__tests__/` for TS/Next.js code
  (`bun run test`, `bun run test:integration`)
- Python `pytest` for `scripts/kb_pipeline/`
  (`python3 -m pytest scripts/tests/`)
- Playwright E2E specs under `e2e/tests/` for critical user flows
  (`bun run test:e2e`)
- MCP eval suites (`bun run test:mcp-eval` / `:rq` / `:fc`) when the change
  touches MCP tools, resources, or prompts
- screenshots, recordings, or staging walkthroughs
  (https://knowledge-hub-git-staging-tw-group.vercel.app) when useful for
  UI-heavy work

See `docs/reference/test-philosophy.md` before writing or remediating tests.

## Best Practices

- Be pragmatic above all else.
- Write specs to improve input quality for agents, not as ceremony.
- Keep product specs behavior-oriented and implementation-light.
- Keep tech specs implementation-oriented and grounded in current codebase
  patterns (`.planning/codebase/STRUCTURE.md`,
  `docs/reference/SCHEMA-QUICK-REFERENCE.md`,
  `docs/generated/codebase-stats.md`).
- Use review time to validate specs and behavior, not to over-index on code
  style nits.

## Related Skills

- `implement-subtask` — for `ID-N.M` Subtask execution after the spec chain
  ratifies (the KH-native Executor entry point).
- `write-product-spec` / `write-tech-spec` / `planning-and-task-breakdown` —
  the spec authoring chain steps (`{N.2}` / `{N.3}` / `{N.4}` respectively).
- `implement-specs` — atomic-Task whole-feature fallback (rare).
- `test-driven-development`
