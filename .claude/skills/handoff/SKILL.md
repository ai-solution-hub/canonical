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

## Step 7 - Prettier Sweep

```bash
# Run format check; capture unformatted file list if it fails.
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if ! bun run format:check >/tmp/fmt-check.log 2>&1; then
  echo "Prettier drift detected — files:"
  grep -E '^\[warn\] ' /tmp/fmt-check.log | awk '{print $2}'
  # Surgical fix — only the files Prettier flagged (avoid full-repo reformat).
  files=$(grep -E '^\[warn\] ' /tmp/fmt-check.log | awk '{print $2}' | tr '\n' ' ')
  if [ -n "$files" ]; then
    bunx prettier --write $files
    git add $files
    git commit -m "chore(format): prettier sweep at session close"
  fi
else
  echo "Prettier clean — no sweep needed."
fi
```

## Step 8 — Commit and push

```bash
git add docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{track}*.md
git commit -m "docs: draft session {NNN} continuation prompt"
git push
```

If Liam edits, he creates a new commit (not amend).

## Step 9 — Add MemPalace diary entry

**Required structure** (passed via `mempalace_diary_write`):

- `agent_name`: `claude` (single wing for the assistant across all KH work).
- `topic`: one of `kh-prod-readiness-SNN` / `main-track` / `workflow-orchestration`
  / `general` — names the session's primary focus.
- `content`: pipe-separated facts in this order:
  1. `SESSION:YYYY-MM-DD.SXX` — date + session counter.
  2. Top-line summary (one segment).
  3. Per-WP segments — each summarising what shipped, key files touched,
     ratifications applied, gotchas surfaced.
  4. Build status (`test.baseline.N.pass/N.fail/N.skip`).
  5. Push refs (`push:short-sha1+short-sha2`).
  6. Forward-look (`SXX+1.continuation.<bullet count>.lines.<WP count>.WPs`).
  7. `★rating` — 1–5 ★ self-assessment of session quality (writer's call;
     ★★★★+ for clean shipping sessions, ★★★ for sessions with workarounds,
     ★★ for partially-blocked sessions).

**Length**: ~600–1500 chars. One logical event per pipe-delimited segment.
Use entity codes (e.g. `WP1.work-status.ts`) and emotion markers (e.g.
`.✓` / `.fail`) for AAAK-compatible search.

**Example** (from S50 close):

```
SESSION:2026-05-18.S50|surface.migration.impl.complete.24commits.production-readiness|WP0.spec.re-ratification.drop.aliases+unified.WorkStatus+Priority.master.enums|WP1.work-status.ts+task-list-schema.ts+task-list.json.dogfood.Tasks.2-5.seeded|...|test.baseline.12546.pass.1.fail.FU-9.only.24.skip|S51.continuation.298.lines.5.WPs|★★★★
```

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
