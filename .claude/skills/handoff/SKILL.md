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

- Read the most recent prompt for this track in full — gives the "Completed
  Work" section to compress + the prior objectives to confirm shipped.
- Read `docs/reference/task-list.json` to identify Tasks closed this session
  (status changes pending→done) and Subtasks that landed (status changes
  pending→in_progress→done). Their `details` field `<info added on YYYY-MM-DD>`
  journal blocks are the canonical record of what shipped — quote relevant
  SHAs from there.

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
5. Any Task or Subtask status flips this session that should be summarised in
   the continuation prompt's "Completed work" section?
6. Any gotchas to flag that aren't yet in CLAUDE.md or memory?

If unsure on next-session focus, ask Liam.

---

## Step 5 — Write the prompt

### Structure (target: 200-250 lines total)

`Section rules` section below outlines the required structure for `Completed work`, `What This Session Does`, and `Agent Allocation` sections of the prompt.

```markdown
# {Session Purpose} — Knowledge Hub Session {NNN} Continuation Prompt

## Context

Working directory: `{cwd}`
Track: {track}
Read first: `docs/plans/phase-0-investigation/architecture/01-vision.md`

## Completed work (recency-weighted)

{As per `Section rules`}

## Build status (end of S{NNN-1})

- `bun run test` — {N} pass / {N} skip / 0 fail
- `bun lint` — {N} errors / {N} warnings

## What This Session Does: {Session Purpose}

### WP{N}: {Title} (Must-Fix)

{Numbered WPs. As per `Section rules`}

## Agent allocation

{Table + file ownership boundaries. As per `Section rules`.}

## Documents to read before starting

{Must-read + per-WP tables.}

## Pre-requisites (Liam)

{Only items needing Liam action before Wave 1 dispatches. Omit section if none.}
```

#### Section rules

**Completed work — recency-weighted compression:**

- Sessions older than N-3: collapse to a single 1-2 line paragraph for the whole
  range.
- N-3, N-2: one paragraph each, 3-4 lines, what shipped + key SHA.
- N-1 (this session): one paragraph per WP, 1-3 lines each. No fluff. If the WP
  closed a Subtask, reference its ID-N.M and quote the commit SHA from the
  `<info added on …>` journal block in `task-list.json`. If the WP only made
  progress (no state flip), say so.

**Per-WP fields** (in this order, one block per WP):

- Priority: `(MUST)` / `(SHOULD)` / `(COULD)`
- Source: spec or plan path + section refs (one line)
- What: 1-3 lines describing the change
- Files: exact paths (NEW vs EXTEND)
- Acceptance criteria: bullet list
- Effort: estimate

Skip: phase-by-phase prose if already in the spec/plan; "why this matters" if
already obvious from roadmap context; restating CLAUDE.md gotchas.

**Agent allocation table** — columns: Agent | Work Package | Scope | Type |
Wave. Then "File ownership boundaries" listing every WP's owned paths. No
overlap allowed across parallel WPs in the same wave.

**Documents to read** — split into "Must read first" (CLAUDE.md, roadmap,
STATUS.md, relevant reference document(s)) and "Read per work package" (per-WP
table).

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

## Step 8 — Add MemPalace diary entry

Per the AAAK format documented in `.claude/skills/start-session/SKILL.md`
"Mempalace diary entry shape" section. Call `mempalace_diary_write` with
`agent_name: claude` + the structured `content` field.

---

## Quality checklist (before presenting)

- [ ] All paths relative to project root
- [ ] Build status from actual runs, not assumed
- [ ] Recency-weighted compression applied (older = shorter)
- [ ] Every WP has acceptance criteria + effort
- [ ] Every WP in agent allocation has file ownership populated
- [ ] Session number = previous + 1 for this track
- [ ] No emojis
- [ ] A future Claude session can start work immediately from this prompt alone
- [ ] Plain English (Liam-readable)
- [ ] Total length 200-250 lines (longer needs justification)
