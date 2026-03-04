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
provides search, browse, content display, projects, digests, and the Python
ingestion pipeline as a starting point.

**Team:** Liam (product owner, zero development experience) + Claude Code as
development partner. All code is written through human-AI collaboration.

## Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install Node dependencies |
| `bun dev` | Start Next.js dev server (Turbopack) |
| `bun build` | Production build |
| `bun test` | Run Vitest tests |
| `bun lint` | ESLint |
| `pip install -r requirements.txt` | Install Python pipeline dependencies |
| `python3 scripts/ingest.py <url>` | Ingest a single URL (extract, dedup, classify, embed, store) |
| `python3 scripts/ingest.py --file urls.txt` | Batch ingest from file |
| `python3 scripts/ingest_markdown.py <dir>` | Ingest .md files from directory (--dry-run, --limit, --skip-existing, --tag, --author) |
| `bun run scripts/kb-search.ts "query"` | Semantic search CLI (--limit, --domain, --full, --json) |
| `bun run scripts/batch_generate_summaries.ts` | Batch AI summary generation |
| `bun run scripts/backfill-reader-html.ts` | Backfill reader HTML for articles/blogs (--limit, --dry-run) |
| `/opt/homebrew/bin/supabase migration new <name>` | Create local migration file |
| `/opt/homebrew/bin/supabase db push` | Push local migrations to remote |

## Architecture

```
knowledge-hub/
  app/                        # Next.js 16 App Router (proxy.ts for auth)
    api/search/               #   POST /api/search (hybrid: embedding + keywords)
    api/search/suggestions/   #   GET /api/search/suggestions
    api/items/[id]/           #   GET/PATCH /api/items/:id (item CRUD)
    api/items/[id]/projects/  #   GET/POST (item-project assignments)
    api/projects/             #   GET/POST (list/create projects)
    api/projects/[id]/        #   PATCH/DELETE (update/archive projects)
    api/embed/                #   POST /api/embed (standalone embedding)
    api/summaries/            #   POST /api/summaries/generate (Claude AI summaries)
    api/digest/               #   generate + latest + list (AI digest)
    api/digest/[id]/          #   GET /api/digest/:id
    api/read-marks/           #   POST /api/read-marks (read tracking)
    api/insights/             #   GET /api/insights (analytical RPCs wrapper)
    browse/                   #   /browse (grid/list, filters, pagination)
    item/[id]/                #   /item/:id (detail + inline editing)
    search/                   #   /search (semantic search results)
    digest/                   #   /digest (AI digest generation + history)
    projects/                 #   /projects (project management)
    login/                    #   /login (Supabase Auth)
    auth/                     #   /auth/callback (OAuth callback)
    page.tsx                  #   / (home: search + recent items)
  components/                 # ~57 custom components + ui/ (22 shadcn)
  contexts/                   # React contexts (read-marks-context)
  hooks/                      # 7 hooks (accessibility, browse-filters, keyboard-shortcuts,
                              #   progress, reader-preferences, search, theme-mode)
  lib/                        # Supabase clients, taxonomy, formatting, utils, anthropic,
                              #   ai-parse, auth, error, rate-limit, digest-export, validation
  types/                      # TypeScript types (content, digest, review, css.d)
  scripts/
    kb_pipeline/              #   Python pipeline package (config, extract, classify,
                              #     embed, store, dedup, summarise, pipeline, pipeline_log)
    ingest.py                 #   Main ingestion CLI
    ingest_markdown.py        #   Markdown file ingestion
    extract_pdf_text.py       #   PDF text extraction
    extract_pdf_images.py     #   PDF image extraction
    kb-search.ts              #   Semantic search CLI
    batch_generate_summaries.ts
    backfill-reader-html.ts
    extract-reader-html.ts
    search-evaluation.json    #   20 search test cases
  supabase/
    migrations/               # 5 consolidated DDL migration files (Phase 2)
    types/                    # Auto-generated types (database.types.ts) — never edit manually
  docs/
    reference/                # Schema reference, classification framework, search evaluation guide
  __tests__/                  # Vitest test files (7 files)
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

Phase 2 (Schema Evolution) is complete. The schema consolidates 38 IMS
migrations into 5 clean product migrations in `supabase/migrations/`.

### Tables (14)

| # | Table | Purpose |
|---|-------|---------|
| 1 | `content_items` | Core KB content with progressive depth, user tracking, freshness |
| 2 | `projects` | Generic containers (project, bid, kb_section) via `type` column |
| 3 | `content_item_projects` | Item-to-container junction |
| 4 | `ingestion_quality_log` | Data quality flags |
| 5 | `read_marks` | Per-user read tracking (scoped by `user_id`) |
| 6 | `digests` | AI-generated change digests |
| 7 | `pipeline_runs` | Pipeline execution tracking |
| 8 | `processing_queue` | Python worker job queue |
| 9 | `user_roles` | Application-level role assignments (admin/editor/viewer) |
| 10 | `content_history` | Immutable version snapshots (auto-versioned) |
| 11 | `bid_questions` | Extracted tender questions |
| 12 | `bid_responses` | AI-drafted and human-edited responses |
| 13 | `taxonomy_domains` | Configurable taxonomy (post-MVP) |
| 14 | `taxonomy_subtopics` | Configurable subtopics (post-MVP) |

**Tables removed from IMS:** `ideas`, `idea_relationships`, `idea_keywords`,
`idea_themes`, `idea_theme_assignments`, `tana_sync_log`, `classification_audit`

### RLS Model

Role-based via `get_user_role()` SECURITY DEFINER helper:
- **All authenticated:** SELECT on all tables
- **Editor + Admin:** INSERT/UPDATE on content, projects, bids, quality log
- **Admin only:** DELETE on most tables, manage `user_roles`, configure taxonomy
- **User-scoped:** `read_marks` filtered by `user_id = auth.uid()`
- **Immutable:** `content_history` — INSERT only, no UPDATE/DELETE
- **Service role:** Python pipeline bypasses RLS entirely

### Key Constraints

- `content_type` IN: post, article, blog, pdf, product-page, podcast, video,
  comment, newsletter, bookmark, transcript, note, course, research, other,
  q_a_pair, case_study, policy, certification, compliance, methodology,
  capability, product_description
- `platform` IN: web, email, manual, upload, extraction, other
- `projects.type` IN: project, bid, kb_section
- `priority` IN: high, medium, low (nullable — null means unset)
- `freshness` IN: fresh, aging, stale, expired
- `lifecycle_type` IN: evergreen, date_bound, regulation, bid_discovered
- `classification_confidence` between 0 and 1
- `user_roles.role` IN: admin, editor, viewer
- Embeddings: `vector(1024)` — OpenAI text-embedding-3-large shortened from
  3072 via Matryoshka
- HNSW indexes (m=16, ef_construction=64, cosine similarity)

### Key Columns Added in Phase 2

- `content_items.created_by`/`updated_by` — UUID FK to auth.users
- `content_items.brief`/`detail`/`reference` — progressive depth sections
- `content_items.source_document`/`source_bid` — provenance tracking
- `content_items.freshness`/`lifecycle_type`/`expiry_date` — freshness (post-MVP)
- `projects.type`/`domain_metadata` — generic container support
- `read_marks.user_id` — multi-user scoping

## Testing

- **Framework:** Vitest (`bun test`)
- **Coverage:** `bun test:coverage` (via `@vitest/coverage-v8`)
- **Location:** `__tests__/` — 7 files (schemas, utils, jsonb, format, ai-parse,
  validation, digest-export)

## Deployment

- **Platform:** Vercel
- **URL:** TODO — will be configured per deployment
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
  `bun test`, `bun build`

## Key Reference Documents

| Document | Location | Purpose |
|----------|----------|---------|
| Master project plan | `.planning/project-plan.md` | Phases, work items, done criteria |
| Feasibility study (12 docs) | `.planning/feasibility/` | Architecture decisions, gap analysis, fork strategy |
| ADS v1.0 | `.planning/ads-v1.md` | Canonical requirements |
| Client documentation | `.planning/client-documentation/` | 8 .docx + 1 .pdf bid library files for import |
| Schema quick reference | `docs/reference/SCHEMA-QUICK-REFERENCE.md` | Tables, columns, functions, views |
| Classification framework | `docs/reference/classification-framework.md` | Domain taxonomy details |
| Classification prompt | `docs/reference/classification-prompt.md` | v3.1 classification prompt |
| Search evaluation guide | `docs/reference/search-evaluation-guide.md` | How to run search tests |
| Search test cases | `scripts/search-evaluation.json` | 20 test cases — re-run after search logic changes |
| IMS CLAUDE.md (external) | `/Users/liamj/Documents/development/IMS/CLAUDE.md` | Original IMS instructions (external reference only — do not modify) |

## Gotchas

- **Embedding vector serialisation:** Supabase RPC needs
  `JSON.stringify(embedding)` not raw array for vector params
- **Metadata double-serialisation:** Pass metadata as dict not `json.dumps()`
  to REST API — Supabase serialises it again
- **Supabase REST PATCH on wrong UUID:** Returns 200 OK with 0 rows affected
  (silent no-op). Always verify updates by re-querying
- **Python background output:** Use `PYTHONUNBUFFERED=1` when running Python
  scripts in background — otherwise output is invisible to monitoring
- **Supabase CLI not linked:** `config.toml` exists but `supabase link` hasn't
  been run (needs DB password). Link to project `rovrymhhffssilaftdwd`
- **RLS requires user_roles entry:** New users cannot write until they have a
  `user_roles` row. First admin must be seeded via service_role key
- **Dropped columns from IMS:** `engagement_metrics`, `author_url`, `segments`,
  `highlights` removed from `content_items`; `share_token`, `share_expires_at`,
  `share_branding` removed from `digests`; `tana_node_id` removed from `projects`
- **Playwright browser install:** After `pip install playwright`, must also run
  `python3 -m playwright install chromium` — version mismatches cause failures
- **taxonomy.ts is IMS legacy:** `lib/taxonomy.ts` contains the hardcoded IMS
  6x30 taxonomy. Will be replaced with database-driven taxonomy from
  `taxonomy_domains`/`taxonomy_subtopics` tables. Until then, it works for
  the existing classification pipeline.
