<!-- Last verified: 22/05/2026 (kh-prod-readiness-S53 ID-18.1 — initial authoring, Option C ratified at S52 close; kh-prod-readiness-S277 ID-23.14 — code-intelligence refactor tilt row added) -->

# Skill Routing Map

**Last verified:** 22/05/2026

This document is a **lookup table**, not a forcing function. The Orchestrator (or Liam)
consults it when composing dispatch briefs to identify which task-specific skills to name
for Planners, Executors, and Checkers. Sub-agents do not auto-discover skills from this
map — they invoke only what the dispatch brief names. Liam's judgement overrides any row.

**Ratification source:** `docs/plans/phase-0-investigation/meta-skill-evaluation.md`
§3 (Option C recommendation) + §4 (implementation scope). Liam ratified at
kh-prod-readiness-S52 session close:

- **Q-META-1:** 8–10 tilt rows (wide-then-deep — cheaper to add a row than merge
  over-split ones).
- **Q-META-2:** Tracked reference doc with `<!-- Last verified: ... -->` header (registered
  in `lib/docs/tracked-reference-docs.ts`). Update when skills are added, renamed, or
  deleted.
- **Q-META-3:** Anti-patterns column included — useful for tilts where a superficially
  relevant skill gives conflicting guidance (e.g. Astro vs React surface area).

---

## How to use this map

1. Read the Task description and `cross_doc_links[]` from `task-list.json`.
2. Pick the tilt row whose description best matches the Task's primary surface area.
3. Copy the **Required skills** into the dispatch brief (always include these).
4. Scan **Conditional skills** — include any whose condition is met by the Task.
5. Check **Anti-patterns** — omit any skill listed there unless the Task explicitly
   surfaces that concern.
6. Name the chosen skills in the brief's "Skills to invoke" field; sub-agents invoke
   what they're told, nothing more.

A Task may span two tilts (e.g. a CI change that also updates Supabase schema). In that
case, union the Required sets and intersect the Anti-pattern exclusions (if a skill
appears in one tilt's Anti-patterns but the other tilt's Required, include it).

---

## Tilt routing table

| Task tilt | Required skills | Conditional skills | Anti-patterns | Example Tasks |
|---|---|---|---|---|
| **AI** — Anthropic SDK / Claude API / prompt engineering / MCP tool authoring | `claude-api`, `test-driven-development` | `supabase-postgres-best-practices` (if tool writes to DB); `playwright-best-practices` (if E2E covers AI output) | Do NOT load `claude-api` if the file imports `openai` or another provider SDK — the skill's prompt-caching and model-version guidance is Anthropic-specific and gives conflicting advice on non-Anthropic providers. See `claude-api` skill trigger conditions. | MCP tool authoring, prompt-chain refactor, eval harness, structured-output schema change |
| **CI / CD** — GitHub Actions workflows, Vercel config, Cloud Run deploy, knip baseline, PR checks | `diagnose-ci-failures`, `test-driven-development` | `supabase-postgres-best-practices` (if workflow touches migration or schema-parity job); `security-review` (if secrets handling changes) | Do NOT load `vercel-react-best-practices` for pure CI workflow changes — Vercel build config is not a React surface. Do NOT use `playwright-best-practices` for workflow YAML edits. | CI job parallelisation, knip baseline update, Cloud Run deploy fix, GitHub Environment config |
| **Supabase / Postgres** — DDL migrations, RLS policies, RPC functions, schema parity, Supabase types | `supabase-postgres-best-practices`, `test-driven-development` | `security-review` (if RLS or SECURITY DEFINER touched); `diagnose-ci-failures` (if migration-parity CI job is red) | Do NOT run `supabase migration new` / `db push` via MCP `execute_sql` — use CLI only (CLAUDE.md §Supabase). Do NOT omit `SET search_path = public, extensions` on new PL/pgSQL functions. Do NOT load `vercel-react-best-practices`. | RLS tightening, SECDEF→INVOKER flip, new RPC, vector index, pg_cron job |
| **Frontend — React** — Next.js App Router pages, React components, hooks, TanStack Query, Tailwind / design tokens | `test-driven-development`, `incremental-implementation` | `playwright-best-practices` (if change has E2E coverage); `security-review` (if auth-gated route added); `code-simplification` (end-of-task pass) | Do NOT use raw Tailwind colour classes — semantic tokens only (`app/globals.css`). Do NOT use `astro` skill for React surface. Do NOT use SWR or raw `fetch` in hooks — TanStack Query only. | New page route, component rebuild, hook refactor, design-token update, TanStack Query migration |
| **Frontend — Astro** — Astro pages, layouts, MCP App UIs (Vite single-file builds) | `astro`, `test-driven-development` | `playwright-best-practices` (if E2E covers Astro pages); `incremental-implementation` (multi-file island changes) | Do NOT load `vercel-react-best-practices` unless the Astro page embeds an explicit React island — the two skills give conflicting routing and data-fetching guidance. Check `mcp-apps/` vs `app/` before choosing tilt. | MCP App UI, Astro layout, Vite bundle change, inline bundle for Vercel |
| **Data pipeline** — Python `kb_pipeline/`, ingestion CLIs, batch scripts, Cloud Run jobs, `pipeline_runs` records | `test-driven-development` | `supabase-postgres-best-practices` (if pipeline writes schema); `diagnose-ci-failures` (if Cloud Run deploy CI is red); `security-review` (if service-account credentials touched) | Do NOT use `PYTHONUNBUFFERED=0` — pipeline output becomes invisible (CLAUDE.md §General). Do NOT use `json.dumps()` for Supabase metadata — pass dict directly. Do NOT use `Document(path)` from python-docx directly — use `open_document_safe()`. | Ingestion pipeline, batch reclassify, Cloud Run job, `pipeline_runs` logging, taxonomy snapshot refresh |
| **Testing — Playwright** — E2E specs, Playwright config, fixture authoring, multi-role auth flows | `playwright-best-practices`, `test-driven-development` | `agent-browser` (if interactive visual verification needed alongside spec authoring); `diagnose-ci-failures` (if E2E job is red in CI) | Do NOT use hard `await page.waitForTimeout()` for timing — always `waitFor({ state: 'visible' })`. Do NOT skip `installRadixPointerShims()` for Radix Select in jsdom. Do NOT use `if (await X.isVisible().catch(() => false))` as a conditional — use hard `expect(X).toBeVisible()` (CLAUDE.md §E2E). | New E2E spec, auth flow coverage, mobile viewport fix, Playwright config update |
| **Documentation** — reference docs, runbooks, ADRs, SDLC docs, tracked-reference-doc updates | `documentation-and-adrs` | `update-skill` (if a skill SKILL.md is also updated as part of the change); `kpf:refresh-reference-docs` (if `<!-- Last verified: ... -->` headers need bumping across multiple docs) | Do NOT write a new PRODUCT.md / TECH.md as part of a documentation Task — those are Planner artefacts produced by `write-product-spec` / `write-tech-spec`. Do NOT edit `docs/reference/product-roadmap.json` or `product-backlog.json` without the Curator (`update-roadmap-backlog`). | Skill routing map, runbook update, ADR, state-of-the-product entry, documentation-inventory update |
| **Security / RLS** — RLS policy authoring, `get_user_role()`, SECURITY DEFINER audit, anon-EXECUTE lint, snyk scan | `security-review`, `supabase-postgres-best-practices`, `test-driven-development` | `diagnose-ci-failures` (if `migration-revoke-guard.yml` or `supabase-advisors.yml` CI job is red) | Do NOT use `--scan-all-users` with snyk-agent-scan — it dumps env-var values verbatim in JSON (CLAUDE.md §Plugin/MCP). Do NOT omit explicit `REVOKE EXECUTE ON FUNCTION ... FROM anon` on every new `public.*()` helper. Do NOT grant anon SELECT on `user_roles`. | OPS-43 SECDEF→INVOKER batch, advisor lint fix, RLS policy tightening, anon-EXECUTE revoke sweep |
| **Workflow tooling** — SDLC skill authoring, agent file updates, `task-list.json` schema changes, orchestration infrastructure | `documentation-and-adrs`, `update-skill` | `test-driven-development` (if skill adds behaviour tested by Vitest guard tests, e.g. `doc-freshness.test.ts`, `mcp-fixture-sync.test.ts`); `context-engineering` (if loadout config changes) | Do NOT invoke `planning-and-task-breakdown` mid-Executor — decomposition is a Planner-phase concern. Do NOT edit `task-list.json` status fields to `done` as Executor — Checker only. Do NOT use `git-workflow-and-versioning` as Executor — Executors use `commit-commands` only. | SDLC skill update, agent file edit, task-list schema extension, freshness guard, skill-routing map authoring |
| **Refactor / Rename / Type-evolution** — symbol renames, function extraction/inlining, type narrowing/widening, dead-export removal, column-rename across consumers | `gitnexus-refactoring`, `gitnexus-impact-analysis`, `ast-dataflow`, `ast-dataflow-rename-sweep`, `ast-dataflow-call-chain-pin` | `code-simplification` (end-of-task pass); `test-driven-development` (if behaviour changes) | Do NOT use find-and-replace for renames — `gitnexus_rename` understands the call graph. Do NOT skip `gitnexus_impact` on HIGH-risk symbol edits. | Column rename across consumers, function extraction, type-narrowing refactor, dead-export sweep |

---

## Maintenance

- **Add a row** when a new tilt emerges from observed session gaps (wide-then-deep:
  wait until the same improvised routing appears ≥2 sessions before adding a row).
- **Update a row** when a skill is renamed, deleted, or its trigger conditions change.
  Both `Required skills` and `Conditional skills` cells must stay in sync with the
  actual skill files in `.claude/skills/`.
- **Bump `Last verified`** header in the same commit that changes any row. The
  freshness guard test (`__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`)
  enforces this.
- **Do not split tilts prematurely.** Q-META-1 ratification: 8–10 rows is the target
  granularity. Finer splits increase maintenance without improving lookup quality.

---

## References

- Option C spec: `docs/plans/phase-0-investigation/meta-skill-evaluation.md` §3–§4
- Q-META-1/2/3 ratification: kh-prod-readiness-S52 session close
- Skill catalogue: `.claude/skills/` (enumerated; no authoritative index — use
  `ls .claude/skills/` and check each `SKILL.md` for trigger conditions)
- Freshness guard: `__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`
- Registration: `lib/docs/tracked-reference-docs.ts`
- Workflow orchestration §4.4: `.claude/skills/workflow-orchestration/SKILL.md`
- Task planner §4.1: `.claude/agents/task-planner.md`
