# CLAUDE.md

Guidance for Claude Code in this repository. Directory-scoped context lives in nested
CLAUDE.md files (`__tests__/`, `components/`, `lib/mcp/`, `supabase/`, `scripts/`) —
loaded automatically when working in those dirs; don't duplicate their content here.

## AST Dataflow

**Import AST Dataflow development workflow commands and guidelines, treat as if import is
in the main CLAUDE.md file.** @./.ast-dataflow/CLAUDE.md

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. First domain applications: procurement + sector
intelligence for UK SMBs; next is Sales Proposals.
**Team:** Liam (product owner, non-developer — verification gates are his eyes on the
code) + Claude Code as development partner.

## Commands

| Command                            | Description                                              |
| ---------------------------------- | -------------------------------------------------------- |
| `bun install` / `bun dev`          | Install deps / dev server (Turbopack, localhost:3000)    |
| `bun build`                        | Production build                                         |
| `bun run test`                     | Vitest suite (full regression gate after merges)         |
| `bun run test:integration`         | Integration suite (real Anthropic + Supabase)            |
| `bun lint` / `bun run format`      | ESLint / Prettier                                        |
| `python3 -m pytest scripts/tests/` | Python pipeline tests                                    |
| `bun run test:e2e`                 | Playwright E2E                                           |
| `task-view <ledger.json>`          | Workflow-ledger editor (github.com/liam-jons/task-view)  |

MCP eval + plugin/app build commands: see `lib/mcp/CLAUDE.md`. Type regen: see
`supabase/CLAUDE.md`. Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser
automation.

## Architecture

Key file: `proxy.ts` — Next.js 16 auth middleware; new public endpoints MUST be added to
its `publicRoutes` allowlist or they silently redirect to `/login`.

| Directory     | Contents                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| `app/`        | Next.js 16 App Router — API + page routes                                 |
| `mcp-apps/`   | MCP App UIs (Vite single-file builds)                                     |
| `components/` | Domain subdirs — never add components at root                             |
| `contexts/`   | React contexts                                                            |
| `hooks/`      | Custom hooks — domain subdirs + general at root                           |
| `lib/`        | Core modules (`ai/`, `mcp/`, `procurement/`, `validation/`, …)            |
| `types/`      | TypeScript types                                                          |
| `scripts/`    | Python pipeline (`cocoindex_pipeline/`), ingestion/search CLIs, ledger-cli |
| `supabase/`   | Migrations + generated types                                              |
| `__tests__/`  | Vitest tests — mirrors source structure                                   |
| `e2e/`        | Playwright specs                                                          |
| `docs/`       | Interim residual docs tree (relocating to docs-site under ID-68)          |

## Environment & Database

- `.env.local` targets the persistent staging Supabase branch (`turayklvaunphgbgscat`);
  prod-targeted CLI work opts in via `--env=prod`. Runbook:
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`.
- Schema is canonically the generated types (`Tables<'x'>` / `Enums<'x'>` from
  `supabase/types/database.types.ts` + JSONB overrides). Migration/DDL/project-ref/RLS
  discipline: `supabase/CLAUDE.md`.
- Interactive CLIs (e.g. `supabase db push`) hang background shells — run foreground.

## Conventions (cross-cutting)

- **Types:** DB/row shapes from `Tables<'x'>` / `QueryData<>`; composed/API shapes from
  `z.infer<typeof schema>`.
- **No barrel re-exports:** direct file imports only (`@/lib/procurement/helpers`).
- **Auth:** `getAuthorisedClient()` returns `{ success: boolean }` — check
  `auth.success`, route failures via the `authFailureResponse(auth)` helper.
- **Data fetching:** TanStack Query exclusively (keys/fetchers in `lib/query/`).
- **UI:** semantic design tokens only — see `components/CLAUDE.md`.
- **Content review vs governance review:** `/review` = content quality;
  `/api/governance/review` = freshness/ownership. Separate workflows.
- **`snyk-agent-scan --scan-all-users` dumps env values verbatim — never in CI.**
- Guard hooks enforce (don't fight them): no `cd` to the repo root, no mutating
  `git -C <main-repo>`, no unquoted heredocs containing `!`, no client names in
  filenames/commands (private denylist), sentinel-gated `.claude/{agents,skills}` edits.

## Orchestration & Sub-agents

- **Worktree isolation:** `isolation: "worktree"` for parallel Agent dispatch;
  cherry-pick (not merge) parallel branches; agents start stale — first action
  `git fetch origin {branch} && git reset --hard origin/{branch}`.
- **ALWAYS check worktree `git status` before removing it.**
- **Workers never write the ledger in-branch** — return ledger-write intents; the
  Orchestrator applies them via `scripts/ledger-cli.ts` on MAIN.
- **Bound sub-agent result size:** bound high-output calls at source; write >64K
  artefacts to a file and return the PATH.
- Use General Purpose agents unless otherwise specified.

## Ledgers (docs-site — slice reads only)

Ledgers live in the PRIVATE docs-site: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`
(task-list, product-backlog, product-roadmap, product-retros, umbrellas + per-record
mirrors in `tasks/`, `backlog/`, `roadmap/`). **Never Read the ledger JSONs wholesale**
(task-list.json is multi-MB). Access via the CLI:
`bun scripts/ledger-cli.ts show task <id>` / `get task <id> <field>` (reads), mutation
subcommands for writes (run `bun scripts/ledger-cli.ts` for usage).

## Key References (private docs-site)

Resolve the checkout via `KH_PRIVATE_DOCS_DIR` (sibling clone locally; GitHub-App token
checkout in CI — `.github/actions/resolve-private-docs/`). Under
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/`: `reference/state-of-the-product.md`,
`reference/skill-routing-map.md`, `reference/documentation-inventory.md` (full doc
inventory), `reference/test-philosophy.md`, `runbooks/` (ci, local-development,
staging-refresh, github-environments, onprem-b1-deploy), `design/` (Warm Meridian),
`continuation-prompts/`, `specs/`.

- **Spec convention:** new Task spec dirs `specs/id-N-<slug>/` with `RESEARCH.md` {N.1},
  `PRODUCT.md` {N.2}, `TECH.md` {N.3}, `PLAN.md` {N.4}.
- **Docs upkeep is automated IN the docs-site repo** (its own `.claude/` skills +
  docubot lane). Historical planning: `knowledge-hub-archive` repo (point-in-time
  snapshots).

## Deployment & CI

- Vercel (Next.js) + IONOS VPS/Coolify for the ingestion pipeline
  (`onprem-deploy.yml`); staging URL
  https://knowledge-hub-git-staging-tw-group.vercel.app; `staging` branch is
  deploy-only. GitHub: https://github.com/ai-solution-hub/knowledge-hub (private).
- PR-blocking CI (`ci.yml`): 8 parallel jobs; draft PRs skip CI. Topology +
  failure-mode table: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/ci.md`.
  Side workflows incl. `migration-revoke-guard`, `schema-parity`,
  `task-view-vendor-drift` (re-vendor reminder when ledger schemas change).

## GitNexus — Code Intelligence

This repo is indexed by GitNexus (MCP tools + `.claude/skills/gitnexus/*`). Discipline:
run `gitnexus_impact({target, direction: "upstream"})` before modifying any symbol (warn
on HIGH/CRITICAL); `gitnexus_detect_changes()` before committing; `gitnexus_rename` for
renames (never find-and-replace); `gitnexus_query`/`gitnexus_context` to explore. Full
tool/resource reference: `.gitnexus/CLAUDE.md`; stale index → `bun run gitnexus:analyze`.

## Memory (MemPalace)

Mempalace MCP is the canonical memory system (`mempalace_diary_read/write`,
`mempalace_search`, `mempalace_kg_*`). Known issue: `mempalace_search` with a `wing`
filter errors — search without it and filter results client-side.
