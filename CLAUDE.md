# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project Overview

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain applications are bid management and
sector intelligence for UK SMBs. Next application is Sales Proposals. The knowledge base
is the foundation for these and future applications.

**Team:** Liam (product owner) + Claude Code as development partner.

## Commands

| Command                                                                                                                                | Description                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bun install`                                                                                                                          | Install Node dependencies                                                                            |
| `bun dev`                                                                                                                              | Start Next.js dev server (Turbopack) - default port is localhost:3000                                |
| `bun run dev:clean`                                                                                                                    | Clear `.next` cache + start dev server (use when OOM)                                                |
| `bun build`                                                                                                                            | Production build                                                                                     |
| `bun run test`                                                                                                                         | Run Vitest tests (NOT `bun test` — see Gotchas)                                                      |
| `bun run test:integration`                                                                                                             | Integration suite — `__tests__/integration/**.integration.test.ts`, real Anthropic + Supabase        |
| `bun lint`                                                                                                                             | ESLint                                                                                               |
| `pip install -r requirements.txt`                                                                                                      | Install Python pipeline dependencies                                                                 |
| `python3 -m pytest scripts/tests/`                                                                                                     | Run Python tests                                                                                     |
| `bun run format`                                                                                                                       | Prettier format all files                                                                            |
| `bun run format:check`                                                                                                                 | Check Prettier formatting                                                                            |
| `bun run build:mcp-apps`                                                                                                               | Build MCP Apps (Vite) + generate inline bundles for Vercel                                           |
| `bun run build:plugin`                                                                                                                 | Regenerate plugin ZIP bundle (`lib/mcp/plugin-bundle.ts`) — commit after                             |
| `bun run test:e2e`                                                                                                                     | Run Playwright E2E tests                                                                             |
| `bun run test:watch`                                                                                                                   | Vitest in watch mode                                                                                 |
| `bun run test:mcp-eval`                                                                                                                | Run MCP eval Layer 1 (protocol compliance, 42 checks)                                                |
| `bun run test:mcp-eval:rq`                                                                                                             | Run MCP eval Layer 3 (response quality, 17 checks)                                                   |
| `bun run test:mcp-eval:fc`                                                                                                             | Run MCP eval Layer 4 (functional correctness, 37 checks, live DB)                                    |
| `/opt/homebrew/bin/supabase migration new <name>`                                                                                      | Create local migration file                                                                          |
| `/opt/homebrew/bin/supabase db push`                                                                                                   | Push local migrations to remote                                                                      |
| `/opt/homebrew/bin/supabase gen types typescript --project-id rovrymhhffssilaftdwd --schema public > supabase/types/database.types.ts` | Regenerate TypeScript types from live schema                                                         |
| `bun run stats`                                                                                                                        | Generate codebase statistics to `docs/generated/` (run end-of-session when file counts change)       |
| `bun run generate:mcp-inventory`                                                                                                       | Generate MCP tool/resource/prompt inventory to `docs/generated/` (run when MCP registrations change) |
| `bun run knip`                                                                                                                         | Detect unused files, exports, types, and dependencies (run before merging large changes)             |
| `bun run analyze`                                                                                                                      | Bundle analyzer (opens browser with bundle visualisation)                                            |

## Architecture

Full directory layout with file-level detail: `.planning/codebase/STRUCTURE.md`

Key file: `proxy.ts` — Next.js 16 auth middleware, `publicRoutes` allowlist
(auto-discovered, not imported)

| Directory     | Contents                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`        | Next.js 16 App Router — API routes, page routes                                                                                                                                                                                                 |
| `mcp-apps/`   | MCP App UIs (Vite single-file builds for Claude Desktop/Claude.ai)                                                                                                                                                                              |
| `components/` | 23 domain subdirs — new components go in their domain dir, never at root                                                                                                                                                                        |
| `contexts/`   | React contexts (read-marks, taxonomy, client-features, layer-vocabulary)                                                                                                                                                                        |
| `hooks/`      | Custom React hooks — 7 domain subdirs (bid, browse, intelligence, provenance, review, streaming, ui) + general hooks at root                                                                                                                    |
| `lib/`        | Core modules — `ai/`, `mcp/` (tools, resources, prompts), `bid/`, `content/`, `coverage/`, `digest/`, `entities/`, `extraction/`, `quality/`, `source-documents/`, `supabase/`, `taxonomy/`, `templates/`, `validation/`, plus standalone utils |
| `types/`      | TypeScript types (content, bid, bid-metadata, digest, review, template, owner, reorient, unified-gap, filter-preset, css.d)                                                                                                                     |
| `scripts/`    | Python pipeline (`kb_pipeline/`), ingestion CLIs, search CLI, batch scripts                                                                                                                                                                     |
| `supabase/`   | Migrations + auto-generated types (`database.types.ts` — never edit manually)                                                                                                                                                                   |
| `__tests__/`  | Vitest tests — mirrors source structure (api, app, components, contexts, hooks, lib, mcp, scripts, validation)                                                                                                                                  |
| `e2e/`        | Playwright E2E specs. Config: `playwright.config.ts`                                                                                                                                                                                            |
| `docs/`       | Reference docs, continuation prompts, design system                                                                                                                                                                                             |

Current counts (routes, components, hooks, tools, migrations, tests):
`docs/generated/codebase-stats.md` and `docs/generated/mcp-inventory.md`

## Environment

Env vars in `.env.local` — the single source of truth for both TS and Python pipelines.

`.env.local` points at the persistent staging Supabase branch (`turayklvaunphgbgscat`).
Prod-targeted CLI work opts in via `--env=prod` or explicit env override. Full guidance:
`docs/runbooks/local-development.md`.

## Supabase & Schema

- **Project ID:** `rovrymhhffssilaftdwd` (eu-west-2 London), pgvector 0.8.0
- **Staging:** persistent branch `turayklvaunphgbgscat`. Refresh procedure:
  `docs/runbooks/staging-refresh.md`.
- **CLI:** `/opt/homebrew/bin/supabase`
- **DDL via CLI only** (`supabase migration new` + `db push`), never MCP `execute_sql`.
  MCP tools for queries and quick DML only.
- **Function search_path:** All new PL/pgSQL functions **MUST** include
  `SET search_path = public, extensions`
- **Prefer proper schema** — tables and columns over JSONB for key data
- **Schema reference:** `docs/reference/SCHEMA-QUICK-REFERENCE.md`
- RLS: role-based via `get_user_role()`. Embeddings: `vector(1024)`
  (text-embedding-3-large). Canonical constants: `lib/validation/schemas.ts`.

## Testing

- **Philosophy:** `docs/reference/test-philosophy.md` — six audit criteria, three observed
  antipatterns, mock discipline. Read before writing or remediating tests.
- **Framework:** Vitest (`bun run test`), coverage via `bun run test:coverage`
- **Location:** `__tests__/` — counts in `docs/generated/codebase-stats.md`
- **Mock pattern:** Shared `createMockSupabaseClient()` in
  `__tests__/helpers/mock-supabase.ts`
- **E2E:** Playwright in `e2e/tests/` — worker-scoped fixtures, multi-role auth
- **Quality gate:** Stop hook runs `vitest --changed` (scoped). Use `bun run test`
  explicitly for full regression checks after merges.

## Deployment

- **Platform:** Vercel (Next.js app) + Cloud Run (Python pipeline jobs)
- **Production URL:** https://www.kh.client.example
- **Staging URL:** https://knowledge-hub-git-staging-tw-group.vercel.app
- **Cloud Run projects:** `kh-prod-494815` (main branch) + `kh-staging-494815`. Auth via
  WIF — no JSON keys. Deploy: `.github/workflows/cloud-run-deploy.yml`. Runbook:
  `docs/runbooks/cloud-run-phase-1-handover.md`.
- **GitHub:** https://github.com/ai-solution-hub/knowledge-hub (private)
- **Region:** eu-west-2 (London)
- **GitHub Environments:** `Production` + `Staging` (case-sensitive). Setup:
  `docs/runbooks/github-environments.md`.

## CI/CD

PR-blocking CI (`ci.yml`) runs 7 jobs in parallel: `quality-precheck`, `quality-test`
(4-shard Vitest matrix), `e2e-smoke`, `mcp-build`, `mcp-eval-seed`, `mcp-eval` (L1/L3/L4
matrix), `integration`. Triggers: PR (any base) + push on `main`/`staging`. Draft PRs skip
CI. Full topology + per-step failure-mode table: `docs/runbooks/ci.md`.

Side workflows: `cloud-run-deploy.yml` (Python pipeline), `migration-revoke-guard.yml`
(anon-EXECUTE lint), `schema-parity.yml` (prod ↔ staging diff),
`staging-reference-refresh.yml`, `supabase-advisors.yml`, `taxonomy-sync.yml`.

`staging` branch is deploy-only (no long-lived worktree) — used for staging-mirror sync
per `docs/runbooks/staging-refresh.md`.

## Key Product Design Principles

- **"One record, many views"** — no content duplication, multiple views
- **AI is invisible infrastructure** — not a visible product feature. See
  `docs/reference/ai-visibility-policy.md`
- **Programmatic where possible** — deterministic functions for deterministic tasks
- **UK English throughout** — DD/MM/YYYY, "colour", "organisation"
- **WCAG 2.1 AA** — never colour alone for meaning
- **Package manager: bun** (NOT npm/yarn)
- **The KB is the product** — data quality is paramount

## Design System: Warm Meridian

Spec: `docs/design/warm-meridian-implementation-spec.md` (tokens in §Semantic Tokens).
Philosophy: `docs/design/warm-meridian-philosophy.md`. Visual:
`docs/design/warm-meridian-identity.pdf`. Quality checks: `.claude/checks/`. Consult when
adding or modifying UI elements.

## Key Reference Documents

| Document               | Location                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| State of the Product   | `docs/reference/state-of-the-product.md`                                    |
| Roadmap                | `docs/reference/product-roadmap.json`                                       |
| Product backlog        | `docs/reference/product-backlog.json`                                       |
| Schema quick reference | `docs/reference/SCHEMA-QUICK-REFERENCE.md`                                  |
| CI runbook             | `docs/runbooks/ci.md` — workflow topology, per-job env scope, knip baseline |
| Session handoffs       | `docs/continuation-prompts/`                                                |
| Codebase mapping       | `.planning/codebase/`                                                       |
| Runbooks               | `docs/runbooks/` — local-development, staging-refresh, github-environments  |

Full inventory of all reference docs: `docs/reference/documentation-inventory.md`

Historical planning: `.planning/.archive/{doc-type}` (`.specs/`, `.audits/`, `.research/`,
`.coninuation-prompts/` etc.) Grep explicitly when researching past decisions; treat as
point-in-time snapshots.

## Memory (Mempalace)

Mempalace MCP server is the canonical memory system (replaced auto-memory file system
2026-05-10). Plugin `mempalace@mempalace` v3.3.5 enabled in `~/.claude/settings.json`
`enabledPlugins`; Stop + PreCompact hooks fire automatically per session — no manual
ingest needed.

**One wing per worktree.** Drawer counts as of S43: `knowledge-hub` (75,878) ·
`knowledge-hub-prod-readiness` (22,773) · `knowledge-hub-kpf` (7,342) ·
`knowledge-hub-ui-ux` (15,299) · plus minor worktrees. Total ~128k drawers across 12
wings.

**MCP tools:**

- `mempalace_status` ✓ — wing + drawer + room counts.
- `mempalace_list_wings` ✓ — drawer counts per wing.
- `mempalace_kg_stats` / `mempalace_kg_query` ✓ — KG empty until seeded.
- `mempalace_diary_write` / `mempalace_diary_read` ✓ — works for default `wing_<agent>`;
  cross-project `wing` param errors. Use AAAK format (entity codes + emotion markers +
  pipe-separated fields).
- `mempalace_search` ⚠ **PARTIAL** — default (no `wing` param) WORKS as of 3.3.5 (verified
  S43 W1: returned 9 hits for "test-audit MCP factory"). Any `wing` filter still errors
  `Error executing plan: Internal error: Error finding id` (verified `wing: knowledge-hub`
  AND `wing: knowledge-hub-prod-readiness`). 3.3.5 PR #1396 fixed `tool_search` Chroma
  transient retry, NOT wing-filter id resolution. Workaround: search default, filter
  results client-side by `wing` field; or fall back to git log + grep for wing-scoped
  recall.

**Auto-memory file system phased out.** Do NOT author new `feedback_*.md` / `project_*.md`
/ `reference_*.md` files in `~/.claude/projects/.../memory/`. New lessons either (a)
graduate to a one-line CLAUDE.md Gotcha entry, (b) get recorded inline in the next
continuation prompt's "Critical rules from recent sessions" section (max 5 items), or (c)
wait for a more substantive memory-shape ratification.

## Implementation Workflow

Spec-Code-Verify workflow is loaded via `/start-session` skill at session start. Key
rules: max 2h per agent, verification gates after every phase, fix ALL findings before
merge, sequential merges only.

**Parallel agent isolation:** Use `isolation: "worktree"` on Agent tool calls for parallel
implementation work. This auto-creates a git worktree, runs the agent there, and returns
changes on a branch. Merge sequentially on main — check `git status` for leaked files
before each merge.

## Parallel Tracks

Three concurrent long-lived worktrees on this project (shared filesystem via
`git worktree`):

- **main** (`/Users/liamj/Documents/development/knowledge-hub`, branch `main`)
- **kh-knowledge-platform**
  (`/Users/liamj/Documents/development/knowledge-hub-knowledge-platform`, branch
  `kh-knowledge-platform`). Primer: `docs/tracks/kh-knowledge-platform.md`.
- **production-readiness**
  (`/Users/liamj/Documents/development/knowledge-hub-production-readiness`, branch
  `production-readiness`) — CI/CD, staging DB, structured logging, handover infra. Primer:
  `docs/tracks/production-readiness.md`.

## Gotchas

### Supabase

- **Embedding vector serialisation:** `JSON.stringify(embedding)` for Supabase RPC vector
  params, not raw array.
- **Metadata double-serialisation:** Pass metadata as dict not `json.dumps()` — Supabase
  serialises it again.
- **REST PATCH on wrong UUID:** Returns 200 OK with 0 rows (silent no-op). Always verify
  updates by re-querying.
- **RLS requires user_roles entry:** New users cannot write until seeded.
- **CLI in Claude Code sandbox:** Run `supabase migration new`, `db push`, and `gen types`
  with `dangerouslyDisableSandbox: true`. `POSTGRES_PASSWORD` must be set as a shell env
  var.
- **Bun fetch hangs on HTTP 204 through sandbox proxy:** supabase-js
  `.update()`/`.insert()`/`.upsert()`/`.delete()` without `.select()` returns 204, which
  Bun hangs on in the sandbox. Production is unaffected. **Fix:** run supabase-writing
  scripts with `dangerouslyDisableSandbox: true`. Do NOT add `.select()` workarounds in
  production code.
- **`content_items.content_text_hash` is `GENERATED ALWAYS`:** explicit insert or update
  value rejected with `cannot insert a non-DEFAULT value into column`. PG auto-computes
  via `md5(normalised content)`. Omit the field from any payload writing `content_items`.
- **CLI `.temp/project-ref` can silently go stale post-env-flip:** `supabase db push` may
  push to the WRONG project (looks like silent-fail on intended project). Always
  `cat supabase/.temp/project-ref` before any push; relink via
  `supabase link --project-ref <correct>` if drift detected.
- **Supabase auto-grants anon EXECUTE on every new public.\* PL/pgSQL function:**
  `pg_default_acl` defaults make `REVOKE ... FROM PUBLIC` a no-op against the anon role.
  Every new `public.*()` helper needs an explicit
  `REVOKE EXECUTE ON FUNCTION public.foo() FROM anon;` in its migration — per-tenant if
  SECURITY DEFINER.
- **`mcp__supabase__apply_migration` auto-generates server-side timestamps** that diverge
  from local file naming. Re-pull `supabase_migrations.schema_migrations` post-apply,
  rename the local file to match, and `UPDATE` the staging row if it diverged.

### Testing

- **Guard tests break on structural changes:** `mcp-fixture-sync.test.ts`,
  `doc-freshness.test.ts`, and `pipeline-parity.test.ts` run on every test. Update
  fixtures when adding tools or changing doc paths.
- **vi.mock() hoisting:** Use `vi.hoisted()` for mock variables. Arrow functions in
  `mockImplementation()` cannot be used with `new` — use `function` keyword.
- **Zod UUID validation is strict:** `z.string().uuid()` enforces RFC 4122. Test UUIDs
  like `00000000-...0001` fail — use v4-compliant values.
- **Date-sensitive tests need pinned time:** Use `vi.spyOn(Date, 'now')` with a fixed
  timestamp — `setDate()` rounding causes midnight-boundary flakiness.
- **Agent escalation rule:** Test agents encountering unexpected production behaviour
  (wrong renders, dead code, tests that can only pass by not testing real logic) **MUST
  escalate to the main session**.
- **Verifier diff on long-lived branches:** use `git show --stat <commit>`, not
  `git diff main..<commit>` — the latter returns multi-session deltas and produces
  false-positive "commit contamination" reports.
- **Radix Select in jsdom needs pointer shims:** call `installRadixPointerShims()` from
  `@/__tests__/helpers/radix-pointer-shims` in `beforeEach`.

### E2E / Playwright

- **Browser install:** Must run `python3 -m playwright install chromium` after pip install
  — version mismatches cause failures.
- **Mobile viewports:** Pixel 5 viewport may need `click({ force: true })` or
  `dispatchEvent('click')` for partially obscured buttons.
- **Auth timing:** Always `waitFor({ state: 'visible' })` before `fill()` on login inputs.
- **Browser testing:** Use `agent-browser` skill with `--session` for isolated, parallel
  sessions.
- **Conditional fallbacks silently pass on empty DBs:**
  `if (await X.isVisible().catch(() => false))` skips assertions — use hard
  `expect(X).toBeVisible()` so missing fixtures fail honestly.

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
  in CI. Add redaction wrapper before any v2 cloud upload. Package renamed from
  `mcp-scan`; install via `pipx install snyk-agent-scan`.

### Data & Architecture

- **Silent failures in Supabase calls:** Use `sb()` (fail-fast) or `tryQuery()`
  (Result-returning) from `@/lib/supabase/safe`. Composite responses use
  `warningsEnvelope()` from `@/lib/supabase/warnings`. Best-effort swallows use
  `logBestEffortWarn()` from `@/lib/supabase/telemetry`. Enforced by ESLint rules
  `local/no-unchecked-supabase-error` and `local/no-silent-promise-catch`. Full spec:
  `docs/specs/silent-failure-prevention-spec.md`.
- **Cron `pipeline_runs` inserts:** Use `recordPipelineRun()` from
  `@/lib/pipeline/record-run`, not raw insert.
- **Data fetching:** TanStack Query exclusively. Keys in `lib/query/query-keys.ts`,
  fetchers in `lib/query/fetchers.ts`. No SWR or raw fetch in hooks.
- **`getAuthorisedClient()` discriminated union:** Returns `{ success: boolean }` — check
  `auth.success` not `auth.authorised`. Three failure reasons: `unauthenticated` (→401),
  `forbidden` (→403), `role_lookup_failed` (→500). **Always** use
  `authFailureResponse(auth)` helper to route each reason to the correct HTTP status.
- **No barrel re-exports:** Always use direct file imports (`@/lib/bid/helpers`), never
  import from index files.
- **Taxonomy dual-source:** App uses DB-driven taxonomy (`contexts/taxonomy-context.tsx`);
  `lib/taxonomy/taxonomy.ts` is now a 24-line re-export shim for content types and
  platforms only — Python pipeline reads taxonomy from
  `scripts/tests/fixtures/taxonomy_snapshot.json`.
- **Content review vs governance review:** `/review` = content quality.
  `/api/governance/review` = freshness/ownership. Separate workflows.
- **"Change Reports" not "Digest":** User-facing label is "Change Reports"; internal code
  still uses "digest".
- **Entity classification: false positives, not type errors:** The problem is extracting
  non-entities (policies, generic concepts, job titles), not mistyping real ones. Source
  of truth: `docs/reference/entity-type-taxonomy-spec.md`.

### UI / Frontend

- **No raw Tailwind colours:** Always use semantic tokens. Define new ones in
  `app/globals.css`. See `docs/design/warm-meridian-implementation-spec.md`.
- **Tailwind v4 gotchas:** (1) Dark mode is class-based via
  `@custom-variant dark (&:is(.dark *))` in `globals.css` — don't remove. (2) Scans ALL
  files — never put wildcard class patterns in backticks. (3) Bare `border` uses
  `currentColor` — the `globals.css` base rule restoring `var(--border)` must not be
  removed.
- **`@tiptap/markdown` is NOT `tiptap-markdown`:** Official package uses
  `editor.getMarkdown()` (not `editor.storage.markdown.getMarkdown()`), has no
  `html`/`transformCopiedText`/`transformPastedText` options. Context7 docs show the
  community package — verify against `node_modules/@tiptap/markdown/dist/`.
- **React compiler memoisation:** Destructure nested properties before using in
  `useCallback` deps (e.g. `const { fn } = data;` not `data.fn`).
- **Stable empty array/object defaults in hook returns:** Inline `data?.foo ?? []` creates
  a new reference every render, breaking downstream deps. Hoist a module-level
  `const EMPTY_X: T[] = [];` and wrap with
  `useMemo(() => data?.foo ?? EMPTY_X, [data?.foo])`.
- **Reset local state via `key` prop, not `setState` in effect:** Add `key={propId}` at
  the call site to force a clean remount — don't write a `useEffect` that calls `setState`
  in response to prop changes.

### General

- **Next.js Image rejects query-string cache-busters on local paths.**
  `<Image src="/foo.webp?v=dev">` fails — Next.js handles its own caching.
- **Python background output:** Use `PYTHONUNBUFFERED=1` or output is invisible.
- **python-docx and Track Changes:** Use `open_document_safe()` from
  `scripts/docx_utils.py`, not `Document(path)` directly.
- **mammoth `convertToMarkdown()` drops tables:** Use two-step `mammoth.convertToHtml()` →
  Turndown (with `turndown-plugin-gfm`).
- **cocoindex 1.0.3 requires `dangerouslyDisableSandbox: true`** for both PyPI install and
  Rust-engine LMDB startup in dev. `localfs.walk_dir` defaults `recursive=False` —
  explicit `recursive=True` needed for nested corpora.
- **Worktree isolation rules:**
  - Two sessions on same working tree destroy each other's files — use
    `isolation: "worktree"` or `git worktree add` for parallel work.
  - After merging worktree branches, run `git status` on main and clean with
    `git checkout -- .` and `git clean -fd` (merges leak files).
  - **Cherry-pick (not merge)** parallel agent branches — agents branch from main at
    launch time and go stale when earlier agents merge first.
  - **Worktree agents start stale:** `isolation: "worktree"` branches from a historical
    commit. Agent's first action must be `git reset --hard main`.
  - `hooks/` directory needs `dangerouslyDisableSandbox: true` for cherry-picks.
  - **Sub-agent instructions must always use relative paths** — absolute paths resolve to
    main repo, not the worktree. If rescuing, check `git status` in main first to detect
    leaked files.
  - **Anthropic plugin files invisible to worktree agents:** `.claude/plugins/*`
    gitignored except `knowledge-hub/`; agents needing other plugins must `cp` from parent
    repo after `git reset --hard main`.
  - **Bash CWD drifts into worktree dirs after `Read`:** prefix git operations with
    `cd <main-repo-path> &&` after any Read on worktree files. Also applies to
    **sub-agents** juggling sub-agent worktrees: after Read of a worktree file, subsequent
    git commands silently run in the wrong tree — always `cd <main-repo-path> &&` before
    main-repo git operations.
  - **`isolation: "worktree"` sub-agents can still commit to the parent worktree**
    (kh-ast-S11 R-WP-S11-C evidence — commits `6dbf9da2` + `af9fe05c` landed on
    `ast-dataflow-tooling` despite isolation flag). Mitigation: every sub-agent must
    prefix `cd $(git rev-parse --show-toplevel) &&` after any `Read` and verify `pwd`
    matches the dispatched worktree path before `git commit`. Reference:
    `docs/specs/ast-dataflow-tool/HANDOVER.md` §8.
  - **Reference-doc freshness guard fails on merge commits.**
    `__tests__/docs/reference-doc-edit-coupled-freshness.test.ts` uses
    `git show --format= <sha> -- <file>` which returns combined-diff format on merge
    commits — `+` regex won't register single-parent `last_updated` additions. Workaround:
    follow-up single-parent commit that bumps `last_updated` (kh-ast-S11 `744d9ef1` is the
    canonical example). Or include `[skip-doc-freshness-guard]` in the merge commit
    message body if the bump is intentional.
  - **Concurrent commits on production-readiness during a cross-track merge are non-fatal
    but add reconciliation rounds.** kh-ast-S11 saw three concurrent commits (`b6f7d55f`,
    `80944a09`, `831d9e74`) land during R-WP-S11-D merge. Working pattern: fresh worktree
    off production-readiness; merge cross-track branch into it; pull-and-merge
    production-readiness back into the merge worktree to reconcile; fast-forward
    production-readiness; push. Full sequence: `docs/runbooks/ast-dataflow-merge-S11.md`.
- **Sub-agents can blow their token budget before final `git commit`:** always check
  worktree `git status` before removing it, in case the agent exited mid-commit. (Prior
  "200K hard cap" claim was wrong — empirically agents run past 200K on Opus 4.7
  1M-context. Budget is harness-configured, not a fixed sub-agent ceiling.)
- **Sub-agents dispatched via Agent tool lack the Agent tool themselves** (verified S51
  ID-7 via ToolSearch — only `EnterWorktree`, `TaskStop`, etc. surfaced; no sub-agent
  spawn primitive). Recursive agent dispatch is blocked by harness design. If an
  Orchestrator dispatches a worktree sub-agent that needs to dispatch another agent (e.g.
  `agent-creator`), the sub-agent must apply the relevant skill's methodology DIRECTLY
  (e.g. `agent-development` skill) + reference the target agent's body as a write-pattern
  template. Skills (Skill tool) remain accessible to sub-agents.
- **`.claude/skills/` is now track-all by default** (S51 close-out gitignore policy flip).
  New skills are automatically tracked — no allowlist additions required. Runtime state
  (`.claude/cmux-events/`, `.claude/worktrees/`) remains gitignored. Previous policy
  required an explicit `!.claude/skills/<name>/` allowlist entry per skill — that friction
  is gone.
- **"Build the thing, forget to turn it on":** Every fix must trace from the production
  entry point to the change. Run `bun run knip` for deterministic detection of unused
  files/exports.
- **`classifyContent` userId must be a UUID:** Use pipeline service account UUID
  (`a0000000-0000-4000-8000-000000000001`), never literal strings.
- **`content_items.summary` (not `ai_summary`):** `feed_articles.ai_summary` is
  intentionally a separate column — do not "fix" the naming.
- **Proxy blocks non-API public routes:** New public endpoints must be added to
  `publicRoutes` in `proxy.ts` (project root) or they silently redirect to `/login`.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **knowledge-hub** (41078 symbols, 58867
relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess
impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal
> first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function,
  class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})`
  and report the blast radius (direct callers, affected processes, risk level) to the
  user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only
  affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before
  proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find
  execution flows instead of grepping. It returns process-grouped results ranked by
  relevance.
- When you need full context on a specific symbol — callers, callees, which execution
  flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the
  call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected
  scope.

## Resources

| Resource                                       | Use for                                  |
| ---------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/knowledge-hub/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/knowledge-hub/clusters`       | All functional areas                     |
| `gitnexus://repo/knowledge-hub/processes`      | All execution flows                      |
| `gitnexus://repo/knowledge-hub/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

<!-- ast-dataflow:start -->

# ast-dataflow — TypeScript Symbol Analysis

ast-dataflow provides type-checker-resolved static analysis via `ts-morph`. Use it for
precise file-and-line answers that GitNexus (graph-level) and Knip (binary reachability)
cannot give: exact call sites, column access sites, string-literal AST context,
barrel-chain tracing, and type-position blast radius.

**CLI:** `bun scripts/ast-dataflow-cli.ts <query> [args]`

## Skill catalogue

| Task                                             | Skill                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Orient: which query to use, which pattern?       | `.claude/skills/ast-dataflow/SKILL.md`                             |
| Verify a rename is complete post-gitnexus_rename | `.claude/skills/ast-dataflow/ast-dataflow-rename-sweep/SKILL.md`   |
| Pin the exact call site passing a wrong argument | `.claude/skills/ast-dataflow/ast-dataflow-call-chain-pin/SKILL.md` |

## When each skill applies

- **Catalogue (`ast-dataflow`)** — start here. Covers all 12 queries (`callers`,
  `references`, `importers`, `string-literal-uses`, `column-reads`, `column-writes`,
  `dead-exports`, `reexport-chain`, `type-evolution`, `enum-uses`, `flow-trace`,
  `type-drift-detect`) and all 9 cross-tool patterns (Knip, gitnexus, ccc compositions).

- **Rename-sweep (`ast-dataflow-rename-sweep`)** — after any `gitnexus_rename` that
  produced `ast_search` edits marked "review carefully". Runs Q1 (string-literal sites),
  Q2 (import-path sweep), Q3 (new-symbol references) and produces a categorised VERDICT
  report.

- **Call-chain pin (`ast-dataflow-call-chain-pin`)** — when a wrong-argument-value bug is
  suspected: wrong UUID shape, wrong string key, missing required field, untyped Supabase
  client. Chains `gitnexus_context` (flow context + direct callers) with `callers` (all
  indirect callers gitnexus does not index) to pinpoint the exact file:line passing the
  wrong value.

## Gotcha: ast-dataflow does not cover Python or SQL files

`ts-morph` operates on the TypeScript corpus only. For string-literal searches that need
to cover Python scripts (`scripts/kb_pipeline/*.py`) or raw SQL migration files
(`supabase/migrations/*.sql`), run a `grep` sweep in addition to any ast-dataflow query.

<!-- ast-dataflow:end -->
