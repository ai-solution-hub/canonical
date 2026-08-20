# CLAUDE.md

Guidance for Claude in this repository. Directory-scoped context lives in nested CLAUDE.md files (`__tests__/`, `components/`, `lib/mcp/`, `supabase/`, `scripts/`).

## Project Overview

Canonical is a map of the knowledge businesses use everyday. Connect a new source of knowledge, the map grows, creating curated concept files which provide humans and agents with a standardised approach for finding what they need, seeing where it came from, judgiung how far to trust it, and understanding how to use it. Trust and traceability are the default, and the map shows you where to fix data quality issues at the source. Applications are the layer on top of the map, putting the knowledge to work and compounding the map with every outcome. The initial market is UK SMBs — the businesses with the most tacit knowledge and the least capacity to structure it themselves.**Team:** Liam (product owner, non-developer — verification gates are his eyes on the code - proactively flag issues, risks, and do-it-properly opportunities in owner-facing summaries — never wait to be asked) + Claude as development partner.

## Commands

| Command | Description |
| --- | --- |
| bun install / bun dev | Install deps / dev server (Turbopack, localhost:3000) |
| NEXT_DIST_DIR=.next-N bun dev | Second+ dev server in the SAME checkout — see below |
| bun run build | Production build |
| bun run test | Vitest suite (full regression gate after merges) |
| bun run test:integration | Integration suite |
| python3 -m pytest scripts/tests/ | Python pipeline tests |

Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser automation.

**Parallel dev servers.** Next locks per *directory*, not per port, so a second `next dev` in the SAME checkout needs its own build root: `NEXT_DIST_DIR=.next-1 bun dev` (slots `.next-1`..`.next-4` — those names only; any other name dirties `tsconfig.json`). Full rules — worktrees, port collisions, `portless`: the **`run-canonical`** skill.

## Agent skills

### Issue tracker

Issues are **ordna** task files at `${KH_PRIVATE_DOCS_DIR}/tasks/id-N.md`. See `docs/agents/issue-tracker.md`.
Spec convention: new Task spec dirs `specs/id-N-<slug>/` with `RESEARCH.md` {N.1},`PRODUCT.md` {N.2}, `TECH.md` {N.3}.

### Triage labels

The five canonical triage labels, applied as ordna `tags:` (`wontfix` also flips status to `archived`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at repo root + `docs/adr/`. See `docs/agents/domain.md`.

### Key Context References

Under `${KH_PRIVATE_DOCS_DIR}/src/content/docs/`: `reference/platform-context.md` (key context anchors with pointers), `runbooks/`, `references/`, `design/`, `continuation-prompts/`, `specs/`, `initiatives/`.

## Architecture

Key file: `proxy.ts` — Next.js 16 auth middleware; new public endpoints MUST be added to its `publicRoutes` allowlist or they silently redirect to `/login`.

**Placement conventions** (the rest of the layout is what `ls` shows): never add components at the `components/` root — domain subdirs only; `hooks/` takes domain subdirs plus general hooks at root.

## Environment & Database

- `.env.local` targets **Platform staging** (`rbwqewalexrzgxtvcqrh`,`PLATFORM_PROJECT_REF`). 
- Platform and client staging DBs are Supabase persistent staging branches of their respective prod project, accessible via `supabase link --project-ref {PROJECT_REF}` - they won't appear via `list_projects`. Credentials are cached, so `supabase db push` works.
- After any prod/client `db push`, **re-link back to `rbwqewalexrzgxtvcqrh`**.
- Prod-targeted CLI work opts in via `--env=prod`; CLI scripts take `--env={prod,staging,auto}`. Runbook:`${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/local-development.md`.
- Schema is canonically the generated types (`Tables<'x'>` / `Enums<'x'>` from`supabase/types/database.types.ts` + JSONB overrides).
- Migration/DDL/project-ref/RLS discipline/type regen: `supabase/CLAUDE.md`.
- Interactive CLIs (e.g. `supabase db push`) hang background shells — run foreground.

## Deployment & CI

- Vercel (Next.js) + IONOS VPS/Coolify for the ingestion pipeline (`onprem-deploy.yml`); staging URL [https://canonical-platform-git-staging-tw-group.vercel.app](https://canonical-platform-git-staging-tw-group.vercel.app); `staging` branch is deploy-only in the current interim (PRs target `main`); the staging-first flow in `runbooks/ci.md` §3 (feature→staging→main) is the target model. GitHub: [https://github.com/ai-solution-hub/canonical](https://github.com/ai-solution-hub/canonical).

## Conventions

- **Behaviour-first testing:** see `docs/reference/testing/` —`test-philosophy.md` + `testing-patterns.md`.
- **Types:** DB/row shapes from `Tables<'x'>` / `QueryData<>`; composed/API shapes from`z.infer<typeof schema>`.
- **No barrel re-exports:** direct file imports only (`@/lib/procurement/helpers`).
- **Auth:** `getAuthorisedClient()` returns `{ success: boolean }` — check`auth.success`, route failures via the `authFailureResponse(auth)` helper.
- **Data fetching:** TanStack Query exclusively (keys/fetchers in `lib/query/`).
- **UI:** semantic design tokens only — see `components/CLAUDE.md`.
- The Read-tool deny on `supabase/types/database.types.ts` in `.claude/settings.json` is deliberate: the generated file is huge — query types via `Tables<'x'>` or `sed`-range reads.
- **Skill/agent edits:** files under `.claude/skills/` and `.claude/agents/` are only changed through the authoring skills — `/create-skill` for new skills, `/update-skill` for changes, `/audit-skill` for de-drift, `/propagate-workflow-change` for cross-file sweeps. Never raw-edit them outside one of those invocations.

## Orchestration & Sub-agents

- **Dispatching sub-agents** - Include the 7 directives from `.agents/coordinator.md` § The Grounding field in sub-agent briefs.
- **Worktree isolation:** `isolation: "worktree"` for parallel Agent dispatch; cherry-pick (not merge) parallel branches; agents start stale — first action`git fetch origin {branch} && git reset --hard origin/{branch}`.
- **Never `git stash` in a dispatch worktree** — the stash ref list is global across worktrees; use a WIP commit on the agent's own branch instead.
- **ALWAYS check worktree **`git status`** before removing it.**
- **Ack gate after mid-flight directives:** any `SendMessage` to a running agent that can change its deliverable voids that agent's prior report — do not synthesise or commit its output until the post-directive final signal arrives. Valid final signals by agent type: Agent-tool subagent = the NEXT task-completion notification; teammate = an explicit final message or task-complete; cross-session peer = a reply-back marker you required in the directive. An `idle_notification` is never a completion signal.
- Sub-agent dispatch briefs 

## Memory (MemPalace)

Mempalace MCP is the canonical memory system (`mempalace_diary_read/write`,`mempalace_search`, `mempalace_kg_*`). The SessionStart hook `.claude/hooks/mempal-recall.sh` injects a lock-free FTS digest of prior context.

**If `mempalace_search` / `mempalace_kg_query` errors (`-32002`, integrity-check refusal, or anything else), a filtered search behaves oddly, or the live palace comes up empty on older work, review `${KH_PRIVATE_DOCS_DIR}/src/content/docs/runbooks/mempalace-handling-degraded-recall.md` for how to resolve.

<!-- code-intelligence:start -->
<!-- code-intelligence:keep -->

# Code Intelligence

## Gitnexus

GitNexus indexes this repo as **canonical** and exposes on-demand code-intelligence MCP tools. Use them when they earn their keep — as a faster path to understanding and safer edits — not by blanket per-edit mandate.

- **Exploration / "how does X work?"** — `query` and `context` return process-grouped execution flows; reach for them instead of grepping when the call graph is the answer.
- **Change safety / refactors** — `impact` sizes the blast radius, `rename` does call-graph-aware renames, `detect_changes` scopes a diff (`base_ref: "main"`).
- Pass `repo: 'canonical'` on gitnexus MCP calls. Per-task how-to lives in the skill files under `.claude/skills/gitnexus/` (exploring, impact-analysis, refactoring).
- A stale-index warning on every commit is expected (the post-commit hook compares the index to the new HEAD). 

## Cocoindex Code

The `ccc` skill provides you with AST-based semantic code search, cover TS, Python, and the database schema.

## AST-dataflow

A type-checker-resolved symbol and dataflow analysis for TypeScript repos, with a Python column-lineage companion. Answers the questions grep cannot: exact call sites, column read/write sites, string-literal AST context, re-export chains, type-position blast radius, and cross-language schema coverage.

<!-- code-intelligence:end -->