---
name: start-session
description: >-
  Bootstraps a Canonical (Formerly Knowledge Hub) session: loads context, and presents the
  session plan from the continuation prompt. Use at the start of every new session.
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill
---

# start-session

Loads critical context, and presents the session plan.

---

## Step 1: Review Continuation Prompt

The newest file is the one to read — it is the previous session's hand-off:

```bash
ls -1 ${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-*.md 2>/dev/null | sort -V | tail -1
```

1. Read that prompt thoroughly (`tail -2` if you need the one before it as
   context for a carry item — not by default; it is a whole extra file)
2. Identify the session objectives

## Step 2: Read Critical Documents

Docs-site paths below are relative to `${KH_PRIVATE_DOCS_DIR}/src/content/docs/` unless
written out in full.

**Context load is this skill's real cost, so the read set is gated, not blanket.**
Run the always-rows in parallel; run a gated row only when its condition holds:

| Read | When |
| --- | --- |
| `reference/platform-context.md` + its Evidence precedence section | Always — the anchor |
| A **Key context anchors** row | Only when the session's task touches that anchor's ground |
| 2a Memory recall | Always, but usually skipped or narrowed at open — see 2a |
| 2b Task state | Always, for the ids the continuation prompt names |
| 2c Owning initiative → project | Spec-chain work, a promote, or new work. Skip when the prompt already names the project |
| 2d Settled state | Always — newest retro in full, older ones as headlines |

**Load anchor first** — `reference/platform-context.md` (current operational facts:
four-DB topology, deploy hosts, key anchors; follow relevant progressive-disclosure
pointers for depth).

**Read its `## Evidence precedence — docs outrank code` section in full, and treat it as
binding for the session.** Ratified docs are the authority; code is evidence of what
exists, never of what is correct. **But not every doc in the site is a ratified doc** —
read that section's `### Not every doc is a north-star doc` sub-block too: it names the
stale families (`intended-architecture/` bar `01-vision.md`, `phase-0-investigation/`,
specs for task ids below ~130) and the read-never-written discriminator. Citing a stale
doc is the same error as citing the code. Carry the precedence rule into **every sub-agent
dispatch brief**: a brief citing only task files, specs and code reproduces the codebase's
errors.

Then open the **Key context anchors** table and read every anchor whose ground the
session's task touches — mandatory for a task on that ground, skipped otherwise. For any
corpus, source-lifecycle, ingestion, fixture or naming work that means
`corpus-reframe-review.html` (R1/R2) and `reference/entity-glossary.md` **before** forming
a verdict.

### 2a: Memory recall

The SessionStart hook has already injected a branch-seeded palace digest, and Step 1 put
the continuation prompt in context. Per `recall-grounding` §1a, that usually makes a broad
`mempalace_search` at open a 4–7k-token restatement of what you just read — so **skip it,
or narrow it to the gap the prompt leaves open**, seeded with the prompt's task ids and
scoped `room: "diary"`.

That skill owns the rest: the filter discipline, and the lock-free FTS fallthrough to run
if the palace errors. Follow it rather than a rule restated here.

### 2b: Task state inspection (ordna task files)

Inspect recently-active tasks straight from the ordna task files — **prefer a plain file
read; no CLI needed** (`tasks/id-N.md` is one small markdown file per task, YAML
frontmatter + body):

```bash
cat "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md"                     # one task, frontmatter + body
cd "$KH_PRIVATE_DOCS_DIR" && ordna list -s doing               # what's in flight
cd "$KH_PRIVATE_DOCS_DIR" && ordna show <id>                   # frontmatter + body to stdout
```

**Config context:** ordna is bound to the docs-site root — there is no `--cwd` flag, so
`cd "$KH_PRIVATE_DOCS_DIR"` before any verb. Use **non-interactive verbs only**
(`list`/`show`/`cat`); bare `ordna` / `ordna board` opens the Kanban TUI and hangs a
background shell (same class as `supabase db push`). Full conventions:
`${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md`.

**Field-selection rule:** for a Subtask the continuation prompt names, read the
`## Subtasks` → `### {N.M}` block first. Absent a pointer: `## Progress` (the append-only
journal) for narrative state, the `## Subtasks` block for the spec brief, frontmatter
`status` + `status_note` for the task-level rollup.

### 2c: Owning initiative → project (strategic context)

**Gate:** run this for spec-chain work, a promote, or new work whose owner is unknown.
Skip it when the continuation prompt already names the owning project — re-deriving it
costs a directory grep and two file reads for state you were handed.

When the gate fires, follow
[references/initiative-resolution.md](references/initiative-resolution.md): resolve the
project by `Linked tasks:`, fall back to the slugified-title match, and surface the
initiative's "why this matters" plus the project's status and sibling tasks. Unowned is a
common outcome, not an error — record it and continue.

### 2d: Settled-state read-back (one-time retro review + decision register)

Load the durable settled state the deltas-only prompt omits. This is a **one-time read at
session open**, not a per-turn ritual.

- **Retros:** one plain markdown file per session at `ledgers/retros/S<NNN>.md`
  (session-numbered). **Read the newest one in full; take the two before it as headlines
  only.** Older retros' durable items reach you through the continuation prompt's carry
  sections — re-reading whole files for them costs ~2.5k tokens for content the prompt
  already routed (S570 token audit):

  ```bash
  R="${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros"
  ls -1 $R/S*.md | sort -V | tail -1                          # read this one in full
  grep -h '^- \*\*' $(ls -1 $R/S*.md | sort -V | tail -3 | head -2) | cut -c1-160
  ```

  In the full read, surface the durable sections — **Unresolved questions**, **Workflow
  improvements**, **Failed assumptions**, **Architecture decisions**. Open an older retro
  in full only when a headline or the continuation prompt points into it.

- **Decision register:** read the **"In force"** table in
  `reference/decision-register.md` — the binding settled-rulings guardrail (`DR-NNN`).
  That page is a GENERATED index: one row per decision (id, date, status, one-line ruling,
  link). Read the table, then open only the individual files under `reference/decisions/`
  that the session actually needs — the continuation prompt's cited ids, plus anything the
  table shows touching your task's ground. Never read the whole `decisions/` directory.

  Below the in-force table is **"Superseded and retired"**. Skip it at session start; go
  there only when resolving a citation that isn't in the in-force table. A `DR-NNN` cited
  in a live doc but absent from the in-force table is a closed decision with a file of its
  own — read its `retired_reason` / `superseded_by` rather than assuming the citation is
  broken.

---

## Step 3: Confirm Session Plan

The continuation prompt is already in context from Step 1 — do not re-read it. Present a
summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {parallel subagents (conditional), dependencies}

Then proceed with the outlined plan — if any adjustments are required, the user will
notify you.

---

## Step 4: GitNexus Baseline (conditional)

Refresh the code-intelligence index **only before a genuinely code-heavy wave** —
spec-authoring / docs / ledger sessions skip this step:

```bash
bun run gitnexus:analyze    # minutes; rebuilds the index for the primary tree
```

A stale-index warning on every commit is expected (the post-commit hook compares the index
to the new HEAD). Never re-run per doc/ledger commit.

---

## Critical Reminders

- **ALL verification gaps must be fixed** — even minor ones.
- **Use `gh-axi` (not raw `gh`) for any GitHub operation this session** — pre-aggregated
  CI rollups + structured error translation; `gh-axi api` is the raw-API escape hatch.
