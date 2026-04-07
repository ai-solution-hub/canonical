# CLAUDE.md

**This project uses a 1M context window — optimise for completeness over
compression in all persisted outputs.**

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain applications are bid
management and intelligence (research pipelines) for UK SMBs. The knowledge base
is the foundation for these and future applications.

**Team:** Liam (product owner, zero development experience) + Claude Code as
development partner. All code is written through human-AI collaboration.

## Commands

| Command                                                                                                                                | Description                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bun install`                                                                                                                          | Install Node dependencies                                                                            |
| `bun dev`                                                                                                                              | Start Next.js dev server (Turbopack) - default port is localhost:3000                                |
| `bun build`                                                                                                                            | Production build                                                                                     |
| `bun run test`                                                                                                                         | Run Vitest tests (NOT `bun test` — see Gotchas)                                                      |
| `bun lint`                                                                                                                             | ESLint                                                                                               |
| `pip install -r requirements.txt`                                                                                                      | Install Python pipeline dependencies                                                                 |
| `python3 scripts/ingest.py <url>`                                                                                                      | Ingest a single URL (extract, dedup, classify, embed, store)                                         |
| `python3 scripts/ingest.py --file urls.txt`                                                                                            | Batch ingest from file                                                                               |
| `python3 scripts/ingest_markdown.py <dir>`                                                                                             | Ingest .md files from directory (--dry-run, --limit, --skip-existing, --tag, --author)               |
| `bun run scripts/kb-search.ts "query"`                                                                                                 | Semantic search CLI (--limit, --domain, --full, --json)                                              |
| `bun run scripts/batch-generate-summaries.ts`                                                                                          | Batch AI summary generation                                                                          |
| `bun run scripts/backfill-reader-html.ts`                                                                                              | Backfill reader HTML for articles/blogs (--limit, --dry-run)                                         |
| `python3 scripts/import_bid_library.py <dir>`                                                                                          | Import Q&A pairs from client .docx files (--dry-run, --batch-tag)                                    |
| `python3 scripts/extract_docx_tables.py <file>`                                                                                        | Extract tables from .docx files                                                                      |
| `python3 -m pytest scripts/tests/`                                                                                                     | Run Python tests                                                                                     |
| `bun run format`                                                                                                                       | Prettier format all files                                                                            |
| `bun run format:check`                                                                                                                 | Check Prettier formatting                                                                            |
| `bun run build:mcp-apps`                                                                                                               | Build MCP Apps (Vite) + generate inline bundles for Vercel                                           |
| `bun run build:plugin`                                                                                                                 | Regenerate plugin ZIP bundle (`lib/mcp/plugin-bundle.ts`) — commit after                             |
| `bun run test:e2e`                                                                                                                     | Run Playwright E2E tests                                                                             |
| `bun run test:watch`                                                                                                                   | Vitest in watch mode                                                                                 |
| `bun run sync:taxonomy`                                                                                                                | Full taxonomy sync (classification prompt + snapshot + plugin + rebuild)                             |
| `bun run test:mcp-eval`                                                                                                                | Run MCP eval Layer 1 (protocol compliance, 42 checks)                                                |
| `bun run test:mcp-eval:rq`                                                                                                             | Run MCP eval Layer 3 (response quality, 17 checks)                                                   |
| `bun run test:mcp-eval:fc`                                                                                                             | Run MCP eval Layer 4 (functional correctness, 37 checks, live DB)                                    |
| `/opt/homebrew/bin/supabase migration new <name>`                                                                                      | Create local migration file                                                                          |
| `/opt/homebrew/bin/supabase db push`                                                                                                   | Push local migrations to remote                                                                      |
| `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` | Regenerate TypeScript types from live schema                                                         |
| `bun run stats`                                                                                                                        | Generate codebase statistics to `docs/generated/` (run end-of-session when file counts change)       |
| `bun run generate:mcp-inventory`                                                                                                       | Generate MCP tool/resource/prompt inventory to `docs/generated/` (run when MCP registrations change) |
| `bun run knip`                                                                                                                         | Detect unused files, exports, types, and dependencies (run before merging large changes)             |

## Architecture

Full directory layout with file-level detail: `.planning/codebase/STRUCTURE.md`

Key directories:

Key file: `proxy.ts` — Next.js 16 convention file (auto-discovered, not
imported) — auth middleware, `publicRoutes` allowlist

| Directory     | Contents                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js 16 App Router — API routes, page routes                                                                                                                                                                                                 |
| `mcp-apps/`   | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai)                                                                                                                                                                              |
| `components/` | 20 domain subdirs — new components go in their domain dir, never at root                                                                                                                                                                        |
| `contexts/`   | React contexts (read-marks, taxonomy, client-features, layer-vocabulary)                                                                                                                                                                        |
| `hooks/`      | Custom React hooks — 5 domain subdirs (bid, browse, review, streaming, ui) + general hooks at root                                                                                                                                              |
| `lib/`        | Core modules — `ai/`, `mcp/` (tools, resources, prompts), `bid/`, `content/`, `coverage/`, `digest/`, `entities/`, `extraction/`, `quality/`, `source-documents/`, `supabase/`, `taxonomy/`, `templates/`, `validation/`, plus standalone utils |
| `types/`      | TypeScript types (content, bid, bid-metadata, digest, review, template, owner, reorient, unified-gap, filter-preset, css.d)                                                                                                                     |
| `scripts/`    | Python pipeline (`kb_pipeline/`), ingestion CLIs, search CLI, batch scripts                                                                                                                                                                     |
| `supabase/`   | Migrations + auto-generated types (`database.types.ts` — never edit manually)                                                                                                                                                                   |
| `__tests__/`  | Vitest tests — mirrors source structure (api, app, components, contexts, hooks, lib, mcp, scripts, validation)                                                                                                                                  |
| `e2e/`        | Playwright E2E specs. Config: `playwright.config.ts`                                                                                                                                                                                            |
| `docs/`       | Reference docs, continuation prompts, design system                                                                                                                                                                                             |

Current counts (routes, components, hooks, tools, migrations, tests):
`docs/generated/codebase-stats.md` and `docs/generated/mcp-inventory.md`

## Environment

Required env vars (in `.env` and `.env.local`; see `.env.example` for template):

- `ANTHROPIC_API_KEY` — Claude API (classification, summaries, digests)
- `OPENAI_API_KEY` — OpenAI API (embeddings)
- `SUPABASE_URL` — Supabase project URL (Python scripts)
- `SUPABASE_ANON_KEY` — Supabase anon key (Python scripts)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase URL (Next.js client)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (Next.js client)
- `SUPABASE_SECRET_KEY` — Supabase service role key (batch scripts, MCP server)
- `AI_SUMMARY_MODEL` — (optional) Claude model for AI summaries/digests,
  defaults to `claude-sonnet-4-6`

## Supabase

- **Project ID:** `rovrymhhffssilaftdwd` (knowledge-base, eu-west-2 London)
- **pgvector:** 0.8.0
- **CLI:** `/opt/homebrew/bin/supabase`
- **Prefer Supabase CLI** for DDL migrations — creates local files and applies
  remotely
- Use Supabase MCP tools (`execute_sql`, `list_tables`, etc.) for queries and
  quick DML
- **Never use MCP `execute_sql` for DDL** (CREATE TABLE, ALTER TABLE, etc.) —
  always use `supabase migration new` + `supabase db push`.
- **Function search_path:** All new PL/pgSQL functions **MUST** include
  `SET search_path = public, extensions` to avoid security warnings
- **Prefer proper schema** -- tables and columns over JSONB for key data
- One Supabase project per client — simple isolation, not multi-tenant RLS

## Schema

Full reference: `docs/reference/SCHEMA-QUICK-REFERENCE.md`

RLS: role-based via `get_user_role()` — see schema reference for full model.
Embeddings: `vector(1024)` (text-embedding-3-large, Matryoshka). Enum-like
columns use CHECK constraints. Canonical constants: `lib/validation/schemas.ts`.

## Testing

- **Framework:** Vitest — run via `bun run test`
- **Coverage:** `bun run test:coverage` (via `@vitest/coverage-v8`)
- **Location:** `__tests__/` — see `docs/generated/codebase-stats.md` for
  current counts
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts` — all API tests use this
- **Integration testing:** Integrate with Supabase DB for testing real data
  flows
- **Python tests:** `python3 -m pytest scripts/tests/`
- **E2E:** Playwright — specs in `e2e/tests/`. Worker-scoped fixtures,
  multi-role auth (admin/editor/viewer).

## Deployment

- **Platform:** Vercel
- **URL:** https://knowledge-hub-seven-kappa.vercel.app
- **GitHub:** https://github.com/liam-jons/knowledge-hub (private)
- **Region:** eu-west-2 (London) — matches Supabase region

## Key Product Design Principles

- **"One record, many views"** — no content duplication. One authoritative
  record per topic, multiple views for different audiences (the Wikipedia
  principle)
- **"Helping you get organised, not learning from you"** — AI is invisible
  infrastructure, **not** a visible product feature - see
  `docs/reference/ai-visibility-policy.md` for guidance when creating/updating
  UI
- **Programmatic where possible** — save AI for response generation and
  classification. Use deterministic functions for deterministic tasks
- **Generic over specific** — containers, workflows, lifecycle machines should
  be reusable across use cases, not bid-specific
- **UK English throughout** — DD/MM/YYYY, "colour" not "color", "organisation"
  not "organization"
- **WCAG 2.1 AA** — never colour alone for meaning
- **Package manager: bun** (NOT npm/yarn) — `bun install`, `bun dev`,
  `bun run test`, `bun build`
- **The KB is the product** — bids and intelligence are the first applications,
  not the only ones. Data quality is of the utmost importance

## Design Context

### Design System: Warm Meridian

- **Philosophy:** `docs/design/warm-meridian-philosophy.md`
- **Implementation spec:** `docs/design/warm-meridian-implementation-spec.md`
- **Visual reference:** `docs/design/warm-meridian-identity.pdf`
- **Token reference:** `docs/design/warm-meridian-implementation-spec.md`
  §Semantic Tokens
- **Quality checks:** `.claude/checks/` (design-system, accessibility, etc.)

Consult these references when adding or modifying UI elements.

## Key Reference Documents

| Document                      | Location                                                              |
| ----------------------------- | --------------------------------------------------------------------- |
| State of the Product          | `docs/reference/state-of-the-product.md`                              |
| Product backlog               | `docs/reference/product-backlog.md`                                   |
| Codebase mapping (7 docs)     | `.planning/codebase/`                                                 |
| Quality checks (10 files)     | `.claude/checks/`                                                     |
| Schema quick reference        | `docs/reference/SCHEMA-QUICK-REFERENCE.md`                            |
| Auto-generated stats          | `docs/generated/codebase-stats.md`, `docs/generated/mcp-inventory.md` |
| Documentation inventory       | `docs/reference/documentation-inventory.md`                           |
| Session handoffs              | `docs/continuation-prompts/`                                          |
| Classification prompt         | `docs/reference/classification-prompt.md`                             |
| Classification architecture   | `docs/reference/classification-architecture.md`                       |
| Two-pass validation arch      | `docs/reference/two-pass-validation-architecture.md`                  |
| Entity type taxonomy spec     | `docs/reference/entity-type-taxonomy-spec.md`                         |
| Field-consumer dependency map | `docs/reference/field-consumer-dependency-map.md`                     |
| Data entry points             | `docs/reference/data-entry-points.md`                                 |
| Taxonomy change runbook       | `docs/reference/taxonomy-change-runbook.md`                           |
| Roadmap                       | `docs/reference/post-mvp-roadmap.md`                                  |
| AI integration strategy       | `docs/reference/ai-integration-strategy.md`                           |
| AI integration layer map      | `docs/reference/ai-integration-layers.md`                             |
| UX principles                 | `docs/reference/ux-principles.md`                                     |
| AI visibility policy          | `docs/reference/ai-visibility-policy.md`                              |
| Sector intelligence pathway   | `docs/reference/sector-intelligence-pathway.md`                       |
| Client personas               | `docs/reference/client-personas.md`                                   |
| Product differentiation audit | `docs/reference/product-differentiation-audit.md`                     |
| Pipeline parity spec          | `.planning/.archive/.specs/pipeline-parity-spec.md` (archived S151)   |

Historical planning documents live in `.planning/.archive/` with subfolders:

- `.specs/` — archived spec documents
- `.audits/` — archived audit reports
- `.reference/` — archived reference docs (e.g. ads-v1)
- `.research/` — archived research documents
- `.continuation-prompts/` — archived session handoff prompts (s41–s131+)
- `.session-exports/`, `.session-extracts/`, `.feasibility/`, `.design-audit/`, `.extracted-patterns/`

These directories contain valuable historical context — why decisions were made, what was tried, what failed — but the `.` prefix keeps them out of normal search results. Grep them explicitly when researching historical context for current work, and treat their content as a point-in-time snapshot (decisions may have been superseded).

## Implementation Workflow

Spec-Code-Verify workflow is loaded via `/start-session` skill at session start.
Key rules: max 2-4h per agent, verification gates after every phase, fix ALL
findings before merge, sequential merges only.

**Parallel agent isolation:** Use `isolation: "worktree"` on Agent tool calls
for parallel implementation work. This auto-creates a git worktree, runs the
agent there, and returns changes on a branch. Merge sequentially on main — check
`git status` for leaked files before each merge. Reserve manual worktree
management only for merge-conflict-prone work requiring interactive resolution.

## Gotchas

### Supabase

- **Embedding vector serialisation:** `JSON.stringify(embedding)` for Supabase
  RPC vector params, not raw array.
- **Metadata double-serialisation:** Pass metadata as dict not `json.dumps()` —
  Supabase serialises it again.
- **REST PATCH on wrong UUID:** Returns 200 OK with 0 rows (silent no-op).
  Always verify updates by re-querying.
- **RLS requires user_roles entry:** New users cannot write until seeded.
- **notifications_type_check:** Valid types listed in schema reference (§29
  CHECK Constraints). Other values fail the DB constraint.
- **CLI in Claude Code sandbox:** The CLI uses direct Postgres connections via
  the pooler hostname (`aws-1-eu-west-2.pooler.supabase.com`) which the sandbox
  blocks. Run `supabase migration new`, `supabase db push`, and
  `supabase gen types` with `dangerouslyDisableSandbox: true`.
  `SUPABASE_DB_PASSWORD` must be set as a shell env var (source from `.env`).
- **Empty migration files from worktree cherry-picks:** When cherry-picking from
  worktrees, migration files may arrive as 0-byte files. Supabase CLI marks them
  as "applied" even though no SQL ran. Always verify migration file content
  after cherry-pick. If an empty migration was already recorded, the SQL must be
  applied directly via `execute_sql` and the local file backfilled.
- **Bun fetch hangs on HTTP 204 through sandbox proxy:** Bun 1.3.4 fetch hangs
  for the full 300s default timeout on HTTP/2 204 No Content responses tunneled
  through the Claude Code sandbox HTTP CONNECT proxy. supabase-js sends
  `Prefer: return=minimal` for `.update()`/`.insert()`/`.upsert()`/`.delete()`
  without chained `.select()`, PostgREST returns 204, and Bun never reads the
  body. AbortController is ignored. Production (Vercel) is unaffected — verified
  via pg_stat_statements (6,215+ UPDATEs at 150ms mean). **Fix:** run any script
  doing supabase writes (`scripts/eval-*.ts`, ad-hoc bun -e snippets) with
  `dangerouslyDisableSandbox: true`. Do NOT add `.select()` workarounds in
  production code — the production code is fine.

### Testing

- **Guard tests break on structural changes:** `mcp-fixture-sync.test.ts` (MCP
  tool/prompt counts), `doc-freshness.test.ts` (reference doc paths), and
  `pipeline-parity.test.ts` (TS/Python pipeline alignment) run on every
  `bun run test`. Update fixtures when adding tools or changing doc paths.
- **vi.mock() hoisting:** Use `vi.hoisted()` for mock variables. Arrow functions
  in `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Zod UUID validation is strict:** `z.string().uuid()` enforces RFC 4122
  (version nibble = 4, variant nibble in `[89ab]`). Test UUIDs like
  `00000000-0000-0000-0000-000000000001` will fail — use v4-compliant values.
- **Date-sensitive tests need pinned time:** Tests that compute "days ago" must
  use `vi.spyOn(Date, 'now')` with a fixed timestamp or the `daysAgo()` buffer
  pattern — `setDate()` rounding causes midnight-boundary flakiness.
- **Agent escalation rule:** When test agents encounter unexpected production
  behaviour (e.g. a component renders incorrectly, a function returns wrong
  data, dead code paths, or tests that can only pass by not actually testing the
  real logic), **they MUST escalate these findings to the main session**.
- **`plugin-taxonomy-consistency.test.ts` fails on worktree branches:** The
  test reads `.claude/plugins/knowledge-hub/1.0.0/skills/*/SKILL.md` and
  `settings.template.json` which are tracked in `.claude/` — but `.claude/` is
  gitignored, so worktrees created via `isolation: "worktree"` don't include
  those files. Tests pass on main, fail in worktrees. Not a regression —
  ignore the 2 failures when merging from a worktree, and verify on main after.

### E2E / Playwright

- **Browser install:** Must run `python3 -m playwright install chromium` after
  pip install — version mismatches cause failures.
- **Mobile viewports:** Pixel 5 viewport may need `click({ force: true })` or
  `dispatchEvent('click')` for partially obscured buttons.
- **Auth timing:** Always `waitFor({ state: 'visible' })` before `fill()` on
  login inputs.
- **Browser testing:** Never use `mcp__playwright__*` for parallel testing. Use
  `agent-browser` skill with `--session` for isolated sessions.

### Plugin / MCP

- **Plugin not auto-discovered:** Must be published to local marketplace and
  enabled in settings. Existing in `.claude/plugins/` is not enough.
- **Plugin bundle is committed:** `lib/mcp/plugin-bundle.ts` must be committed.
  Run `bun run build:plugin` after changing plugin files.
- **Plugin marketplaces:** After pushing plugins to remote, `git pull` in
  `~/.claude/plugins/marketplaces/{name}/` to refresh.
- **mcp-handler breaks on Vercel:** Use MCP SDK's
  `WebStandardStreamableHTTPServerTransport` directly, not `createMcpHandler`.
  Fresh server + transport per request. `mcp-handler` only for `.well-known`.

### Data & Architecture

- **Silent failures in Supabase calls:** For every `await supabase.` call in
  `app/api/**/*.ts` or `lib/**/*.ts`, use `sb()` (fail-fast) or `tryQuery()`
  (Result-returning) from `@/lib/supabase/safe`, or destructure `{ data, error }`
  and branch on `error`. Composite responses use `warningsEnvelope()` from
  `@/lib/supabase/warnings` (sibling shape `T & { warnings: readonly string[] }`,
  field omitted when empty — canonical reference at `app/api/items/[id]/route.ts:419-423`).
  "Best-effort" swallows use `logBestEffortWarn('domain.entity.action', msg, { err })`
  from `@/lib/supabase/telemetry`. The ESLint rules `local/no-unchecked-supabase-error`
  and `local/no-silent-promise-catch` enforce this at `error` level. Full spec:
  `docs/specs/silent-failure-prevention-spec.md`.
- **Data fetching:** TanStack Query exclusively. Keys in
  `lib/query/query-keys.ts`, fetchers in `lib/query/fetchers.ts`. No SWR or raw
  fetch in hooks.
- **`getAuthorisedClient()` discriminated union:** Returns
  `{ success: boolean }` — check `auth.success` not `auth.authorised`. Three
  failure reasons are distinguished: `unauthenticated` (→401), `forbidden`
  (→403), `role_lookup_failed` (→500, new in S151 — covers transient DB
  failures on the `user_roles` read so admins are never silently downgraded
  to viewer). **Always** handle failures via the `authFailureResponse(auth)`
  helper rather than hand-rolling `NextResponse.json({ error: '...' }, ...)`
  — the helper routes each reason to the correct HTTP status.
- **No barrel re-exports:** Always use direct file imports
  (`@/lib/bid/helpers`), never import from index files.
- **taxonomy.ts dual-source:** App uses DB-driven taxonomy
  (`contexts/taxonomy-context.tsx`), but `lib/taxonomy/taxonomy.ts` remains for
  the Python pipeline. Constants in `lib/validation/schemas.ts`.
- **Taxonomy changes require `bun run sync:taxonomy`:** After adding/editing
  domains or subtopics via admin UI, run `sync:taxonomy` to regenerate the
  classification prompt and plugin files. DB is the single source of truth.
- **Content review vs governance review:** `/review` = content quality (speed
  review cards). `/api/governance/review` = freshness/ownership. Separate
  workflows.
- **"Change Reports" not "Digest":** User-facing label is "Change Reports".
  Internal code, types, routes, and file names still use "digest".
- **Entity classification: false positives, not type errors:** S140 eval showed
  99.2% type accuracy but 45.7% precision. The problem is extracting
  non-entities (policies, generic concepts, job titles), not mistyping real
  ones. Source of truth: `docs/reference/entity-type-taxonomy-spec.md`.

### UI / Frontend

- **No raw Tailwind colours:** Always use semantic tokens. Define new ones in
  `app/globals.css`. See `docs/design/warm-meridian-implementation-spec.md`.
- **Tailwind v4 dark mode is class-based:**
  `@custom-variant dark (&:is(.dark *))` in `globals.css` — without it, `dark:`
  compiles to a media query and class-based toggling (next-themes) breaks.
- **Tailwind v4 scans ALL files:** Never put wildcard class patterns in
  backticks in any project file (including docs). Use `{name}` not `*`.
- **Tailwind v4 removed default border-color preflight:** Bare `border` uses
  `currentColor` not `--border`. The base rule in `globals.css`
  (`*, ::after, ::before { border-color: var(--border) }`) restores the expected
  behaviour. Never remove it.
- **React compiler memoisation:** Destructure nested properties before using in
  `useCallback` deps (e.g. `const { fn } = data;` not `data.fn`).
- **Stable empty array/object defaults in hook returns:** Inline `data?.foo ?? []`
  in hook return values creates a new array reference every render, cascading
  into broken `useMemo`/`useCallback` dependency arrays downstream. Hoist a
  module-level `const EMPTY_X: T[] = [];` and wrap with `useMemo(() => data?.foo ?? EMPTY_X, [data?.foo])`.
  Pattern confirmed by `vercel-react-best-practices` skill (S151 WP6).
- **Reset local state via `key` prop, not `setState` in effect:** If a child
  component needs to reset its local state when a parent prop changes, add
  `key={propId}` at the call site to force a clean remount — don't write a
  `useEffect` that calls `setState` in response to the prop change. This is
  the `react-hooks/set-state-in-effect` rule fix; see S151 WP6.

### General

- **Python background output:** Use `PYTHONUNBUFFERED=1` or output is invisible.
- **python-docx and Track Changes:** Use `open_document_safe()` from
  `scripts/docx_utils.py`, not `Document(path)` directly. Mammoth (TypeScript
  path) handles Track Changes correctly.
- **Concurrent Claude sessions:** Two sessions on same working tree destroy each
  other's files. Use `isolation: "worktree"` for parallel agents, or sequence
  sessions. For planned parallel sessions (e.g. split S152A/B/C), use top-level
  `git worktree add ../project-sessionN -b sessionN` so each session has its
  own filesystem + `.claude/worktrees/` namespace and shares only the git
  object database. `/start-session`'s worktree cleanup is safe (`git branch -d`
  refuses unmerged), but its "investigate unmerged worktrees" instruction can
  be misinterpreted if the investigator agent doesn't know about the other
  concurrent sessions.
- **Worktree merges leak files:** After merging worktree branches (including
  `isolation: worktree` agent branches), run `git status` on main and clean with
  `git checkout -- .` and `git clean -fd`.
- **Worktree branches stale on parallel launch:** Agents launched in parallel
  branch from main at launch time. If earlier agents merge first, later
  branches no longer match main. **Cherry-pick (not merge)** the unique commit
  to avoid reverting newer work — `git diff main worktree-branch --stat` will
  show the full reverse diff if you naively merge.
- **`hooks/` directory needs sandbox bypass for cherry-picks:** Sandbox blocks
  writes to project `hooks/` for some operations. When cherry-picking commits
  that create files there, use `dangerouslyDisableSandbox: true`.
- **"Build the thing, forget to turn it on":** S150 found multiple cases of
  backend code shipped without UI/cron/migration/test wiring (SI-C1 cron not
  scheduled, SI-H5 health endpoint orphaned, SI-L5 read-only, SI-M5 metadata
  unread, AI-H2 dead flag, AI-L2 dead skill). Verification rule: every fix must
  trace from the production entry point to the change. Run `bun run knip` for
  deterministic detection of unused files/exports.
- **Sub-agents are hard-limited to 200K tokens — NOT the parent session's 1M.**
  Even when the main session has a 1M context window, sub-agents launched via
  the Agent tool (including `isolation: "worktree"` agents) get their own
  isolated 200K context. Performance degrades around 147K (~73%); "Prompt is
  too long" fires near the ceiling. Scope rule: budget ~80 tool calls, hard
  stop at 120. For tasks that need to read >15 large files or walk large
  codebases, split into multiple sub-agents or do the work in the main session.
  Confirmed via claude-code issues #12312, #23377. S151 saw 3 sub-agent failures
  from this: Task 17 (ai-integration audit — retried as 17a/17b split), Task 4
  Phase 2 (continuation prompt audit — rescued from worktree), Task 6 (lint
  cleanup — rescued from worktree). Common failure mode: the agent writes its
  output correctly but runs out of budget during the final `git commit`. Always
  check the worktree's `git status` before removing it; uncommitted work can be
  rescued.
- **Worktree sub-agents: absolute paths resolve to MAIN REPO, not the worktree.**
  When a sub-agent uses `Write`/`Edit` with an absolute path like
  `/Users/liamj/Documents/development/knowledge-hub/docs/foo.md`, the tool
  writes to the main repo, NOT the worktree copy at
  `/Users/liamj/Documents/development/knowledge-hub/.claude/worktrees/agent-XXXX/docs/foo.md`.
  This is because Claude Code's file tools use absolute paths directly; the
  agent's `pwd` is the worktree but the absolute path points elsewhere.
  **Sub-agent instructions must always use relative paths** (e.g.
  `docs/audits/s151-decision-responses.md`, not `/Users/liamj/.../docs/audits/s151-decision-responses.md`) OR
  must explicitly derive the worktree root first: `cd "$(git rev-parse --show-toplevel)"`.
  S151 saw this across multiple Phase 4 agents; in each case the agent caught
  it mid-task and recovered by copying files into the worktree + reverting
  main. When rescuing, run `git status` in main FIRST to detect leaked files,
  then copy to the worktree path and `git checkout --` the main paths.
- **`classifyContent` userId must be a UUID:** `content_items.updated_by` is a
  uuid column. Eval scripts and other callers must use the pipeline service
  account UUID (`a0000000-0000-4000-8000-000000000001`), never a literal string
  like `'eval-runner'`.
- **Proxy blocks non-API public routes:** New public endpoints must be added to
  `publicRoutes` in `proxy.ts` (project root) or they silently redirect to
  `/login`.
