# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality, structured data accessible by AI. The first domain application is bid management for UK SMBs. The knowledge base is the foundation; bids are the first use case, not the only one.

**Stack:** Next.js 16 (App Router), TypeScript, Supabase (PostgreSQL + pgvector), Python ingestion pipeline, Vercel deployment.

**Team:** Liam (product owner, zero development experience) + AI as development partner. All code is written through human-AI collaboration.

## Commands

### Build, lint, format

- `bun install` — install Node dependencies
- `bun dev` — start Next.js dev server (Turbopack)
- `bun build` — production build
- `bun lint` — ESLint
- `bun run format` — Prettier format all files
- `bun run format:check` — check Prettier formatting

### Testing

- `bun run test` — run all Vitest tests (**NOT `bun test`** — see Gotchas)
- `bun run test __tests__/some-file.test.ts` — run a single test file
- `bun run test:watch` — Vitest watch mode
- `bun run test:coverage` — coverage via `@vitest/coverage-v8`
- `python3 -m pytest scripts/tests/` — Python pipeline tests

### Python pipeline

- `pip install -r requirements.txt` — install Python dependencies
- `python3 scripts/ingest.py <url>` — ingest a single URL
- `python3 scripts/ingest.py --file urls.txt` — batch ingest from file
- `python3 scripts/ingest_markdown.py <dir>` — ingest .md files from directory
- `python3 scripts/import_bid_library.py <dir>` — import Q&A pairs from .docx files

### Utilities

- `bun run scripts/kb-search.ts "query"` — semantic search CLI
- `bun run scripts/batch_generate_summaries.ts` — batch AI summary generation

### Supabase

- `/opt/homebrew/bin/supabase migration new <name>` — create local migration file
- `/opt/homebrew/bin/supabase db push` — push local migrations to remote
- `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` — regenerate TypeScript types from live schema

## Architecture

### High-level structure

- `app/` — Next.js 16 App Router (pages + API routes)
- `components/` — ~95 custom components + `ui/` (shadcn/ui)
- `contexts/` — React contexts (`read-marks-context`, `taxonomy-context`)
- `hooks/` — 12 hooks (accessibility, browse-filters, keyboard-shortcuts, notifications, etc.)
- `lib/` — Supabase clients, AI utils, bid logic, search, validation, formatting
- `types/` — TypeScript types (content, bid, bid-metadata, copilot, digest, review)
- `scripts/` — Python ingestion pipeline + TypeScript CLI utilities
- `supabase/migrations/` — DDL migration files
- `supabase/types/` — auto-generated types (`database.types.ts` — never edit manually)
- `__tests__/` — Vitest unit tests (covers `lib/` functions)
- `proxy.ts` — auth middleware (Next.js 16 proxy pattern)
- `docs/reference/` — schema reference, classification framework, search evaluation, import guides
- `.planning/` — specs, project plan, codebase mapping, research, continuation prompts

### Auth flow

`proxy.ts` is the Next.js middleware. It creates a cookie-based Supabase server client and calls `supabase.auth.getUser()` (never `getSession()`) on every request. Unauthenticated users are redirected to `/login`; API routes pass through (they do their own auth check).

API routes use `getAuthenticatedClient()` or `getAuthorisedClient(requiredRoles)` from `lib/auth.ts`. These return a `{ user, supabase }` pair (and optionally `role`) in a single operation. The Supabase client from auth is reused for all subsequent data queries in that request.

### Supabase client pattern (three clients)

1. **Browser client** (`lib/supabase/client.ts`) — `createBrowserClient<Database>()`, used in React components
2. **Server client** (`lib/supabase/server.ts` → `createClient()`) — cookie-based, used in API routes and Server Components
3. **Service client** (`lib/supabase/server.ts` → `createServiceClient()`) — uses `SUPABASE_SECRET_KEY`, bypasses RLS, for admin/pipeline operations

### API route pattern

All API routes follow this pattern:
1. Auth check via `getAuthenticatedClient()` / `getAuthorisedClient()`
2. Rate limiting via `checkRateLimit()` from `lib/rate-limit.ts`
3. Body/params validation via `parseBody()` / `parseSearchParams()` from `lib/validation/` against Zod schemas in `lib/validation/schemas.ts`
4. Supabase data operations using the authenticated client
5. Error handling via `safeErrorMessage()` from `lib/error.ts`

### AI model orchestration

`lib/anthropic.ts` provides multi-model orchestration with three tiers:
- **analysis** (Sonnet) — fast/cheap: question analysis, search queries
- **drafting** (Opus) — high quality: response drafting with citations
- **quality** (Haiku) — cheap: quality checks

Overridable via env vars: `AI_ANALYSIS_MODEL`, `AI_DRAFTING_MODEL`, `AI_QUALITY_MODEL`.

Embeddings use OpenAI `text-embedding-3-large` at 1024 dimensions (Matryoshka-shortened from 3072) via `lib/embeddings.ts`.

### Bid drafting pipeline

`lib/bid-drafting.ts` implements a three-pass pipeline:
1. **Pass 1** (Sonnet): Question analysis — structured output with topics, headings, tone
2. **Pass 2** (Opus): Response drafting with Search Result Citations from KB content
3. **Pass 3** (Haiku): Quality check — deterministic + AI verification

Citations and Structured Outputs are incompatible in the Claude API, so these are separate API calls.

### Bid state machine

`lib/bid-state-machine.ts` defines the bid lifecycle: `draft` → `questions_extracted` → `matching` → `drafting` → `in_review` → `ready_for_export` → `submitted` → `won`/`lost`. Terminal states: `won`, `lost`, `withdrawn`. Transitions are validated via `canTransition(from, to)`.

### Taxonomy system

DB-driven via `taxonomy_domains` and `taxonomy_subtopics` tables, loaded at app boot by `TaxonomyProvider` in `contexts/taxonomy-context.tsx`. `lib/taxonomy.ts` has a hardcoded fallback for the Python pipeline and static builds. Canonical validation constants live in `lib/validation/schemas.ts`.

### CopilotKit integration

`app/api/copilotkit/` is the AG-UI runtime endpoint. System prompt is in `lib/copilotkit/system-prompt.ts`. Action helpers in `lib/copilotkit/action-helpers.ts`.

### Provider tree (app/layout.tsx)

`ThemeProvider` → `TaxonomyProvider` → `ReadMarksProvider` → `TooltipProvider` → children. Plus `CommandPalette`, `KeyboardShortcutsProvider`, and `Toaster` (sonner).

### Path aliases

`@/*` maps to project root (configured in `tsconfig.json`). Use `@/lib/...`, `@/components/...`, etc.

## Supabase

- **Project ID:** `rovrymhhffssilaftdwd` (eu-west-2 London)
- **pgvector:** 0.8.0 — embeddings are `vector(1024)`, HNSW indexes (m=16, ef_construction=64, cosine similarity)
- Use Supabase CLI for DDL migrations
- `supabase/types/database.types.ts` is auto-generated — never edit manually

### RLS model

Role-based via `get_user_role()` SECURITY DEFINER helper:
- All authenticated: SELECT on all tables
- Editor + Admin: INSERT/UPDATE on content, projects, bids
- Admin only: DELETE, manage `user_roles`, configure taxonomy
- User-scoped: `read_marks` filtered by `user_id = auth.uid()`
- Service role: Python pipeline bypasses RLS entirely

## Testing

- **Framework:** Vitest with jsdom environment — run via `bun run test`
- **Location:** `__tests__/` — unit tests covering `lib/` functions
- **Setup file:** `__tests__/setup.ts`
- **Coverage targets:** `lib/`, `app/api/`, `components/`, `hooks/`
- **Python tests:** `python3 -m pytest scripts/tests/`
- **Known gap:** zero component tests, zero API route integration tests, zero hook tests
- **`vi.mock()` hoisting:** factories are hoisted above `const` declarations — use `vi.hoisted()` for variables referenced inside factories. Arrow functions in `mockImplementation()` cannot be used with `new` — use `function` keyword

## Design Principles

- **UK English throughout** — DD/MM/YYYY, "colour" not "color", "organisation" not "organization"
- **Package manager: bun** — never use npm or yarn
- **WCAG 2.1 AA** — never use colour alone for meaning
- **Generic over specific** — containers, workflows, lifecycle machines should be reusable across use cases
- **"One record, many views"** — no content duplication; one authoritative record per topic
- **"Observe and intervene" governance** — trust users by default, flag for review when quality dips

## Gotchas

- **`bun test` vs `bun run test`:** `bun test` invokes bun's native test runner (no jsdom, no vitest config). **Always use `bun run test`**
- **Embedding vector serialisation:** Supabase RPC needs `JSON.stringify(embedding)`, not a raw array, for vector params
- **Supabase REST PATCH on wrong UUID:** Returns 200 OK with 0 rows affected (silent no-op). Always verify updates by re-querying
- **RLS requires user_roles entry:** New users cannot write until they have a `user_roles` row
- **Content review vs governance review:** `/review` is content quality review (speed review cards). `/api/governance/review` is freshness/ownership governance. They are separate workflows
- **Python background output:** Use `PYTHONUNBUFFERED=1` when running Python scripts in the background
- **taxonomy.ts dual-source:** `lib/taxonomy.ts` has a hardcoded fallback; canonical constants live in `lib/validation/schemas.ts`. The app uses DB-driven taxonomy via `contexts/taxonomy-context.tsx`

## Deployment

- **Platform:** Vercel
- **URL:** https://knowledge-hub-seven-kappa.vercel.app
- **GitHub:** https://github.com/liam-jons/knowledge-hub (private)
