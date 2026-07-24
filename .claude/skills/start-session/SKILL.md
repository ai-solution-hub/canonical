---
name: start-session
description:
  Bootstraps a Canonical (Formerly Knowledge Hub) session: loads context, and presents the session plan from the continuation prompt. Use at the start of every new session.
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill, MCP
---

# start-session

Loads critical context, and presents the session plan.

---

## Step 1: Review Continuation Prompt

```bash
ls -1 ${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt thoroughly
2. Identify the session objectives

## Step 2: Read Critical Documents

Read these documents in parallel to load context. **Load anchor first** — `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/platform-context.md` (current operational facts: four-DB topology, deploy hosts, key anchors; follow relevant progressive-disclosure pointers for depth).

### 2a: Memory recall

Run recall via `mempalace_search` / `mempalace_kg_query` per the `recall-grounding` skill, **seeded with the continuation-prompt-named task ids and titles**. Search **without** a `wing` filter and filter client-side.

**Fail open:** if the palace errors, use the lock-free FTS; run it manually with your seed terms:

```bash
sqlite3 "file:$HOME/.mempalace/palace/chroma.sqlite3?mode=ro&immutable=1" \
  "SELECT substr(replace(string_value, char(10),' '),1,200) FROM embedding_fulltext_search
   WHERE string_value MATCH '<id-145 OR okf OR …>' AND string_value NOT LIKE 'CHECKPOINT:%'
   ORDER BY rowid DESC LIMIT 8"
```

### 2b: Task state inspection (ordna task files)

Inspect recently-active tasks straight from the ordna task files — **prefer a
plain file read; no CLI needed** (`tasks/id-N.md` is one small markdown file per
task, YAML frontmatter + body):

```bash
cat "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md"                     # one task, frontmatter + body
cd "$KH_PRIVATE_DOCS_DIR" && ordna list -s doing               # what's in flight
cd "$KH_PRIVATE_DOCS_DIR" && ordna show <id>                   # frontmatter + body to stdout
```

**Config context:** ordna is bound to the docs-site root — there is no `--cwd`
flag, so `cd "$KH_PRIVATE_DOCS_DIR"` before any verb. Use **non-interactive
verbs only** (`list`/`show`/`cat`); bare `ordna` / `ordna board` opens the Kanban
TUI and hangs a background shell (same class as `supabase db push`). Full
conventions: `${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md`.

**Field-selection rule:** for a Subtask the continuation prompt names, read the
`## Subtasks` → `### {N.M}` block first. Absent a pointer: `## Progress` (the
append-only journal) for narrative state, the `## Subtasks` block for the spec
brief, frontmatter `status` + `status_note` for the task-level rollup.

### 2c: Owning-initiative strategic context

Load the owning **Initiative** for your task so the session opens with the
strategic "why this Task matters" — not just the tactical state.

Initiatives left the ledger system — they are now plain docs-site markdown at
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/`.

1. **Resolve the owner directly** from the task file's `initiative:` frontmatter
   slug — no reverse `linked_tasks[]` lookup any more
   (`grep -n '^initiative:' "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md"`).
2. **Read the matching initiative doc** (small numbered set — resolve the slug via
   `grep -rl "<slug>" "$KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers/initiatives/"`).
   Surface the initiative **title** + intro ("why this matters") and the
   `## Projects` entry (**status** + **summary**) whose **Linked tasks** include the
   active id. If `substrate_doc` is set it is the floor for the initiative's latest
   context, not the ceiling — confirm against the task file and the Decision Register
   before acting on it.
3. **No `initiative:` key → explicit note** — *"no owning initiative — operational
   Task"*.

### 2d: Settled-state read-back (one-time retro review + decision register)

Load the durable settled state the deltas-only prompt omits. This is a **one-time
read at session open**, not a per-turn ritual.

- **Retros — one-time review first.** Retros left the ledger too: one plain
  markdown file per session at
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros/S<NNN>.md`
  (session-numbered). Read the most recent **once** at session open:

  ```bash
  ls -1 ${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros/S*.md | sort -V | tail -3
  ```

  then read those files and surface the durable sections — **Unresolved
  questions**, **Workflow improvements**, **Failed assumptions**, **Architecture
  decisions**. Don't re-read them each turn; this is the single settled-state pass.
- **Decision register:** read the in-force (`accepted`) entries from
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md` — the binding
  settled-rulings guardrail (`DR-NNN`). Plain markdown, no CLI slice — grep the
  `DR-` headings (plus the newest ids the continuation prompt cites) rather than reading
  it wholesale.

---

## Step 3: Confirm Session Plan

1. Re-read the continuation prompt:

```bash
ls -1 ${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-*.md 2>/dev/null | sort -V | tail -2
```

2. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {parallel subagents (conditional), dependencies}

3. Proceed with outlined plan - if any adjustments are required, user will notify you.

---

## Step 4: GitNexus Baseline (conditional)

Refresh the code-intelligence index **only before a genuinely code-heavy wave** —
spec-authoring / docs / ledger sessions skip this step:

```bash
bun run gitnexus:analyze    # minutes; rebuilds the index for the primary tree
```

Notes:

- A stale-index warning on every commit is expected (the post-commit hook
  compares the index to the new HEAD). Never re-run per doc/ledger commit.

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones.
- **Use `gh-axi` (not raw `gh`) for any GitHub operation this session** — pre-aggregated
CI rollups + structured error translation; `gh-axi api` is the raw-API escape hatch.

