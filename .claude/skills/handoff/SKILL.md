---
name: handoff
description:
  Generate the orchestrator-of-orchestrators continuation prompt at session
  close. Triggers on "handoff", "continuation prompt", "wrap up session", "create handoff". 
  allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff

Generates `docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{slug}.md`
at session close. The prompt is consumed by the **next session's
orchestrator-of-orchestrators**. It is a **routing + deltas** document: it points to canonical sources and carries only what is NOT already in them.

**Canonical sources — point to these, never reproduce them:**

| Content                                                          | Lives in                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Task / Subtask state, `details`, `testStrategy`, what shipped + SHAs | `docs/reference/task-list.json` (`<info added on …>` journals)             |
| Per-terminal scope, bootstrap reads, file ownership, sequence/gates  | the per-Task cmux briefs (`docs/continuation-prompts/cmux-brief-*.md`)      |
| Recency-weighted multi-session history                           | Mempalace diary (`mempalace_diary_read agent=claude`)                          |

---

## Step 1 — Session number + filename

Filename uses the highest existing number + 1. 

Filename format: `continuation-prompt-kh-s{NNN}-{slug}.md`

---

## Step 2 — Confirm next-session focus

Confirm before drafting (ask Liam if unsure):

1. What did this session complete / leave in-flight?
2. The next session's purpose (≤ 3-4 areas)?
3. Which terminals does the next session deploy, and in what sequence/gates?
4. Decisions made this session not yet in the ledger / specs / memory?
5. Gotchas not yet in CLAUDE.md or memory?

---

## Step 3 — Write the prompt (target 60-100 lines)

The prompt's **body addresses the next session** (the reader).

````markdown
# Knowledge Hub Continuation Prompt - {Next-session purpose}

_Authored at the close of S{NNN}; for the next session._

Working directory: `{cwd}` ({branch}).

## READ FIRST

- `docs/themes/canonical-pipeline/reference/v1-completion-sequence.md` — the forward map (Spine = re-ingest is the cutover gate).

## Next-session focus

{3-4 lines: what the next session orchestrates + the O-of-O operating mode —
delegate heavy lifting to subagents/terminals, keep main-session context lean.}

## Deployment Approach

{Table: Terminal/Worktree Subagent | brief file | sequence/gate one-liner. The brief + ledger hold
the detail.}

## Session deltas / decisions NOT in the ledger

{Bullets: only what a fresh orchestrator cannot derive from the ledger/specs —
ratifications, schema/process changes, gotchas, strategic options.}

## Session Carry

{Anything which was intended for the previous session, but wasn't completed.}

## Pre-reqs (Liam)

{Only items needing Liam action before the next session starts. Omit if none.}
````

---

## Step 4 — Write the file

`docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{slug}.md`

## Step 5 — Prettier sweep

```bash
bun run format
```

## Step 6 — Commit and push

```bash
git add docs/continuation-prompts/continuation-prompt-kh-s{NNN}-*.md
git commit -m "docs: S{NNN} continuation prompt — {slug}"
git push
```

If Liam edits, he creates a new commit (not amend).

## Step 7 — Add MemPalace diary entry

Via `mempalace_diary_write` (`agent_name: claude`; `topic`: `main-track` /
`workflow-orchestration` / `general`). `content` = pipe-separated AAAK facts:
`SESSION:YYYY-MM-DD.SXX` → top-line summary → per-area segments (what shipped, key
SHAs, ratifications, gotchas surfaced) → build status (`test.N.pass/N.fail/N.skip`) →
push refs → forward-look → `★rating` (★★★★+ clean ship, ★★★ workarounds, ★★
partially blocked). ~600-1500 chars; one event per segment; entity codes + `.✓` /
`.fail` markers for AAAK search.

---

## Quality checklist (before presenting)

- [ ] Routing + deltas only — no task state, per-WP specs, file ownership, or
      session-history recaps reproduced (those are pointers).
- [ ] No emojis; plain English (Liam-readable); all paths repo-relative.
- [ ] Total length ≤ ~100 lines (longer needs explicit justification).
- [ ] A fresh orchestrator can start from this prompt + the ledger + the briefs alone.
