# CLAUDE.md

**This project uses a 1M context window — optimise for completeness over compression in all persisted outputs.**

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain application is bid management
for UK SMBs. The knowledge base is the foundation; bids are the first use case,
not the only one.

**Team:** Liam (product owner, zero development experience) + Claude Code as
development partner. All code is written through human-AI collaboration.

## Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install Node dependencies |
| `bun dev` | Start Next.js dev server (Turbopack) |
| `bun build` | Production build |
| `bun run test` | Run Vitest tests (NOT `bun test` — see Gotchas) |
| `bun lint` | ESLint |
| `pip install -r requirements.txt` | Install Python pipeline dependencies |
| `python3 scripts/ingest.py <url>` | Ingest a single URL (extract, dedup, classify, embed, store) |
| `python3 scripts/ingest.py --file urls.txt` | Batch ingest from file |
| `python3 scripts/ingest_markdown.py <dir>` | Ingest .md files from directory (--dry-run, --limit, --skip-existing, --tag, --author) |
| `bun run scripts/kb-search.ts "query"` | Semantic search CLI (--limit, --domain, --full, --json) |
| `bun run scripts/batch-generate-summaries.ts` | Batch AI summary generation |
| `bun run scripts/backfill-reader-html.ts` | Backfill reader HTML for articles/blogs (--limit, --dry-run) |
| `python3 scripts/import_bid_library.py <dir>` | Import Q&A pairs from client .docx files (--dry-run, --batch-tag) |
| `python3 scripts/extract_docx_tables.py <file>` | Extract tables from .docx files |
| `python3 -m pytest scripts/tests/` | Run Python tests |
| `bun run format` | Prettier format all files |
| `bun run format:check` | Check Prettier formatting |
| `bun run build:mcp-apps` | Build MCP Apps (Vite) + generate inline bundles for Vercel |
| `bun run build:plugin` | Regenerate plugin ZIP bundle (`lib/mcp/plugin-bundle.ts`) — commit after |
| `bun run test:mcp-eval` | Run MCP eval Layer 1 (protocol compliance, 42 checks) |
| `bun run test:mcp-eval:rq` | Run MCP eval Layer 3 (response quality, 17 checks) |
| `bun run test:mcp-eval:fc` | Run MCP eval Layer 4 (functional correctness, 37 checks, live DB) |
| `/opt/homebrew/bin/supabase migration new <name>` | Create local migration file |
| `/opt/homebrew/bin/supabase db push` | Push local migrations to remote |
| `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` | Regenerate TypeScript types from live schema |
| `bun run stats` | Generate codebase statistics to `docs/generated/` (run end-of-session when file counts change) |
| `bun run generate:mcp-inventory` | Generate MCP tool/resource/prompt inventory to `docs/generated/` (run when MCP registrations change) |

## Architecture

Full directory layout with file-level detail: `.planning/codebase/STRUCTURE.md`

Key directories:

| Directory | Contents |
|-----------|----------|
| `app/` | Next.js 16 App Router — API routes, page routes, `proxy.ts` auth middleware |
| `mcp-apps/` | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai) |
| `components/` | Custom components + `reader-cards/` + `ui/` (shadcn) |
| `contexts/` | React contexts (read-marks, taxonomy, client-features) |
| `hooks/` | Custom hooks (browse-filters, keyboard-shortcuts, draft-stream, etc.) |
| `lib/` | Utility modules — includes `mcp/` (tools, resources, prompts), `ai/` (service layer), `claude-prompts.ts` |
| `types/` | TypeScript types (content, bid, bid-metadata, digest, review, template, css.d) |
| `scripts/` | Python pipeline (`kb_pipeline/`), ingestion CLIs, search CLI, batch scripts |
| `supabase/` | Migrations + auto-generated types (`database.types.ts` — never edit manually) |
| `__tests__/` | Vitest test files |
| `e2e/` | Playwright E2E specs. Config: `playwright.config.ts` |
| `docs/` | Reference docs, continuation prompts, design system |

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
  always use `supabase migration new` + `supabase db push`. S118 migration
  squash found ~20 columns and 25 functions applied via MCP that were never
  captured in migration files, blocking replay for 3+ months.
- **Function search_path:** All new PL/pgSQL functions MUST include
  `SET search_path = public, extensions` to avoid security warnings
- **Prefer proper schema** -- tables and columns over JSONB for key data
- One Supabase project per client — simple isolation, not multi-tenant RLS
- **IMS reference project:** `ngsxwlaeybexlgsurnhy` (read-only, do not modify)

## Schema

Full reference: `docs/reference/SCHEMA-QUICK-REFERENCE.md`

RLS: role-based via `get_user_role()` — see schema reference for full model.
Embeddings: `vector(1024)` (text-embedding-3-large, Matryoshka). Enum-like
columns use CHECK constraints. Canonical constants: `lib/validation/schemas.ts`.

## Testing

- **Framework:** Vitest — run via `bun run test` (NOT `bun test` — see Gotchas)
- **Coverage:** `bun run test:coverage` (via `@vitest/coverage-v8`)
- **Location:** `__tests__/` — see `docs/generated/codebase-stats.md` for current counts
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts` — all API tests use this
- **Python tests:** `python3 -m pytest scripts/tests/`
- **E2E:** Playwright — specs in `e2e/tests/`. Worker-scoped fixtures,
  multi-role auth (admin/editor/viewer).
- **Strategy:** `.planning/specs/testing-strategy-spec.md` (original) +
  `.planning/specs/testing-expansion-spec.md` (all waves complete)
- **Agent escalation rule:** When test agents encounter unexpected production
  behaviour (e.g. a component renders incorrectly, a function returns wrong
  data, dead code paths, or tests that can only pass by not actually testing
  the real logic), they MUST escalate these findings rather than silently
  working around them with mocks. Tests that pass but don't verify real
  functionality are worse than no tests.

## Deployment

- **Platform:** Vercel
- **URL:** https://knowledge-hub-seven-kappa.vercel.app
- **GitHub:** https://github.com/liam-jons/knowledge-hub (private)
- **Region:** eu-west-2 (London) — matches Supabase region

## Key Design Principles

- **"One record, many views"** — no content duplication. One authoritative
  record per topic, multiple views for different audiences (the Wikipedia
  principle)
- **"Observe and intervene" governance** — not "prevent and approve". Trust
  users by default, flag for review when quality dips
- **"Helping you get organised, not learning from you"** — AI is invisible
  infrastructure, not a visible product feature
- **Programmatic where possible** — save AI for response generation and
  classification. Use deterministic functions for deterministic tasks
- **Generic over specific** — containers, workflows, lifecycle machines should
  be reusable across use cases, not bid-specific
- **UK English throughout** — DD/MM/YYYY, "colour" not "color",
  "organisation" not "organization"
- **WCAG 2.1 AA** — never colour alone for meaning
- **Package manager: bun** (NOT npm/yarn) — `bun install`, `bun dev`,
  `bun run test`, `bun build`
- **Nav items earn their place** — each nav item must have a genuinely
  different interaction model (Browse=filter, Q&A Library=copy-to-bid,
  Coverage=gap analysis, Bids=pipeline, Review=speed triage). New
  application types only get nav items if the interaction model is distinct
- **The KB is the product** — bids are the first application, not the only
  one. Navigation and IA must lead with the knowledge base

## Design Context

### Design System: Warm Meridian

- **Philosophy:** `docs/design/warm-meridian-philosophy.md`
- **Implementation spec:** `docs/design/warm-meridian-implementation-spec.md`
- **Visual reference:** `docs/design/warm-meridian-identity.pdf`
- **Token reference:** `docs/design/warm-meridian-implementation-spec.md` §Semantic Tokens
- **Quality checks:** `.claude/checks/` (design-system, accessibility, etc.)

Consult these references when adding or modifying UI elements.

## Key Reference Documents

| Document | Location |
|----------|----------|
| State of the Product | `docs/reference/state-of-the-product.md` |
| Codebase mapping (7 docs) | `.planning/codebase/` |
| Schema quick reference | `docs/reference/SCHEMA-QUICK-REFERENCE.md` |
| Quality checks (10 files) | `.claude/checks/` |
| Auto-generated stats | `docs/generated/codebase-stats.md`, `docs/generated/mcp-inventory.md` |
| Documentation inventory | `docs/reference/documentation-inventory.md` |
| Session handoffs | `docs/continuation-prompts/` |
| Classification framework | `docs/reference/classification-framework.md` |
| Roadmap | `docs/reference/post-mvp-roadmap.md` |

Historical planning documents are in `.planning/`.

## Implementation Workflow

Spec-Code-Verify workflow is loaded via `/start-session` skill at session start.
Key rules: max 2-4h per agent, verification gates after every phase, fix ALL
findings before merge, worktrees for parallel work, sequential merges only.

## Gotchas

- **No raw Tailwind colours:** Always use semantic tokens. Define new ones in
  `app/globals.css`. See `docs/design/warm-meridian-implementation-spec.md`.
- **Embedding vector serialisation:** `JSON.stringify(embedding)` for Supabase
  RPC vector params, not raw array.
- **Metadata double-serialisation:** Pass metadata as dict not `json.dumps()`
  — Supabase serialises it again.
- **Supabase REST PATCH on wrong UUID:** Returns 200 OK with 0 rows (silent
  no-op). Always verify updates by re-querying.
- **Python background output:** Use `PYTHONUNBUFFERED=1` or output is invisible.
- **RLS requires user_roles entry:** New users cannot write until seeded.
- **Playwright browser install:** Must run `python3 -m playwright install
  chromium` after pip install — version mismatches cause failures.
- **taxonomy.ts dual-source:** App uses DB-driven taxonomy
  (`contexts/taxonomy-context.tsx`), but `lib/taxonomy.ts` remains for the
  Python pipeline. Constants in `lib/validation/schemas.ts`.
- **Content review vs governance review:** `/review` = content quality (speed
  review cards). `/api/governance/review` = freshness/ownership. Separate workflows.
- **vi.mock() hoisting:** Use `vi.hoisted()` for mock variables. Arrow functions
  in `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Concurrent Claude sessions:** Two sessions on same working tree destroy each
  other's files. Use git worktrees or sequence sessions.
- **Proxy blocks non-API public routes:** New public endpoints must be added to
  `publicRoutes` in `proxy.ts` or they silently redirect to `/login`.
- **mcp-handler breaks on Vercel:** Use MCP SDK's
  `WebStandardStreamableHTTPServerTransport` directly, not `createMcpHandler`.
  Fresh server + transport per request. `mcp-handler` only for `.well-known`.
- **Plugin not auto-discovered:** Must be published to local marketplace and
  enabled in settings. Existing in `.claude/plugins/` is not enough.
- **Plugin bundle is committed:** `lib/mcp/plugin-bundle.ts` must be committed.
  Run `bun run build:plugin` after changing plugin files.
- **Tailwind v4 scans ALL files:** Never put wildcard class patterns in
  backticks in any project file (including docs). Use `{name}` not `*`.
- **E2E mobile:** Pixel 5 viewport may need `click({ force: true })` or
  `dispatchEvent('click')` for partially obscured buttons.
- **E2E auth timing:** Always `waitFor({ state: 'visible' })` before `fill()`
  on login inputs.
- **notifications_type_check:** Valid types listed in schema reference
  (§29 CHECK Constraints). Other values fail the DB constraint.
- **python-docx and Track Changes:** Use `open_document_safe()` from
  `scripts/docx_utils.py`, not `Document(path)` directly. Mammoth (TypeScript
  path) handles Track Changes correctly.
- **Browser testing:** Never use `mcp__playwright__*` for parallel testing. Use
  `agent-browser` skill with `--session` for isolated sessions.
- **Plugin marketplaces:** After pushing plugins to remote, `git pull` in
  `~/.claude/plugins/marketplaces/{name}/` to refresh.
- **Worktree agents leak files:** Before merging worktree branches, run
  `git status` on main and clean with `git checkout -- .` and `git clean -fd`.
- **React compiler memoisation:** Destructure nested properties before using
  in `useCallback` deps (e.g. `const { fn } = data;` not `data.fn`).
- **Supabase CLI in Claude Code sandbox:** The CLI uses direct Postgres
  connections via the pooler hostname (`aws-1-eu-west-2.pooler.supabase.com`)
  which the sandbox blocks. Run `supabase migration new`, `supabase db push`,
  and `supabase gen types` with `dangerouslyDisableSandbox: true`.
  `SUPABASE_DB_PASSWORD` must be set as a shell env var (source from `.env`).
- **Supabase default row limit:** Max Rows is set to 5000 (raised from 1000).
  Scripts fetching large result sets should still paginate with `.range()` or
  add explicit `.limit()` rather than relying on the default.
