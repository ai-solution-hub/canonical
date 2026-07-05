---
name: start-session
description:
  Bootstraps a Canonical (Formerly Knowledge Hub) session: cleans git worktrees, loads context, presents the session plan from the
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

# List NAMED worktrees (git worktree prune only clears deleted dirs — named
# worktrees from prior sessions survive and accumulate)
git worktree list
```

If unmerged branches exist, deploy an agent to investigate whether they should be merged or
deleted.

For each named worktree under `.claude/worktrees/` not referenced by the
continuation prompt or an active parallel session: check `git -C <wt> status
--porcelain`, salvage any untracked/modified files worth keeping, then
`git worktree remove <wt>`. Ask the user only when a worktree is dirty and its
purpose is unclear.

---

## Step 1b: GitNexus Baseline

Refresh the code-intelligence index at session start:

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

Read these documents in parallel to load context. **Load anchor first** — `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/platform-context.md` (current operational facts: four-DB topology, deploy hosts, key anchors; follow its progressive-disclosure pointers for depth).

### 2a: Memory recall

Call `mempalace_diary_read` (`agent_name: claude`, `last_n: 2`) — skip `CHECKPOINT:` auto-noise rows, read the narrative entries. Then run **branch + active-task-seeded** recall via `mempalace_search` / `mempalace_kg_query` per the `mempalace-recall` skill. Search **without** a `wing` filter (upstream #1665) and filter client-side; if vector search errors, the lock-free `mode=ro` sqlite FTS read is the fallback.

### 2b: Task-list state inspection (slice reads ONLY)

Inspect recently-active task records via the ledger CLI — **never Read the
ledger JSON files wholesale** (task-list.json is multi-MB; full reads burn
context for nothing):

```bash
bun scripts/ledger-cli.ts show task <id>            # one task record (size-shaped ≤48KB; --full for verbatim)
bun scripts/ledger-cli.ts get task <id> <field>     # one field (e.g. status_note)
bun scripts/ledger-cli.ts get task <id>.<subId>     # one subtask directly (no whole-task fetch)
```

For tasks referenced by the continuation prompt, the `<info added on …>` journal
blocks (PRODUCT inv 13) surface what shipped, commit SHAs, and any in-flight
discoveries the previous Executor / Checker left behind. A bare `show` now stubs
those blocks on large tasks to keep the payload under 48KB, so read the thread
explicitly via `journal <id>.<subId>` (or `journal <id>` for the per-subtask
index); `--full` opts `show` out of the valve. Prefer `get … details` /
`get … status_note` over `show` for large done tasks.

NB: For viewing multiple backlog items use the following approach - no prefix required (e.g., BL-, bl-):

`Bash(for id in 323 324 304; do echo "==================== $id ===================="; bun scripts/ledger-cli.ts get backlog $id 2>&1; echo; do…)`

### 2c: Sandbox / allowlist carryover

Read the prior handoff's `Sandbox / allowlist carryover` section and surface it at
session start — apply any allowlist candidates and be aware of commands that will
need `dangerouslyDisableSandbox` (e.g. the documented `next build` Turbopack
sandbox failure).

### 2d: GitHub tooling

Use `gh-axi` (not raw `gh`) for any GitHub operation this session — pre-aggregated
CI rollups + structured error translation; `gh-axi api` is the raw-API escape hatch
(ID-92, see CLAUDE.md).

### 2e: Owning-theme strategic context

For each active Task surfaced in 2b, load the **owning roadmap theme** so the session
opens with the strategic "why this Task matters" — not just the tactical task state.

1. **Resolve the owning theme(s).** Read the active Task(s) `capability_theme` field (the
   optional back-link to a roadmap theme `id`) via `bun scripts/ledger-cli.ts show roadmap <themeId>`.
2. **Surface only theme title + current intent.** From the relevant theme records, surface the
   theme **title** and its **current intent** (`description` — "why this Task matters").
3. **Unset / operational Task → explicit no-op note.** If the active Task has **no**
   `capability_theme` (unset or operational), emit an **explicit** note —
   *"no owning theme — operational Task"* — rather than a silent skip. Never fall back to
   reading the full roadmap.
4. **Surface the owning umbrella (cross-Task initiative).** A Task may also belong to a
   strategic *umbrella* (the Linear-initiative analogue) alongside its roadmap theme.
   Resolve it by finding which umbrella's `task_ids[]` contains the active Task id in
   `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/umbrellas.json` — a small curated file,
   safe to `Read` wholesale (unlike task-list.json) — and surface that umbrella's `title` +
   `substrate_doc` so the brief carries the cross-Task framing. Emit nothing if no umbrella
   lists the Task.

### 2f: Reconciliation sweep (prompt-independent)

Reconcile against the ledger so the session never re-flags or re-implements settled work:

```bash
bun scripts/ledger-cli.ts list task --status in_progress
bun scripts/ledger-cli.ts list task --status done --since <lastSessionDate>   # date of the prior retro/handoff
```

Done-status is a **don't-re-flag signal ONLY** — never import done-task `details` as current
truth (**DR-002**). Archived done-tasks are CLI-invisible; non-archived done-tasks are
visible but stale. Cross-check the sweep against the continuation-prompt-named ids.

### 2g: Settled-state read-back (retros + decision register)

Load the durable settled state the deltas-only prompt omits:

- **Retros:** `bun scripts/ledger-cli.ts list retro --recent 3` → surface `unresolved_questions`,
  `workflow_improvements`, `failed_assumptions`. Do NOT present `workflow_improvements` as
  ratified — they are observations, not rulings.
- **Decision register:** read the in-force (`accepted`, non-superseded) entries from
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md` — the binding
  settled-rulings guardrail (`DR-NNN`). Surface titles + one-line rulings; do **not** dump the
  whole file. These hold until superseded; honour them when planning.

---

## Step 3: Review Continuation Prompt and Confirm Session Plan

```bash
ls -1 ${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt thoroughly
2. Read any referenced tasks to gain an understanding of current state
3. Identify the session objectives
4. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {cmux terminal sessions, parallel subagents (conditional), dependencies}

5. Proceed with outlined plan - if any adjustments are required, user will notify you.

---

## Step 4: Chain to workflow-orchestration

Once the session plan is presented, invoke the `workflow-orchestration` skill via the Skill tool, to begin session orchestration.

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones
- **NEVER prefix a Bash command with **`cd`**; use relative paths or `git -C <path>`, and carry this rule into every brief you compose this session.

