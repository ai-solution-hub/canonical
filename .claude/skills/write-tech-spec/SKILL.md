---
name: write-tech-spec
description:
  Write a TECH.md spec for a significant Knowledge Hub feature after researching
  the current codebase and implementation constraints. Use when the user asks
  for a technical spec, implementation plan, or architecture doc tied to a
  product spec.
---

# write-tech-spec

Write a `TECH.md` spec for a significant feature in Knowledge Hub.

## Overview

The tech spec should translate product intent into an implementation plan that
fits the existing codebase, documents architectural choices, and makes the work
easier for agents to execute and reviewers to evaluate.

Write specs to `specs/<id>/TECH.md`, where `<id>` is one of:

- a GitHub issue id, prefixed with `gh-` (e.g. `specs/gh-4567/TECH.md`)
- a Linear ticket number if Liam is using one for the feature (e.g.
  `specs/APP-1234/TECH.md`)
- a short kebab-case feature name (e.g. `specs/q-a-workspace-scoping/TECH.md`)
- once Taskmaster is installed (S232 WP4+), align `<id>` with the Taskmaster
  task ID for the feature.

Match the id used by the sibling `PRODUCT.md` when one exists. `specs/` should
contain only id-named directories as direct children.

Ticket / issue references are optional. If Liam has a GitHub issue or Linear
ticket, use its id. If not, ask for a feature name to use as the directory. Only
create a new GitHub issue or Linear ticket when explicitly asked; in that case
use `gh` CLI for GitHub or Linear MCP tools for Linear (and `AskUserQuestion` if
labels or repo are unclear).

## When to use

Use this skill when the implementation spans multiple modules, has meaningful
architectural tradeoffs, or when reviewers will benefit from seeing the plan
before or alongside the code. For pure UI changes or straightforward fixes, a
tech spec is often unnecessary.

Prefer to have a `PRODUCT.md` first so the technical plan is anchored to agreed
behavior. If the implementation is still too uncertain, build an e2e prototype
first and then write the tech spec from what was learned.

## Research before writing

Before drafting, read the product spec (if any), inspect the relevant code, and
identify the main files, types, data flow, and ownership boundaries. Do not
guess about current architecture when the code can be inspected directly.

Knowledge Hub conventions to ground the plan in:

- **Architecture map:** `.planning/codebase/STRUCTURE.md` is the authoritative
  directory layout. `docs/generated/codebase-stats.md` +
  `docs/generated/mcp-inventory.md` are auto-generated current counts.
- **Schema:** `supabase/types/database.types.ts` (auto-generated; never
  hand-edit) + `supabase/types/database-overrides.ts` for JSONB domain types —
  consume via `Tables<'x'>` / `Enums<'x'>`. New DDL: `supabase migration new` +
  `db push`, not MCP `execute_sql`.
- **Function search_path:** every new PL/pgSQL function MUST include
  `SET search_path = public, extensions`.
- **Anon EXECUTE grants:** every new `public.*()` function needs an explicit
  `REVOKE EXECUTE ON FUNCTION public.foo() FROM anon;` in its migration.
- **Embedding vectors:** `vector(1024)` (text-embedding-3-large); embed-array
  RPC params via `JSON.stringify(embedding)`.
- **Safe Supabase access:** `sb()` / `tryQuery()` from `@/lib/supabase/safe`;
  never raw client calls in feature paths.
- **No barrel re-exports:** direct file imports only (`@/lib/bid/helpers`).
- **Data fetching:** TanStack Query exclusively; keys in
  `lib/query/query-keys.ts`.
- **Auth:** `getAuthorisedClient()` discriminated union; route failures via
  `authFailureResponse(auth)`.
- **MCP tools / resources / prompts:** see `lib/mcp/` +
  `docs/generated/mcp-inventory.md`.
- **Taxonomy:** DB-driven via `contexts/taxonomy-context.tsx`; Python pipeline
  reads `scripts/tests/fixtures/taxonomy_snapshot.json`. Run
  `bun run sync:taxonomy` after taxonomy changes.

## Structure

Required sections:

1. **Context** — What's being built, how the current system works in the area
   being changed, and the most relevant files with line references. Combine the
   "problem," "current state," and "relevant code" into one grounded section.
   Example references:
   - `lib/bid/helpers.ts:42` — entry point for the bid-response edit flow
   - `app/api/items/[id]/route.ts (120-220)` — state and event handling that
     will likely change
   - `scripts/kb_pipeline/classify.py (300-450)` — Pass 1 classification that
     this feature extends Reference `PRODUCT.md` for user-visible behavior
     rather than restating it.
2. **Proposed changes** — The implementation plan: which modules change, new
   types/APIs/state being introduced, data flow, ownership boundaries, and how
   the design follows existing patterns. Call out tradeoffs when there is more
   than one reasonable path. For schema changes, include the migration
   filename + `REVOKE` grants + `SET search_path` + RLS predicates explicitly.
   For MCP changes, include the tool/resource/prompt registration site +
   two-step contract shape.
3. **Testing and validation** — How the implementation will be verified against
   the product behavior. Owns everything about proving the feature works: unit
   tests, integration tests, manual steps, screenshots, videos, and any other
   verification. Reference the numbered Behavior invariants from `PRODUCT.md`
   directly rather than restating them; each important invariant should map to a
   concrete test or verification step. This section is where validation lives —
   `PRODUCT.md` intentionally does not have a Validation section.

Optional sections — include only when they add signal. Omit the heading entirely
if empty; do not write "None" as a placeholder.

- **End-to-end flow** — Include only when tracing the path through the system
  tells you something the Proposed changes list doesn't.
- **Diagram** — Include a Mermaid diagram only when a visual will explain the
  design faster than prose (data flow, state transitions, sequence across
  layers). Prefer one or two focused diagrams over decorative ones.
- **Risks and mitigations** — Include when there are real failure modes,
  regressions, migration concerns, or rollout hazards worth calling out. For
  Knowledge Hub, common risks: silent supabase-call failures, RLS predicate
  gaps, GENERATED column constraints (`content_text_hash`), proxy `publicRoutes`
  allowlist for new API routes, embedding-cost on backfill, schema parity prod ↔
  staging.
- **Parallelization** — Include when work can cleanly split across multiple
  agents and that split is non-obvious. Note worktree isolation requirements
  (see CLAUDE.md "Parallel agent isolation").
- **Follow-ups** — Include when there is deferred cleanup or future work worth
  naming. Cross-reference any `0.9-collapse-candidates.md` entries this work
  creates or resolves.

## Length heuristic

Right-size the spec to the feature:

- Single-file change with clear approach: skip the tech spec or keep it under
  ~40 lines.
- Multi-module change with some ambiguity: target ~80–150 lines.
- Large cross-cutting or architecturally novel change: longer is fine when every
  section earns its place.

If Context and Proposed changes end up describing the same files and state from
different angles, collapse them.

## Writing guidance

- Ground the plan in actual codebase structure and patterns.
- Prefer concrete implementation guidance over generic architecture language.
- Explain why the proposed design fits this repo.
- Reference `PRODUCT.md` for behavior instead of restating it.
- Cite CLAUDE.md gotchas when they apply (Supabase CLI sandbox bypass, REST
  PATCH silent no-op, etc.) — many Phase 2 bugs come from missing these.
- Each section should earn its place — if a section would repeat another or
  contain only boilerplate, omit it.
- UK English (`colour`, `organisation`, DD/MM/YYYY) throughout.

## Keep the spec current

Approved specs may ship in the same PR as the implementation. Update `TECH.md`
in the same PR when module boundaries, implementation sequencing, risks,
validation strategy, or rollout assumptions change. The checked-in spec should
describe the implementation that actually ships.

For large features, the implementer may optionally keep a `DECISIONS.md` file
summarizing concrete decisions. Offer it when it would help future agents;
otherwise skip it.

Once Gitbook integration is wired (planned), approved + shipped specs may also
be published as engineering docs via the Gitbook sync. The checked-in `TECH.md`
remains the canonical source of truth; Gitbook is the publishing surface.

**Ledger field discipline (ID-34):** REJECTED-alternatives analysis, migration
trade-offs, and design rationale live here in `TECH.md`. When the work is
tracked by a task-list Task, the Task's `description` points at this spec via
`cross_doc_links` — it does not inline the rationale (that is the drift ID-34
corrects). See [`docs/reference/task-list-discipline.md`](../../../docs/reference/task-list-discipline.md).

## Related Skills

- `write-product-spec` — companion product spec.
- `documentation-and-adrs` — for architectural decision records that outlive a
  single feature.
- `spec-driven-development` — broader spec-first workflow.
- `test-driven-development` — for the test-first slice of the validation work.
- `incremental-implementation` — for landing the spec's changes in slices.
