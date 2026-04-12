---
name: update-docs
description: Update roadmap, state of the product, auto-generated stats, product-functionality docs, and product backlog to reflect the current session's work, then auto-chain to /handoff. Triggers on "update docs", "update roadmap", "update state of the product", "update backlog".
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Skill
---

# Update Docs — Session Documentation Sync

Updates roadmap, state-of-the-product, auto-generated stats, product-functionality, and product backlog docs to reflect the current session's work, then auto-chains to `/handoff` to
generate the continuation prompt. The user reviews the continuation prompt at the end.

## Document Roles (READ FIRST)

The planning documents have distinct, non-overlapping roles. Future agents
must respect this distinction or the docs will drift back into chaos:

| Document | File | Role |
|---|---|---|
| **State of the product** | `docs/reference/state-of-the-product.md` | **Canonical record of what is CURRENTLY built.** Describes the platform in its present state, organised by functional area (Feature State, AI Integration Points, Test Infrastructure, etc.). Updated whenever a significant feature lands — updates integrate into the relevant functional section. |
| **Roadmap** | `docs/reference/post-mvp-roadmap.md` | **Forward-looking only.** Active and ready-for-implementation items. All session work is driven from here. Never contains Done/Resolved items. |
| **Product backlog** | `docs/reference/product-backlog.md` | It's unlikely that product backlog items will have been completed during the session as the roadmap drives implementation priorities, but it's possible that new items may have been identified during the session, which will need to be added to the backlog, awaiting promotion to the roadmap. |
| **State of the product — history** | `docs/reference/state-of-the-product-history.md` | **Frozen historical archive** of per-session "what shipped in session N" narrative blocks (S53→S152A), split out of the canonical doc in S152B WP10 (commit `3e3eccc5`) to keep the canonical doc under control. 
| **Backlog completed archive** | `docs/reference/product-backlog-completed.md` | Frozen historical record of completed backlog items. |

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

## Step 3: Update Roadmap

**File:** `docs/reference/post-mvp-roadmap.md`

Read the file, then:

1. Move any completed roadmap items to `state-of-the-product.md` (the canonical
   built record) and the relevant product-functionality document(s). The roadmap is **forward-looking only** — never leave Completed/Done items in it. This provides clear visibility of priority, actionable tasks on the roadmap, which can be updated with new items from the product backlog when capacity allows/priorities evolve.
2. Update statuses for in-progress items (with effort and source-spec references
   where helpful).
3. Add new items discovered during the session — under the appropriate
   domain section (Sector Intelligence, AI Evaluation, Bid Workflow, etc.).
4. Reorder if priorities have shifted based on user feedback.

---

## Step 4: Archive Completed Specs (Conditional)

**"Spec" below also applies to "plan" files.*

If any roadmap items were marked as completed in Step 3, check whether their
backing spec is now fully delivered — i.e. **every item** in the spec has
shipped. A spec is only archived once ALL of its items are complete, not before.

For each fully-completed spec:

1. Move it to `.planning/.archive/.specs/`:

```bash
git mv docs/specs/<spec-file>.md .planning/.archive/.specs/<spec-file>.md
```

2. Update any roadmap or state-of-the-product references that point to the old
   path.

If a spec still has outstanding items (even one), leave it in `docs/specs/`.

```bash
# Commit any archived specs
git diff --cached --quiet || git commit -m "chore: archive completed specs"
```

---

## Step 5: Update State of the Product

**File:** `docs/reference/state-of-the-product.md` (canonical — CURRENT state)

If the session introduced significant architecture changes, new features, or
removed major components, update `state-of-the-product.md`. Skip if the session
was primarily bug fixes, styling, or minor enhancements.

**How to update:**

1. **Find the relevant functional section** (e.g. "Sector Intelligence",
   "AI Evaluation", "Test Infrastructure", "MCP Server Integration" etc.). Read
   the existing section structure — each section describes the
   present-tense capability, not a session-by-session changelog.
2. **Integrate the new capability into the section's narrative.** If the
   new work extends an existing bullet (e.g. "Phase 1c Prompt Refinement
   Skill landed Phase 1b"), update the bullet in place. If it's a genuinely
   new sub-capability, add a new bullet with a session marker in parentheses
   (e.g. "(S155 WP3)").
3. **If a feature was REMOVED or rewritten**, update the description to
   match the new state, not to track both old and new.
5. **If a functional section does not exist for the work** (rare), add a
   new section at the bottom of §5 Feature State or §8 AI Integration
   Points, whichever fits. Do not create an entirely new top-level section
   unless the work warrants it.
6. **If you notice that a section hasn't followed this aproach** (e.g., content appears like a session-by-session changelog), resolve this if it's the section(s) your actively updating, or for separate sections flag this as an action to be resolved in the next session and add to the continuation prompt created during /handoff - this keeps the document aligned and representative of the canonical product state.

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
   - If **no doc exists yet — add a note to the deferred items** in the continuation prompt that you are about to create during /handoff (do not create a doc mid-session; docs are written in dedicated documentation sessions)
   - If **a doc exists** — open it and:
     a. Identify any claims that are now outdated
     b. Update the relevant section, replacing outdated information
     c. Update the `Last verified` header date and session number
     d. Mark any sections that need fuller review with `[NEEDS REVIEW — updated S{NNN}]`

4. If the addition is substantial (a whole new feature area, not a tweak), flag it in the
   continuation prompt that you are about to create during /handoff so a dedicated documentation sub-session can be planned. The table in 'Step 5: Item 2' will also need to be updated to include the new path/functional area.

```bash
# Commit any product-functionality doc updates
git diff --quiet docs/product-functionality/ || \
  (git add docs/product-functionality/ && \
   git commit -m "docs: update product-functionality docs with session changes")
```

---

## Step 7: Update Product Backlog (Conditional)

**File:** `docs/reference/product-backlog.md`

If new work items were discovered in the session which aren't related to sections already covered by the product roadmap, these will need to be added to the product backlog, awaiting prioritisation. 

It's also possible that during the session an item or items have been identified as candidates for promotion to the roadmap.

Read the file, then for each item that was identified in this session:

1. Add a **new backlog item** under the relevant section (bugs found, UX issues observed, missing features identified).

2. **If an item was identifed for promotion to the roadmap, remove it entirely from the backlog and create a record in the roadmap document.

3. Update the **summary counts** at the top of the file to match the new status distribution.

---

## Step 8: Commit Reference Doc Changes

Stage the canonical docs.

```bash
# Commit reference doc updates
git diff --quiet docs/reference/ || \
  (git add docs/reference/post-mvp-roadmap.md docs/reference/state-of-the-product.md \
  docs/reference/product-backlog.md 2>/dev/null && \
  
   git commit -m "docs: update reference docs for session")
```

---

## Step 9: Report and Chain to Handoff

Present a summary to the user:

> Documentation updated:
> - **Stats:** {regenerated / no changes}
> - **Roadmap:** {N items updated — X done, Y partial, Z new}
> - **Specs archived:** {N specs archived / none eligible}
> - **State of product:** {updated / no changes needed}
> - **Product-functionality docs:** {N areas updated / no existing docs affected / N areas flagged for doc session}
> - **Backlog:** {N items updated — Z new}
>
> Generating continuation prompt now.

Then invoke the `/handoff` skill. All session context (git history, doc state,
conversation) is already loaded — handoff will use it directly without
re-gathering.
