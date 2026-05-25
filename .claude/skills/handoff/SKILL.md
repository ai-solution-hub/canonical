---
name: handoff
description:
  Generate the lean orchestrator-of-orchestrators continuation prompt at session
  close. Triggers on "handoff", "continuation prompt", "session handoff", "wrap up
  session", "create handoff". Produces a routing + deltas document that points to
  the canonical ledger / cmux briefs / Mempalace diary instead of reproducing them.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff — Continuation Prompt Generator

Generates `docs/continuation-prompts/continuation-prompt-kh-s{NNN}-main-{slug}.md`
at session close. The prompt is consumed by the **next session's
orchestrator-of-orchestrators** — never by an individual cmux terminal. So it is a
**routing + deltas** document: it points to canonical sources and carries only what
is NOT already in them.

**Canonical sources — point to these, never reproduce them:**

| Content                                                          | Lives in                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Task / Subtask state, `details`, `testStrategy`, what shipped + SHAs | `docs/reference/task-list.json` (`<info added on …>` journals)             |
| Per-terminal scope, bootstrap reads, file ownership, sequence/gates  | the per-Task cmux briefs (`docs/continuation-prompts/cmux-brief-*.md`)      |
| Recency-weighted multi-session history                           | Mempalace diary (`mempalace_diary_read agent=claude`)                          |

Reproducing any of these in the prompt is a duplicate read — the failure mode this
structure exists to prevent.

---

## Step 1 — Read context (lean)

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -3
git worktree list
git log --oneline -12
```

- Identify this session's Task/Subtask status flips from `task-list.json` — the
  `<info added on …>` journals are the canonical record. Do **not** re-compress them
  into the prompt; the diary already holds session history.
- Do **not** read a prior prompt to copy its "completed work" forward.

---

## Step 2 — Session number + filename

Filename uses the **writing session's** number = highest existing main-track number
+ 1. That same number is the title and the build-status session (`end of S{NNN}`).
The prompt's **body addresses the next session** (the reader). One counter, one
convention — no `{NNN-1}` offset.

`continuation-prompt-kh-s{NNN}-main-{slug}.md` — single canonical counter since the
S71 collapse (ID-24). The retired `prod-readiness-s{N}` pattern is historical only.

---

## Step 3 — Build status (one line)

```bash
bun run test 2>&1 | tail -3   # pass / fail / skip headline
bun lint 2>&1 | tail -3
git rev-parse --short HEAD
```

Record the headline counts + HEAD only. Flag whether failures are pre-existing/tracked
or new this session.

---

## Step 4 — Confirm next-session focus

Confirm before drafting (ask Liam if unsure):

1. What did this session complete / leave in-flight?
2. The next session's purpose (≤ 3-4 areas)?
3. Which terminals does the next session deploy, and in what sequence/gates?
4. Decisions made this session not yet in the ledger / specs / memory?
5. Gotchas not yet in CLAUDE.md or memory?

---

## Step 5 — Write the prompt (lean — target 60-100 lines)

````markdown
# {Next-session purpose} — Knowledge Hub Continuation Prompt

_Authored at the close of S{NNN}; for the next session._

Working directory: `{cwd}` (single-track `main`, HEAD `{sha}`).

> **Lean prompt.** Routing + deltas only — task state is in `task-list.json`,
> per-terminal scope in the cmux briefs, history in the Mempalace diary.

## Next-session focus

{3-4 lines: what the next session orchestrates + the O-of-O operating mode —
delegate heavy lifting to subagents/terminals, keep main-session context lean.}

## Terminals to deploy (pointers, not re-specs)

{Table: Terminal | brief file | sequence/gate one-liner. The brief + ledger hold
the detail.}

## Session deltas / decisions NOT in the ledger

{Bullets: only what a fresh orchestrator cannot derive from the ledger/specs —
ratifications, schema/process changes, gotchas, strategic options.}

## Deferred / separate focus

{Tasks explicitly out of the next session's scope + where they go.}

## Build status (end of S{NNN})

{One line: test headline + lint + HEAD; note pre-existing vs new failures.}

## Pre-reqs (Liam)

{Only items needing Liam action before the next session starts. Omit if none.}
````

**Do not add:** a "Completed work" recap (→ diary + ledger journals), per-WP
Source/Files/Acceptance/Effort blocks (→ cmux briefs + Subtask `details` /
`testStrategy`), a file-ownership matrix (→ briefs), or per-WP "documents to read"
tables (→ each brief's bootstrap). If the next session needs per-Task detail it reads
the brief + the ledger — that is the design.

---

## Step 6 — Write the file

`docs/continuation-prompts/continuation-prompt-kh-s{NNN}-main-{slug}.md`

## Step 7 — Prettier sweep (single file)

```bash
bunx prettier --write docs/continuation-prompts/continuation-prompt-kh-s{NNN}-main-*.md
```

## Step 8 — Commit and push

```bash
git add docs/continuation-prompts/continuation-prompt-kh-s{NNN}-main-*.md
git commit -m "docs: S{NNN} continuation prompt — {slug}"
git push
```

If Liam edits, he creates a new commit (not amend).

## Step 9 — Add MemPalace diary entry

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
- [ ] Build status from an actual run; pre-existing vs new failures distinguished.
- [ ] Terminals listed as brief pointers + sequence/gates, not re-specified.
- [ ] Session number = previous + 1 (writing session); body addresses the next session.
- [ ] No emojis; plain English (Liam-readable); all paths repo-relative.
- [ ] Total length ≤ ~100 lines (longer needs explicit justification).
- [ ] A fresh orchestrator can start from this prompt + the ledger + the briefs alone.
