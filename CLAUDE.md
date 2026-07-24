# CLAUDE.md

Guidance for Claude Code in this repository. Directory-scoped context lives in nested CLAUDE.md files (`__tests__/`, `components/`, `lib/mcp/`, `supabase/`, `scripts/`) — loaded automatically when working in those dirs; don't duplicate their content here.

## Project Overview

Canonical (formerly Knowledge Hub) is a knowledge base platform where the core value is high-quality, structured data accessible by AI. First domain applications: procurement + sector intelligence for UK SMBs; next is Sales Proposals.**Team:** Liam (product owner, non-developer — verification gates are his eyes on the code) + Claude Code as development partner.

## Commands

| Command | Description |
| --- | --- |
| bun install / bun dev | Install deps / dev server (Turbopack, localhost:3000) |
| bun build | Production build |
| bun run test | Vitest suite (full regression gate after merges) |
| bun run test:integration | Integration suite (real Anthropic + Supabase) |
| bun lint / bun run format | ESLint / Prettier |
| python3 -m pytest scripts/tests/ | Python pipeline tests |
| bun run test:e2e | Playwright E2E |

MCP eval + plugin/app build commands: see `lib/mcp/CLAUDE.md`. Type regen: see`supabase/CLAUDE.md`. Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser automation.

## Architecture

Key file: `proxy.ts` — Next.js 16 auth middleware; new public endpoints MUST be added to its `publicRoutes` allowlist or they silently redirect to `/login`.

| Directory | Contents |
| --- | --- |
| app/ | Next.js 16 App Router — API + page routes |
| mcp-apps/ | MCP App UIs (Vite single-file builds) |
| components/ | Domain subdirs — never add components at root |
| contexts/ | React contexts |
| hooks/ | Custom hooks — domain sub dirs + general at root |
| lib/ | Core modules (ai/, mcp/, procurement/, validation/, …) |
| types/ | TypeScript types |
| scripts/ | Python pipeline (cocoindex_pipeline/), ingestion/search CLIs |
| supabase/ | Migrations + generated types |
| tests/ | Vitest tests — mirrors source structure |
| e2e/ | Playwright specs |

## Environment & Database

- `.env.local` targets the **Platform staging** DB (`rbwqewalexrzgxtvcqrh`,`PLATFORM_PROJECT_REF`) — the local-dev + CI target since the staging-first cutover. The platform runs separate **staging** + **prod** DBs (Platform prod `zjqbrdctesqvouboziae`),and each client its own prod + staging project; the full four-DB topology + client refs live in the private runbook. Prod-targeted CLI work opts in via `--env=prod`. Runbook:`${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`.
- Schema is canonically the generated types (`Tables<'x'>` / `Enums<'x'>` from`supabase/types/database.types.ts` + JSONB overrides). Migration/DDL/project-ref/RLS discipline: `supabase/CLAUDE.md`.
- Interactive CLIs (e.g. `supabase db push`) hang background shells — run foreground.

## Conventions (cross-cutting)

- **Types:** DB/row shapes from `Tables<'x'>` / `QueryData<>`; composed/API shapes from`z.infer<typeof schema>`.
- **No barrel re-exports:** direct file imports only (`@/lib/procurement/helpers`).
- **Auth:** `getAuthorisedClient()` returns `{ success: boolean }` — check`auth.success`, route failures via the `authFailureResponse(auth)` helper.
- **Data fetching:** TanStack Query exclusively (keys/fetchers in `lib/query/`).
- **UI:** semantic design tokens only — see `components/CLAUDE.md`.
- **Content review vs governance review:** `/review` = content quality;`/api/governance/review` = freshness/ownership. Separate workflows.
- Guard hooks enforce: no unquoted heredocs containing `!`, no client names in filenames/commands (private denylist), sentinel-gated `.claude/{agents,skills}` edits.

## Orchestration & Sub-agents

- **Worktree isolation:** `isolation: "worktree"` for parallel Agent dispatch; cherry-pick (not merge) parallel branches; agents start stale — first action`git fetch origin {branch} && git reset --hard origin/{branch}`.
- **ALWAYS check worktree **`git status`** before removing it.**
- **Workers edit task files directly** — update `${KH_PRIVATE_DOCS_DIR}/tasks/id-N.md` as work progresses; the Coordinator alone moves a task to `done` (dependency-gated terminal status).
- **Intent (ACP) sessions:** permission prompts never surface in Intent — a user-level PreToolUse hook (`~/.claude/hooks/intent-acp-autoallow.sh`) auto-allows tool calls when cwd is under `~/intent/workspaces/`. Claude Code's force-ask files (`.claude/settings*.json`, `.claude/hooks/`, `.claude/skills/`, `.claude/agents/`) can NOT be auto-allowed by hooks — a Write/Edit to them inside Intent stalls until Intent's ~30-min watchdog kills the turn. Do those edits from a terminal session instead.

## Ledgers

The task ledger is **ordna** in the PRIVATE docs-site: one markdown file per task at `${KH_PRIVATE_DOCS_DIR}/tasks/id-N.md` (YAML frontmatter + body; Git is the source of truth — no database, no server). Read via `cat` on the task file, or the ordna CLI from the docs-site root: `ordna list` / `ordna show <id>` (non-interactive — bare `ordna` opens the TUI board and hangs background shells, like `supabase db push`). Write by editing the task file directly. File format + conventions: `${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md` — the single home for task-ledger conventions.

## Key References

Resolve the checkout via `KH_PRIVATE_DOCS_DIR` (sibling clone locally; GitHub-App token checkout in CI — `.github/actions/resolve-private-docs/`). Under`${KH_PRIVATE_DOCS_DIR}/src/content/docs/`: `reference/platform-context.md` (load at session start — current four-DB topology, deploy hosts + key context anchors, with progressive-disclosure pointers into the runbooks), `runbooks/` (ci, local-development, staging-refresh, github-environments, onprem-b1-deploy), `design/` (Warm Meridian),`continuation-prompts/`, `specs/`, `initiatives/`.

- **Test standards (co-located in-repo):** `docs/reference/testing/` —`test-philosophy.md` (behaviour-first testing doctrine) + `testing-patterns.md`.
- **Spec convention:** new Task spec dirs `specs/id-N-<slug>/` with `RESEARCH.md` {N.1},`PRODUCT.md` {N.2}, `TECH.md` {N.3}. The {N.4} PLAN.md artefact is retired (DR-089) —the plan/decomposition surface is the Intent workspace spec-note.
- **Historical planning:** `knowledge-hub-archive` repo (point-in-time snapshots).

## Deployment & CI

- Vercel (Next.js) + IONOS VPS/Coolify for the ingestion pipeline(`onprem-deploy.yml`); staging URL[https://canonical-platform-git-staging-tw-group.vercel.app](https://canonical-platform-git-staging-tw-group.vercel.app); `staging` branch is deploy-only. GitHub: [https://github.com/ai-solution-hub/canonical](https://github.com/ai-solution-hub/canonical).
- PR-blocking CI (`ci.yml`): Topology + failure-mode table: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/ci.md`.Side workflows incl. `schema-parity`.

## Memory (MemPalace)

Mempalace MCP is the canonical memory system (`mempalace_diary_read/write`,`mempalace_search`, `mempalace_kg_*`). Known issue: `mempalace_search` with a `wing`filter errors (`Error finding id` — upstream #1665, HNSW↔sqlite drift after bulk add/delete; affects MCP **and** CLI) — search without the wing filter and filter results client-side.

**Proactive recall (read-at-start).** The SessionStart hook `.claude/hooks/mempal-recall.sh`injects a lock-free (`mode=ro&immutable=1`, no chromadb writer — DR-009/DR-003) FTS digest of prior context — seeded by branch + cwd base name, diary-first, CHECKPOINT-noise filtered — on session `startup`/`clear`. Beyond that automatic digest, MUST run a branch + active-task-seeded recall pass (the `recall-grounding` skill — decision-point triggers + the `-32002` lock-freeFTS fall through; underlying palace-search mechanism: the plugin `mempalace-recall` skill)before relying on memory of prior work, decisions, or people; honour the #1665 workaround above (no `wing` filter; filter client-side).

**On-demand historic stores**: the `knowledge-hub-archive` repo is mined into a separate palace, searchable via `mempalace --palace ~/.mempalace-archive search "…"` (CLI only; point-in-time /possibly-superseded — verify against current docs-site before trusting); the full pre-S355350k transcript history is cold in `/mempalace-backup-PRE-PATHA-20260612.tar.gz`(extract → open the nested`.mempalace/palace`, collection `mempalace_drawers`, for a specific older conversation).

<!-- gitnexus:start -->
<!-- gitnexus:keep -->

# GitNexus — Code Intelligence

GitNexus indexes this repo as **canonical** and exposes on-demand code-intelligence MCP tools. Use them when they earn their keep — as a faster path to understanding and safer edits — not by blanket per-edit mandate.

- **Exploration / "how does X work?"** — `query` and `context` return process-grouped execution flows; reach for them instead of grepping when the call graph is the answer.
- **Change safety / refactors** — `impact` sizes the blast radius, `rename` does call-graph-aware renames, `detect_changes` scopes a diff (`base_ref: "main"`).
- Pass `repo: 'canonical'` on gitnexus MCP calls. Per-task how-to lives in the skill files under `.claude/skills/gitnexus/` (exploring, impact-analysis, debugging, refactoring, guide, cli).

<!-- gitnexus:end -->