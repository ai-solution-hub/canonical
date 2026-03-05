# AGENTS.md

This file provides guidance to Warp Oz agents working with code in this repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality, structured data accessible by AI. The first domain application is bid management for UK SMBs. The knowledge base is the foundation; bids are the first use case, not the only one.

**Stack:** Next.js 16 (App Router), TypeScript, Supabase (PostgreSQL + pgvector), Python ingestion pipeline, Vercel deployment.

**Team:** Liam (product owner, zero development experience) + AI as development partner. All code is written through human-AI collaboration.

## Key Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install Node dependencies |
| `bun dev` | Start Next.js dev server (Turbopack) |
| `bun build` | Production build |
| `bun run test` | Run Vitest tests (NOT `bun test` — see Gotchas) |
| `bun run test:coverage` | Test coverage via `@vitest/coverage-v8` |
| `bun lint` | ESLint |
| `bun run format` | Prettier format all files |
| `bun run format:check` | Check Prettier formatting |
| `pip install -r requirements.txt` | Install Python pipeline dependencies |
| `python3 scripts/ingest.py <url>` | Ingest a single URL |
| `python3 scripts/ingest.py --file urls.txt` | Batch ingest from file |
| `python3 scripts/ingest_markdown.py <dir>` | Ingest .md files from directory |
| `bun run scripts/kb-search.ts "query"` | Semantic search CLI |
| `python3 -m pytest scripts/tests/` | Run Python tests |

## Architecture

```
knowledge-hub/
  app/                        # Next.js 16 App Router
    api/search/               # POST /api/search (hybrid: embedding + keywords)
    api/items/[id]/           # GET/PATCH + sub-routes
    api/projects/             # GET/POST + [id]/ CRUD
    api/bids/                 # GET/POST + [id]/ (CRUD, questions, responses, export)
    api/copilotkit/           # POST (CopilotKit AG-UI runtime endpoint)
    api/summaries/            # POST /api/summaries/generate (Claude AI summaries)
    api/digest/               # generate + latest + list (AI digest)
    api/governance/           # review + route (freshness/ownership governance)
    api/admin/users/          # list + invite + [userId] (user management)
  components/                 # ~95 custom components + shadcn/ui
  contexts/                   # React contexts (read-marks, taxonomy)
  hooks/                      # 12 hooks
  lib/                        # Supabase clients, AI utils, bid logic, search, etc.
  types/                      # TypeScript types
  scripts/
    kb_pipeline/              # Python pipeline package
    ingest.py                 # Main ingestion CLI
    ingest_markdown.py        # Markdown file ingestion
    import_bid_library.py     # Q&A pair import from client documents
  supabase/
    migrations/               # DDL migration files
    types/                    # Auto-generated types — never edit manually
  __tests__/                  # Vitest test files
  proxy.ts                    # Auth middleware (Next.js 16 proxy pattern)
```

## Environment Variables

Required (see `.env.example` for full template):

- `ANTHROPIC_API_KEY` — Claude API (classification, summaries, digests)
- `OPENAI_API_KEY` — OpenAI API (embeddings: `text-embedding-3-large`)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase URL (Next.js client)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (Next.js client)
- `SUPABASE_URL` — Supabase project URL (Python scripts)
- `SUPABASE_ANON_KEY` — Supabase anon key (Python scripts)
- `AI_SUMMARY_MODEL` — (optional) Claude model, defaults to `claude-sonnet-4-6`

## Supabase

- **Project ID:** `rovrymhhffssilaftdwd` (eu-west-2 London)
- **pgvector:** 0.8.0 — embeddings are `vector(1024)` (OpenAI text-embedding-3-large, Matryoshka-shortened from 3072)
- **HNSW indexes:** m=16, ef_construction=64, cosine similarity
- Use Supabase CLI for DDL migrations; use MCP tools for queries/DML

### Core Tables

| Table | Purpose |
|-------|---------|
| `content_items` | Core KB content with progressive depth, user tracking, freshness |
| `projects` | Generic containers (project, bid, kb_section) via `type` column |
| `content_item_projects` | Item-to-container junction |
| `bid_questions` | Extracted tender questions |
| `bid_responses` | AI-drafted and human-edited responses |
| `taxonomy_domains` / `taxonomy_subtopics` | DB-driven taxonomy |
| `user_roles` | Application-level role assignments (admin/editor/viewer) |
| `digests` | AI-generated change digests |
| `notifications` | User notifications (governance, freshness, quality) |

### RLS Model

Role-based via `get_user_role()` SECURITY DEFINER helper:
- All authenticated: SELECT on all tables
- Editor + Admin: INSERT/UPDATE on content, projects, bids
- Admin only: DELETE, manage `user_roles`, configure taxonomy
- User-scoped: `read_marks` filtered by `user_id = auth.uid()`
- Service role: Python pipeline bypasses RLS entirely

## Key Design Principles

- **UK English throughout** — DD/MM/YYYY, "colour" not "color", "organisation" not "organization"
- **Package manager: bun** — use `bun install`, `bun dev`, `bun run test`, `bun build`. Never use npm/yarn
- **WCAG 2.1 AA** — never use colour alone for meaning
- **Generic over specific** — containers, workflows, lifecycle machines should be reusable across use cases
- **Programmatic where possible** — use AI for response generation and classification; deterministic functions for deterministic tasks

## Gotchas

- **`bun test` vs `bun run test`:** `bun test` invokes bun's native test runner (no jsdom, no vitest config). `bun run test` invokes vitest via package.json. **Always use `bun run test`.**
- **Embedding vector serialisation:** Supabase RPC needs `JSON.stringify(embedding)`, not a raw array, for vector params
- **Supabase REST PATCH on wrong UUID:** Returns 200 OK with 0 rows affected (silent no-op). Always verify updates by re-querying
- **Python background output:** Use `PYTHONUNBUFFERED=1` when running Python scripts in the background
- **RLS requires user_roles entry:** New users cannot write until they have a `user_roles` row
- **taxonomy.ts dual-source:** `lib/taxonomy.ts` has a hardcoded fallback; canonical constants live in `lib/validation/schemas.ts`. The app uses DB-driven taxonomy via `contexts/taxonomy-context.tsx`
- **Content review vs governance review:** `/review` is content quality review. `/api/governance/review` is freshness/ownership governance. They are separate workflows
- **Supabase type regeneration:** `supabase/types/database.types.ts` is auto-generated — never edit manually. Regenerate with the supabase CLI

## Testing

- **Framework:** Vitest — run via `bun run test`
- **Location:** `__tests__/` — unit test files covering `lib/` functions
- **Python tests:** `python3 -m pytest scripts/tests/`
- Known gap: zero component tests, zero API route integration tests, zero hook tests

## Deployment

- **Platform:** Vercel
- **URL:** https://knowledge-hub-seven-kappa.vercel.app
- **GitHub:** https://github.com/liam-jons/knowledge-hub (private)
