---
name: sync-source-docs
description:
  Detects drift between Knowledge Hub code surfaces and their reference docs,
  then opens a docs PR with the refreshed pages. Three KH source pairs:
  database schema, MCP registrations, and API route definitions. KH-renamed
  from Warp's sync-error-docs. Weekly Monday 06:00 UTC plus workflow_dispatch.
  Driven by scripts/skills/run-skill.ts.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit
---

# sync-source-docs — KH source-to-docs drift sync

This skill keeps code-generated reference docs in step with their source
surfaces. It is loaded by `scripts/skills/run-skill.ts` alongside `AGENTS.md`
and `.claude/skills/keep-docs-in-sync/SKILL.md`.

Spec source: `docs/specs/id-9-astro-starlight-docs-foundation/TECH.md` §4.4;
`docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md` Inv-20 + Inv-39.

---

## 1. The three KH source pairs (Inv-39)

| # | Source surface                                | Doc target                                                       |
| - | --------------------------------------------- | ---------------------------------------------------------------- |
| 1 | `supabase/types/database.types.ts` (schema)   | `docs-site/src/content/docs/reference/schema-quick-reference.md` |
| 2 | MCP registrations under `lib/mcp/`            | `docs-site/src/content/docs/reference/mcp-inventory.md`          |
| 3 | API routes `app/api/**/route.ts`              | `docs-site/src/content/docs/reference/api-routes.md` (NEW)       |

- **Pair 1 (schema).** Per-table pages may also live under
  `docs-site/src/content/docs/reference/schema/<table>.md` — create them on
  first run if missing.
- **Pair 2 (MCP).** `bun run generate:mcp-inventory` already produces an
  inventory; consume its output or independently audit the source registrations
  in `lib/mcp/tools/`, `lib/mcp/resources/`, `lib/mcp/prompts/`.
- **Pair 3 (routes).** `api-routes.md` does not exist yet — this skill is
  responsible for its first creation and ongoing sync. Group routes by feature
  area; record method + path + auth posture.

## 2. Drift detection

For each pair: read the source surface, read the current doc target, and
compare. Drift means the doc omits, mislabels, or staleley describes a surface
present in the source (a new table/column, a new MCP tool, a new route), or
describes a surface no longer present.

When no drift is found for a pair, record that and move on — do not open an
empty PR.

## 3. On detected drift

Open ONE docs PR titled `docs(reference): sync <surface> drift` (e.g.
`docs(reference): sync schema drift`) containing the rewritten target file(s).

- Write directly to the `docs-site/src/content/docs/reference/` target(s).
- Mark every written file `kh_docubot_owned: true` in its front matter so the
  build-time sync (`docs-site/scripts/sync-content.ts`) skips the path and does
  not clobber the refresh (per TECH §3.4 divergence guard).
- Follow KH commit + PR conventions (keep-docs-in-sync) and the single-comment
  guardrail.

## 4. Trigger

`workflow_dispatch` plus a weekly `schedule` cron — Monday 06:00 UTC
(`0 6 * * 1`, OQ-T2 ratified default). The weekly cadence catches drift that
accumulates between source-PR merges.
