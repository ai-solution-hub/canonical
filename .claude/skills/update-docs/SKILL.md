---
name: update-docs
description: Update roadmap, product backlog, auto-generated stats, and product-functionality docs to reflect the current session's work, then auto-chain to /handoff. Triggers on "update docs", "update roadmap", "update backlog".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Skill
---

# Update Docs — Session Documentation Sync

Updates roadmap, product backlog, auto-generated stats, and product-functionality
docs to reflect the current session's work, then auto-chains to `/handoff` to
generate the continuation prompt. The user reviews the continuation prompt at the end.

## Document Roles (READ FIRST)

The planning documents have distinct, non-overlapping roles. Future agents
must respect this distinction or the docs will drift back into chaos:

| Document | File | Role |
|---|---|---|
| **Roadmap** | `docs/reference/post-mvp-roadmap.md` | **Forward-looking only.** Active and ready-for-implementation items. Never contains Done/Resolved items. |
| **Product backlog** | `docs/reference/product-backlog.md` | Items not currently on the roadmap. Active, deferred, and "needs spec" items. |
| **State of the product** | `docs/reference/state-of-the-product.md` | **Canonical record of what is CURRENTLY built.** Describes the platform in its present state, organised by functional area (Feature State, AI Integration Points, Test Infrastructure, etc.). Updated whenever a significant feature lands — updates integrate into the relevant functional section, NOT as per-session addendum blocks. |
| **State of the product — history** | `docs/reference/state-of-the-product-history.md` | **Frozen historical archive** of per-session "what shipped in session N" narrative blocks (S53→S152A), split out of the canonical doc in S152B WP10 (commit `3e3eccc5`) to keep the canonical doc under control. **Do NOT write new session additions to this file** — it is read-only and only touched to correct historical errors. New session deliverables go into `state-of-the-product.md`. |
| **Backlog completed archive** | `docs/reference/product-backlog-completed.md` | Frozen historical record of completed backlog items. |

**The canonical vs history split (important for all future sessions):** The
S152B WP10 split took `state-of-the-product.md` from 2325 lines to a
canonical 674 lines + the 1695-line history file. The canonical doc now
describes only the **current** state, not the evolution. When landing new
work in a session:

- **DO:** Find the relevant functional section in `state-of-the-product.md`
  (e.g. "Sector Intelligence (Phases 0-1d + Production Hardening)") and
  add the new capability to the description of what's built today.
- **DO NOT:** Append a "Session NNN Additions" block at the bottom of the
  canonical doc. That pattern was explicitly deprecated in S152B WP10 —
  it caused the unbounded growth that forced the split.
- **DO NOT:** Write anything to `state-of-the-product-history.md`. It is
  frozen as a point-in-time snapshot through S152A.

When marking something Done, **move it out of the backlog/roadmap** to the
appropriate destination — never leave Done items in either active document.

---

## Step 1: Regenerate Auto-Generated Stats

Run both stats scripts to ensure the generated files reflect the current
session's changes.

```bash
# Regenerate codebase statistics
cd /Users/liamj/Documents/development/knowledge-hub && bun run stats

# Regenerate MCP tool/resource/prompt inventory
cd /Users/liamj/Documents/development/knowledge-hub && bun run generate:mcp-inventory
```

If either script fails, report the error but do not block the rest of the
update.

Check if anything changed and commit if so:

```bash
git diff --quiet docs/generated/ || (git add docs/generated/ && git commit -m "chore: regenerate codebase stats and MCP inventory")
```

---

## Step 2: Understand Session Work

Gather context about what was accomplished:

```bash
# Recent commits
git log --oneline -30 --no-decorate

# Files changed
git diff --name-only HEAD~30 HEAD 2>/dev/null | head -100
```

Also read the conversation context and any task tracking to understand which
work packages were completed, partially completed, or deferred.

---

## Step 3: Update Product Backlog

**File:** `docs/reference/product-backlog.md`

Read the file, then for each item that was addressed this session:

1. **Done items must move out** — when marking something Done, do NOT leave it
   in the main backlog with a `Done` status. Move it to
   `docs/reference/product-backlog-completed.md` (the archive) with the session
   number, OR if it was promoted to the roadmap and then completed, move it to
   `state-of-the-product.md`. The active backlog should only contain items that
   are still actionable, deferred, or in-progress.

2. Update the **status** of any in-progress items (e.g. `Partial`, with a note
   about what remains).

3. Update the **summary counts** at the top of the file to match the new
   status distribution.

4. Add any **new backlog items** discovered during the session (bugs found,
   UX issues observed, missing features identified).

---

## Step 4: Update Roadmap

**File:** `docs/reference/post-mvp-roadmap.md`

Read the file, then:

1. Move any completed roadmap items to `state-of-the-product.md` (the canonical
   built record). The roadmap is **forward-looking only** — never leave Done items
   in it. If a completed item was previously promoted from the backlog, it can
   ALSO be referenced from `product-backlog-completed.md` for the historical
   trail, but the primary destination is state-of-the-product.
2. Update statuses for in-progress items (with effort and source-spec references
   where helpful).
3. Add new items discovered during the session — under the appropriate
   domain section (Sector Intelligence, AI Evaluation, Bid Workflow, etc.).
4. Reorder if priorities have shifted based on user feedback.

---

## Step 5: Update State of the Product (conditional)

**File:** `docs/reference/state-of-the-product.md` (canonical — CURRENT state)
**Do NOT touch:** `docs/reference/state-of-the-product-history.md` (frozen archive)

If the session introduced significant architecture changes, new features, or
removed major components, update `state-of-the-product.md`. Skip if the session
was primarily bug fixes, styling, or minor enhancements.

**How to update (important — the S152B WP10 split rule):**

1. **Find the relevant functional section** (e.g. "Sector Intelligence",
   "AI Evaluation", "Test Infrastructure", "MCP Server Integration"). Read
   the existing section structure — each section describes the
   present-tense capability, not a session-by-session changelog.
2. **Integrate the new capability into the section's narrative.** If the
   new work extends an existing bullet (e.g. "Phase 1c Prompt Refinement
   Skill landed Phase 1b"), update the bullet in place. If it's a genuinely
   new sub-capability, add a new bullet with a session marker in parentheses
   (e.g. "(S155 WP3)").
3. **DO NOT append a "Session NNN Additions" block.** That pattern was
   deprecated in S152B WP10. New per-session additions belong inside the
   functional sections, integrated with what's already there.
4. **If a feature was REMOVED or rewritten**, update the description to
   match the new state, not to track both old and new.
5. **If a functional section does not exist for the work** (rare), add a
   new section at the bottom of §5 Feature State or §8 AI Integration
   Points, whichever fits. Do not create an entirely new top-level section
   unless the work warrants it.

**Check the history file is untouched:**

```bash
# state-of-the-product-history.md should be unchanged this session
git diff --quiet docs/reference/state-of-the-product-history.md || \
  echo "WARNING: history file modified — this is almost always wrong; history is frozen through S152A"
```

---

## Step 6: Update Product Functionality Docs (Conditional)

**File directory:** `docs/product-functionality/`

The product-functionality docs are session-dated snapshots. They must be kept
aligned as the Sector Intelligence, AI/Prompt Engineering, and other workstreams
add features in parallel.

1. Check which functional areas this session's work touched:

```bash
# See which product-functionality areas are affected by this session's commits
git diff --name-only HEAD~20 HEAD 2>/dev/null | grep -E "^(app/api|lib/ai|lib/mcp|components|hooks)" | head -50
```

2. Map the changed paths to functional areas using this table:

| Changed Path Pattern | Functional Area Doc |
|---|---|
| `app/api/bids/`, `lib/ai/draft.ts`, `lib/ai/match.ts` | `bid-management/` |
| `app/api/items/`, `app/api/ingest/`, `app/api/extract/` | `content-management/` |
| `app/api/search/`, `hooks/use-search.ts` | `search/` |
| `app/api/governance/`, `app/api/review/`, `lib/quality-score.ts` | `quality-governance/` |
| `app/api/taxonomy/`, `app/api/entities/`, `app/api/guides/`, `app/api/coverage/` | `knowledge-organisation/` |
| `lib/ai/`, `lib/mcp/`, `app/api/mcp/` | `ai-integration/` |
| `app/api/settings/`, `app/api/admin/`, cron routes | `administration/` |

3. For each affected area:
   - Check if a doc already exists in `docs/product-functionality/[area]/`
   - If **no doc exists yet** — add a note to the deferred items in the continuation prompt
     (do not create a doc mid-session; docs are written in dedicated documentation sessions)
   - If **a doc exists** — open it and:
     a. Identify any claims that are now outdated
     b. Add a brief addendum section at the bottom:
        ```markdown
        ## Updates — Session NNN
        - [describe what changed]
        ```
     c. Update the `Last verified` header date and session number
     d. Mark any sections that need fuller review with `[NEEDS REVIEW — updated S{NNN}]`

4. If the addition is substantial (a whole new feature area, not a tweak), flag it in
   the session report so a dedicated documentation sub-session can be planned.

```bash
# Commit any product-functionality doc updates
git diff --quiet docs/product-functionality/ || \
  (git add docs/product-functionality/ && \
   git commit -m "docs: patch product-functionality docs for session changes")
```

---

## Step 7: Commit Reference Doc Changes

Stage the canonical docs only. `state-of-the-product-history.md` is frozen
and should NOT be staged — if it shows in `git diff`, investigate before
committing.

```bash
# Commit reference doc updates (canonical files only — history file is frozen)
git diff --quiet docs/reference/ || \
  (git add docs/reference/post-mvp-roadmap.md docs/reference/product-backlog.md \
   docs/reference/product-backlog-completed.md docs/reference/state-of-the-product.md 2>/dev/null && \
   git commit -m "chore: update roadmap, backlog, and reference docs for session")

# Safety check: warn if the frozen history file was modified
git diff --quiet docs/reference/state-of-the-product-history.md || \
  echo "WARNING: state-of-the-product-history.md has uncommitted changes — this file is frozen (S152B WP10 split). Investigate before committing."
```

---

## Step 8: Report and Chain to Handoff

Present a summary to the user:

> Documentation updated:
> - **Stats:** {regenerated / no changes}
> - **Backlog:** {N items updated — X done, Y partial, Z new}
> - **Roadmap:** {N items updated}
> - **State of product:** {updated / no changes needed}
> - **Product-functionality docs:** {N areas patched / no existing docs affected / N areas flagged for doc session}
>
> Generating continuation prompt now.

Then invoke the `/handoff` skill. All session context (git history, doc state,
conversation) is already loaded — handoff will use it directly without
re-gathering.
