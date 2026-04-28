---
name: review
description:
  Review recent code changes against Knowledge Hub project standards. Reads
  check files from `.claude/checks/` and evaluates the diff, producing a
  pass/fail report. Invoke with `/review` or when asked to "review changes",
  "check my code", or "run project checks".
argument-hint: '[optional: git ref range, e.g. HEAD~3, or a branch name]'
allowed-tools: Bash(git *), Bash(wc -l *), Bash(cat *), Read, Glob, Grep
---

# Review Changes Against Knowledge Hub Project Standards

Evaluate recent code changes against the project's quality checks.

Arguments (optional): $ARGUMENTS

- If no arguments given, auto-detect: use `git diff main` if on a branch, or
  `git diff HEAD~5` if on main.
- If a git ref is given (e.g. `HEAD~3`, `feature-branch`), use `git diff <ref>`.

## Step 1: Load Check Files

Read **all** `.md` files from `.claude/checks/`:

```bash
ls .claude/checks/*.md
```

Read each check file in full. Each contains:

- A title and purpose
- Numbered rules
- Examples of violations and correct patterns
- A severity level (error or warning)

Also check for global checks in `~/.claude/checks/` — these apply to all
projects and should be included in the review:

```bash
ls ~/.claude/checks/*.md 2>/dev/null
```

## Step 2: Get the Diff

Determine the appropriate diff command:

1. Check the current branch:
   ```bash
   git branch --show-current
   ```
2. If on `main`, use:
   ```bash
   git diff HEAD~5
   ```
3. If on any other branch, use:
   ```bash
   git diff main
   ```
4. If arguments were provided, use those as the ref:
   ```bash
   git diff <ref>
   ```

Also get the list of changed files:

```bash
git diff --name-only <ref>
```

And get the full diff with context for analysis:

```bash
git diff -U5 <ref>
```

## Step 3: Evaluate Each Check

For **each** check file (project-specific + global), evaluate every rule against
the diff:

1. Read the check file's rules
2. Scan the diff for violations of each rule
3. For each violation found, record:
   - The check file name (e.g. `uk-english`)
   - The specific rule number violated
   - The file path and line number (from the diff)
   - A brief description of the violation
   - The severity (error or warning, as defined in the check file)
4. If a rule is not applicable to the changed files (e.g. no Image components
   changed), mark it as "not applicable"

**Important:** Only flag violations in **new or modified lines** (lines starting
with `+` in the diff). Do not flag issues in removed lines or unchanged context.

## Step 4: Produce the Report

Output a structured report with:

### Summary

- Total checks evaluated
- Total rules checked
- Passed / Failed / Not Applicable counts
- Overall result: PASS (zero errors) or FAIL (one or more errors)

### Results by Check

For each check file, output:

```
## [check-name] — [PASS|FAIL|N/A]

| # | Rule | Result | Details |
|---|------|--------|---------|
| 1 | Rule description | PASS/FAIL/WARN/N/A | file:line — explanation |
| 2 | ... | ... | ... |
```

Use this formatting:

- **PASS** — Rule satisfied in all changed files
- **FAIL** — Error-level violation found (blocks merge)
- **WARN** — Warning-level violation found (should fix but not blocking)
- **N/A** — Rule not applicable to changed files

### Violations Summary

List all failures and warnings grouped by file, with exact line references:

```
### path/to/file.ts
- Line 42: [error] uk-english #3 — "color" should be "colour"
- Line 87: [warning] testing #1 — New utility function without test
```

## Step 5: Offer Fixes

If there are any failures or warnings:

1. List each fixable violation
2. Ask: "Would you like me to auto-fix these issues?"
3. If the user agrees, apply fixes directly to the source files

For unfixable issues (e.g. missing tests), describe what needs to be done.

## Notes

- Be strict on error-level rules, lenient on warnings
- Context matters: a `color` CSS property is fine (that is CSS, not a variable
  name), but a `color` TypeScript variable name or UI string is a violation
- Check files may reference specific project paths — verify those paths still
  exist before flagging
- If `.claude/checks/` is empty or missing, report that no checks are configured
- This project is multi-user — pay special attention to role checks and
  user-scoping
