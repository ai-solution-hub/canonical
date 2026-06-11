# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## AST Dataflow

**Import AST Dataflow development workflow commands and guidelines, treat as if import is
in the main CLAUDE.md file.** @./.ast-dataflow/CLAUDE.md

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain applications are procurement and sector
intelligence for UK SMBs. Next application is Sales Proposals. The knowledge base is the
foundation for these and future applications.

**Team:** Liam (product owner) + Claude Code as development partner.

## Commands

| Command                                                                                                                                | Description                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bun install`                                                                                                                          | Install Node dependencies                                                                     |
| `bun dev`                                                                                                                              | Start Next.js dev server (Turbopack) - default port is localhost:3000                         |
| `bun run dev:clean`                                                                                                                    | Clear `.next` cache + start dev server (use when OOM)                                         |
| `bun build`                                                                                                                            | Production build                                                                              |
| `bun run test`                                                                                                                         | Run Vitest tests                                                                              |
| `bun run test:integration`                                                                                                             | Integration suite — `__tests__/integration/**.integration.test.ts`, real Anthropic + Supabase |
| `bun lint`                                                                                                                             | ESLint                                                                                        |
| `pip install -r requirements.txt`                                                                                                      | Install Python pipeline dependencies                                                          |
| `python3 -m pytest scripts/tests/`                                                                                                     | Run Python tests                                                                              |
| `bun run format`                                                                                                                       | Prettier format all files                                                                     |
| `bun run build:mcp-apps`                                                                                                               | Build MCP Apps (Vite) + generate inline bundles for Vercel                                    |
| `bun run build:plugin`                                                                                                                 | Regenerate plugin ZIP bundle (`lib/mcp/plugin-bundle.ts`) — commit after                      |
| `bun run test:e2e`                                                                                                                     | Run Playwright E2E tests                                                                      |
| `bun run test:mcp-eval`                                                                                                                | Run MCP eval Layer 1 (protocol compliance, 42 checks)                                         |
| `bun run test:mcp-eval:rq`                                                                                                             | Run MCP eval Layer 3 (response quality, 17 checks)                                            |
| `bun run test:mcp-eval:fc`                                                                                                             | Run MCP eval Layer 4 (functional correctness, 37 checks, live DB)                             |
| `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` | Regenerate TypeScript types from live schema                                                  |
| `task-view <ledger.json>`                                                                                                              | Open a workflow ledger in the task-view editor (https://github.com/liam-jons/task-view)       |

- Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser automation.

## Architecture

Key file: `proxy.ts` — Next.js 16 auth middleware, `publicRoutes` allowlist
(auto-discovered, not imported)

| Directory     | Contents                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/`        | Next.js 16 App Router — API routes, page routes                                                                                                                                                                                                                                                              |
| `mcp-apps/`   | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai)                                                                                                                                                                                                                                           |
| `components/` | Domain subdirs — new components go in their domain dir, never at root                                                                                                                                                                                                                                        |
| `contexts/`   | React contexts (read-marks, taxonomy, client-features, layer-vocabulary)                                                                                                                                                                                                                                     |
| `hooks/`      | Custom React hooks — domain subdirs (`browse`, `intelligence`, `procurement`, `provenance`, `review`, `streaming`, `ui`) + general hooks at root                                                                                                                                                             |
| `lib/`        | Core modules — `ai/`, `mcp/` (tools, resources, prompts), `procurement/`, `content/`, `coverage/`, `change-reports/`, `entities/`, `extraction/`, `governance/`, `intelligence/`, `ontology/`, `quality/`, `source-documents/`, `supabase/`, `taxonomy/`, `templates/`, `validation/`, plus standalone utils |
| `types/`      | TypeScript types (content, procurement, procurement-metadata, change-reports, intelligence-refinement, review, template, owner, reorient, unified-gap, filter-preset, css.d)                                                                                                                                 |
| `scripts/`    | Python pipeline (`cocoindex_pipeline/`), ingestion CLIs, search CLI, batch scripts                                                                                                                                                                                                                                  |
| `supabase/`   | Migrations + auto-generated types (`database.types.ts` — never edit manually)                                                                                                                                                                                                                                |
| `__tests__/`  | Vitest tests — mirrors source structure (api, app, components, contexts, hooks, lib, mcp, scripts, validation)                                                                                                                                                                                               |
| `e2e/`        | Playwright E2E specs. Config: `playwright.config.ts`                                                                                                                                                                                                                                                         |
| `docs/`       | Interim residual docs tree (relocating to the private docs-site repo under ID-68)                                                                                                                                                                                                                                                         |

## Environment

`.env.local` targets persistent staging Supabase branch (`turayklvaunphgbgscat`).
Prod-targeted CLI work opts in via `--env=prod` or explicit env override. Full guidance:
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`.

## Database

- Uses Supabase
- Migrations in `supabase/migrations/`
- Schema is canonically defined by the generated types in
  `supabase/types/database.types.ts` (+ JSONB domain types in
  `supabase/types/database-overrides.ts`). Consume row/enum shapes via `Tables<'x'>` /
  `Enums<'x'>`

## Testing

- **Philosophy:** `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/test-philosophy.md` — six audit criteria, three observed
  antipatterns, mock discipline. Read before writing or remediating tests.
- **Framework:** Vitest (`bun run test`), coverage via `bun run test:coverage`
- **Location:** `__tests__/` — mirrors the source structure
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts`
- **E2E:** Playwright in `e2e/tests/` — worker-scoped fixtures, multi-role auth
- **Quality gate:** Use `bun run test`
  explicitly for full regression checks after merges.

## Deployment

- **Platform:** Vercel (Next.js app). Ingestion pipeline runs on-prem (IONOS VPS +
  Coolify).
- **Production URL:** per-deploy `APP_URL`; see `.env.local`
- **Staging URL:** https://knowledge-hub-git-staging-tw-group.vercel.app
- **Pipeline deploy:** The ingestion pipeline
  deploys to an IONOS VPS via Coolify (`.github/workflows/onprem-deploy.yml`). Runbook:
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/onprem-b1-deploy.md`.
- **GitHub:** https://github.com/ai-solution-hub/knowledge-hub (private)
- **GitHub Environments:** `Production` + `Staging` (case-sensitive). Setup:
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/github-environments.md`.

## CI/CD

PR-blocking CI (`ci.yml`) runs 8 jobs in parallel
Triggers: PR (any base) + push on `main`/`staging`. Draft PRs skip
CI. Full topology + per-step failure-mode table: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/ci.md`.

Side workflows: `onprem-deploy.yml` (Pipeline image build + Coolify deploy — always
runs on `main`/`staging` push),
`migration-revoke-guard.yml` (anon-EXECUTE lint), `schema-parity.yml`
(prod ↔ staging diff), `staging-reference-refresh.yml`, `supabase-advisors.yml`,
`taxonomy-sync.yml`, `task-view-vendor-drift.yml` (non-blocking re-vendor reminder when
`lib/validation/{task-list,roadmap,backlog}-schema.ts` or `work-status.ts` change).

`staging` branch is deploy-only

## Design System: Warm Meridian

Spec: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-implementation-spec.md` (tokens in §Semantic Tokens).
Philosophy: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-philosophy.md`. Visual:
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-identity.pdf`. Quality checks: `.claude/checks/`. Consult when
adding or modifying UI elements.

## Key Reference Documents

| Document             | Location                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| State of the Product | `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/state-of-the-product.md`                                    |
| Skill routing map    | `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/skill-routing-map.md`                                       |
| CI runbook           | `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/ci.md` — workflow topology, per-job env scope, knip baseline |
| Session handoffs     | `docs/continuation-prompts/`                                                |
| Runbooks             | `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/` — local-development, staging-refresh, github-environments |

Full inventory of all reference docs: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/documentation-inventory.md`

> **Private-docs bridge** The docs corpus lives in the PRIVATE
> `knowledge-hub-docs-site` repo. Resolve the checkout via
> `KH_PRIVATE_DOCS_DIR` (set explicitly: sibling clone locally via `.env.local`/shell;
> GitHub-App token checkout in CI — `.github/actions/resolve-private-docs/`).
>
> **Docs upkeep is automated IN the docs-site repo**, not via any in-repo command. The
> `knowledge-hub-docs-site` repo carries its own `.claude/`: including six docs-maintenance skills
> (`keep-docs-in-sync`, `sync-source-docs`, `missing-docs`, `check-for-broken-links`,
> `docs-seo-audit`, `review-docs-pr`), and the
> **docubot** lane — a GitHub App + composite action that opens follow-up docs PRs in the
> docs-site repo reacting to merged public-KH source PRs (`docubot.yml`, dispatched by the
> public repo's `docs-dispatch.yml`).

Historical planning: relocated to the `knowledge-hub-archive`. Grep there explicitly when researching past
decisions; treat as point-in-time snapshots.

## Spec directory convention

New Task spec dirs live under `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-N-<slug>/` with four canonical
artefacts: `RESEARCH.md` ({N.1}), `PRODUCT.md` ({N.2}), `TECH.md` ({N.3}), `PLAN.md`
({N.4}). 

## Ledgers

Used for managing, tracking, and improving platform development activities.

| Document  | Location                              |
| --------- | ------------------------------------- |
| Task List | `docs/reference/task-list.json`       |
| Backlog   | `docs/reference/product-backlog.json` |
| Roadmap   | `docs/reference/product-roadmap.json` |
| Retros    | `docs/reference/product-retros.json`  |

## Memory (MemPalace)

Mempalace MCP server is the canonical memory system.

**MCP tools:**

- `mempalace_list_wings` ✓ — drawer counts per wing.
- `mempalace_kg_stats` / `mempalace_kg_query` ✓
- `mempalace_search` **PARTIAL** — default (no `wing` param) works. Any `wing` filter
  errors `Error executing plan: Internal error: Error finding id`. **Workaround:** search
  default, filter results client-side by `wing` field.

## Gotchas

### Data & Architecture

- **RLS:** role-based via `get_user_role()`. Embeddings: `vector(1024)`
  (text-embedding-3-large). Canonical constants: `lib/validation/schemas.ts`.
- **Embedding vector serialisation:** `JSON.stringify(embedding)` for Supabase RPC vector
  params, not raw array.
- **DDL via CLI only** (`supabase migration new` + `db push`), never MCP `execute_sql` or
  `mcp__supabase__apply_migration`.
- **Always** `cat supabase/.temp/project-ref` before any push; relink via
  `supabase link --project-ref <correct>` if drift detected. Main repo's
  `.temp/project-ref` persists across sessions and can drift to **prod** if a prior
  session linked there — always verify-and-relink before `db push` or the migration
  silently lands on prod. `supabase/.temp/` is gitignored so agent worktrees inherit no
  link state — worker first action MUST be
  `supabase link --project-ref turayklvaunphgbgscat` (staging).
- **Function search_path:** All new PL/pgSQL functions **MUST** include
  `SET search_path = public, extensions`
- **Data fetching:** TanStack Query exclusively. Keys in `lib/query/query-keys.ts`,
  fetchers in `lib/query/fetchers.ts`. No SWR or raw fetch in hooks.
- **`getAuthorisedClient()` discriminated union:** Returns `{ success: boolean }` — check
  `auth.success` not `auth.authorised`. **Always** use `authFailureResponse(auth)` helper
  to route each failure reason to the correct HTTP status.
- **TypeScript conventions (canonical type sources):** DB / row shapes come from
  `Tables<'x'>` / `QueryData<>` off `@/supabase/types/database.types` (or
  `supabase/types/database-overrides.ts` for JSONB-typed columns). Composed / API response
  shapes come from `z.infer<typeof schema>`.
- **No barrel re-exports:** Always use direct file imports (`@/lib/procurement/helpers`),
  never import from index files.
- **Taxonomy dual-source:** App uses DB-driven taxonomy (`contexts/taxonomy-context.tsx`);
  `lib/taxonomy/taxonomy.ts` is a 24-line re-export shim for content types and platforms
  only — Python pipeline reads taxonomy from
  `scripts/tests/fixtures/taxonomy_snapshot.json`.
- **Content review vs governance review:** `/review` = content quality.
  `/api/governance/review` = freshness/ownership. Separate workflows.

### UI / Frontend

- **No raw Tailwind colours:** Always use semantic tokens. Define new ones in
  `app/globals.css`. See `${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-implementation-spec.md`.
- **React compiler memoisation:** Destructure nested properties before using in
  `useCallback` deps (e.g. `const { fn } = data;` not `data.fn`).
- **Stable empty array/object defaults in hook returns:** Inline `data?.foo ?? []` creates
  a new reference every render, breaking downstream deps. Hoist a module-level
  `const EMPTY_X: T[] = [];` and wrap with
  `useMemo(() => data?.foo ?? EMPTY_X, [data?.foo])`.
- **Reset local state via `key` prop:** Add `key={propId}` at the call site to force a
  clean remount — don't write a `useEffect` that calls `setState` in response to prop
  changes.

### Testing

- **Guard tests break on structural changes:** `mcp-fixture-sync.test.ts`,
   and `pipeline-parity.test.ts` run on every test. Update
  fixtures when adding tools.
- **vi.mock() hoisting:** Use `vi.hoisted()` for mock variables. Arrow functions in
  `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Zod UUID validation is strict:** `z.string().uuid()` enforces RFC 4122. Use
  v4-compliant values.
- **Date-sensitive tests need pinned time:** Use `vi.spyOn(Date, 'now')` with a fixed
  timestamp.
- **Radix Select in jsdom needs pointer shims:** call `installRadixPointerShims()` from
  `@/__tests__/helpers/radix-pointer-shims` in `beforeEach`.

### Plugin / MCP

- **Plugin not auto-discovered:** Must be published to local marketplace and enabled in
  settings. Existing in `.claude/plugins/` is not enough.
- **Plugin bundle is committed:** `lib/mcp/plugin-bundle.ts` must be committed. Run
  `bun run build:plugin` after changing plugin files.
- **Plugin marketplaces:** After pushing plugins to remote, `git pull` in
  `~/.claude/plugins/marketplaces/{name}/` to refresh.
- **mcp-handler breaks on Vercel:** Use MCP SDK's
  `WebStandardStreamableHTTPServerTransport` directly, not `createMcpHandler`. Fresh
  server + transport per request. `mcp-handler` only for `.well-known`.
- **`snyk-agent-scan --scan-all-users` dumps env-var values verbatim in JSON.** Never use
  in CI. Add redaction wrapper before any v2 cloud upload.

### General

- **Python background output:** Use `PYTHONUNBUFFERED=1` or output is invisible.
- **Worktree isolation:** Use `isolation: "worktree"` on parallel Agent dispatch.
  Cherry-pick (not merge) parallel branches; agents start stale, so first action is
  `git fetch origin {branch} && git reset --hard origin/{branch}`.
- **Worktree pytest must run from the worktree CWD:** main-repo-CWD invocations resolve
  `scripts.*` to the MAIN tree's modules (namespace-package hazard — spurious
  failures/passes against stale code).
- **ALWAYS check worktree `git status` before removing it**
- **Use General Purpose agents (unless otherwise specified)**
- **`classifyContent` userId must be a UUID:** Use pipeline service account UUID
  (`a0000000-0000-4000-8000-000000000001`), never literal strings.
- **Proxy blocks non-API public routes:** New public endpoints must be added to
  `publicRoutes` in `proxy.ts` (project root) or they silently redirect to `/login`.
- **Workers never write the ledger in-branch:** The ID-90 daemon mutex is per
  main-checkout ledger directory, so an in-branch `chore(ledger)` commit from a worktree
  worker bypasses it (the bl-287/288 3-way id collision). Worktree workers RETURN
  ledger-write intents; the Orchestrator applies them via `ledger-cli.ts` on MAIN.
- **Bound sub-agent result size:** dispatch briefs must tell workers to keep tool-results
  and return-payloads bounded — bound high-output calls at source (`git show --stat` first,
  scope to paths, narrow searches) and write any >64K artefact to a file and return the
  PATH; a convention, not a programmatic block.

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **knowledge-hub**. Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `bun run gitnexus:analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/knowledge-hub/context` | Codebase overview, check index freshness |
| `gitnexus://repo/knowledge-hub/clusters` | All functional areas |
| `gitnexus://repo/knowledge-hub/processes` | All execution flows |
| `gitnexus://repo/knowledge-hub/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
