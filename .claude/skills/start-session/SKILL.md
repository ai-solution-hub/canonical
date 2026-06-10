---
name: start-session
description:
  Bootstraps a Knowledge Hub session: cleans git worktrees, loads context, presents the session plan from the
  continuation prompt, then chains to `workflow-orchestration` for the canonical SDLC
  flow (ID-N Task / ID-N.M Subtask lifecycle, dispatch, gating, merge cadence). Use at
  the start of every new session.
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

## Step 1b: GitNexus Baseline

Refresh the code-intelligence index at session start so the sub-orchestrator(s) — and any
in-tree (non-isolation) sub-agents — query a current graph rather than the
previous session's:

```bash
npx gitnexus analyze    # minutes; rebuilds .gitnexus/lbug for the primary tree
```

Notes:

- A stale-index warning on every commit is expected (the post-commit hook
  compares the index to the new HEAD). Re-run `analyze` only before a genuinely
  code-heavy wave — not per doc/ledger commit.

---

## Step 2: Read Critical Documents (parallel with Step 1)

Surface the current live production domain (per-deploy config, never tracked in source): `grep '^APP_URL' .env.local`

Read these documents in parallel to load context:

### 2a: Memory recall

Call `mempalace_diary_read` (`agent_name: claude`, `last_n: 2`) for the most recent diary entries. For recall during the session, use `mempalace_search` and `mempalace_kg_query`; any errors are transient and should resolve on retry.

### 2b: Task-list state inspection

Read `docs/reference/task-list.json` at session start where a task whose `session_refs[]` includes the previous
  session — these are recently-closed records; their `<info added on …>`
  journal blocks (PRODUCT inv 13) surface what shipped, commit SHAs, and any
  in-flight discoveries the previous Executor / Checker left behind that may
  have been omitted from the continuation prompt.

### 2c: Sandbox / allowlist carryover

Read the prior handoff's `Sandbox / allowlist carryover` section and surface it at
session start — apply any allowlist candidates and be aware of commands that will
need `dangerouslyDisableSandbox` (e.g. the documented `next build` Turbopack
sandbox failure).

### 2d: GitHub tooling

Use `gh-axi` (not raw `gh`) for any GitHub operation this session — pre-aggregated
CI rollups + structured error translation; `gh-axi api` is the raw-API escape hatch
(ID-92, see CLAUDE.md).

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

Once the session plan is presented, invoke the `workflow-orchestration` skill via the Skill tool, to begin session orchestration.

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones
- **NEVER prefix a Bash command with `cd /Users/.../knowledge-hub`** (or any absolute cd
  into the repo root) — this applies to the MAIN session, not just worktree agents. You
  are already in the repo CWD. Use paths relative to CWD, or `git -C <path>` flags. A
  PreToolUse guard hard-blocks `cd <repo-root>` to stop wrong-branch commit leakage; each
  block costs a full retry round-trip. Carry this rule into every brief you compose this
  session. (Friction register FR-001 — permanent rule, not a per-handoff carryover.)

