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

### 2c: Owning initiative → project (strategic context)

Load the owning **project** for your task so the session opens with the strategic
"why this Task matters" — not just the tactical state.

Initiatives are plain docs-site markdown, one numbered file per initiative:
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/<n>.md`. Projects sit at
**two** levels — directly under `## Projects`, and under `## Sub-initiatives` →
`- Projects:`. Check both; five of ten initiatives park every project one level down.

1. **Resolve the project first — it works with or without the frontmatter key.** The
   project is the entry whose `Linked tasks:` includes the active id:

   ```bash
   INIT_DIR="$KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers/initiatives"
   grep -rn "Linked tasks:.*\b<N>\b" "$INIT_DIR"/
   ```
2. **Resolve the initiative** from the task file's `initiative:` frontmatter. The value
   is a **slugified title**, not a string present in the initiative doc — grepping the
   slug misses (`sdlc-workflow-orchestration` → zero hits) or is ambiguous
   (`core-product` → two files). Match it against the slugified `title:` instead:

   ```bash
   SLUG=$(sed -n 's/^initiative: //p' "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md")
   for f in "$INIT_DIR"/*.md; do
     t=$(sed -n 's/^title: //p' "$f" | head -1 | tr 'A-Z ' 'a-z-')
     [ "$t" = "$SLUG" ] && echo "$f"
   done
   ```
3. **Surface**, in order: the initiative **title** + intro ("why this matters"); the
   owning sub-initiative's scope boundary, if the project sits under one; then the
   project's **[status]**, **Summary**, and sibling **Linked tasks** — the siblings are
   the work you may be about to duplicate or block.
4. **`Substrate doc`, where set, is the floor for context, not the ceiling** — confirm
   against the task file and the Decision Register before acting on it. Two live
   pointers aim into `_archive/` (initiative 4).
5. **Unowned is the common case, not the exception.** Only **126 of 354** task files
   resolve by either route — 125 by frontmatter, 80 by `Linked tasks`, none above id
   **163**. When neither resolves, state *"no owning initiative/project — unowned
   Task"* and continue; do not invent an owner or halt. Ownership backfill belongs to
   the initiatives-ledger project.

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
- **Decision register:** read the **"In force"** table in
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md` — the binding
  settled-rulings guardrail (`DR-NNN`). That page is a GENERATED index: one row per
  decision (id, date, status, one-line ruling, link). Read the table, then open only the
  individual files under `reference/decisions/` that the session actually needs — the
  continuation prompt's cited ids, plus anything the table shows touching your task's
  ground. Never read the whole `decisions/` directory.

  Below the in-force table is **"Superseded and retired"**. Skip it at session start; go
  there only when resolving a citation that isn't in the in-force table. A `DR-NNN` cited
  in a live doc but absent from the in-force table is a closed decision with a file of its
  own — read its `retired_reason` / `superseded_by` rather than assuming the citation is
  broken.

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

