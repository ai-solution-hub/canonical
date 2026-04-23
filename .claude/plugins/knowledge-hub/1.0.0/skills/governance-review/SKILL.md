---
name: governance-review
description: >-
  Walk through the governance review queue to triage pending content changes.
  Guides admin and editor users through inspecting, approving, requesting
  changes to, or reverting content items pending governance review. Captures
  structured reasons for each decision. Use when reviewing pending changes,
  triaging the governance backlog, processing overdue review items, checking
  what needs governance review, or going through the review queue.
---

# Governance Review

Structured workflow for triaging the Knowledge Hub governance queue. Wraps three MCP tools (`get_governance_queue`, `update_governance_status`, `review_governance_item`) into a guided session where each pending item is inspected, acted on, and documented with a structured reason.

## When to Use This Skill

- The user asks to review the governance queue
- The user wants to triage pending items or process the review backlog
- The user asks to approve, request changes to, or revert governance items
- The user asks what items are waiting for governance review
- The user wants to process overdue review items

**Not this skill:**
- Freshness lifecycle definitions, quality flags, or dashboard health interpretation -- use **@content-governance** (framework/principles)
- Content quality review (accuracy, classification, summaries) -- that is the `/review` UI workflow, not governance review

## Roles

| Role | Access |
|------|--------|
| **Admin** | Full workflow -- all actions including approve, request changes, revert |
| **Editor** | Full workflow -- same as admin (MCP tools require editor+) |
| **Viewer** | No access. If `get_governance_queue` returns permission denied, respond: "Governance review requires editor or admin access. Contact your administrator to request the appropriate role." Do not offer a partial read-only path. |

## Workflow

```
Entry
  |
  v
Step 1: Domain Prompt --- (user pre-specified domain) --> skip prompt
  |
  v
Step 2: Discover Queue -- (empty?) --> Step 8: Empty Queue
  |
  v
Step 3: Present Triage Summary
  |
  v
Step 4: Iterate Items ---------------------------------+
  |                                                    |
  v                                                    |
Step 5: Take Action (approve/request_changes/revert)   |
  |                                                    |
  v                                                    |
Step 6: Why-Capture (tier-1 + tier-2)                  |
  |                                                    |
  v                                                    |
Step 7: Confirm + Record -- (more items?) -------------+
  |
  v                      (approved draft items only?)
  +---------> Step 7b: Offer Publish (optional)
  |
  v
Step 9: Session Summary
```

### Step 1: Domain Prompt

Before fetching the queue, ask the user which domain to focus on:

> "Which domain would you like to focus on? (Or say 'all' to triage the whole queue.)"

If the user's triggering message already named a domain, skip this prompt and proceed directly to Step 2.

### Step 2: Discover Queue

Call `get_governance_queue` with `{ limit: 20, offset: 0 }` and the domain from Step 1 (omit domain if "all").

If the call returns a permission-denied error, the user is a viewer -- display the role message from the Roles table above and stop.

If the result is empty (0 items), go to Step 8.

### Step 3: Present Triage Summary

Display a Markdown table of pending items:

| # | Title | Domain | Due Date | Days Overdue |
|---|-------|--------|----------|--------------|

Below the table, show a summary line:

> **Overdue: X | Due this week: Y | Not yet due: Z**

Then ask how to proceed:
- Review all in order (default)
- Overdue only
- Pick specific items by number

### Step 4: Iterate Items

For each item in the working set, present:
- Title, domain, due date
- Last updater and reviewer assignment

Offer five choices: **Approve**, **Request changes**, **Revert**, **Skip** (next item), or **Stop** (end session, go to Step 9).

Maintain an **in-skill session ledger** tracking: item ID, title, chosen action, recorded reason, and outcome. The ledger persists within the conversation for the Step 9 summary.

### Step 5: Take Action

Collect the chosen action (approve / request_changes / revert) and prepare context for Why-Capture. Do **not** call the MCP tool yet.

### Step 6: Why-Capture

Present the tier-1 quick-reason list for the chosen action:

**Approve reasons:**
- Content verified accurate
- Minor update reviewed
- Ownership confirmed
- Freshness reconfirmed

**Request changes reasons:**
- Factual inaccuracy
- Outdated information
- Missing evidence
- Classification error
- Formatting issues

**Revert reasons:**
- Unauthorised change
- Introduced errors
- Superseded by newer version
- Accidental edit

Ask the user to pick one. Then:
- **Approve:** Tier-2 free-text is optional. Offer but do not require.
- **Request changes / Revert:** Prompt for tier-2 free-text elaboration (up to 1000 characters).

Compose the `notes` value:
- With tier-2: `"{tier-1 label}: {tier-2 text}"`
- Without tier-2: `"{tier-1 label}"`

### Step 7: Confirm and Record

Call `review_governance_item` with `{ item_id, action, notes }`.

**On success:** Record the action in the session ledger. If items remain, return to Step 4.

**On "already reviewed" error:** The item was processed by another reviewer. Report: "This item was already reviewed by another user." Skip to the next item.

**Stale-state detection:** Track consecutive "already reviewed" errors. If **2 or more consecutive** items return this error, another reviewer is actively working the queue. Re-fetch via `get_governance_queue` with the same parameters to get a fresh working set, then resume iteration.

**On transient error:** Offer retry or skip. Continue with remaining items.

### Step 7b: Offer Publish (approved draft items only)

This step fires **only** when:
1. The action in Step 5 was `approve`, AND
2. The item is in a `draft` state

After successfully recording the review, ask:

> "Would you also like to publish this item now? (Separate decision from approval -- publishing makes it searchable.)"

On yes: call `update_governance_status` with `{ item_ids: [<id>], status: "publish" }`. Record the publish as a **separate entry** in the session ledger (distinct from the approve entry for audit clarity).

Do **not** trigger this prompt for request_changes or revert actions. If the approved item is already published, skip silently.

### Step 8: Empty Queue

If the queue is empty, display:

> "Queue is clear -- no items pending governance review."

Point to next steps:
- **@content-governance** for KB health interpretation
- **@coverage** for identifying content gaps

If the empty result was filtered by domain, note the filter and suggest trying without it.

### Step 9: Session Summary

After triage completes or the user stops, present:

**Session overview:**
- Items reviewed: N of M total
- Approved: X | Changes requested: Y | Reverted: Z | Skipped: S | Published: P

**Action ledger:**

| Item | Action | Reason | Outcome |
|------|--------|--------|---------|
| (title) | approve | Content verified accurate | Success |
| (title) | publish | -- | Success |

**Remaining:** N items still pending.

If any items were skipped (e.g. due to concurrent reviewer), include them so the user can resume later.

## Pagination

Default batch size is 20 items. If `total > limit`, offer to load the next page after processing the current batch:

> "20 items reviewed. Load next batch?"

For large backlogs (>100 items), offer to raise the page size to 100 for faster throughput.

## Output Format

- Dates in DD/MM/YYYY format
- Item titles truncated to 60 characters in tables
- Overdue days calculated from `governance_review_due` vs current date
- All output in UK English

## MCP Tools Reference

| Tool | When Used | Arguments |
|------|-----------|-----------|
| `get_governance_queue` | Step 2 (discover), pagination, stale re-fetch | `{ limit, offset, domain? }` |
| `review_governance_item` | Step 7 (record review action) | `{ item_id, action, notes? }` |
| `update_governance_status` | Step 7b (publish after approve) | `{ item_ids, status: "publish" }` |

## Related Skills

- **@content-governance** -- Framework and principles: freshness lifecycle, quality flags, triage prioritisation, dashboard health interpretation
- **@coverage** -- Analyse domain coverage gaps
- **@guide-builder** -- Create or update guides organising KB content
