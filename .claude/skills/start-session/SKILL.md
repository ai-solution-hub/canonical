---
name: start-session
description: Run at the start of every new session. Cleans up git worktrees, reads critical documents, then asks the user to paste the continuation prompt. Triggers on "start session", "new session", "session start", "begin session".
allowed-tools: Read, Bash, Grep, Glob, Agent, Skill
---

# Start Session — Pre-flight and Context Loading

Run this skill at the beginning of every new Knowledge Hub session. It ensures
a clean working environment, loads critical context, and asks the user to provide 
the continuation prompt before any implementation work begins.

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

Report any unmerged worktree branches or uncommitted changes. If unmerged 
branches exist, deploy an agent to investigate whether they should be merged 
or deleted.

**Parallel track worktrees vs agent worktrees:** The project may have two
types of worktrees:

- **Top-level track worktrees** (e.g.
  `/Users/liamj/Documents/development/knowledge-hub-ui-ux-simplification`)
  — long-lived worktrees for parallel development tracks. These have their
  own continuation prompts and are NOT cleaned up between sessions. Do not
  delete or prune these.
- **Agent worktrees** under `.claude/worktrees/` — ephemeral worktrees
  created by `isolation: "worktree"` during sessions. These SHOULD be
  cleaned up (prune + delete merged branches).

When reporting worktree state, distinguish between the two types.

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

Read the MEMORY.md file from the project memory directory. 

---

## Step 3: Review Continuation Prompt and Confirm Session Plan

```bash
ls -1 docs/continuation-prompts/continuation-prompt-kh-*.md 2>/dev/null | sort -V | tail -2
```

1. Read the continuation prompt for your repo thoroughly
2. Read any referenced specs in full before planning implementation
3. Identify the session objectives and work packages
4. Present a summary to the user:

> ## Session {NNN} Plan
>
> **Objectives:** {summarise from continuation prompt}
>
> **Work packages:** {list WPs with priority}
>
> **Execution strategy:** {wave structure, parallel agents, dependencies}
>
> **Estimated scope:** {hours of work}
>

5. Invoke `/using-agent-skills`, taking note of any skills which will be relevant to you for your tasks this session, or which should be provided to subagents based on their respective tasks e.g., `/spec-driven-development` if a task requires a new spec, `/planning-and-task-breakdown` if a spec requires decomposing to tasks, `/code-simplification` when adversarially reviewing a spec/plan, `/code-review-and-quality` if implementation work is being adversarially reviewed, `/documentation -and-adrs` for documentation-related tasks, and so on.

6. Proceed with outlined plan - if any adjustments are required, user will notify you.

---

## Implementation Workflow (MUST FOLLOW)

This is the core execution discipline for the project. Every implementation
must follow this workflow.

### Agent Work Limits

- **Max 2 hours of work per agent** — never let one agent complete an entire
  multi-phase spec without a verification gate. If a spec/plan is estimated at
  more than 2 hours, split it between sequential agents with verification 
  between each stage.
  
### Agent Skills  

When deploying the agent make it clear which agent-skill they should be invoking based on the task(s) they will be assigned. 

### Verification Gates

After EVERY implementation and spec/plan-writing agent completes, deploy a **separate verification
agent** before merging. This is not optional. The verification agent must:

1. Read the spec/plan requirements for the implemented work
2. Read the implementation code
3. Check spec/plan compliance — are all requirements met?
4. Check code quality — semantic tokens, UK English, auth patterns, error handling
5. Check test quality — do tests verify real behaviour, not just mock returns?
6. Return a verdict: **PASS** / **PASS WITH NOTES** / **FAIL**

**Fix ALL verification findings** (including minor/low severity) before
merging. Deploy a fix agent for any findings, no matter the severity. Not 
integrating all findings creates unneccessary technical debt that can be easily 
avoided by doing things right the first time.

### Wave Structure

1. **Wave N implementation:** Launch parallel worktree agents (strict file
   ownership, no overlap)
2. **Wave N verification:** Deploy verification agents after all
   implementation agents complete
3. **Wave N fix:** Fix any findings from verification
4. **Wave N merge:** Merge worktrees sequentially, run full test suite after
   each merge
5. Proceed to Wave N+1 only after current wave is merged and green

### Documentation

Documentation will be updated at the end of the session when `/update-docs` is invoked. There is no requirement to update reference documentation (roadmap, state-of-the-product, etc.) throughout the session.

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
- **ALL verification gaps must be fixed** — even minor ones
- **Semantic tokens only** — never raw Tailwind colours in components
- **UK English throughout** — DD/MM/YYYY, colour, organisation
