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

Write specs to `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/ID-N-<slug>/TECH.md`, where:

- `N` is the Task ID from `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/task-list.json` (e.g.
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/ID-9-astro-starlight-docs-foundation/TECH.md`).
- `<slug>` is a short kebab-case feature name matching the sibling
  `RESEARCH.md` / `PRODUCT.md` / `PLAN.md`.

**Filename convention (ID-48.4):** The canonical Subtask artefact filename for
the `{N.3}` TECH artefact is `TECH.md` (uppercase). The sibling research
artefact MUST be named `RESEARCH.md` (not `research.md`,
`<feature>-research.md`, or similar variants). Pre-existing spec dirs without
the `ID-N-` prefix are not migrated.

Match the dir used by the sibling `PRODUCT.md` when one exists. `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/`
should contain only id-named directories as direct children.

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

<!-- code-intel:planner-citation-start -->
### Code-intelligence orientation

Before writing the spec, orient yourself in the codebase using the code-intelligence
tools. This is the first research step — complete it before inspecting individual files or
drafting any section.

**Step (a) — query the feature concept.** Run `gitnexus_query` with the feature concept
from PRODUCT.md as the query string. This returns execution flows and symbols ranked by
relevance, grouped by functional area. It reveals which parts of the codebase are already
doing work in the problem space and which flows the new feature will intersect.

**Step (b) — context on named symbols.** For each named symbol (function, class, type, or
route) that PRODUCT.md references directly, run `gitnexus_context` on that symbol. This
returns its callers, callees, and the execution flows it participates in — the blast radius
a change would have and the patterns it is expected to follow.

**Step (c) — semantic search for unfamiliar surfaces.** When the feature concept is
unfamiliar or the query in step (a) returns few results, run a `ccc` semantic search
across the codebase. `ccc` uses embedding-based retrieval and surfaces files and symbols
that are semantically related even when they share no lexical terms with the query.

**Step (d) — ast-dataflow queries for precision work.** For schema-touching work, run
`ast-dataflow column-reads` and `ast-dataflow column-writes` on any column the spec
introduces or modifies; this shows every TypeScript site that reads or writes that
column, which is the correct scope for migration-safety analysis. For refactor work, run
`ast-dataflow callers` on the symbol being refactored to find all call sites that the
type-checker resolves — a superset of what GitNexus indexes.

If steps (a)–(c) return no relevant symbols, note the result inline in the Context
section with the literal: `gitnexus orientation: no existing symbols match — greenfield surface`

Guide references: `.gitnexus/CLAUDE.md` and `.ast-dataflow/CLAUDE.md` document the full
tool catalogue, query shapes, and cross-tool composition patterns. Cite those files; do
not reproduce their contents in the spec.
<!-- code-intel:planner-citation-end -->

Knowledge Hub conventions to ground the plan in:

- **Architecture map:** the CLAUDE.md Architecture table is the authoritative
  directory layout; GitNexus cluster/process maps give current structure
  (`.planning/codebase/` and the generated stats/inventory files are retired).
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
- **MCP tools / resources / prompts:** see `lib/mcp/` (tools, resources,
  prompts subdirs).
- **Taxonomy:** DB-driven via `contexts/taxonomy-context.tsx`; Python pipeline
  reads `scripts/tests/fixtures/taxonomy_snapshot.json`. Run
  `bun run sync:taxonomy` after taxonomy changes.
- **Code intelligence** — see `.gitnexus/CLAUDE.md` and `.ast-dataflow/CLAUDE.md`.

### Decision register

Before drafting, read the in-force entries of the decision register
(`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md`) — the durable
store of settled cross-cutting rulings and won't-fixes (`DR-NNN`). Do not re-propose an
approach a `DR` has already settled or ruled out of scope; where the plan must touch a
settled area, cite the governing `DR-NNN` rather than re-deriving the decision.

If research for this spec yields a new binding ruling — a hard-to-reverse architectural or
"explicitly-not-doing" decision a future session would otherwise re-litigate — return a
**DR-intent** to the Orchestrator (it writes on `main`) rather than appending to the
register yourself; workers never write the register in-branch.

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
corrects). See `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md`.

## Related Skills

- `write-product-spec` — companion product spec.
- `documentation-and-adrs` — for architectural decision records that outlive a
  single feature.
- `spec-driven-development` — broader spec-first workflow.
- `test-driven-development` — for the test-first slice of the validation work.
- `incremental-implementation` — for landing the spec's changes in slices.
