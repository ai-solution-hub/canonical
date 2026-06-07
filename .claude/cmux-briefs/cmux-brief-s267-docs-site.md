# cmux sub-orchestrator brief — S267 — docs-site (Task ID-9)

You are a **sub-orchestrator** in Knowledge Hub's parallel-cmux phase (S267). You drive
**Task ID-9** end-to-end on your own worktree branch. The parent session
(orchestrator-of-orchestrators) cherry-picks your commits back to `main` at teardown.

## First actions (orient — you are NOT stale)

You were branched from `main` HEAD `73ffb2b4` into your own worktree. Do **NOT**
`git reset --hard origin/main` (you would discard your branch). Just orient:

1. `pwd && git branch --show-current && git status` — confirm you're on
   `cmux-worker-docs-site-73ffb2b4`, clean.
2. Load the **workflow-orchestration** skill (Skill tool) — your SDLC backbone
   (Planner/Executor/Checker dispatch, state machines, commit cadence).

## Paths: RELATIVE ONLY

Always relative (`docs/...`, `docs-site/...`). Never absolute `/Users/...` (primer-effect
gotcha breaks in-worktree).

## Tooling per worktree (no symlinkDirectories)

Fresh checkout — no `node_modules`. The docs-site has its OWN package: to build/test it,
`cd docs-site && bun install && bun run build` (and `bun run test`). Root tooling
(`bun install` at repo root) only if you run root `tsc`/lint.

## Commit model: worker-branch-only

Commit incrementally on YOUR branch (workflow-orchestration cadence). Do NOT push, do NOT
touch `main`. Parent integrates via cherry-pick. Commit trailer:
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Open Questions: NEVER use AskUserQuestion (you are headless → it stalls forever)

1. Write `OQ-pending.md` at your worktree root: `## Question`, the options, **your
   provisional default**, and why.
2. Apply your provisional default and CONTINUE (non-blocking). Do NOT stop and wait.
3. The parent monitors for `OQ-pending.md` and relays overrides via prompt.

## Workflow discipline (S264/S265 load-bearing lessons)

- **Validate against INSTALLED code, not specs/assumptions** (ID-28/ID-32 each shipped
  against fictional APIs).
- **Non-vacuous acceptance criteria** — a green fixture test that never exercises real
  behaviour is worthless (ID-32 B4).
- **`bun run format` before commit**; run relevant tests before each commit.

## Skill / workflow file edits — hook policy

Authoring the 5 docs skill bodies (9.14–9.18) — invoke the **create-skill** /
**update-skill** skill (the workflow-security PreToolUse hook expects skill authoring to
go through it; the FIRST raw edit to `.claude/skills/` or `.github/workflows/` may be
blocked once with a one-time reminder — **retry succeeds**).

## Final report (before you finish)

Write `.claude/cmux-events/final-report-docs-site.yaml` (gitignored; parent reads it).
Schema:
`{summary, commits:[sha+msg], subtask_dispositions, OQs_for_parent, next_session_handoff}`.
Keep a stdout summary too.

## Ledger (task-list.json) updates

Flip ONLY ID-9's subtask statuses + append `<info added on …>` journal blocks to subtask
`details`. Task `dependencies` = STRINGS, subtask `dependencies` = NUMBERS (asymmetric —
don't coerce). Tasks have NO `details` field. Keep edits scoped to ID-9's records (4
terminals share this file).

---

## YOUR TASK: ID-9 — Astro+Starlight docs site + Warp docubot port + decommission /update-docs

Status `in_progress`, priority `must`. Spec chain {9.1–9.4} DONE. **Phase 1–2 impl DONE**
(9.5 scaffold, 9.6 sync script + manifest, 9.7 Warm Meridian theming + token-drift guard,
9.8 AI-invisibility + UK-English + 404 guards, 9.9 AGENTS.md, 9.10 keep-docs-in-sync
skill).

**RESUME at 9.11.** Read full subtask details in `docs/reference/task-list.json` (ID-9) +
the ratified specs. Remaining:

- **9.11** Docubot composite action + KH-persona prompt template (VERBATIM per TECH
  §3.3) + secrets contract
- **9.12** Docubot workflow + Claude Agent SDK driver
- **9.13** 5-skill canonical workflow scaffold + shared driver
  (`scripts/skills/run-skill.ts`)
- **9.14–9.18** five skill bodies + workflows: review-docs-pr, sync-source-docs,
  missing-docs, check-for-broken-links, docs-seo-audit (docs-seo-audit cron commented per
  OQ-T3)
- **9.19** ci.yml regenerate-stats job (decommission glue)
- **9.20** Session A decommission verification gate
- **9.21** Session B atomic decommission: remove `.claude/skills/update-docs/` + CLAUDE.md
  atomic edit (Inv-49/50)
- **9.22** `docs-site/package.json`: gray-matter devDeps→deps
- **9.23** astro check title front-matter gap (sync-content.ts H1/filename)
- **9.24** Convert docs-site E2E Vitest shape tests → Playwright

### Canonical refs (read in-worktree, do NOT reproduce here)

- `docs/specs/id-9-astro-starlight-docs-foundation/PLAN.md` — 17-subtask decomposition, 5
  phases
- `docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md` — 52 numbered invariants
- `docs/specs/id-9-astro-starlight-docs-foundation/TECH.md` — 1-to-1 mapping; **KH-persona
  prompt template body is at §3.3 (embed VERBATIM, it is not a reference)**
- `AGENTS.md` (repo root, shipped 9.9) + `.claude/skills/keep-docs-in-sync/` (shipped
  9.10)

### Critical locks (do NOT violate)

- **9.21 decommission is GRADUAL 2-session** (Inv-47–50): 9.20 Session A gate verifies
  docubot narrative faithfulness FIRST; only 9.21 Session B deletes `/update-docs`. Do NOT
  delete `/update-docs` before the 9.20 gate passes. If you can't complete the 2-session
  sequence cleanly this session, ship 9.11–9.20 and **leave 9.21 for a verified Session
  B** (flag in final report).
- Docubot writes **DIRECTLY to docs-site** (Inv-18/30); `kh_docubot_owned: true`
  front-matter flag for divergence (OQ-T1 ratified).
- Canonical 5-skill workflow shape (Inv-43): ONE workflow template, ONE driver
  (`run-skill.ts --skill` flag), ONE upload-artifact contract.
- Vercel-default-subdomain framing (no `docs.kh.client.example` prescriptive refs).

### Files (your ownership boundary)

`docs-site/`,
`.github/workflows/{docubot,review-docs-pr,sync-source-docs,missing-docs,check-for-broken-links,docs-seo-audit}.yml`,
`.claude/skills/{review-docs-pr,sync-source-docs,missing-docs,check-for-broken-links,docs-seo-audit}/`,
`scripts/skills/`, `ci.yml` (9.19 ONLY — append the regenerate-stats job; do NOT touch
other jobs — the parent owns ci.yml integration), `CLAUDE.md` (9.21 atomic edit only).
