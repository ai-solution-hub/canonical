---
name: start-session
description:
  Bootstraps a Canonical (Formerly Knowledge Hub) session: cleans git worktrees, loads context, and presents the session plan from the continuation prompt. Use at the start of every new session.
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill, MCP
---

# start-session

Ensures a clean working environment, loads critical context, and presents the session plan.

---

## Step 1: Git Hygiene (parallel)

Survey stale worktrees and branches from previous sessions:

```bash
git worktree prune      # clears only deleted dirs
git status              # verify clean working tree
git worktree list       # named worktrees survive prune and accumulate
```

NB: this repo integrates worktree branches by **cherry-pick, never merge** — so
`git branch --merged main` will never match a landed worktree branch. Do not use
merge status to decide deletions; check whether a branch's commits landed with
`git cherry main <branch>` (empty/`-` lines = landed).

For each named worktree under `.claude/worktrees/` not referenced by the
continuation prompt or an active parallel session: check `git -C <wt> status
--porcelain`, salvage any untracked/modified files worth keeping, then
`git worktree remove <wt>` and delete its branch once its commits are confirmed
landed. Ask the user only when a worktree is dirty and its purpose is unclear.

---

## Step 1b: GitNexus Baseline (conditional)

Refresh the code-intelligence index **only before a genuinely code-heavy wave** —
spec-authoring / docs / ledger sessions skip this step:

```bash
bun run gitnexus:analyze    # minutes; rebuilds the index for the primary tree
```

Notes:

- A stale-index warning on every commit is expected (the post-commit hook
  compares the index to the new HEAD). Never re-run per doc/ledger commit.

---

## Step 2: Read Critical Documents (parallel with Step 1)

Read these documents in parallel to load context. **Load anchor first** — `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/platform-context.md` (current operational facts: four-DB topology, deploy hosts, key anchors; follow its progressive-disclosure pointers for depth).

### 2a: Memory recall

Run recall via `mempalace_search` / `mempalace_kg_query` per the `recall-grounding` skill, **seeded with the continuation-prompt-named task ids and titles**. Search **without** a `wing` filter and filter client-side.

**Fail open:** if the palace errors (e.g. `MCP error -32002` integrity-check refusal), tell the user memory is degraded and proceed. The lock-free FTS read survives index corruption; run it manually with your seed terms:

```bash
sqlite3 "file:$HOME/.mempalace/palace/chroma.sqlite3?mode=ro&immutable=1" \
  "SELECT substr(replace(string_value, char(10),' '),1,200) FROM embedding_fulltext_search
   WHERE string_value MATCH '<id-145 OR okf OR …>' AND string_value NOT LIKE 'CHECKPOINT:%'
   ORDER BY rowid DESC LIMIT 8"
```

### 2b: Task-list state inspection (slice reads ONLY)

Inspect recently-active task records via the ledger CLI — **never Read the
ledger JSON files wholesale** (task-list.json is multi-MB; full reads burn
context for nothing):

```bash
bun scripts/ledger-cli.ts show task <id>            # one task record (size-shaped ≤48KB; --full for verbatim)
bun scripts/ledger-cli.ts get task <id> <field>     # one field (e.g. status_note)
bun scripts/ledger-cli.ts get task <id>.<subId>     # one subtask directly (no whole-task fetch)
```

**Field-selection rule:** for a Subtask the continuation
prompt names, read the field the prompt points at first. Absent a pointer:
`journal <id>.<sub>` for narrative state, `get <id>.<sub> details` for the spec
brief, `get <id> status_note` for the task-level rollup. Skip `show task <id>`
entirely when the prompt already summarises the task — go straight to the named
journal (`show`'s journal behaviour is size-dependent: stubbed on large tasks,
inlined on small ones — don't rely on it for the thread).

NB: For viewing multiple backlog items use the following approach - no prefix required (e.g., BL-, bl-):

`Bash(for id in 323 324 304; do echo "==================== $id ===================="; bun scripts/ledger-cli.ts get backlog $id 2>&1; echo; do…)`

### 2c: GitHub tooling

Use `gh-axi` (not raw `gh`) for any GitHub operation this session — pre-aggregated
CI rollups + structured error translation; `gh-axi api` is the raw-API escape hatch.

### 2d: Owning-initiative strategic context

For each active Task surfaced in 2b, load the owning **Initiative / Project** so the
session opens with the strategic "why this Task matters" — not just the tactical state.

The strategic ledger is
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives.json`.

1. **Resolve the owning Project** by finding which project's `linked_tasks[]` contains
   the active Task id (`bun scripts/ledger-cli.ts list projects`)
2. **Surface** the initiative + project **titles**, the project **status**, and the
   **description/summary** ("why this Task matters"). If `substrate_doc` is set, it is
   the floor for the initiative's latest context, not the ceiling — confirm against the
   task mirrors and the Decision Register before acting on it.
3. **No owning project → explicit note** — *"no owning project — operational Task"*.

### 2e: Settled-state read-back (retros + decision register)

Load the durable settled state the deltas-only prompt omits:

- **Retros:** `bun scripts/ledger-cli.ts list retro --recent 3` returns ids only
  (`{id,date,track}`) — then `show retro <id>` per id to get the fields. Surface
  `unresolved_questions`, `workflow_improvements`, `failed_assumptions`.
- **Decision register:** read the in-force (`accepted`) entries from
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md` — the binding
  settled-rulings guardrail (`DR-NNN`). The file has no CLI slice — grep the
  `DR-` headings (plus the newest ids the continuation prompt cites) rather than reading
  it wholesale.

---

## Step 3: Review Continuation Prompt and Confirm Session Plan

```bash
ls -1 ${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt thoroughly
2. Identify the session objectives
3. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {parallel subagents (conditional), dependencies}

5. Proceed with outlined plan - if any adjustments are required, user will notify you.

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones.

