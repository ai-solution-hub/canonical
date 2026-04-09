---
name: start-session
description: Run at the start of every new session. Cleans up git worktrees, reads critical documents, reviews execution skills, then asks the user to paste the continuation prompt. Triggers on "start session", "new session", "session start", "begin session".
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill
---

# Start Session — Pre-flight and Context Loading

Run this skill at the beginning of every new Knowledge Hub session. It ensures
a clean working environment, loads critical context, reviews execution skills,
and asks the user to provide the continuation prompt before any implementation
work begins.

---

## Step 1: Git Hygiene (parallel)

Run these commands to clean up stale worktrees and branches from previous
sessions:

```bash
# Prune orphaned worktrees
git worktree prune

# Delete merged worktree branches
git branch --merged main | grep worktree | xargs -r git branch -d

# Count remaining worktree branches (informational)
git branch | grep worktree | wc -l

# Verify clean working tree
git status
```

Report any unmerged worktree branches or uncommitted changes. Do NOT delete
unmerged branches without asking the user first. If unmerged branches exist,
deploy an agent to investigate whether they should be merged or deleted.

---

## Step 2: Read Critical Documents (parallel with Step 1)

Read these documents in parallel to load context:

### 2a: CLAUDE.md

```
Read file: CLAUDE.md
```

This contains commands, architecture, schema, gotchas, and conventions. Pay
special attention to the "Gotchas" section — the implementation workflow is
covered in Step 4 below.

### 2b: Memory Files

Read the MEMORY.md file from the project memory directory. This provides the
current project state, build status baseline, specs ready for implementation,
and learned rules from previous sessions.

### 2c: Latest Continuation Prompt (identify but do NOT read yet)

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -1
```

Note the filename for Step 4.

---

## Step 3: Using Git Worktrees

Invoke the `using-git-worktrees` skill via the Skill tool. This ensures the session has the latest guidance loaded before planning agent allocation.

Key points to absorb:
- When and how to create isolated worktrees for parallel implementation
- Smart directory selection and safety verification
- Commit-before-finish protocol (auto-cleanup destroys uncommitted work)
- Sequential merge strategy with test suite verification

This is a built-in Claude Code skill — invoke with the Skill tool. This will help inform the agent allocation and wave structure presented in Step 5.

---

## Step 4: Request Continuation Prompt

After Steps 1-3 are complete, present this message to the user:

> Pre-flight checks complete:
> - Git: {N} stale worktree branches cleaned, working tree is clean
> - Memory loaded: Session {N} state
> - Execution skills reviewed (worktrees + parallel agents)
>
> The latest continuation prompt is:
> `docs/continuation-prompts/{filename}`
>
> **Please paste the continuation prompt into the chat** so I have the full
> session context before we begin. I will not start any implementation work
> until I have reviewed it.

**IMPORTANT:** Wait for the user to paste the continuation prompt. Do NOT
proceed with any implementation, planning, or code changes until the
continuation prompt has been received and reviewed.

---

## Step 5: Review and Confirm Session Plan

After receiving the continuation prompt:

1. Read it thoroughly
2. Read any referenced specs in full before planning implementation
3. Identify the session objectives and work packages
4. Present a summary to the user:

> ## Session {N} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Work packages:** {list WPs with priority}
>
> **Execution strategy:** {wave structure, parallel agents, dependencies}
>
> **Estimated scope:** {hours of work}
>

5. Proceed with outlined plan - if any adjustments are required, user will notify you

---

## Implementation Workflow (MUST FOLLOW)

This is the core execution discipline for the project. Every implementation
must follow this workflow.

### Agent Work Limits

- **Max 2-4 hours of work per agent** — never let one agent do an entire
  multi-phase spec without a verification gate. If a spec is estimated at
  more than 4 hours, split it into phases for sequential agents, with verification between each.
- The work limit depends on complexity: simpler tasks (styling, small
  features) can run to 4 hours; complex tasks (new API endpoints, data model
  changes) should verify after 2 hours of work.

### Verification Gates

After EVERY implementation agent completes, deploy a **separate verification
agent** before merging. This is not optional. The verification agent must:

1. Read the spec requirements for the implemented work
2. Read the implementation code
3. Check spec compliance — are all requirements met?
4. Check code quality — semantic tokens, UK English, auth patterns, error handling
5. Check test quality — do tests verify real behaviour, not just mock returns?
6. Run the test suite (`bun run test`)
7. Return a verdict: **PASS** / **PASS WITH NOTES** / **FAIL**

**Fix ALL verification findings** (including minor/low severity) before
merging. Deploy a fix agent for any notes, no matter the severity.

### Wave Structure

1. **Wave N implementation:** Launch parallel worktree agents (strict file
   ownership, no overlap)
2. **Wave N verification:** Deploy verification agents after all
   implementation agents complete
3. **Wave N fix:** Fix any findings from verification
4. **Wave N merge:** Merge worktrees sequentially, run full test suite after
   each merge
5. Proceed to Wave N+1 only after current wave is merged and green

---

## Critical Reminders

These are the most commonly missed items across sessions:

- **`bun run test`** not `bun test` — the latter runs Bun's built-in test
  runner, not Vitest
- **`bun run build`** needs `dangerouslyDisableSandbox: true`
- **Worktree agents MUST commit to their worktree** before finishing — auto-cleanup destroys
  uncommitted work
- **Merge worktrees sequentially**
- **Never run two sessions on the same working tree** — they destroy each
  other's untracked files
- **ALL verification gaps must be fixed** — even minor ones (user preference)
- **Semantic tokens only** — never raw Tailwind colours in components
- **UK English throughout** — DD/MM/YYYY, colour, organisation
