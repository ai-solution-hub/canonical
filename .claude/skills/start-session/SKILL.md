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

---

## Step 1b: GitNexus Baseline (run before any code-heavy wave / sub-agent dispatch)

Refresh the code-intelligence index at session start so the Orchestrator — and any
in-tree (non-isolation) sub-agents — query a current graph rather than the
previous session's:

```bash
npx gitnexus analyze    # minutes; rebuilds .gitnexus/lbug for the primary tree
```

Notes (important — the naive "push the baseline" model does NOT work):

- The index (`.gitnexus/lbug`, ~270 MB) is **gitignored and local**
  (`.gitnexus/**` is ignored except `!.gitnexus/CLAUDE.md`). It does **not**
  propagate to git worktrees via commit/push, so cherry-picked sub-agent
  worktrees start with a stale/absent index — this is the root of the
  "stale (never) in every worktree" friction.
- Until the worktree index-seeding mechanism lands (tracked under ID-27
  `{27.5}` + `backlog-190`), a **code-touching** dispatch brief into an
  isolated worktree must either (a) instruct the worker to run
  `npx gitnexus analyze` first, or (b) accept that gitnexus tools report stale
  in that worktree and instead lean on `gitnexus_context` / `gitnexus_impact`
  run from the primary tree at dispatch-authoring time.
- A stale-index warning on every commit is expected (the post-commit hook
  compares the index to the new HEAD). Re-run `analyze` only before a genuinely
  code-heavy wave — not per doc/ledger commit.

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

- Read Tasks whose `session_refs[]` includes the previous
  session — these are recently-closed records; their `<info added on …>`
  journal blocks (PRODUCT inv 13) surface what shipped, commit SHAs, and any
  in-flight discoveries the previous Executor / Checker left behind that may
  have been omitted from the continuation prompt.

---

## Step 3: Review Continuation Prompt and Confirm Session Plan

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt thoroughly
2. Read any referenced tasks to gain an understanding of current state
3. Identify the session objectives
4. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {terminal sessions, parallel subagents (conditional), dependencies}

5. Proceed with outlined plan - if any adjustments are required, user will
   notify you.

---

## Step 4: Chain to workflow-orchestration

Once the session plan is presented (Step 3), invoke the `workflow-orchestration` skill via the Skill tool. That skill is the canonical SDLC workflow body — it covers the ID-N Task / ID-N.M Subtask lifecycle, the Planner / Executor / Checker / Curator dispatch protocol, sequential cherry-pick merge cadence, state machines, finding routing (in-scope fix-Executor vs out-of-scope Curator), quality gates, and failure handling. See `.claude/skills/workflow-orchestration/SKILL.md` plus its `references/` files (lifecycle-detail, dispatch-primitives, checker-output-schema, state-machines, failure-modes, skill-routing, external-references).

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones

