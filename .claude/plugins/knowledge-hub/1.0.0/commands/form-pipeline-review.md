---
description: Pipeline-wide action review — blockers, stalled drafts, and prioritised next actions across all active forms
argument-hint: "[stale_threshold_days]"
---

# Form Pipeline Review Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Describe your pipeline; get blockers, stalled drafts,  |
|  and a flat cross-form action list                       |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude pulls live form detail, confidence postures,     |
|  and response edit timestamps across the whole pipeline |
+---------------------------------------------------------+
```

Surfaces the forms that need work right now — not a status dump. Complements `/kb:form-status` (per-form read) with a workflow framing: what is blocking me, what has gone stale, and what should I do next across all forms.

Stale threshold (days since last edit): $ARGUMENTS
If a file is referenced: @$1

## What I Need From You

**Option A — Pipeline review via connector (recommended):**

```
/kb:form-pipeline-review
/kb:form-pipeline-review 7
```

Pass an optional integer argument to override the "stalled draft" threshold (default 5 days).

**Option B — Manual input (no connector needed):**

```
/kb:form-pipeline-review
[Paste your active-form list with deadlines, question progress, and recent edit activity]
```

## Usage

```
/kb:form-pipeline-review
/kb:form-pipeline-review 7
```

## Instructions

### 1. Parse Arguments

If `$ARGUMENTS` parses as a positive integer, use it as the stale-draft threshold in days. Otherwise default to 5.

### 2. Invoke the `form_pipeline_review` MCP prompt

**If `~~knowledge base` connector is available:**

Invoke the `form_pipeline_review` MCP prompt with `stale_threshold_days` = the parsed value. The prompt template will direct you through:

1. `list_active_procurement(limit: 50)` — full pipeline
2. `get_procurement_detail(id: <form_id>)` for each active form — extract unanswered questions, confidence postures (`no_content`, `needs_sme`), stalled drafts (response `updated_at` older than the threshold)
3. Recent activity classification (active within 7 days vs silent)

Use the `@completing-forms` skill for urgency framing and `@knowledge-synthesis` for cross-form narrative.

**If no connector available:**

```
To review the form pipeline, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, paste:
- Active forms with deadlines + % complete
- Question-level blockers you know about (no_content, needs_sme)
- Recent edit activity (which drafts were last touched when)
```

### 3. Structure the Output

```
## Form pipeline review — DD/MM/YYYY

### Critical blockers (action today)
- [FormName] — Q[N]: no_content on [topic]. Need a KB item covering [topic].
- [FormName] — Q[N]: no_content on [topic].

### Stalled drafts (action this week)
- [FormName] — Q[N]: last edit DD/MM/YYYY ([X] days, threshold [N]). Was in draft state.

### SME input needed
- [FormName] — Q[N]: needs_sme on [topic].

### Recent activity
- Active (edited last 7 days): [FormA, FormB]
- Silent (no edits 7+ days): [FormC, FormD]

### Prioritised next actions
1. [Cross-form action ordered by deadline × blocker severity]
2. [Next]
3. [Next]
```

### 4. Prioritise

Order actions by:
1. Forms with deadlines < 7 days AND unresolved blockers first.
2. Forms with stalled drafts past the threshold second.
3. SME escalations third.
4. If an item has zero blockers, omit from the blocker sections (still list in Recent activity).

Limit to 3-5 actions — this is a focus list, not a full task inventory.

### 5. Handle Edge Cases

**Empty pipeline:**

```
No active forms in the pipeline.

For historical context, use `/kb:form-status` (or tell me about forms you're preparing).
```

**No blockers anywhere (rare):**

```
Pipeline is clean — no blockers, no stalled drafts. Recent activity:
- Active: [list]
- Silent: [list]

Next action: consider `/kb:coverage` to spot pre-emptive gaps, or `/kb:draft-response` to start the next unanswered question.
```

## Tips

- UK English throughout. DD/MM/YYYY dates.
- Stale threshold defaults to 5 days; override with an integer arg (e.g. `/kb:form-pipeline-review 7`).
- Cross-reference: `/kb:form-status <form>` for a per-form deep-dive on anything this review surfaces.
- Cross-reference: `/kb:draft-response "<question>"` for drafting a specific answer.
- Do NOT emit per-form progress tables — that's `/kb:form-status`. This command is action-oriented.
