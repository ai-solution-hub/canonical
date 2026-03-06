# CLAUDE.md

**This project uses a 1M context window — optimise for completeness over compression in all persisted outputs.**

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain application is bid management
for UK SMBs. The knowledge base is the foundation; bids are the first use case,
not the only one.

Forked from the IMS (Idea Management System) codebase — a personal knowledge
management system with semantic search, AI classification, and content ingestion
pipelines. Personal-use features (LinkedIn, Reddit, YouTube, Gmail integrations,
Chrome extension, launchd agents) have been stripped. The retained codebase
provides search, browse, content display, workspaces, digests, and the Python
ingestion pipeline as a starting point.

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
| `/opt/homebrew/bin/supabase migration new <name>` | Create local migration file |
| `/opt/homebrew/bin/supabase db push` | Push local migrations to remote |
| `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` | Regenerate TypeScript types from live schema |

## Architecture

```
knowledge-hub/
  app/                        # Next.js 16 App Router (proxy.ts for auth)
    api/search/               #   POST /api/search (hybrid: embedding + keywords)
    api/search/suggestions/   #   GET /api/search/suggestions
    api/items/[id]/           #   GET/PATCH + sub-routes (priority, vision, files, images, workspaces, layers, metadata)
    api/workspaces/           #   GET/POST + [id]/ (PATCH/DELETE) + [id]/items
    api/bids/                 #   GET/POST + [id]/ (CRUD, questions, responses, tender, outcome, export)
    api/copilotkit/           #   POST (CopilotKit AG-UI runtime endpoint)
    api/embed/                #   POST /api/embed (standalone embedding)
    api/summaries/            #   POST /api/summaries/generate (Claude AI summaries)
    api/digest/               #   generate + latest + list (AI digest)
    api/read-marks/           #   POST /api/read-marks (read tracking)
    api/insights/             #   GET /api/insights (analytical RPCs wrapper)
    api/review/               #   queue + action + stats (content review workflow)
    api/governance/           #   review + route (freshness/ownership governance)
    api/notifications/        #   read + route (user notifications)
    api/freshness/            #   calculate + recalculate-all
    api/activity/             #   GET /api/activity (activity feed)
    api/health/               #   GET /api/health (health check)
    api/admin/users/          #   list + invite + [userId] (user management)
    api/users/display-names/  #   GET (UUID→display name resolution)
    api/upload/               #   POST (file upload)
    api/extract/              #   POST (content extraction)
    api/tags/                 #   GET/POST + rename, merge, suggest
    api/taxonomy/             #   domains + subtopics CRUD, reorder
    api/dashboard/            #   GET /api/dashboard (dashboard stats)
    api/quality/              #   GET + summary (quality metrics)
    api/jobs/[id]/status/     #   GET (background job status)
    bid/                      #   /bid (bid workspace + [id] detail/session pages)
    browse/                   #   /browse (grid/list, filters, pagination)
    item/[id]/                #   /item/:id (detail + inline editing)
    search/                   #   /search (semantic search results)
    digest/                   #   /digest (AI digest generation + history)
    library/                  #   /library (Q&A Library — browse, filter, manage Q&A pairs)
    workspaces/               #   /workspaces (workspace management)
    review/                   #   /review (content review workflow)
    settings/                 #   /settings (user settings, 4 tabs)
    login/                    #   /login (Supabase Auth)
    auth/                     #   /auth/callback (OAuth callback)
    page.tsx                  #   / (home: search + recent items)
  components/                 # ~118 custom + copilot-ui/ (2) + reader-cards/ (3) + ui/ (23 shadcn)
  contexts/                   # React contexts (read-marks, taxonomy, client-features)
  hooks/                      # 15 hooks (accessibility, browse-filters, citation-orphans,
                              #   content-library-drawer, display-names, draft-stream,
                              #   keyboard-shortcuts, notifications, progress, reader-preferences,
                              #   review-shortcuts, search, theme-mode, transcript, user-role)
  lib/                        # Supabase clients, taxonomy, formatting, utils, anthropic,
                              #   ai-parse, auth, roles, error, rate-limit, digest-export,
                              #   browse-helpers, extraction-schemas, highlight, validation/,
                              #   bid-drafting, bid-matching, bid-state-machine, bid-export-*,
                              #   citations, copilotkit/, editor-utils, embeddings, freshness,
                              #   quality-check, structured-outputs, pdf-worker, client-config,
                              #   cost-estimation, dashboard, docx-utils, drawer-insert,
                              #   change-summary, template-auto-map, user-helpers,
                              #   taxonomy-format, taxonomy-server, anthropic-files
  types/                      # TypeScript types (content, bid, bid-metadata, copilot, digest, review, template, css.d)
  scripts/
    kb_pipeline/              #   Python pipeline package (config, extract, classify,
                              #     embed, store, dedup, summarise, pipeline, pipeline_log)
    ingest.py                 #   Main ingestion CLI
    ingest_markdown.py        #   Markdown file ingestion
    import_bid_library.py     #   Q&A pair import from client documents
    extract_pdf_text.py       #   PDF text extraction
    extract_pdf_images.py     #   PDF image extraction
    extract_docx_tables.py    #   DOCX table extraction
    kb-search.ts              #   Semantic search CLI
    batch_generate_summaries.ts
    backfill-reader-html.ts
    extract-reader-html.ts
    search-evaluation.json    #   20 search test cases
  supabase/
    migrations/               # 27 migration files
    types/                    # Auto-generated types (database.types.ts) — never edit manually
                              #   Regenerate: /opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts
  docs/
    reference/                # Schema reference, classification, search evaluation, import guide
    continuation-prompts/     # Session handoff documents for cross-session context
  __tests__/                  # Vitest tests (58 files across lib/ (23+4), components/ (5+2), hooks/ (3+3), api/ (13+5) + 5 helper files)
  proxy.ts                    # Auth middleware (Next.js 16 proxy pattern)
```

## Environment

Required env vars (in `.env` and `.env.local`; see `.env.example` for template):

- `ANTHROPIC_API_KEY` — Claude API (classification, summaries, digests)
- `OPENAI_API_KEY` — OpenAI API (embeddings)
- `SUPABASE_URL` — Supabase project URL (Python scripts)
- `SUPABASE_ANON_KEY` — Supabase anon key (Python scripts)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase URL (Next.js client)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (Next.js client)
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

### Tables (16)

| # | Table | Purpose |
|---|-------|---------|
| 1 | `content_items` | Core KB content with progressive depth, user tracking, freshness |
| 2 | `workspaces` | Generic containers (project, bid, kb_section) via `type` column |
| 3 | `content_item_workspaces` | Item-to-container junction |
| 4 | `ingestion_quality_log` | Data quality flags |
| 5 | `read_marks` | Per-user read tracking (scoped by `user_id`) |
| 6 | `digests` | AI-generated change digests |
| 7 | `pipeline_runs` | Pipeline execution tracking |
| 8 | `processing_queue` | Python worker job queue |
| 9 | `user_roles` | Application-level role assignments (admin/editor/viewer) |
| 10 | `content_history` | Immutable version snapshots (auto-versioned) |
| 11 | `bid_questions` | Extracted tender questions |
| 12 | `bid_responses` | AI-drafted and human-edited responses |
| 13 | `taxonomy_domains` | Configurable taxonomy (DB-driven via taxonomy-context) |
| 14 | `taxonomy_subtopics` | Configurable subtopics (DB-driven via taxonomy-context) |
| 15 | `governance_config` | Governance settings (freshness thresholds, review rules) |
| 16 | `notifications` | User notifications (governance, freshness, quality) |

### RLS Model

Role-based via `get_user_role()` SECURITY DEFINER helper:
- **All authenticated:** SELECT on all tables
- **Editor + Admin:** INSERT/UPDATE on content, workspaces, bids, quality log
- **Admin only:** DELETE on most tables, manage `user_roles`, configure taxonomy
- **User-scoped:** `read_marks` filtered by `user_id = auth.uid()`
- **Immutable:** `content_history` — INSERT only, no UPDATE/DELETE
- **Service role:** Python pipeline bypasses RLS entirely

### Key Constraints

- `content_type` IN: article, blog, pdf, note, research, other,
  q_a_pair, case_study, policy, certification, compliance, methodology,
  capability, product_description
- `platform` IN: web, email, manual, upload, extraction, other
- `workspaces.type` IN: project, bid, kb_section
- `priority` IN: high, medium, low (nullable — null means unset)
- `freshness` IN: fresh, aging, stale, expired
- `lifecycle_type` IN: evergreen, date_bound, regulation, bid_discovered
- `classification_confidence` between 0 and 1
- `user_roles.role` IN: admin, editor, viewer
- Embeddings: `vector(1024)` — OpenAI text-embedding-3-large shortened from
  3072 via Matryoshka
- HNSW indexes (m=16, ef_construction=64, cosine similarity)

## Testing

- **Framework:** Vitest — run via `bun run test` (NOT `bun test` — see Gotchas)
- **Coverage:** `bun run test:coverage` (via `@vitest/coverage-v8`)
- **Location:** `__tests__/` — 58 test files (1026 tests) across lib/ (27),
  components/ (7), hooks/ (6), api/ (18) + 5 helper files
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts` — all API tests use this
- **Python tests:** `python3 -m pytest scripts/tests/` (template analysis,
  template filling)
- **Strategy:** `.planning/specs/testing-strategy-spec.md` (original) +
  `.planning/specs/testing-expansion-spec.md` (Waves 1-3 done, Wave 4 E2E
  remaining)

## Deployment

- **Platform:** Vercel
- **URL:** https://knowledge-hub-seven-kappa.vercel.app
- **GitHub:** https://github.com/liam-jons/knowledge-hub (private)
- **Region:** TBD (client is UK-based, likely LHR1)

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

## Key Reference Documents

### Active Development — consult regularly

| Document | Location | Purpose |
|----------|----------|---------|
| State of the Product | `.planning/state-of-the-product.md` | Accurate reference of actual tech stack, architecture, features |
| Codebase mapping (8 docs) | `.planning/codebase/` | Deep detail on stack, architecture, structure, conventions, testing, integrations, concerns |
| Schema quick reference | `docs/reference/SCHEMA-QUICK-REFERENCE.md` | Tables, columns, functions, views |
| Quality checks (9 files) | `.claude/checks/` | Best-practice checks used by `/review` (accessibility, architecture, error handling, image quality, multi-user patterns, package manager, Supabase patterns, testing, UK English) |
| Testing strategy | `.planning/specs/testing-strategy-spec.md` | Test infrastructure, priorities, mock patterns |
| Post-MVP backlog | `.planning/post-mvp-backlog.md` | 86 items, P1-P5, 4 sprint groupings |
| Session handoffs | `docs/continuation-prompts/` | Cross-session context transfer documents |

### Remaining Roadmap

| Item | Location | Status |
|------|----------|--------|
| Coverage Dashboard (Spec 2 §3) | `.planning/specs/spec2-tag-management-coverage.md` | Tags done; `/coverage` page not built |
| AI Integration (Spec 4) | `.planning/specs/spec4-ai-integration-architecture.md` | Not started — Liam covering interactively |

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
- **`bun test` vs `bun run test`:** `bun test` invokes bun's native test
  runner (no jsdom, no vitest config). `bun run test` invokes vitest via the
  package.json script. ALWAYS use `bun run test` for this project.
- **`vi.mock()` hoisting in Vitest v4:** `vi.mock()` factories are hoisted
  above `const` declarations. Variables referenced inside factories must use
  `vi.hoisted(() => { return { mock }; })`. Arrow functions in
  `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Concurrent Claude sessions:** Two sessions on the same working tree will
  destroy each other's untracked files and revert shared config. Never run
  test infrastructure work concurrently with feature work — use git worktrees
  or sequence the sessions.
