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
| `bun run scripts/batch_generate_summaries.ts` | Batch AI summary generation |
| `bun run scripts/backfill-reader-html.ts` | Backfill reader HTML for articles/blogs (--limit, --dry-run) |
| `python3 scripts/import_bid_library.py <dir>` | Import Q&A pairs from client .docx files (--dry-run, --batch-tag) |
| `python3 scripts/extract_docx_tables.py <file>` | Extract tables from .docx files |
| `python3 -m pytest scripts/tests/` | Run Python tests |
| `bun run format` | Prettier format all files |
| `bun run format:check` | Check Prettier formatting |
| `bun run build:mcp-apps` | Build MCP Apps (Vite) + generate inline bundles for Vercel |
| `bun run build:plugin` | Regenerate plugin ZIP bundle (`lib/mcp/plugin-bundle.ts`) — commit after |
| `/opt/homebrew/bin/supabase migration new <name>` | Create local migration file |
| `/opt/homebrew/bin/supabase db push` | Push local migrations to remote |
| `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` | Regenerate TypeScript types from live schema |

## Architecture

Full directory layout with file-level detail: `.planning/codebase/STRUCTURE.md`

Key directories:

| Directory | Contents |
|-----------|----------|
| `app/` | Next.js 16 App Router — ~30 API route groups, ~12 page routes, `proxy.ts` auth middleware |
| `mcp-apps/` | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai) |
| `components/` | ~210 custom + `copilot-ui/` (2) + `reader-cards/` (3) + `ui/` (23 shadcn) |
| `contexts/` | React contexts (read-marks, taxonomy, client-features) |
| `hooks/` | ~33 custom hooks (browse-filters, keyboard-shortcuts, draft-stream, etc.) |
| `lib/` | ~69 utility modules — includes `mcp/` (23 tools, 9 resources, 5 prompts) and `ai/` (service layer) |
| `types/` | TypeScript types (content, bid, bid-metadata, copilot, digest, review, template, css.d) |
| `scripts/` | Python pipeline (`kb_pipeline/`), ingestion CLIs, search CLI, batch scripts |
| `supabase/` | ~45 migrations + auto-generated types (`database.types.ts` — never edit manually) |
| `__tests__/` | Vitest — ~111 test files |
| `e2e/` | Playwright — 5 spec files (auth, browse-search, settings, governance-review, role-gating) |
| `docs/` | Reference docs, continuation prompts, design system |

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
- One Supabase project per client — simple isolation, not multi-tenant RLS
- **IMS reference project:** `ngsxwlaeybexlgsurnhy` (read-only, do not modify)

## Schema

**20 tables** — full reference: `docs/reference/SCHEMA-QUICK-REFERENCE.md`

### RLS Model

Role-based via `get_user_role()` SECURITY DEFINER helper:
- **All authenticated:** SELECT on all tables
- **Editor + Admin:** INSERT/UPDATE on content, workspaces, bids, quality log
- **Admin only:** DELETE on most tables, manage `user_roles`, configure taxonomy
- **User-scoped:** `read_marks` filtered by `user_id = auth.uid()`
- **Immutable:** `content_history` — INSERT only, no UPDATE/DELETE
- **Service role:** Python pipeline bypasses RLS entirely

### Key Constraints

- Embeddings: `vector(1024)` — OpenAI text-embedding-3-large shortened from
  3072 via Matryoshka, HNSW indexes (m=16, ef_construction=64, cosine)
- Enum-like columns use CHECK constraints — see schema reference for valid values
- Canonical constants for content_type, platform, priority, freshness, etc.
  live in `lib/validation/schemas.ts`

## Testing

- **Framework:** Vitest — run via `bun run test` (NOT `bun test` — see Gotchas)
- **Coverage:** `bun run test:coverage` (via `@vitest/coverage-v8`)
- **Location:** `__tests__/` — ~111 test files
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts` — all API tests use this
- **Python tests:** `python3 -m pytest scripts/tests/` (template analysis,
  template filling)
- **E2E:** Playwright — 5 spec files in `e2e/tests/` (auth, browse-search,
  settings, governance-review, role-gating). Config: `playwright.config.ts`.
  111/111 tests pass. Worker-scoped fixtures with `[E2E-W{index}]` prefix for
  data isolation. Multi-role auth (admin/editor/viewer storage states).
  Shared responsive helpers in `e2e/helpers/responsive.ts`. Dev overlay
  suppression in `e2e/helpers/dev-overlays.ts`.
- **E2E test users:** user1=admin, user2=editor, user3=viewer (all in
  `user_roles` table). Auth setup saves 3 storage states to `e2e/.auth/`.
- **Strategy:** `.planning/specs/testing-strategy-spec.md` (original) +
  `.planning/specs/testing-expansion-spec.md` (all waves complete)

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
- **Quality checks:** `.claude/checks/` (design-system, accessibility, etc.)

Consult these references for brand personality, aesthetic direction, and design
principles. Key actionable rules below.

### Token Quick Reference

When adding or modifying UI elements, use these semantic tokens:

| Context | Token prefix | Example |
|---------|-------------|---------|
| Freshness states | `freshness-*` | `text-freshness-fresh`, `bg-freshness-aging-bg` |
| Confidence postures | `confidence-*` | `text-confidence-strong`, `border-confidence-partial-border` |
| Bid lifecycle | `bid-*` | `text-bid-active`, `bg-bid-won-bg` |
| Governance status | `governance-*` | `text-governance-approved`, `border-governance-pending-border` |
| Streaming phases | `phase-*` | `text-phase-drafting`, `bg-phase-done-bg` |
| Template review | `template-*` | `text-template-confirmed`, `bg-template-unmapped-bg` |
| Quality scoring | `quality-*` | `text-quality-good`, `bg-quality-moderate-bg` |
| General status | `status-*` | `text-status-success`, `text-status-warning` |
| Domain categories | `[var(--domain-{name}-text)]` | Per-domain tokens in globals.css |

**Rule:** Never use raw Tailwind colour classes (`text-green-600`,
`bg-amber-50`, etc.) in components. Always use a semantic token. If no token
exists for your use case, define one in `app/globals.css` first.

## Key Reference Documents

### Active Development — consult regularly

| Document | Location | Purpose |
|----------|----------|---------|
| State of the Product | `docs/reference/state-of-the-product.md` | Accurate reference of actual tech stack, architecture, features |
| Codebase mapping (7 docs) | `.planning/codebase/` | Deep detail on stack, architecture, structure, conventions, testing, integrations, concerns |
| Schema quick reference | `docs/reference/SCHEMA-QUICK-REFERENCE.md` | Tables, columns, functions, views |
| Quality checks (10 files) | `.claude/checks/` | Best-practice checks used by `/review` (accessibility, architecture, design system, error handling, image quality, multi-user patterns, package manager, Supabase patterns, testing, UK English) |
| Testing strategy | `.planning/specs/testing-strategy-spec.md` | Test infrastructure, priorities, mock patterns |
| Post-MVP backlog | `.planning/post-mvp-backlog.md` | 86 items, P1-P5, 4 sprint groupings |
| Session handoffs | `docs/continuation-prompts/` | Cross-session context transfer documents |
| AI integration layers | `docs/reference/ai-integration-layers.md` | 5-layer architecture: how MCP, plugin, skills, CopilotKit interconnect |
| MCP App build guide | `docs/reference/mcp-app-build-guide.md` | How to create, build, test, and deploy MCP Apps (lifecycle, patterns, Vercel) |

### Remaining Roadmap

| Item | Location | Status |
|------|----------|--------|
| Coverage Dashboard (Spec 2 §3) | `.planning/specs/spec2-tag-management-coverage.md` | Tags done; `/coverage` API built, page in progress |
| AI Integration (Spec 4) | `.planning/specs/spec4-ai-integration-architecture.md` | Sprints 1-7b done (MCP server 23 tools, OAuth, plugin, entity graph, MCP Apps); Sprint 7c-8 remaining |

### Domain References — consult when working in that area

| Document | Location | Purpose |
|----------|----------|---------|
| Classification framework | `docs/reference/classification-framework.md` | Domain taxonomy details |
| Classification prompt | `docs/reference/classification-prompt.md` | v3.1 classification prompt |
| Search evaluation | `docs/reference/search-evaluation-guide.md` + `scripts/search-evaluation.json` | How to run search tests (20 test cases) |
| Bid library import guide | `docs/reference/bid-library-import-guide.md` | Q&A import workflow and conventions |
| E2E test flows + setup | `docs/reference/e2e-test-flows.md` + `e2e-test-setup.md` | 12 flows, test data creation runbook |

Historical planning documents (project plan, feasibility study, ADS v1.0, Phase
6-7 specs, tool evaluations) are in `.planning/` — consult for decision context
when needed.

## Gotchas

- **Embedding vector serialisation:** Supabase RPC needs
  `JSON.stringify(embedding)` not raw array for vector params
- **Metadata double-serialisation:** Pass metadata as dict not `json.dumps()`
  to REST API — Supabase serialises it again
- **Supabase REST PATCH on wrong UUID:** Returns 200 OK with 0 rows affected
  (silent no-op). Always verify updates by re-querying
- **Python background output:** Use `PYTHONUNBUFFERED=1` when running Python
  scripts in background — otherwise output is invisible to monitoring
- **Supabase CLI linked:** Project `rovrymhhffssilaftdwd` is linked. Use
  `/opt/homebrew/bin/supabase db push` to apply local migrations
- **RLS requires user_roles entry:** New users cannot write until they have a
  `user_roles` row. First admin must be seeded via service_role key
- **Playwright browser install:** After `pip install playwright`, must also run
  `python3 -m playwright install chromium` — version mismatches cause failures
- **taxonomy.ts dual-source:** `lib/taxonomy.ts` contains a hardcoded fallback
  taxonomy. The app now uses DB-driven taxonomy via `contexts/taxonomy-context.tsx`
  (`TaxonomyProvider` + `useTaxonomy()`), but `taxonomy.ts` remains for the
  Python pipeline and as a static fallback. Canonical constants live in
  `lib/validation/schemas.ts`.
- **Content review vs governance review:** `/review` is content quality review
  (speed review cards). `/api/governance/review` is freshness/ownership
  governance. They are separate workflows — do not conflate them.
- **`vi.mock()` hoisting in Vitest v4:** `vi.mock()` factories are hoisted
  above `const` declarations. Variables referenced inside factories must use
  `vi.hoisted(() => { return { mock }; })`. Arrow functions in
  `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Concurrent Claude sessions:** Two sessions on the same working tree will
  destroy each other's untracked files and revert shared config. Never run
  test infrastructure work concurrently with feature work — use git worktrees
  or sequence the sessions.
- **CopilotKit CSS selectors:** `CopilotSidebar` applies the user `className`
  and its own `copilotKitSidebar` class to the SAME element. Use compound
  selectors (`.my-class.copilotKitSidebar`, no space) not descendant selectors.
- **pgvector search_path in Supabase functions:** PL/pgSQL functions don't
  inherit the session `search_path`, so `<=>` operators fail inside function
  bodies. Fix with `ALTER FUNCTION ... SET search_path = public, extensions`.
- **Proxy blocks non-API public routes:** `proxy.ts` redirects all
  unauthenticated non-`/api/` requests to `/login`. New public-facing
  endpoints (e.g. `/.well-known`, `/oauth/consent`) must be added to the
  `publicRoutes` array in `proxy.ts` or they will be silently redirected.
- **mcp-handler breaks on Vercel warm instances:** Do NOT use
  `createMcpHandler`/`withMcpAuth` from `mcp-handler` for the MCP route.
  Its shared Node.js transport corrupts on warm serverless instances
  (initialize works, tools/list crashes). Use the MCP SDK's
  `WebStandardStreamableHTTPServerTransport` directly with a fresh
  server + transport per request. `mcp-handler` is still used for
  `protectedResourceHandler` in the `.well-known` route only.
- **Knowledge Hub plugin not auto-discovered:** The plugin at
  `.claude/plugins/knowledge-hub/1.0.0/` is NOT auto-discovered by Claude Code.
  It must be published to the local marketplace
  (`~/.claude/plugins/marketplaces/local/plugins/`) and enabled in settings.
  Simply existing in the project's `.claude/plugins/` directory is not enough.
- **Plugin bundle is a committed artefact:** `lib/mcp/plugin-bundle.ts` is a
  generated file (like `app-bundles.ts`) that must be committed to git. The
  `.claude/` directory is gitignored, so Vercel cannot regenerate it. After
  changing plugin files (commands, skills, plugin.json), run
  `bun run build:plugin` and commit the updated `plugin-bundle.ts`.
- **Tailwind v4 scans ALL project files:** Tailwind v4 extracts class names
  from every file it can find — not just source code, but also `.md` files,
  `docs/`, and `CLAUDE.md` itself. Wildcard-like patterns (e.g.
  `domain-*-text`) in any file can be extracted as class names, generating
  invalid CSS that breaks the build or causes runtime layout failures (S76:
  this was the root cause of 82 E2E failures). Never put wildcard class
  patterns in backticks in any project file. Use placeholder names like
  `{name}` instead of `*` in documentation examples.
- **CopilotKit Web Inspector blocks E2E:** The `cpk-web-inspector` element
  and 429/401 runtime banners intercept pointer events. Set
  `showDevConsole={false}` and `enableInspector={false}` on `<CopilotKit>`,
  and stub `/api/copilotkit/` requests in E2E via `e2e/helpers/dev-overlays.ts`.
- **E2E mobile interactions:** Pixel 5 viewport may need
  `click({ force: true })` or `dispatchEvent('click')` for buttons that do
  not respond to standard Playwright click — particularly in responsive
  layouts where elements may be partially obscured or overlapping.
- **E2E auth input timing:** Always use `waitFor({ state: 'visible' })`
  before `fill()` on login page inputs — CopilotKit initialisation scripts
  can intercept focus and cause fill operations to silently fail.
- **notifications_type_check constraint:** Valid notification types are:
  `governance_review_needed`, `governance_approve`,
  `governance_request_changes`, `governance_revert`, `quality_flag`,
  `digest_ready`. Other values will fail the DB check constraint.
