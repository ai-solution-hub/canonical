---
name: start-session
description:
  Bootstraps a Knowledge Hub session: cleans git worktrees, loads context, presents the session plan from the
  continuation prompt, then chains to `workflow-orchestration` for the canonical SDLC
  flow (ID-N Task / ID-N.M Subtask lifecycle, dispatch, gating, merge cadence). Use at
  the start of every new session. Triggers on "start session", "begin session", "session
  bootstrap", "kick off the session".
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill, MCP
---

# start-session

Ensures a clean working environment, loads critical context, presents the session plan, then hands off to `workflow-orchestration` for SDLC execution.

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

- **Agent worktrees** under `.claude/worktrees/` — ephemeral worktrees created
  by `isolation: "worktree"` during sessions. These SHOULD be cleaned up
  (prune + delete merged branches).

When reporting worktree state, confirm which track the session is on before reading continuation prompts (filename
conventions differ per track until worktree collapse completes).

---

## Step 2: Read Critical Documents (parallel with Step 1)

Read these documents in parallel to load context:

### 2a: Memory recall

Mempalace MCP is the canonical memory system. Call `mempalace_diary_read`
(`agent_name: claude`, `last_n: 5-8`) for the most recent diary entries — these
recover cross-session context the continuation prompt may not surface (mode
ratifications, gotchas, build status deltas). For recall during the session,
use `mempalace_search` and `mempalace_kg_query`; any errors are transient and
should resolve on retry.

### 2b: Task-list state inspection

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

5. Proceed with outlined plan - if any adjustments are required, user will
   notify you.

---

## Step 4: Chain to workflow-orchestration

Once the session plan is presented (Step 3), invoke the `workflow-orchestration` skill via the Skill tool. That skill is the canonical SDLC workflow body — it covers the ID-N Task / ID-N.M Subtask lifecycle, the Planner / Executor / Checker / Curator dispatch protocol, sequential cherry-pick merge cadence, state machines, finding routing (in-scope fix-Executor vs out-of-scope Curator), quality gates, and failure handling. See `.claude/skills/workflow-orchestration/SKILL.md` plus its `references/` files (lifecycle-detail, dispatch-primitives, checker-output-schema, state-machines, failure-modes, skill-routing, external-references).

---

## Critical Reminders

These are the most commonly missed items across sessions:

- **`bun run test`** not `bun test` — the latter runs Bun's built-in test
  runner, not Vitest
- **`bun run build`** needs `dangerouslyDisableSandbox: true`
- **Worktree agents MUST commit to their worktree** before finishing —
  auto-cleanup destroys uncommitted work
- **Never run two sessions on the same working tree** — they destroy each
  other's untracked files
- **ALL verification gaps must be fixed** — even minor ones

