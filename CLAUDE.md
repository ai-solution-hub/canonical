# CLAUDE.md

Guidance for Claude Code in this repository. Directory-scoped context lives in nested
CLAUDE.md files (`__tests__/`, `components/`, `lib/mcp/`, `supabase/`, `scripts/`) —
loaded automatically when working in those dirs; don't duplicate their content here.

## AST Dataflow

**Import AST Dataflow development workflow commands and guidelines, treat as if import is
in the main CLAUDE.md file.** @./.ast-dataflow/CLAUDE.md

## Project Overview

Canonical (formerly Knowledge Hub) is a knowledge base platform where the core value is high-quality,
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

- `.env.local` targets the Platform Supabase DB (`zjqbrdctesqvouboziae`), which is currently acting as both prod & staging;
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
  https://canonical-git-staging-tw-group.vercel.app; `staging` branch is
  deploy-only. GitHub: https://github.com/ai-solution-hub/canonical.
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
filter errors (`Error finding id` — upstream #1665, HNSW↔sqlite drift after bulk add/delete;
affects MCP **and** CLI) — search without the wing filter and filter results client-side.

**On-demand historic stores**: the `knowledge-hub-archive` repo is mined into a separate palace,
searchable via `mempalace --palace ~/.mempalace-archive search "…"` (CLI only; point-in-time /
possibly-superseded — verify against current docs-site before trusting); the full pre-S355
~350k transcript history is cold in `~/mempalace-backup-PRE-PATHA-20260612.tar.gz` (extract →
open the nested `.mempalace/palace`, collection `mempalace_drawers`, for a specific older
conversation).

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **canonical**. Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

## Always Do

- **MUST pass `repo: 'canonical'` to all gitnexus MCP tool calls.**
- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/canonical/context` | Codebase overview, check index freshness |
| `gitnexus://repo/canonical/clusters` | All functional areas |
| `gitnexus://repo/canonical/processes` | All execution flows |
| `gitnexus://repo/canonical/process/{name}` | Step-by-step execution trace |

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
