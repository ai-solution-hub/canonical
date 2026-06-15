---
description: Domain-scoped briefing covering KB content, sector intelligence, and recent change reports
argument-hint: "<domain> [period_days]"
---

# Sector Briefing Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Describe your domain focus and recent activity; get    |
|  a structured briefing and prioritised actions          |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude pulls live KB content, SI feed highlights,      |
|  change reports, and governance queue per domain        |
+---------------------------------------------------------+
```

Assemble a briefing for a single domain (e.g. `audit-content`, `social-housing-compliance`) covering four data sources: KB inventory, sector intelligence signals, what changed recently, and outstanding governance items. Ideal for admin leads owning a specific domain, or for catching up on a domain before working in it.

Focus domain: $ARGUMENTS
If a file is referenced: @$1

## What I Need From You

**Option A — Briefing via connector (recommended):**

```
/kb:sector-briefing audit-content
/kb:sector-briefing social-housing-compliance 14
```

Pass the domain key as the first argument. An optional second argument overrides the default 7-day look-back window.

**Option B — Manual input (no connector needed):**

```
/kb:sector-briefing audit-content
[Paste recent activity, sector news, and any current governance items]
```

## Usage

```
/kb:sector-briefing <domain> [period_days]
```

## Instructions

### 1. Parse Arguments

Extract the domain key from `$ARGUMENTS`. If no domain was supplied, ask the user:

```
Which domain should this briefing cover? Common values:
- audit-content
- social-housing-compliance
- ai-forms
- form-management

(Or any other domain key configured in this workspace.)
```

If a second argument is supplied and parses as an integer, use it as the look-back window in days. Otherwise default to 7.

### 2. Invoke the `sector_briefing` MCP prompt

**If `~~knowledge base` connector is available:**

Invoke the `sector_briefing` MCP prompt with `domain` = the parsed argument and `period_days` = the parsed window. The prompt template will direct you through the tool sequence:

1. `list_guides(domain_filter: <domain>, published_only: true)` — guide catalogue
2. `find(query: <domain>, domain: <domain>, limit: 10)` — KB items
3. `find(query: <domain>, limit: 5)` — Q&A pairs
4. `get_intelligence_summary(period: <N>d, limit: 15)` — SI feed highlights, filter to the domain
5. `get_change_report(period_days: <N>, domain: <domain>)` — what changed in the period
6. `whats_in_my_queue(limit: 10)` — pending review items, filter to the domain

Use the `@content-governance` skill for freshness framing and the `@search-strategy` skill for KB querying.

**If no connector available:**

```
To run a sector briefing, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, paste the following and I'll compose the briefing manually:
- Domain KB inventory (guides, articles, Q&A pairs for the domain)
- Recent sector news / feed highlights
- Any pending governance review items in the domain
- Recent content changes in the domain
```

### 3. Handle Tool Unavailability

Two of the referenced tools ship later in the same release train:

- `get_change_report` — registered by WP6 (P1-35). If not yet available, note "Change report tool not yet available — skipping the period change summary" and proceed with the remaining data sources.
- `whats_in_my_queue` — registered by WP3 (P0-23). If not yet available, note "Governance queue tool not yet available — skipping governance review section" and proceed.

If `get_intelligence_summary` requires a `workspace_id` parameter and none is provided, call it once per active workspace and merge results, or prompt the user for the relevant workspace.

### 4. Structure the Output

```
## Sector briefing — [domain] — DD/MM/YYYY

### At a glance
- Content count: [N] guides, [M] items, [K] Q&A pairs
- Change activity ([N] days): [N added / N updated / N removed]
- Pending governance review: [N items]
- SI signals: [N relevant feed articles]

### What changed
[Narrative summary of change report, grouped by content_type. If the tool was unavailable, say so.]

### Sector intelligence
[Top 3-5 SI highlights relevant to the domain with source links]

### Governance queue
[Pending items with due dates]

### Recommendations
[Prioritised 2-4 actions]
```

### 5. Recommend Actions

Conclude with 2-4 prioritised actions grounded in the four data sources. Examples:
- "Refresh the `audit-content` freshness banner on 3 items past the 180-day threshold."
- "Review the 2 pending governance items for `social-housing-compliance` before the end of the week."
- "Consider seeding an SI feed for this domain — no relevant signals in the period."

## Tips

- Use UK English throughout (DD/MM/YYYY, colour, organisation).
- Frame dates as days elapsed for recency, absolute DD/MM/YYYY for deadlines.
- If the domain has no content (`content_count = 0`), surface that as the top recommendation: "No KB content exists for this domain yet. Consider running `/kb:coverage` to identify gaps."
- If no SI signals arrived in the period, suggest `/kb:briefing` for broader account-level context.
- For a wider pipeline view not scoped to one domain, use `/kb:briefing` (whole-account reorient) or `/kb:form-status` (active forms).
