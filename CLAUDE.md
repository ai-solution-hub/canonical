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
| `app/` | Next.js 16 App Router — ~38 API route groups, ~19 page routes, `proxy.ts` auth middleware |
| `mcp-apps/` | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai) |
| `components/` | ~160 custom + `copilot-ui/` (2) + `reader-cards/` (3) + `ui/` (23 shadcn) |
| `contexts/` | React contexts (read-marks, taxonomy, client-features) |
| `hooks/` | ~35 custom hooks (browse-filters, keyboard-shortcuts, draft-stream, claude-connected, etc.) |
| `lib/` | ~56 utility modules — includes `mcp/` (33 tools, 10 resources, 5 prompts), `ai/` (service layer), `claude-prompts.ts` |
| `types/` | TypeScript types (content, bid, bid-metadata, copilot, digest, review, template, css.d) |
| `scripts/` | Python pipeline (`kb_pipeline/`), ingestion CLIs, search CLI, batch scripts |
| `supabase/` | ~85 migrations + auto-generated types (`database.types.ts` — never edit manually) |
| `__tests__/` | Vitest — ~256 test files |
| `e2e/` | Playwright — 11 spec files. Config: `playwright.config.ts` |
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

**29 tables** — full reference: `docs/reference/SCHEMA-QUICK-REFERENCE.md`

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
- **Location:** `__tests__/` — ~256 test files, ~4,183 tests
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts` — all API tests use this
- **Python tests:** `python3 -m pytest scripts/tests/`
- **E2E:** Playwright — 11 spec files in `e2e/tests/`. Worker-scoped fixtures,
  multi-role auth (admin/editor/viewer). See `e2e/` directory for spec files
  and helpers.
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
| Codebase statistics | `docs/generated/codebase-stats.md` | Auto-generated file/code counts — canonical source for volatile numbers |
| MCP inventory | `docs/generated/mcp-inventory.md` | Auto-generated tool/resource/prompt catalogue |
| Documentation inventory | `docs/reference/documentation-inventory.md` | Catalogue of all 557 docs with purpose, currency, and actions |

### Remaining Roadmap

| Item | Location | Status |
|------|----------|--------|
| Template-Driven Completeness | `docs/plans/template-driven-completeness-spec.md` | Phases 1-3b complete; Phases 4-6 remaining |

### Domain References — consult when working in that area

| Document | Location | Purpose |
|----------|----------|---------|
| Classification framework | `docs/reference/classification-framework.md` | Domain taxonomy details |
| Classification prompt | `docs/reference/classification-prompt.md` | v4.2 classification prompt (7 domains, 34 subtopics) |
| Search evaluation | `scripts/search-evaluation.json` | 24 search test cases |

Historical planning documents (project plan, feasibility study, ADS v1.0, Phase
6-7 specs, tool evaluations) are in `.planning/` — consult for decision context
when needed.

## Implementation Workflow (Spec-to-Code)

When implementing from specs, follow this methodical phased approach:

### 1. Spec Review (pre-implementation)
- Deploy parallel subagents to review each spec against the actual codebase
- Verify: file references exist, API signatures match, DB schema correct,
  effort estimates realistic, dependencies satisfied
- Fix ALL findings (must-fix AND should-fix) in specs before implementation
- Assess parallel vs sequential based on file overlap matrix

### 2. Phased Implementation with Verification Gates
- **Max 2-4 hours of work per agent** — never let one agent do an entire
  multi-phase spec without verification
- Use **git worktrees** (`isolation: "worktree"`) for parallel implementation
- After each phase completes, deploy a **separate verification agent** that:
  - Reads the spec requirements for that phase
  - Reads the implementation code
  - Checks spec compliance, code quality, test quality, regressions
  - Runs the tests
  - Returns PASS / PASS WITH NOTES / FAIL
- **Fix ALL verification findings** (including minor/low) before merging —
  deploy a fix agent for any notes, no matter the severity
- Only merge after verification passes clean

### 3. Merge and Regression Check
- Merge verified worktrees sequentially (not all at once)
- Run full test suite after each merge to catch conflicts
- Push after confirming green suite
- Continue to next phase only after current phase is merged and clean

### 4. Wave Structure
- **Wave 1:** Specs with no shared file dependencies (parallel worktrees)
- **Wave 2:** Specs that depend on Wave 1 outputs (after Wave 1 merges)
- Within each wave, phases run in steps: implement → verify → fix → merge

## Gotchas

- **No raw Tailwind colours in components:** Never use `text-green-600`,
  `bg-amber-50`, etc. Always use a semantic token (e.g. `text-freshness-fresh`,
  `bg-bid-won-bg`). If no token exists, define one in `app/globals.css` first.
  See `docs/design/warm-meridian-implementation-spec.md` for the full token map.
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
  `digest_ready`, `freshness_transition`, `coverage_alert`,
  `content_gap`, `owner_content_stale`, `owner_content_updated`,
  `owner_assignment`, `source_document_updated`,
  `date_expiry_approaching`. Other values will fail the DB check
  constraint. Valid entity types: `content_item`, `digest`,
  `template_requirement`, `domain`, `source_document`, `entity_mention`.
- **python-docx and Track Changes:** python-docx does not resolve tracked
  changes (revisions) in `.docx` files. Documents with unaccepted Track Changes
  will have incorrect text extracted — deleted text may be included and inserted
  text may be missed. Always use `open_document_safe()` from
  `scripts/docx_utils.py` (which resolves via pandoc) instead of
  `Document(path)` directly. The `mammoth` npm package used in the TypeScript
  tender extraction pathway handles Track Changes correctly — it includes
  inserted text and excludes deleted text. See
  `__tests__/lib/mammoth-track-changes.test.ts` for the regression test.
- **Browser testing must use agent-browser skill:** Never use Playwright MCP
  tools (`mcp__playwright__*`) for parallel browser testing — they share a
  single browser instance and agents fight over navigation. Use the
  `agent-browser` skill with `--session <name>` for isolated parallel sessions.
  The main session must start `bun dev` first; sub-agents connect to the
  existing server on `localhost:3000` rather than starting their own.
- **CopilotKit fully removed (S109):** Zero `@copilotkit` imports remain.
  CopilotKit Sidebar items in the product backlog are all N/A.
  `ClaudePromptButton` bridge is preserved and functional. The
  `ExpiringContentSection` uses Supabase client directly (not `/api/items`).
- **GitHub-backed plugin marketplaces are shallow git clones:**
  `~/.claude/plugins/marketplaces/{name}/` is a git clone of the repo in
  `extraKnownMarketplaces`. After pushing new plugins to the remote, the
  local marketplace must be refreshed (`git pull` in the marketplace dir)
  before `/plugin` will discover them. Manual file copies don't persist.
