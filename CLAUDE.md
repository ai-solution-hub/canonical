# CLAUDE.md

**This project uses a 1M context window — optimise for completeness over
compression in all persisted outputs.**

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain applications are bid
management and sector intelligence for UK SMBs. The knowledge base
is the foundation for these and future applications.

**Team:** Liam (product owner) + Claude Code as
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

Key file: `proxy.ts` — Next.js 16 auth middleware, `publicRoutes` allowlist
(auto-discovered, not imported)

| Directory     | Contents                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js 16 App Router — API routes, page routes                                                                                                                                                                                                 |
| `mcp-apps/`   | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai)                                                                                                                                                                              |
| `components/` | 21 domain subdirs — new components go in their domain dir, never at root                                                                                                                                                                        |
| `contexts/`   | React contexts (read-marks, taxonomy, client-features, layer-vocabulary)                                                                                                                                                                        |
| `hooks/`      | Custom React hooks — 6 domain subdirs (bid, browse, intelligence, review, streaming, ui) + general hooks at root                                                                                                                                              |
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

Env vars in `.env` and `.env.local` — see `.env.example` for full template.
Key vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SECRET_KEY`, `AI_SUMMARY_MODEL` (optional, defaults `claude-sonnet-4-6`).

## Supabase & Schema

- **Project ID:** `rovrymhhffssilaftdwd` (eu-west-2 London), pgvector 0.8.0
- **CLI:** `/opt/homebrew/bin/supabase`
- **DDL via CLI only** (`supabase migration new` + `db push`), never MCP
  `execute_sql`. MCP tools for queries and quick DML only.
- **Function search_path:** All new PL/pgSQL functions **MUST** include
  `SET search_path = public, extensions`
- **Prefer proper schema** — tables and columns over JSONB for key data
- One Supabase project per client — simple isolation, not multi-tenant RLS
- **Schema reference:** `docs/reference/SCHEMA-QUICK-REFERENCE.md`
- RLS: role-based via `get_user_role()`. Embeddings: `vector(1024)`
  (text-embedding-3-large). Canonical constants: `lib/validation/schemas.ts`.

## Testing

- **Framework:** Vitest (`bun run test`), coverage via `bun run test:coverage`
- **Location:** `__tests__/` — counts in `docs/generated/codebase-stats.md`
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts`
- **E2E:** Playwright in `e2e/tests/` — worker-scoped fixtures, multi-role auth

## Deployment

- **Platform:** Vercel
- **URL:** https://knowledge-hub-seven-kappa.vercel.app
- **GitHub:** https://github.com/liam-jons/knowledge-hub (private)
- **Region:** eu-west-2 (London) — matches Supabase region

## Key Product Design Principles

- **"One record, many views"** — no content duplication, multiple views
- **AI is invisible infrastructure** — not a visible product feature. See
  `docs/reference/ai-visibility-policy.md`
- **Programmatic where possible** — deterministic functions for deterministic tasks
- **Generic over specific** — reusable containers/workflows, not bid-specific
- **UK English throughout** — DD/MM/YYYY, "colour", "organisation"
- **WCAG 2.1 AA** — never colour alone for meaning
- **Package manager: bun** (NOT npm/yarn)
- **The KB is the product** — data quality is paramount

## Design System: Warm Meridian

Spec: `docs/design/warm-meridian-implementation-spec.md` (tokens in §Semantic
Tokens). Philosophy: `docs/design/warm-meridian-philosophy.md`. Visual:
`docs/design/warm-meridian-identity.pdf`. Quality checks: `.claude/checks/`.
Consult when adding or modifying UI elements.

## Key Reference Documents

| Document                  | Location                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| State of the Product      | `docs/reference/state-of-the-product.md`                              |
| Roadmap                   | `docs/reference/post-mvp-roadmap.md`                                  |
| Product backlog           | `docs/reference/product-backlog.md`                                   |
| Schema quick reference    | `docs/reference/SCHEMA-QUICK-REFERENCE.md`                            |
| Auto-generated stats      | `docs/generated/codebase-stats.md`, `docs/generated/mcp-inventory.md` |
| AI visibility policy      | `docs/reference/ai-visibility-policy.md`                              |
| Session handoffs          | `docs/continuation-prompts/`                                          |
| Codebase mapping (7 docs) | `.planning/codebase/`                                                 |
| Quality checks (11 files) | `.claude/checks/`                                                     |

Full inventory of all reference docs: `docs/reference/documentation-inventory.md`

Historical planning: `.planning/.archive/` (specs, audits, research, session
handoffs s41–s131+). Grep explicitly when researching past decisions; treat as
point-in-time snapshots.

## Implementation Workflow

Spec-Code-Verify workflow is loaded via `/start-session` skill at session start.
Key rules: max 2h per agent, verification gates after every phase, fix ALL
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
- **CLI in Claude Code sandbox:** Run `supabase migration new`, `db push`, and
  `gen types` with `dangerouslyDisableSandbox: true`. `SUPABASE_DB_PASSWORD`
  must be set as a shell env var.
- **Empty migration files from worktree cherry-picks:** Migration files may
  arrive as 0-byte. Supabase CLI marks them "applied" anyway. Always verify
  content after cherry-pick; if empty was already recorded, apply SQL via
  `execute_sql` and backfill the local file.
- **Bun fetch hangs on HTTP 204 through sandbox proxy:** supabase-js
  `.update()`/`.insert()`/`.upsert()`/`.delete()` without `.select()` returns
  204, which Bun hangs on in the sandbox. Production is unaffected. **Fix:** run
  supabase-writing scripts with `dangerouslyDisableSandbox: true`. Do NOT add
  `.select()` workarounds in production code.

### Testing

- **Guard tests break on structural changes:** `mcp-fixture-sync.test.ts`,
  `doc-freshness.test.ts`, and `pipeline-parity.test.ts` run on every test.
  Update fixtures when adding tools or changing doc paths.
- **vi.mock() hoisting:** Use `vi.hoisted()` for mock variables. Arrow functions
  in `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Zod UUID validation is strict:** `z.string().uuid()` enforces RFC 4122.
  Test UUIDs like `00000000-...0001` fail — use v4-compliant values.
- **Date-sensitive tests need pinned time:** Use `vi.spyOn(Date, 'now')` with a
  fixed timestamp — `setDate()` rounding causes midnight-boundary flakiness.
- **Agent escalation rule:** Test agents encountering unexpected production
  behaviour (wrong renders, dead code, tests that can only pass by not testing
  real logic) **MUST escalate to the main session**.

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

- **Silent failures in Supabase calls:** Use `sb()` (fail-fast) or `tryQuery()`
  (Result-returning) from `@/lib/supabase/safe`. Composite responses use
  `warningsEnvelope()` from `@/lib/supabase/warnings`. Best-effort swallows use
  `logBestEffortWarn()` from `@/lib/supabase/telemetry`. Enforced by ESLint
  rules `local/no-unchecked-supabase-error` and `local/no-silent-promise-catch`.
  Full spec: `docs/specs/silent-failure-prevention-spec.md`.
- **Cron `pipeline_runs` inserts:** Use `recordPipelineRun()` from
  `@/lib/pipeline/record-run`, not raw insert. Uses `sb()` internally, fires
  Sentry on failures, never throws.
- **Data fetching:** TanStack Query exclusively. Keys in
  `lib/query/query-keys.ts`, fetchers in `lib/query/fetchers.ts`. No SWR or raw
  fetch in hooks.
- **`getAuthorisedClient()` discriminated union:** Returns
  `{ success: boolean }` — check `auth.success` not `auth.authorised`. Three
  failure reasons: `unauthenticated` (→401), `forbidden` (→403),
  `role_lookup_failed` (→500). **Always** use `authFailureResponse(auth)` helper
  to route each reason to the correct HTTP status.
- **No barrel re-exports:** Always use direct file imports
  (`@/lib/bid/helpers`), never import from index files.
- **Taxonomy dual-source:** App uses DB-driven taxonomy
  (`contexts/taxonomy-context.tsx`); `lib/taxonomy/taxonomy.ts` remains for the
  Python pipeline. After taxonomy changes, run `bun run sync:taxonomy` to
  regenerate classification prompt and plugin files. DB is single source of truth.
- **Content review vs governance review:** `/review` = content quality.
  `/api/governance/review` = freshness/ownership. Separate workflows.
- **"Change Reports" not "Digest":** User-facing label is "Change Reports";
  internal code still uses "digest".
- **Entity classification: false positives, not type errors:** The problem is
  extracting non-entities (policies, generic concepts, job titles), not mistyping
  real ones. Source of truth: `docs/reference/entity-type-taxonomy-spec.md`.

### UI / Frontend

- **No raw Tailwind colours:** Always use semantic tokens. Define new ones in
  `app/globals.css`. See `docs/design/warm-meridian-implementation-spec.md`.
- **Tailwind v4 gotchas:** (1) Dark mode is class-based via
  `@custom-variant dark (&:is(.dark *))` in `globals.css` — don't remove.
  (2) Scans ALL files — never put wildcard class patterns in backticks.
  (3) Bare `border` uses `currentColor` — the `globals.css` base rule restoring
  `var(--border)` must not be removed.
- **React compiler memoisation:** Destructure nested properties before using in
  `useCallback` deps (e.g. `const { fn } = data;` not `data.fn`).
- **Stable empty array/object defaults in hook returns:** Inline `data?.foo ?? []`
  creates a new reference every render, breaking downstream deps. Hoist a
  module-level `const EMPTY_X: T[] = [];` and wrap with
  `useMemo(() => data?.foo ?? EMPTY_X, [data?.foo])`.
- **Reset local state via `key` prop, not `setState` in effect:** Add
  `key={propId}` at the call site to force a clean remount — don't write a
  `useEffect` that calls `setState` in response to prop changes.

### General

- **Next.js Image rejects query-string cache-busters on local paths.**
  `<Image src="/foo.webp?v=dev">` fails — Next.js handles its own caching.
- **`bun run format` reformats the entire repo.** Use
  `bunx prettier --write <path>` for targeted formatting.
- **Python background output:** Use `PYTHONUNBUFFERED=1` or output is invisible.
- **python-docx and Track Changes:** Use `open_document_safe()` from
  `scripts/docx_utils.py`, not `Document(path)` directly.
- **Worktree isolation rules:**
  - Two sessions on same working tree destroy each other's files — use
    `isolation: "worktree"` or `git worktree add` for parallel work.
  - After merging worktree branches, run `git status` on main and clean with
    `git checkout -- .` and `git clean -fd` (merges leak files).
  - **Cherry-pick (not merge)** parallel agent branches — agents branch from
    main at launch time and go stale when earlier agents merge first.
  - **Worktree agents start stale:** `isolation: "worktree"` branches from a
    historical commit. Agent's first action must be `git reset --hard main`.
  - `hooks/` directory needs `dangerouslyDisableSandbox: true` for cherry-picks.
  - **Sub-agent instructions must always use relative paths** — absolute paths
    resolve to main repo, not the worktree. If rescuing, check `git status` in
    main first to detect leaked files.
- **Sub-agents are hard-limited to 200K tokens — NOT the parent session's 1M.**
  Split large tasks across multiple sub-agents. Common failure: agent runs out
  of budget during final `git commit` — always check worktree `git status`
  before removing it.
- **"Build the thing, forget to turn it on":** Every fix must trace from the
  production entry point to the change. Run `bun run knip` for deterministic
  detection of unused files/exports.
- **`classifyContent` userId must be a UUID:** Use pipeline service account
  UUID (`a0000000-0000-4000-8000-000000000001`), never literal strings.
- **Proxy blocks non-API public routes:** New public endpoints must be added to
  `publicRoutes` in `proxy.ts` (project root) or they silently redirect to
  `/login`.
- **Dev server memory:** If OOM, run `bun run dev:clean`. Monitor with `btm`.
