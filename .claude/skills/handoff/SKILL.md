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

Generate a complete continuation prompt following the project's established
template and style conventions. The output is a markdown file that a future
Claude Code session can consume to pick up exactly where this session left off.

**Pre-requisite:** `/update-docs` should have run before this skill. It
regenerates stats, updates the
roadmap/state-of-the-product/product-functionality/backlog documents, and
gathers git context — all of which are already in the conversation. If
`/update-docs` has not been run, remind the user before proceeding.

---

## Step 1: Read the Most Recent Continuation Prompt

Find existing continuation prompts in `docs/continuation-prompts/`:

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -5
```

If they exist, read the most recent file in full. This provides:

- The cumulative "Completed Work" section to compress further
- The previous session's objectives (to confirm what was done)

---

## Step 1b: Identify Active Parallel Tracks (Conditional)

The project sometimes runs parallel work tracks on separate top-level git
worktrees (e.g. the knowledge-platform track on
`/Users/liamj/Documents/development/knowledge-hub-knowledge-platform` alongside
main-track work on the primary repo `/knowledge-hub`). These are **long-lived
worktrees** — distinct from the ephemeral `isolation: "worktree"` agent
worktrees created during sessions under `.claude/worktrees/`.

Check for active parallel tracks:

```bash
git worktree list
```

If a top-level worktree exists outside `.claude/worktrees/`:

- Note which branch it tracks and its current HEAD.
- This session's continuation prompt is for **this track only** — do not write
  objectives for the other track.
- Include a "Parallel track note" section (see Section 1) pointing to the other
  track's continuation prompt so a future session knows both exist.
- Use the track-suffixed filename convention (see Step 2).

---

## Step 2: Determine the Next Session Number and Track Suffix

Parse the highest session number from existing files and add 1.

**Filename convention:** When parallel tracks are active, suffix the filename
with a track identifier to avoid confusion:

- Main track: `continuation-prompt-kh-s{NNN}-main-{purpose}.md`
- kh-knowledge-platform track: `continuation-prompt-kh-kpf-s{N}-{purpose}.md`
  (track-local counter)
- production-readiness track:
  `continuation-prompt-kh-prod-readiness-s{N}-{purpose}.md` (track-local
  counter)

When only one track is active, the track suffix is optional:
`continuation-prompt-kh-s{NNN}-{purpose}.md`.

---

## Step 3: Gather Build Status

Git history, file changes, and doc state are already in context from
`/update-docs`. The only new information needed is a fresh build status:

```bash
# Run tests and capture result (use bun run test, NOT bun test)
cd /Users/liamj/Documents/development/{repo-name} && bun run test 2>&1 | tail -20

# Run lint and capture result
cd /Users/liamj/Documents/development/{repo-name} && bun lint 2>&1 | tail -10
```

---

## Step 4: Determine Next Session Context

Before generating the continuation prompt, assess whether you can confidently
answer the following questions, based on reference documentation, git history
and the conversation context. If you can answer the questions confidently,
proceed to step 5.

Key information required to allow creation of the next session's continuation
prompt:

1.  **Was there work that was started but not completed**, or items that were
    planned but skipped?

2.  **Was there work that was completed** which opens up capacity to focus on
    the next priority item(s) from the roadmap? Our workflow allows us to focus
    on 3-4 areas per session.

3.  **Session purpose (for the NEXT session):** Based on points 1 and 2, and
    your interactions during the session, what should the next session focus on?

4.  **Key decisions made this session:** Have any architectural decisions,
    design choices, or direction changes already been captured in the relevant
    document(s)?

5.  **Anything to flag for next session:** Gotchas discovered, things that
    almost broke, or important context the next session needs and which isn't
    already documented?

If you are unsure on what the next session's focus should be, ask Liam to
confirm.

---

## Step 5: Generate the Continuation Prompt

Write the full continuation prompt following these rules:

### Section 1: Header & Identity

```markdown
# {Session Purpose} — Knowledge Hub Session {NNN} Continuation Prompt

## Context

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain applications are bid
management and sector intelligence for UK SMBs. The knowledge base is the
foundation for these and future applications.

Multi-user with role-based access (admin/editor/viewer).

**Team:** Liam (product owner) + Claude Code as development partner.

**Read first:** `CLAUDE.md` -- project commands, architecture, schema, gotchas.
**Codebase analysis:** `.planning/codebase/` (7 docs).
```

The Context paragraph should be consistent across all prompts.

### Section 2: Critical rules from recent sessions

Include **"Critical rules from recent sessions"** only for items that meet ALL
of these criteria:

1. Discovered in the last 1-2 sessions (genuinely recent)
2. NOT already documented in `CLAUDE.md` Gotchas or elsewhere
3. NOT already captured in memory files
4. Would cause bugs or confusion if a new session didn't know

**Graduation rule:** If an item has been carried across 3+ continuation prompts,
it has graduated from "recent session context" to "project knowledge". Move it
to `CLAUDE.md` Gotchas (one concise line) and REMOVE it from the continuatio
prompt. Do not let this section grow beyond 5 items — if it exceeds 5, the
oldest items must either graduate to CLAUDE.md or be dropped.

Before writing the critical rules section, read `CLAUDE.md` Gotchas to check for
duplicates. Every item already in CLAUDE.md MUST be excluded.

### Section 3: Completed Work (Cumulative, Recency-Weighted)

Apply **recency-weighted compression**:

- **Older sessions:** Collapse into a single paragraph (1-2 lines).
- **Recent sessions (N-3 to N-2):** One paragraph each (3-4 lines).
- **Current session (N-1):** One paragraph (1-3 lines) per WP to provide a
  concise update of what was completed, including only genuinely useful
  context - no fluff.

## Section 4: Build Status

```markdown
## Build Status (end of S{NNN})

- [ ] `bun run test` passes ({test_count}+ tests — populate from actual run)
- [ ] `bun lint` passes (0 new errors/warnings)
```

### Section 5: Session Objectives (Work Packages for NEXT Session)

Structure as numbered work packages (WP1, WP2, etc.) with priority labels:

- **(MUST)** — Non-negotiable for the session
- **(SHOULD)** — Important but can be deferred
- **(COULD)** — Nice to have

Each work package must include:

- **Roadmap ref**
- **Spec or source file reference**
- **What** needs to change
- **File(s)** to modify
- **Why** this matters
- **Acceptance criteria**
- **Gotchas** or constraints
- **Estimated effort**

Only include steps/actions to take if these aren't already covered by a
specification.

### Section 6: Agent Allocation

Include a table showing which agents handle which work packages, with file
ownership boundaries to prevent merge conflicts. The Wave column defines
execution order, with work package dependencies managed through wave sequencing.

Add this preamble before the table:

```markdown
## Agent Allocation

Waves execute sequentially. All implementation/spec/plan work packages are
verified via adversarial review within the same wave or the next. Where
adversarial reviews identify any issues, deploy agent(s) to resolve ALL
findings, not just critical/high severity.
```

Then the allocation table:

```markdown
| Agent                | Work Package         | Scope           | Type                                 | Wave |
| -------------------- | -------------------- | --------------- | ------------------------------------ | ---- |
| Main session         | WP{x}                | {Task}          | Main                                 | 1    |
| `wp{1}-{wp-name}`    | WP{1}                | {Task}          | Research-only subagent (no worktree) | 1    |
| `wp{1}-verification` | WP{1} (verification) | Review of WP{1} | Worktree subagent                    | 2    |
| `wp{2}-{wp-name}`    | WP{2}                | {Task}          | Worktree subagent                    | 2    |
| `wp{2}-verification` | WP{2} (verification) | Review of WP{2} | Worktree subagent                    | 3    |
| ...                  | ...                  | ...             | ...                                  | ...  |

**File ownership boundaries:**

- WP{1}: {list all files this WP may create or modify}
- WP{2}: {list all files this WP may create or modify}
```

Every WP must have its file ownership boundaries populated.

### Section 7: Documents to Read Before Starting

Always include CLAUDE.md, post-mvp-roadmap.md, and state-of-the-product.md. Add
additional documents to "Must read first (in order)", as necessary.

```markdown
**Must read first (in order):**

| Document                                 | Purpose                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `CLAUDE.md`                              | Project commands, architecture, schema, gotchas |
| `docs/reference/post-mvp-roadmap.md`     | Implementation priorities; Forward-looking only |
| `docs/reference/state-of-the-product.md` | Canonical product document                      |
| `{example file name}`                    | {Example purpose}                               |
```

Add documents relevant to the next session to "Read per work package".

```markdown
**Read per work package:**

| WP    | Documents                                      |
| ----- | ---------------------------------------------- |
| WP{N} | `docs/specs/{example file name}` - §{N} + §{I} |
| WP{N} | `docs/audit/{example file name}` - §{N}        |
| ...   | ...                                            |
```

---

## Step 6: Write the File

Write the completed continuation prompt to:

```
docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{track}-{purpose-slug}.md
```

See Step 2 for the track-suffix convention. When parallel tracks are active,
always include the track suffix (`main-`, `uisimp-`, etc.).

---

## Step 7: Commit and Push the Draft Immediately

Commit the file as soon as it is written. Committing first guarantees the work
survives a session switch even if Liam cannot review immediately.

```bash
git add docs/continuation-prompts/continuation-prompt-kh-s{NNN}-{track}*.md
git commit -m "docs: draft session {NNN} continuation prompt"
git push
```

After reviewing, if changes are required, Liam will apply these directly and
will create a **new** commit.

---

## Step 8: Update Memory Files

Update your memory files.

This step exists because sessions typically end when the handoff is complete and
Liam takes the continuation prompt to the next session — there is no natural
"wrap up" moment for memory updates otherwise.

---

## Quality Checklist (Self-Review Before Presenting)

Before presenting the file to Liam, verify:

- [ ] UK English throughout (colour, prioritise, organisation, etc.)
- [ ] No template placeholders remain
- [ ] All file paths are relative to project root (not absolute)
- [ ] Build status reflects ACTUAL results, not assumed ones
- [ ] Recency-weighted compression applied (older = shorter)
- [ ] Every WP has acceptance criteria
- [ ] Every WP in agent allocation has file ownership boundaries populated
- [ ] Deferred items carried forward correctly
- [ ] Session number is correct (previous + 1)
- [ ] No emojis anywhere in the document
- [ ] The document is COMPLETE — a future Claude session should be able to start
      working immediately from this prompt alone
- [ ] Readable by a non-developer (plain English, no unexplained jargon)
- [ ] "Critical rules" section has max 5 items, none duplicating CLAUDE.md
- [ ] Items carried 3+ sessions have been graduated to CLAUDE.md or dropped
