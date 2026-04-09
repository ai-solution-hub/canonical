---
name: handoff
description: Generate a continuation prompt for the current session. Triggers on "handoff", "continuation prompt", "session handoff", "wrap up session", "create handoff". Automates the structured document that enables seamless session-to-session context transfer.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Session Handoff — Continuation Prompt Generator

Generate a complete continuation prompt following the project's established
template and style conventions. The output is a markdown file that a future
Claude Code session can consume to pick up exactly where this session left off.

**Pre-requisite:** `/update-docs` should have run before this skill. It
regenerates stats, updates the roadmap/backlog, and gathers git context — all
of which are already in the conversation. If `/update-docs` has not been run,
remind the user before proceeding.

---

## Step 1: Read the Most Recent Continuation Prompt

Find existing continuation prompts in `docs/continuation-prompts/`:

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -5
```

If they exist, read the most recent file in full. This provides:
- The cumulative "Completed Work" section to compress further
- The previous session's objectives (to confirm what was done)
- The deferred items list (to carry forward or resolve)

---

## Step 2: Determine the Next Session Number

Parse the highest session number from existing files and add 1. The filename
format is `continuation-prompt-kh-{NN}-{purpose}.md`.

---

## Step 3: Gather Build Status

Git history, file changes, and doc state are already in context from
`/update-docs`. The only new information needed is a fresh build status:

```bash
# Run tests and capture result (use bun run test, NOT bun test)
cd /Users/liamj/Documents/development/knowledge-hub && bun run test 2>&1 | tail -20

# Run lint and capture result
cd /Users/liamj/Documents/development/knowledge-hub && bun lint 2>&1 | tail -10
```

Note: `bun run build` needs `dangerouslyDisableSandbox: true`. Only run if
needed to verify build status — the test and lint results are usually
sufficient for the continuation prompt.

---

## Step 4: Ask Liam for Session Context

Before generating the continuation prompt, ask Liam the following questions.
Present them all at once so he can answer in a single response:

> I am gathering context for the continuation prompt. Please help me fill in
> the gaps:
>
> 1. **Session purpose (for the NEXT session):** What should the next session
>    focus on? Or should I suggest based on what was deferred?
>
> 2. **Key decisions made this session:** Were there any architectural decisions,
>    design choices, or direction changes I should capture?
>
> 3. **Anything that didn't get finished:** Work that was started but not
>    completed, or items that were planned but skipped?
>
> 4. **Anything to flag for next session:** Gotchas discovered, things that
>    almost broke, or important context the next session needs?
>
> 5. **Priority for deferred items:** Any changes to what should be tackled
>    next vs pushed further out?

If Liam says to just generate it based on what you can see, proceed with your
best assessment from the git history and conversation context.

---

## Step 5: Generate the Continuation Prompt

Write the full continuation prompt following these rules:

### Section 1: Header & Identity

```markdown
# {Session Purpose} — Knowledge Hub Session {NN} Continuation Prompt

## Context

Knowledge Hub is a knowledge base platform where the core value is high-quality,
structured data accessible by AI. The first domain application is bid management
for UK SMBs. The knowledge base is the foundation; bids are the first use case,
not the only one.

Forked from the IMS codebase. Multi-user with role-based access (admin/editor/viewer).

**Team:** Liam (product owner) + Claude Code as development partner.

**Read first:** `CLAUDE.md` -- project commands, architecture, schema, gotchas.
**Codebase analysis:** `.planning/codebase/` (7 docs).
```

The Context paragraph should be consistent across all prompts.

After the Context block, include **"Critical rules from recent sessions"** only
for items that meet ALL of these criteria:
1. Discovered in the last 1-2 sessions (genuinely recent)
2. NOT already documented in `CLAUDE.md` Gotchas or elsewhere
3. NOT already captured in memory files
4. Would cause bugs or confusion if a new session didn't know

**Graduation rule:** If an item has been carried across 3+ continuation prompts,
it has graduated from "recent session context" to "project knowledge". Move it
to `CLAUDE.md` Gotchas (one concise line) and REMOVE it from the continuation
prompt. Do not let this section grow beyond 5 items — if it exceeds 5, the
oldest items must either graduate to CLAUDE.md or be dropped.

Before writing the critical rules section, read `CLAUDE.md` Gotchas to check
for duplicates. Every item already in CLAUDE.md MUST be excluded.

### Section 2: Completed Work (Cumulative, Recency-Weighted)

Apply **recency-weighted compression**:

- **Older sessions:** Collapse into a single paragraph (2-3 lines).
- **Recent sessions (N-3 to N-2):** One paragraph each (3-5 lines).
- **Current session (N-1):** Full detail with bullet points.
- **Build Status:** Always include actual results from Step 3.

### Section 3: Session Objectives (Work Packages for NEXT Session)

Structure as numbered work packages (WP1, WP2, etc.) with priority labels:

- **(MUST)** — Non-negotiable for the session
- **(SHOULD)** — Important but can be deferred
- **(COULD)** — Nice to have

Each work package must include:
- **What** needs to change
- **File(s)** to modify
- **Why** this matters
- **Acceptance criteria**
- **Gotchas** or constraints
- **Estimated effort**

Include a **Dependency Graph** showing execution order.

### Section 4: Agent Allocation (if parallel work is possible)

Include a table showing which agents handle which work packages, with file
ownership boundaries to prevent merge conflicts.

### Section 5: Verification Checklist

```markdown
## Verification After This Session

- [ ] `bun run build` passes with 0 errors
- [ ] `bun run test` passes ({test_count}+ tests — populate from actual run)
- [ ] `bun lint` passes (0 new errors/warnings)
- [ ] {Session-specific verification items from WPs}
```

### Section 6: Deferred Items

Carry forward unresolved deferred items. Add new items deferred this session.
Remove completed items.

### Section 7: Documents to Read

Always include `CLAUDE.md` first. Add documents relevant to the next session.

---

## Step 6: Write the File

Write the completed continuation prompt to:

```
docs/continuation-prompts/continuation-prompt-kh-{NN}-{purpose-slug}.md
```

---

## Step 7: Commit the Draft Immediately

**CRITICAL — do not skip.** Commit the file as soon as it is written, BEFORE
presenting it for review. Untracked files in this directory have been
destroyed in the past by worktree operations between sessions (see missing
s144/s148/s150 continuation prompts). Committing first guarantees the work
survives a session switch even if Liam cannot review immediately.

```bash
git add docs/continuation-prompts/continuation-prompt-kh-{NN}-*.md
git commit -m "docs: draft session {NN} continuation prompt"
```

Do NOT push yet — the draft may need edits after Liam reviews.

---

## Step 8: Present for Review

After the draft commit lands, tell Liam:

> The continuation prompt has been written and committed (draft) to
> `docs/continuation-prompts/continuation-prompt-kh-{NN}-{purpose-slug}.md`.
>
> **Please review it** — particularly:
> - Is the session purpose accurate for what you want to do next?
> - Are the work packages correctly prioritised?
> - Is anything missing from the completed work summary?
> - Should any deferred items be promoted or removed?
>
> I will make any edits you request and create a follow-up commit before we
> consider it final.

---

## Step 9: Apply Edits and Push

If Liam requests changes, apply them via `Edit`, then create a **new** commit
(never amend, per the CLAUDE.md rule):

```bash
git add docs/continuation-prompts/continuation-prompt-kh-{NN}-*.md
git commit -m "docs: finalise session {NN} continuation prompt"
git push
```

If Liam approves without edits, skip the edit step and push directly:

```bash
git push
```

---

## Quality Checklist (Self-Review Before Presenting)

Before presenting the file to Liam, verify:

- [ ] UK English throughout (colour, prioritise, organisation, etc.)
- [ ] No template placeholders remain
- [ ] All file paths are relative to project root (not absolute)
- [ ] Build status reflects ACTUAL results, not assumed ones
- [ ] Recency-weighted compression applied (older = shorter)
- [ ] Every WP has acceptance criteria
- [ ] Deferred items carried forward correctly
- [ ] Session number is correct (previous + 1)
- [ ] No emojis anywhere in the document
- [ ] The document is COMPLETE — a future Claude session should be able to
      start working immediately from this prompt alone
- [ ] Readable by a non-developer (plain English, no unexplained jargon)
- [ ] "Critical rules" section has max 5 items, none duplicating CLAUDE.md
- [ ] Items carried 3+ sessions have been graduated to CLAUDE.md or dropped
