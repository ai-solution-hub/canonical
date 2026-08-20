---
name: start-session
description: >-
  Bootstraps a Canonical session: loads context, and presents the
  session plan from the continuation prompt. Use at the start of every new session.
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill
---

# start-session

Loads critical context, and presents the session plan.

---

## Step 1: Review Continuation Prompt

The newest file is the one to read (unless stated otherwise by the owner) — it is the previous session's hand-off:

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
| 2a Task state | Always, for the ids the continuation prompt names |
| 2b Settled state | Always |

Carry the precedence rule into **every sub-agent
dispatch brief**: a brief citing only task files, specs and code reproduces the codebase's
errors.

### 2a: Task state inspection

Inspect session-relevant tasks straight from the ordna task files.

```bash
cat "$KH_PRIVATE_DOCS_DIR/tasks/id-<N>.md"                     # one task, frontmatter + body
cd "$KH_PRIVATE_DOCS_DIR" && ordna list -s doing               # what's in flight
cd "$KH_PRIVATE_DOCS_DIR" && ordna show <id>                   # frontmatter + body to stdout
```

**Field-selection guidance:** 
- `## Progress` for narrative state
- `## Subtasks` block for the spec brief
- frontmatter `status` + `status_note` for the task-level rollup

### 2b: Settled state inspection

Retros provide valuable context (**Unresolved questions**, **Workflow improvements**, **Failed assumptions**, **Architecture decisions**) - the durable settled state the deltas-only prompt omits.

One plain markdown file per session at `ledgers/retros/S<NNN>.md`.

  ```bash
  R="${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros"
  ls -1 $R/S*.md | sort -V | tail -1
  ```

The retro for earlier sessions can be reviewed when it would be valuable for a task, but keep in mind that these are point-in-time context, and the content may have been superseeded. 

---

## Step 3: Confirm Session Plan

Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Execution strategy:** {parallel subagents (conditional), dependencies}

Then proceed with the outlined plan — if any adjustments are required, the user will
notify you.

---

## Step 4: Code intelligence baseline (conditional)

Refresh the code-intelligence indexes before a code-heavy wave.

```bash
bun run gitnexus:analyze    # minutes; rebuilds the index for the primary tree
```

```
ccc index
```

---
