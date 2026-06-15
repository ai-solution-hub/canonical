---
description: Generate a change report of recent KB changes and activity
argument-hint: "[--daily | --weekly]"
---

# Change Report Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Tell Claude about recent KB changes; get a structured  |
|  change report with urgency categorisation and actions         |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude pulls live dashboard, freshness, and quality    |
|  data to produce a complete change change report               |
+---------------------------------------------------------+
```

Generate a summary of recent changes to the knowledge base — new content, freshness shifts, quality issues, and items needing review. Helps you stay on top of KB health and team activity.

$ARGUMENTS: Optional period filter (--daily or --weekly). Defaults to all recent changes.
If a file is referenced: @$1

## Usage

```
/kb:change-report
/kb:change-report --daily
/kb:change-report --weekly
```

## Instructions

### 1. Parse Period Filter

Check for optional period arguments:

- **No argument or `--daily`**: Focus on changes from the last 24 hours
- **`--weekly`**: Cover the last 7 days with a broader summary

Use the period to frame the change report scope and set expectations about change volume.

### 2. Fetch Dashboard Data

**If `~~knowledge base` connector is available:**

Call `whats_in_my_queue` to get current KB state including:
- Total item counts and type breakdown
- Items needing attention
- Recent activity feed
- Active form summaries

**If no connector available:**

```
To generate a KB change report, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, share what you know about recent KB changes
and I'll help summarise and prioritise them.
```

### 3. Fetch Freshness Report

Call `where_are_we_exposed` to understand the current freshness landscape:
- How many items are in each state (fresh, aging, stale, expired)
- Whether freshness is improving or declining
- Which domains are most affected

### 4. Identify Changes

Use the @content-governance skill to categorise changes:

**Content Changes:**
- New items added (count, types, domains)
- Items updated or revised
- Items re-classified or re-tagged

**Freshness Changes:**
- Items that moved from fresh to aging
- Items that moved from aging to stale
- Items that became expired
- Items refreshed (moved back to fresh)

**Quality Changes:**
- New quality flags raised
- Quality issues resolved
- Items added to review queue

**Form Activity:**
- New form workspaces created
- Responses drafted or updated
- Forms approaching deadline

### 5. Categorise by Urgency

**Requires Action:**
- Expired content in domains used by active forms
- Quality flags on high-priority items
- Form deadlines within 7 days

**Awareness:**
- Content moving from fresh to aging
- New items added by team
- Forms progressing (responses completed)

**Positive:**
- Content refreshed or updated
- Quality issues resolved
- Form milestones achieved

### 6. Present the Change Report

```
# Knowledge Base Change Report — [DD/MM/YYYY] [Daily | Weekly]

## Summary
[1-2 sentence overview of KB health and notable changes]

## Requires Action ([N] items)

### Freshness
- [N] items moved to stale/expired since last change report
- Worst affected: [Domain] — [N] stale items
- Action: Review and update or archive

### Quality
- [N] new quality flags raised
- Most common issue: [type]
- Action: `/kb:search [topic]` to review flagged items

### Forms
- [Form Name]: Deadline in [N] days, [N] questions unanswered
- Action: `/kb:form-status [name]` for detail

## Recent Activity

### New Content ([N] items)
- [N] Q&A pairs added across [domains]
- [N] articles/policies added
- Notable: [specific significant item if any]

### Updates ([N] items)
- [N] items refreshed (content updated)
- [N] items re-classified
- [N] responses drafted for active forms

## Freshness Snapshot

| State | Count | Change |
|-------|-------|--------|
| Fresh | [N] | [+/-N] |
| Aging | [N] | [+/-N] |
| Stale | [N] | [+/-N] |
| Expired | [N] | [+/-N] |

## Domain Health

| Domain | Items | Health | Trend |
|--------|-------|--------|-------|
| [Domain] | [N] | Good | Stable |
| [Domain] | [N] | Thin | Declining |

---
[Total] items | [N] need action | [N] new since last change report
```

### 7. Handle Edge Cases

**No changes since last check:**
```
# Knowledge Base Change Report — [DD/MM/YYYY]

No significant changes since your last check. Your KB is stable.

Current state: [N] items | [N]% fresh | [N] active forms

Next recommended check: [suggest a timeframe based on activity level]
```

**Many changes (busy period):**
Prioritise and group. Show the top 5-10 most important changes and summarise the rest:
```
[N] total changes — showing the [M] most significant:
[Details]

Other changes: [N] minor updates, [N] routine freshness transitions.
```

## Tips

- Use UK date format (DD/MM/YYYY) throughout
- Compare current state to baseline when possible ("+5 from last change report")
- Focus on actionable changes — routine freshness transitions can be summarised, not listed individually
- Always end with concrete actions the user can take
- Link to other commands: `/kb:coverage` for deep analysis, `/kb:form-status` for form detail
- Keep the change report scannable — users should get the key information in 30 seconds
- Use `--daily` for quick morning check-ins, `--weekly` for end-of-week reviews
