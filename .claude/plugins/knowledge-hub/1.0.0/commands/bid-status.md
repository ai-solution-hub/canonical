---
description: Overview of active bids with progress, gaps, and deadlines
argument-hint: "[bid name]"
---

# Bid Status Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Tell Claude about your bids; get urgency ranking,      |
|  gap analysis, and prioritised actions                  |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude pulls live bid data, question-level progress,   |
|  confidence postures, and deadline tracking              |
+---------------------------------------------------------+
```

Show an overview of active bids sorted by urgency. Optionally focus on a specific bid for detailed analysis including question-level progress, confidence postures, and response gaps.

Focus on this bid: $ARGUMENTS
If a file is referenced: @$1

## What I Need From You

**Option A — Overview of all bids (connector required):**
```
/kb:bid-status
```

**Option B — Focus on a specific bid (connector required):**
```
/kb:bid-status NHS Digital Framework
```

**Option C — Manual input (no connector needed):**
```
/kb:bid-status
[Paste your bid details, question list, or deadline information]
```

## Usage

```
/kb:bid-status
/kb:bid-status NHS Digital Framework
/kb:bid-status Highways England
```

## Instructions

### 1. Parse Arguments

Determine the scope:

- **No argument**: Show all active bids overview
- **Bid name provided**: Focus on that specific bid with full detail

### 2. List Active Bids

**If `~~knowledge base` connector is available:**

Call `list_active_bids` to get the full pipeline. This returns:
- Bid name and buyer
- Submission deadline and days remaining
- Question count and completion progress
- Current status (active, draft, submitted)

If a bid name was provided, identify the matching bid from the list.

**If no connector available:**

```
To view your bid pipeline, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, tell me about your active bids and I'll help you
organise them by urgency and identify gaps.
```

### 3. Sort by Urgency

Rank bids using the @bid-writing skill urgency framework:

| Priority | Criteria |
|----------|----------|
| **Critical** | Deadline within 7 days AND completion <80% |
| **High** | Deadline within 14 days AND completion <60% |
| **Medium** | Deadline within 30 days OR completion <40% |
| **On track** | Deadline >30 days AND completion >60% |

### 4. Get Detail for Focus Bid

If a specific bid was requested, call `get_bid_detail` with the bid ID to get:
- Full question list with section groupings
- Response status per question (answered, draft, unanswered)
- Confidence postures (strong_match, partial_match, needs_sme, no_content)
- Word limits and response lengths

For the top bid questions, optionally call `get_bid_question` for individual question detail.

### 5. Identify Gaps

Analyse the bid data to surface:

**Unanswered questions** — grouped by section, with the hardest gaps highlighted:
- Questions with `no_content` confidence (no KB material available)
- Questions with `needs_sme` confidence (need subject matter expert input)
- Questions in sections with no responses at all

**Evidence gaps** — questions where the KB may have supporting material but no response has been drafted:
- Suggest running `/kb:search` or `/kb:draft-response` for specific questions

**Quality concerns** — responses that may need attention:
- Responses below word limit by >20%
- Responses with `partial_match` confidence that could be strengthened

### 6. Present the Overview

**For all bids:**

```
# Active Bids Overview

## Critical
### [Bid Name] — [Buyer]
- **Deadline**: [DD/MM/YYYY] ([N] days)
- **Progress**: [X]/[Y] questions ([Z]%)
- **Gaps**: [N] unanswered, [N] need SME input
- **Action**: [Specific recommendation]

## High Priority
### [Bid Name] — [Buyer]
[Same format]

## On Track
### [Bid Name] — [Buyer]
[Same format]

---
[Total] active bids | [N] critical | [N] high | [N] on track
```

**For a specific bid:**

```
# [Bid Name] — Detailed Status

**Buyer**: [Buyer name]
**Deadline**: [DD/MM/YYYY] ([N] days remaining)
**Overall Progress**: [X]/[Y] questions answered ([Z]%)

## By Section

### [Section 1 Name]
| # | Question | Status | Confidence | Word Limit |
|---|----------|--------|------------|------------|
| 1 | [Question text, truncated] | Answered | Strong | 500/500 |
| 2 | [Question text, truncated] | Draft | Partial | 280/400 |
| 3 | [Question text, truncated] | Unanswered | — | —/300 |

### [Section 2 Name]
[Same format]

## Gaps & Recommendations

1. **[Question N]** — No KB content available. Consider creating a [content type] item.
2. **[Question N]** — Needs SME input on [topic]. Partial answer available.
3. **[Question N]** — Response is 60% of word limit. Strengthen with evidence from [domain].

## Quick Actions

- `/kb:draft-response "[question text]"` — Draft a response for an unanswered question
- `/kb:search [topic]` — Find supporting evidence
```

### 7. Handle Edge Cases

**No active bids:**
```
No active bids found. Your bid pipeline is empty.

To create a new bid workspace, use the Knowledge Hub web interface.
```

**Bid name not found:**
```
I couldn't find a bid matching "[name]". Active bids are:
- [Bid 1]
- [Bid 2]
- [Bid 3]

Did you mean one of these?
```

## Tips

- Always use UK date format (DD/MM/YYYY)
- Frame deadlines as days remaining — "6 days" is more urgent than "15/03/2026"
- Confidence postures are: strong_match, partial_match, needs_sme, no_content
- Sort sections by completion (least complete first) to surface gaps quickly
- Truncate question text in tables to keep output scannable
- Always end with actionable recommendations
- For a workflow-oriented cross-bid review (blockers, stalled drafts, next actions rather than per-bid status), use `/kb:bid-pipeline-review`
