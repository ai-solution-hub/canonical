# cmux Terminal Brief — ID-9 docs-site Phase 3 (S262)

**Your role:** Orchestrator for Task **ID-9** (single-track `main`). Run
`workflow-orchestration`.

**Bootstrap (read once):**

- `CLAUDE.md`
- `docs/reference/task-list.json` → Task **ID-9** (9.11–9.24 `details` are load-bearing)
- `docs/specs/id-9-astro-starlight-docs-foundation/{PRODUCT,TECH,PLAN}.md`
- `AGENTS.md` (repo root — canonical style source the 5 ported skills depend on);
  `.claude/skills/keep-docs-in-sync/`

**Status:** 9.1–9.10 done. Pending: 9.11–9.24 (Phase 3).

**Core chain (docubot + 5-skill workflow):**

1. **9.11** Docubot composite action + KH-persona prompt template — deps `[9,10]`.
2. **9.12** Docubot workflow + Claude Agent SDK driver — deps `[11]`.
3. **9.13** 5-skill canonical workflow scaffold + shared driver — deps `[9,10,11]`.
4. **9.14–9.18** five skill bodies (`review-docs-pr`, `sync-source-docs`, `missing-docs`,
   `check-for-broken-links`, `docs-seo-audit`) — each deps `[13]`, **PARALLELIZABLE among
   themselves**.
5. **9.20** Session-A decommission verification gate — deps `[12,14]`.
6. **9.21** Session-B atomic decommission (remove `update-docs` + CLAUDE.md refs) — deps
   `[19,20]`.

**Independent (deps `[]` — dispatch anytime):** 9.19 (ci.yml regenerate-stats job), 9.22
(move `gray-matter` devDep→dep), 9.23 (resolve `astro check` title front-matter gap), 9.24
(docs-site E2E Vitest→Playwright — **gated on the Vercel preview deploy** that Phase-3
deploy glue provides).

**Gate:** 9.20/9.21 are a two-session **atomic** decommission — do NOT remove
`update-docs` until docubot + the 5 skills are proven (9.20 is the gate).

**Merge cadence:** cherry-pick onto `main`, fetch-before-push (shared `main`).
