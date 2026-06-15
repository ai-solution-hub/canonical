---
description: Get a reorientation briefing on what changed and what needs attention
argument-hint: ""
---

# Briefing Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Tell Claude your priorities and active forms; get a     |
|  structured briefing and prioritised action list        |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude pulls live reorientation data, form status,      |
|  freshness alerts, and team activity automatically      |
+---------------------------------------------------------+
```

Generate a personalised briefing covering urgent items, team activity, recent work, and active form status. Ideal for starting your day or returning after time away.

$ARGUMENTS: No arguments expected.
If a file is referenced: @$1

## Usage

```
/kb:briefing
```

## Instructions

### 1. Check Time Context

Determine what context is available:

- Has the user mentioned how long they've been away?
- Is this a morning start-of-day briefing?
- Is this a return-from-holiday catch-up?

Use this to frame the urgency and depth of the briefing.

### 2. Fetch Reorientation Data

**If `~~knowledge base` connector is available:**

Call `get_reorientation` to fetch the personalised briefing data. This returns:
- Urgent items needing attention (stale content, quality flags, approaching deadlines)
- Recent team activity (new items, updates by others)
- Your recent work (items you've created or modified)
- Active form status (progress, deadlines, gaps)

Also call `list_active_procurement` to get the current form pipeline overview.

**If no connector available:**

```
To get a personalised briefing, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, tell me about your current priorities, active forms, and
any items you know need attention — I'll help you organise your day.
```

### 3. Identify Urgent Items

Use the @content-governance skill to categorise urgency:

**Critical (act today):**
- Form deadlines within 3 days with unanswered questions
- Expired content referenced in active forms
- Quality flags on high-priority items

**Important (act this week):**
- Stale content that may need updating
- Forms with <50% question completion and deadline within 14 days
- Governance review items pending action

**Awareness (no immediate action):**
- Aging content approaching stale threshold
- New items added by team members
- Completed form responses needing review

### 4. Summarise Team Activity

Present recent activity grouped by theme, not by person:

```
## Recent Activity

### New Content
- [N] new items added across [domains]
- Notable: [specific item if significant]

### Updates
- [N] items updated
- [N] items reviewed or re-classified

### Form Activity
- [Form Name]: [N] new responses drafted
- [Form Name]: Tender documents uploaded
```

### 5. Present Form Status

For each active form, show:

```
## Active Forms

### [Form Name]
- **Deadline**: [DD/MM/YYYY] ([N] days remaining)
- **Progress**: [X]/[Y] questions answered ([Z]%)
- **Gaps**: [N] unanswered questions
- **Confidence**: [Summary of confidence postures]
- **Action needed**: [Specific next step]
```

Sort forms by urgency (closest deadline with most gaps first).

### 6. Recommend Actions

Conclude with a prioritised action list:

```
## Recommended Actions

1. **[Most urgent action]** — [why and what to do]
2. **[Second action]** — [why and what to do]
3. **[Third action]** — [why and what to do]
```

Limit to 3-5 actions. Each should be specific and actionable.

### 7. Format the Briefing

Structure the full output:

```
# Briefing — [DD/MM/YYYY]

## Urgent Items ([N])
[Critical items listed first]

## Active Forms
[Form summaries sorted by urgency]

## Recent Activity
[Grouped by theme]

## Recommended Actions
[Prioritised list]

---
[N] urgent items | [N] active forms | [N] items updated recently
```

## Tips

- Use UK date format (DD/MM/YYYY) throughout
- Frame deadlines in terms of days remaining, not just dates
- Form status should always include percentage completion
- Do not overwhelm — if there are many items, prioritise and summarise
- If no urgent items exist, say so clearly: "No urgent items — your KB is in good shape"
- Suggest running `/kb:form-status [name]` for detailed form investigation
- Suggest running `/kb:coverage` if freshness issues are widespread
