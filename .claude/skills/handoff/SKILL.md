---
name: handoff
description:
  Generate a continuation prompt for the current session. Triggers on "handoff",
  "continuation prompt", "session handoff", "wrap up session", "create handoff".
  Automates the structured document that enables seamless session-to-session
  context transfer.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff — Continuation Prompt Generator

Generates
`docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{track}-{slug}.md`.

**Prerequisite:** `/update-docs` must have run first (stats, roadmap,
state-of-product, git context already in conversation). Remind the user if not.

---

## Step 1 — Read context

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -5
git worktree list
```

Read the most recent prompt for this track in full — gives the "Completed Work"
section to compress + the prior objectives to confirm shipped.

If a top-level worktree exists outside `.claude/worktrees/`, this prompt is
**for the active track only**. Use the track-suffixed filename below.

---

## Step 2 — Determine session number + filename

Highest existing session number for this track + 1.

| Track                   | Filename pattern                                                             |
| ----------------------- | ---------------------------------------------------------------------------- |
| main                    | `continuation-prompt-kh-s{NNN}-main-{slug}.md`                               |
| `kh-knowledge-platform` | `continuation-prompt-kh-kpf-s{N}-{slug}.md` (track-local counter)            |
| `production-readiness`  | `continuation-prompt-kh-prod-readiness-s{N}-{slug}.md` (track-local counter) |

---

## Step 3 — Capture build status

```bash
bun run test 2>&1 | tail -20
bun lint 2>&1 | tail -10
```

Record actual numbers — pass/skip/fail counts, lint errors/warnings.

---

## Step 4 — Confirm next-session focus

Confirm before drafting:

1. What was completed this session (frees capacity for next priority)?
2. What was started but not completed (carries forward)?
3. What is the next session's purpose (3-4 areas max per session)?
4. Any decisions made this session that aren't yet captured in roadmap /
   state-of-product?
5. Any gotchas to flag that aren't yet in CLAUDE.md or memory?

If unsure on next-session focus, ask Liam.

---

## Step 5 — Write the prompt

### Structure (target: 150-250 lines total)

```markdown
# {Purpose} — Knowledge Hub Session {NNN} Continuation Prompt

## Context

{5 lines — fixed boilerplate. Read first: CLAUDE.md. Codebase:
.planning/codebase/.}

## Critical rules from recent sessions

{Max 5 items. See rules below.}

## Completed work (recency-weighted)

{See compression rules below.}

## Build status (end of S{NNN-1})

- bun run test — {N} pass / {N} skip / 0 fail
- bun lint — {N} errors / {N} warnings
- Other relevant gates (tsc, build, MCP inventory).

## Session objectives

{Numbered WPs. See WP structure below.}

## Agent allocation

{Table + file ownership boundaries. See below.}

## Documents to read before starting

{Must-read + per-WP tables.}

## Pre-requisites (Liam)

{Only items needing Liam action before Wave 1 dispatches. Omit section if none.}
```

### Section rules

**Critical rules from recent sessions** — include only items meeting ALL of:

1. Discovered in the last 1-2 sessions.
2. Not in CLAUDE.md Gotchas.
3. Not in memory files.
4. Would cause bugs or confusion if missed.

Carried 3+ sessions → graduate to CLAUDE.md (one line) and remove. Cap: 5 items.
Read CLAUDE.md Gotchas first to dedupe.

**Completed work — recency-weighted compression:**

- Sessions older than N-3: collapse to a single 1-2 line paragraph for the whole
  range.
- N-3, N-2: one paragraph each, 3-4 lines, what shipped + key SHA.
- N-1 (this session): one paragraph per WP, 1-3 lines each. No fluff.

**Per-WP fields** (in this order, one block per WP):

- Priority: `(MUST)` / `(SHOULD)` / `(COULD)`
- Source: spec or plan path + section refs (one line)
- What: 1-3 lines describing the change
- Files: exact paths (NEW vs EXTEND)
- Acceptance criteria: bullet list
- Effort: estimate
- Gotchas: only memory IDs (`feedback_X`) — agent reads memory at session start

Skip: phase-by-phase prose if already in the spec/plan; "why this matters" if
already obvious from roadmap context; restating CLAUDE.md gotchas.

**Agent allocation table** — columns: Agent | Work Package | Scope | Type |
Wave. Then "File ownership boundaries" listing every WP's owned paths. No
overlap allowed across parallel WPs in the same wave.

**Documents to read** — split into "Must read first" (CLAUDE.md, roadmap,
state-of-product, plus 1-3 task-specific) and "Read per work package" (per-WP
table).

**Skip these sections by default** (only include if they earn their place):

- "Recurring session practices" — already in CLAUDE.md.
- "Out-of-scope" — only if guarding against likely scope creep.
- "Success criteria" — duplicates per-WP acceptance criteria.
- "Parallel tracks" overview — already in CLAUDE.md; reference only if a new
  track was added this session.
- Wave preamble paragraphs — wave structure is in the agent allocation table.

---

## Step 6 — Write the file

```
docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{track}-{slug}.md
```

---

## Step 7 — Commit and push

```bash
git add docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{track}*.md
git commit -m "docs: draft session {NNN} continuation prompt"
git push
```

If Liam edits, he creates a new commit (not amend).

---

## Step 8 — Memory capture (mempalace transition in progress)

**Deferred kh-prod-readiness-S40.** The auto-memory system
(`~/.claude/projects/.../memory/feedback_*.md` + `MEMORY.md` index) is being
phased out in favour of mempalace MCP tools. The replacement shape (Shape A
diary-write / Shape B KG-backed / Shape C auto-archive — see sub-agent report
referenced in S40 STATUS row) is **not yet ratified**.

Until then:

- Do NOT create new `feedback_*.md` / `project_*.md` / `reference_*.md` files.
  New lessons either (a) graduate to a one-line CLAUDE.md Gotcha entry, (b) get
  recorded inline in the continuation prompt's "Critical rules from recent
  sessions" section (max 5 items), or (c) wait for the mempalace shape to land.
- The CLAUDE.md graduation check still applies: distinctive-keyword grep before
  authoring anything memory-shaped; one-line CLAUDE.md entry beats a full
  markdown file when the lesson is already proven.
- DELETE candidates (memory files made redundant by CLAUDE.md graduation) stay
  on the radar but are NOT touched this session — they'll be picked up by the
  mempalace migration script when Shape A/B/C is wired.

**Open question for next session(s):** ratify final mempalace shape. See
`docs/audits/kh-production-readiness-phase-1/STATUS.md` "Mempalace transition"
section + the sub-agent report referenced there. The investigation likely lives
on the main repo (per S40 user direction) — check
`/Users/liamj/Documents/development/knowledge-hub` for cutover artefacts before
making per-branch decisions.

---

## Quality checklist (before presenting)

- [ ] UK English (colour, prioritise, organisation)
- [ ] No template placeholders left
- [ ] All paths relative to project root
- [ ] Build status from actual runs, not assumed
- [ ] Recency-weighted compression applied (older = shorter)
- [ ] Every WP has acceptance criteria + effort
- [ ] Every WP in agent allocation has file ownership populated
- [ ] Deferred items carried forward
- [ ] Session number = previous + 1 for this track
- [ ] No emojis
- [ ] A future Claude session can start work immediately from this prompt alone
- [ ] Plain English (Liam-readable)
- [ ] Critical rules ≤ 5 items, none in CLAUDE.md
- [ ] Items carried 3+ sessions graduated or dropped
- [ ] Total length 150-250 lines (longer needs justification)
