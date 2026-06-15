---
description: Analyse coverage gaps and identify thin domains
argument-hint: ""
---

# Coverage Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Tell Claude about your KB structure; get gap analysis  |
|  and content creation priorities                        |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude pulls live dashboard, freshness, and quality    |
|  data to produce a complete coverage analysis           |
+---------------------------------------------------------+
```

Analyse the knowledge base coverage across domains, identify thin areas, surface freshness and quality issues, and recommend specific content to create.

$ARGUMENTS: No arguments expected.
If a file is referenced: @$1

## Usage

```
/kb:coverage
```

## Instructions

### 1. Fetch Dashboard Summary

**If `~~knowledge base` connector is available:**

Call `whats_in_my_queue` to get the overall KB health metrics:
- Total item count and breakdown by content type
- Items needing attention (stale, expired, quality flagged)
- Recent activity summary

**If no connector available:**

```
To analyse your KB coverage, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, tell me about your knowledge base — what domains you cover,
how many items you have, and any areas you know are thin — and I'll help
you plan content creation priorities.
```

### 2. Fetch Freshness Report

Call `where_are_we_exposed` to get the freshness breakdown:
- Count of items in each freshness state (fresh, aging, stale, expired)
- Freshness distribution by domain (if available)

Use the @content-governance skill to interpret freshness states.

### 3. Fetch Quality Summary

Call `where_are_we_exposed` to get quality issue counts:
- Items with quality flags
- Common quality issue types
- Overall quality health

### 4. Identify Thin Domains

Using the @classification skill, analyse the taxonomy coverage:

- **Well-covered domains**: >20 items, majority fresh, diverse content types
- **Adequate domains**: 10-20 items, some freshness issues
- **Thin domains**: <10 items, significant gaps
- **Empty domains**: No items at all

For each thin or empty domain, note:
- What content types are present vs missing
- Whether the domain is important for form responses
- Specific subtopics with zero coverage

### 5. Recommend Content to Create

Based on gaps, generate a prioritised content creation plan:

**Priority 1 — Critical for forms:**
- Q&A pairs for commonly asked form questions in thin domains
- Case studies for domains with no evidence
- Policies that active forms reference but don't exist

**Priority 2 — Strengthen weak areas:**
- Updated versions of stale/expired content
- Additional Q&A pairs for partially covered subtopics
- Supporting evidence for domains with only Q&A pairs (no case studies, no articles)

**Priority 3 — Build depth:**
- Methodology documents for well-covered domains
- Capability statements for service areas
- Additional case studies for strong domains

### 6. Present the Analysis

```
# Knowledge Base Coverage Analysis

## Overview
- **Total items**: [N]
- **Content types**: [breakdown]
- **Freshness**: [N] fresh | [N] aging | [N] stale | [N] expired

## Domain Coverage

| Domain | Items | Fresh | Aging | Stale | Expired | Health |
|--------|-------|-------|-------|-------|---------|--------|
| Security | 45 | 38 | 5 | 2 | 0 | Good |
| Compliance | 32 | 20 | 8 | 3 | 1 | Adequate |
| Methodology | 8 | 3 | 2 | 2 | 1 | Thin |
| [Domain] | [N] | [N] | [N] | [N] | [N] | [Status] |

## Gaps Identified

### Critical Gaps
1. **[Domain/Subtopic]** — [N] items, [issue description]. Impact: [why it matters for forms]
2. **[Domain/Subtopic]** — [N] items, [issue description]. Impact: [why it matters]

### Freshness Issues
- [N] items are stale or expired across [N] domains
- Worst affected: [Domain] ([N] stale/expired out of [N] total)

### Quality Issues
- [N] items flagged for quality review
- Common issues: [types of quality flags]

## Content Creation Priorities

### Priority 1 — Create Now
| Content | Type | Domain | Why |
|---------|------|--------|-----|
| [Specific topic] | Q&A pair | [Domain] | Active form requires this |
| [Specific topic] | Case study | [Domain] | No evidence available |

### Priority 2 — Create This Week
| Content | Type | Domain | Why |
|---------|------|--------|-----|
| [Specific topic] | Policy update | [Domain] | Current version is stale |
| [Specific topic] | Q&A pair | [Domain] | Partially covered subtopic |

### Priority 3 — Build Depth
| Content | Type | Domain | Why |
|---------|------|--------|-----|
| [Specific topic] | Methodology | [Domain] | Strengthen existing coverage |

---
[N] total items | [N] domains covered | [N] gaps identified | [N] items need freshness review
```

### 7. Cross-Reference with Active Forms

If form data is available from `whats_in_my_queue`, highlight coverage gaps that directly affect active forms:

```
## Impact on Active Forms

### [Form Name] ([N] days to deadline)
- Missing Q&A pairs for: [topics]
- Stale content referenced in: [question areas]
- Recommendation: Prioritise [specific content] before deadline
```

## Tips

- Use the taxonomy from `kb://taxonomy` resource to understand the full domain structure
- Health ratings: Good (>20 items, >75% fresh), Adequate (10-20 items, >50% fresh), Thin (<10 items), Critical (<5 items or >50% stale)
- Always connect coverage gaps to form impact where possible — this makes the analysis actionable
- Suggest `/kb:search [domain]` to explore existing content in thin areas
- Suggest `/kb:draft-response` for specific questions exposed by gaps
