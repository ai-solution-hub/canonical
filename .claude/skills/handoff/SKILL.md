---
name: handoff
description:
  Generate the continuation prompt at session close. Triggers on "handoff", "continuation prompt", "wrap up session", "create handoff". Records architectural decisions, retro records, and provides direction and context to the next Coordinator.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff

Generates
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`
at session close (the file is written to, and committed in, the docs-site checkout resolved via
`KH_PRIVATE_DOCS_DIR`). The prompt is consumed by the next session. It is a **routing + deltas** document: it points to canonical sources and carries only what is NOT already in them.

---

## Step 1 — Write settled rulings to the Decision Register

Determine the session's architectural rulings and append them to
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md` as `DR-NNN` entries
(newest at top; 1-3 sentences + `**Status:** accepted · S{NNN}`). 

Boundary: an architectrual decision → register; an observation / friction → the retro (Step 2). Skip if the session settled nothing.

When a new decision **supersedes** an existing `DR-NNN` (or this session flipped a Task/spec
state that downstream docs assert), run the docs-site `sync-ledger-context` skill — or flag
it in *Session deltas* — so docs carrying the superseded assertion get a *Ledger drift* stamp instead of silently going
stale.

## Step 2 — Retro-authoring assist (candidate mining → Coordinator authors)

### 2a — Dispatch the Retro Miner specialist agent

Dispatch the agent to review this session's transcript and to return a
**RANKED retro-candidate list** with evidence pointers. Each candidate is one line: rank, one-sentence finding, and an evidence pointer (transcript `file:line` and/or `agent-<hash>`).

Provide the agent with the location of the {transcript path}.

### 2b — Coordinator authors + durably WRITES the retro

You read the ranked candidates, and author the session's retro record if there are findings worth recording.

`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/retros/retro-template.md` holds the shape.

`id` is the ordna task ID. Required scalars: `id` (id-N), `session_id` (SNNN),
`date` (YYYY-MM-DD), `track`; the six category arrays + `session_refs` /
`commit_refs` / `cross_doc_links` default to empty when omitted.

---

## Step 3 — Confirm next-session focus

Confirm before drafting (ask Liam if unsure):

1. What did this session complete / leave in-flight?
2. The next session's purpose (≤ 3-4 areas)?

---

## Step 4 — Write the prompt (target 60-100 lines)

Filename uses the highest existing number + 1. 

Write to the docs-site checkout (resolve `KH_PRIVATE_DOCS_DIR` first):
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-{slug}.md`

The prompt's **body addresses the next session** (the reader).

````markdown
---
title: "S{NNN}: {slug}"
---

# Canonical Platform - Continuation Prompt - {Next-session purpose}

_Authored at the close of S{NNN}; for the next session._

## Session focus

{3-4 lines: focus for the next session}

## Completed this session (Tasks + SHAs)

Task/Subtask ids + merge/PR SHA only (the ledger holds the detail; never reproduce it). Omit if nothing shipped.}

## Settled this session (Decision Register)

{New architectural decisions written to `reference/decision-register.md` this session —
cite the NEW ids only (e.g. `DR-011`–`DR-013`), one line each.}

## Session deltas / decisions NOT in the ledger

{Bullets: only what a fresh Coordinator cannot derive from the ordna/specs/register —
NON-binding deltas: schema/process changes, gotchas, strategic options. Omit if all information is in ordna/specs/register.}

## Session Carry

{Anything which was intended for the previous session, but wasn't completed.}

## Mechanical state (auto-generated)

{Paste the output of `bash scripts/session-close-report.sh` — branch/HEAD,
orphaned worktrees, open PRs + CI, index freshness.}

## Pre-reqs (Liam)

{Only items needing Liam action before the next session starts. Omit if none.}
````

---

## Step 4b — Mechanical state generator

Run the read-only generator and paste its block into the prompt's *Mechanical state* section:

```bash
bash scripts/session-close-report.sh
```

It emits branch/HEAD, named worktrees, open PRs + CI (`gh-axi`), and index
freshness.

---

## Step 5 — Commit and push

Continuation prompts are stored in the private docs-site repo, so
the commit + push target THAT checkout, not the Canonical Platform repo. Use the
explicit `--git-dir`/`--work-tree` form so the op runs against docs-site
regardless of CWD:

```bash
DOCS="${KH_PRIVATE_DOCS_DIR}"
git --git-dir="$DOCS/.git" --work-tree="$DOCS" \
  add src/content/docs/continuation-prompts/continuation-prompt-ca-s{NNN}-*.md
git --git-dir="$DOCS/.git" --work-tree="$DOCS" \
  commit -m "docs: S{NNN} continuation prompt — {slug}"
git --git-dir="$DOCS/.git" --work-tree="$DOCS" push
```

---

## Quality checklist (before presenting)

- [ ] Routing + deltas only — no task state, per-WP specs, file ownership, or
      session-history recaps reproduced (those are pointers).
- [ ] No emojis; plain English (Liam-readable); all paths repo-relative.
- [ ] Total length ≤ ~100 lines (longer needs explicit justification).
- [ ] New architectural decisions written to the Decision Register.