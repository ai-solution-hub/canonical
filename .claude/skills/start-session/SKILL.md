---
name: start-session
description:
  Run at the start of every new session. Cleans up git worktrees, reads critical
  documents, then plans the session based on the continuation prompt and/or user feedback. Triggers on
  "start session".
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill, MCP
---

# start-session

Ensures a clean working environment, loads critical context, and plans the session before any implementation work begins.

---

## Step 1: Git Hygiene (parallel)

Run these commands to clean up stale worktrees and branches from previous
sessions:

```bash
# Prune orphaned worktrees
git worktree prune

# Delete merged worktree branches
git branch --merged main | grep worktree | xargs -r git branch -d

# Count remaining worktree branches (informational)
git branch | grep worktree | wc -l

# Verify clean working tree
git status
```

If unmerged branches exist, deploy an agent to investigate whether they should be merged or
deleted.

**Parallel track worktrees vs agent worktrees:** The project may have two types
of worktrees:

- **Top-level track worktrees** — long-lived worktrees for parallel development
  tracks. These have their own continuation prompts and are NOT cleaned up
  between sessions. Do not delete or prune these. Discover them with `git worktree list`; the branches are typically `production-readiness` and `kh-knowledge-platform` (plus `main`).

  Per Q-COUNTER-1 ratification the session counter is now a **single global
  counter** (`kh-sNNN`); the track-prefixed scheme (`kh-prod-readiness-sN`) is
  retired and filename suffix on the continuation prompt conveys track identity
  until worktree collapse completes (B3). Per Q-WORKTREES-2, per-track primer
  docs (`docs/tracks/*.md`) are retired — any persisting context promotes to
  CLAUDE.md or a per-Task `task-list.json` Task description.

- **Agent worktrees** under `.claude/worktrees/` — ephemeral worktrees created
  by `isolation: "worktree"` during sessions. These SHOULD be cleaned up
  (prune + delete merged branches).

When reporting worktree state, confirm which track the session is on before reading continuation prompts (filename
conventions differ per track until worktree collapse completes).

---

## Step 2: Read Critical Documents (parallel with Step 1)

Read these documents in parallel to load context:

### 2a: CLAUDE.md

```
Read file: CLAUDE.md
```

This contains commands, architecture, schema, gotchas, and conventions. Pay
special attention to the "Gotchas" section — the implementation workflow is
covered in Step 4 below.

### 2b: Memory recall

Mempalace MCP is the canonical memory system. Call `mempalace_diary_read`
(`agent_name: claude`, `last_n: 5-8`) for the most recent diary entries — these
recover cross-session context the continuation prompt may not surface (mode
ratifications, gotchas, build status deltas). For recall during the session,
use `mempalace_search` (default wing — wing-filter still errors per CLAUDE.md
mempalace section) and `mempalace_kg_query`; any errors are transient and
should resolve on retry.

### 2c: Task-list state inspection

Read `docs/reference/task-list.json` at session start. The task-list is the
canonical **traceability + observability** surface — active AND recently-closed
Tasks live here. Subtask state machine (per `kh-sdlc-workflow.md` §6.3) is the
record of what shipped, NOT a per-session test/check artefact.

- Identify Tasks with status `in_progress` (carry-forward from previous
  session) and `pending` (next-wave candidates).
- Read Tasks with status `done` whose `session_refs[]` includes the previous
  session — these are recently-closed records; their `<info added on …>`
  journal blocks (PRODUCT inv 13) surface what shipped, commit SHAs, and any
  in-flight discoveries the previous Executor / Checker left behind that may
  have been omitted from the continuation prompt.
- Verify the `last_updated` field date aligns with the previous session's
  close-out.
- Tasks are removed only when `cancelled` or reclassified (e.g. promoted to
  backlog); `done` Tasks stay in place.

Per Q3 ratification the previous STATUS-change-log workflow is retired — the
canonical session-state recording mechanism is now `task-list.json` field
updates + Subtask journal blocks + the mempalace diary entry. See "Mempalace
diary entry shape" below.

---

## Step 3: Review Continuation Prompt and Confirm Session Plan

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt for your repo thoroughly
2. Read any referenced specs in full before planning implementation
3. Identify the session objectives and work packages
4. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Work packages:** {list WPs with priority}
>
> **Execution strategy:** {wave structure, parallel agents, dependencies}
>
> **Estimated scope:** {hours of work}

5. Note any skills which will be relevant to you for your tasks this session, or which should be provided to
   subagents based on their respective tasks e.g., `/writing-product-spec` and `writing-tech-spec` if
   a WP requires a new spec, `/planning-and-task-breakdown` if a spec requires
   decomposing to tasks, `/code-simplification` then `/code-review-and-quality` if implementation work is being
   adversarially reviewed, `/documentation-and-adrs` for documentation-related
   tasks, `/supabase-postgres-best-practices` for database tasks, `/playwright-best-practices` for E2E test tasks, and so on.

6. Proceed with outlined plan - if any adjustments are required, user will
   notify you.

---

## Implementation Workflow (MUST FOLLOW)

This is the core execution discipline for the project. Every implementation must
follow this workflow.

### Agent Work Limits

- **Max 2 hours of work per agent** — never let one agent complete an entire
  multi-phase spec without a verification gate. If a spec/plan is estimated at
  more than 2 hours, split it between sequential agents with verification
  between each stage.

### Agent Skills

When deploying the agent make it clear which skill they should be invoking
based on the task(s) they will be assigned.

### Verification Gates

After EVERY implementation and spec/plan-writing agent completes, deploy a
**separate verification agent** before merging. This is not optional. The
verification agent must:

1. Read the spec/plan requirements for the implemented work
2. Read the implementation code
3. Check spec/plan compliance — are all requirements met?
4. Review code quality — semantic tokens, UK English, auth patterns, error
   handling
5. Check test quality — tests MUST verify real behaviour, NOT test the implemenation
6. Return a verdict: **PASS** / **PASS WITH NOTES** / **FAIL**

**Fix ALL verification findings** (including minor/low severity) before merging.
Deploy a fix agent for any findings, no matter the severity. Not integrating all
findings creates unneccessary technical debt that can be easily avoided by doing
things right the first time.

### Wave Structure

1. **Wave N implementation:** Launch parallel worktree agents (strict file
   ownership, no overlap)
2. **Wave N verification:** Deploy verification agents after all implementation
   agents complete
3. **Wave N fix:** Fix any findings from verification
4. **Wave N merge:** Merge worktrees sequentially, run full test suite after
   each merge
5. Proceed to Wave N+1 only after current wave is merged and green

### Documentation

Documentation will be updated at the end of the session when `/update-docs` is
invoked. There is no requirement to update reference documentation (roadmap,
state-of-the-product, etc.) throughout the session.

---

## Mempalace diary entry shape

Diary entries written at session close (typically by `/handoff` skill, or
manually if `/handoff` skipped) provide cross-session recall via the AAAK
convention. Consistency across entries lets `mempalace_search` surface
historical decisions reliably.

**Required structure** (passed via `mempalace_diary_write`):

- `agent_name`: `claude` (single wing for the assistant across all KH work).
- `topic`: one of `kh-prod-readiness-SNN` / `main-track` / `workflow-orchestration`
  / `general` — names the session's primary focus.
- `content`: pipe-separated facts in this order:
  1. `SESSION:YYYY-MM-DD.SXX` — date + session counter.
  2. Top-line summary (one segment).
  3. Per-WP segments — each summarising what shipped, key files touched,
     ratifications applied, gotchas surfaced.
  4. Build status (`test.baseline.N.pass/N.fail/N.skip`).
  5. Push refs (`push:short-sha1+short-sha2`).
  6. Forward-look (`SXX+1.continuation.<bullet count>.lines.<WP count>.WPs`).
  7. `★rating` — 1–5 ★ self-assessment of session quality (writer's call;
     ★★★★+ for clean shipping sessions, ★★★ for sessions with workarounds,
     ★★ for partially-blocked sessions).

**Length**: ~600–1500 chars. One logical event per pipe-delimited segment.
Use entity codes (e.g. `WP1.work-status.ts`) and emotion markers (e.g.
`.✓` / `.fail`) for AAAK-compatible search.

**Example** (from S50 close):

```
SESSION:2026-05-18.S50|surface.migration.impl.complete.24commits.production-readiness|WP0.spec.re-ratification.drop.aliases+unified.WorkStatus+Priority.master.enums|WP1.work-status.ts+task-list-schema.ts+task-list.json.dogfood.Tasks.2-5.seeded|...|test.baseline.12546.pass.1.fail.FU-9.only.24.skip|S51.continuation.298.lines.5.WPs|★★★★
```

**Cross-session recall**: `mempalace_search` for the default wing works as of
mempalace 3.3.5 (verified S43 W1); wing-filter still errors per CLAUDE.md
mempalace gotcha section — workaround is search default + filter results
client-side by `wing` field.

---

## Critical Reminders

These are the most commonly missed items across sessions:

- **`bun run test`** not `bun test` — the latter runs Bun's built-in test
  runner, not Vitest
- **`bun run build`** needs `dangerouslyDisableSandbox: true`
- **Worktree agents MUST commit to their worktree** before finishing —
  auto-cleanup destroys uncommitted work
- **Merge worktrees sequentially**
- **Never run two sessions on the same working tree** — they destroy each
  other's untracked files
- **ALL verification gaps must be fixed** — even minor ones
- **Semantic tokens only** — never raw Tailwind colours in components
- **UK English throughout** — DD/MM/YYYY, colour, organisation
