---
name: start-session
description:
  Bootstraps a Knowledge Hub session: cleans git worktrees, loads critical context
  (CLAUDE.md, mempalace diary, task-list.json), presents the session plan from the
  continuation prompt, then chains to `workflow-orchestration` for the canonical SDLC
  flow (ID-N Task / ID-N.M Subtask lifecycle, dispatch, gating, merge cadence). Use at
  the start of every new session. Triggers on "start session", "begin session", "session
  bootstrap", "kick off the session".
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill, MCP
---

# start-session

Ensures a clean working environment, loads critical context, presents the session plan, then hands off to `workflow-orchestration` for SDLC execution.

---

## When to invoke

- At the very start of every new session (chat-driven or scheduled). This is the bootstrap step — nothing else should run before it.
- After a `/clear` or context reset when the session needs to re-bootstrap mid-conversation.
- Trigger phrases: "start session", "begin session", "session bootstrap", "kick off the session".

This skill runs the four bootstrap steps below and then **chains into `workflow-orchestration`** (Step 4). It does not own the SDLC body — that lives in `workflow-orchestration` and its `references/`.

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
special attention to the "Gotchas" section — the implementation workflow itself
is owned by `workflow-orchestration` (chained from Step 4 below).

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

## Step 4: Chain to workflow-orchestration

Once the session plan is presented (Step 3), invoke the `workflow-orchestration` skill via the Skill tool. That skill is the canonical SDLC workflow body — it covers the ID-N Task / ID-N.M Subtask lifecycle, the Planner / Executor / Checker / Curator dispatch protocol, sequential cherry-pick merge cadence, state machines, finding routing (in-scope fix-Executor vs out-of-scope Curator), quality gates, and failure handling. See `.claude/skills/workflow-orchestration/SKILL.md` plus its `references/` files (lifecycle-detail, dispatch-primitives, checker-output-schema, state-machines, failure-modes, skill-routing, external-references).

Documentation updates do not happen mid-session — `/update-docs` is invoked at session close (then chains to `/handoff`).

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
