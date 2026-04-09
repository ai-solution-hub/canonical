---
name: content-governance
description: Freshness lifecycle management, quality flag interpretation, governance review vs content review workflows, lifecycle types, priority levels, and when to flag content for review vs update directly. Use when interpreting KB health data, triaging attention items, or advising on content maintenance.
---

# Content Governance

Guidance for interpreting and acting on Knowledge Hub governance signals — freshness states, quality flags, review workflows, and content lifecycle management.

## Freshness Lifecycle

Content in the KB follows a four-state freshness lifecycle:

```
Fresh --> Aging --> Stale --> Expired
```

### State Definitions

| State | Meaning | Action |
|-------|---------|--------|
| **Fresh** | Content is current and reliable | No action needed |
| **Aging** | Content is approaching its review date | Plan to review soon |
| **Stale** | Content has passed its review date | Review and update or confirm still accurate |
| **Expired** | Content is significantly past its review date | Must be updated, archived, or explicitly reconfirmed |

### Freshness Thresholds

Freshness thresholds are configured per lifecycle type (see below). The system automatically transitions content through states based on the time since last update.

### Using Freshness in Bid Responses

| Freshness | Bid response guidance |
|-----------|----------------------|
| Fresh | Safe to use without caveat |
| Aging | Safe to use; note internally that a review is due |
| Stale | Flag to user: "This source was last updated [date] — verify before use" |
| Expired | Warn explicitly: "This source is expired and should not be used in a bid without verification" |

## Lifecycle Types

Each content item has a lifecycle type that determines its freshness thresholds:

| Type | Description | Typical review cycle |
|------|-------------|---------------------|
| **evergreen** | Content that changes rarely (core policies, foundational Q&As) | Annual |
| **date_bound** | Content tied to a specific date (certifications, annual reports) | On expiry date |
| **regulation** | Regulatory or legal content that changes when regulations update | On regulatory change |
| **bid_discovered** | Content discovered during bid preparation — may be temporary | Quarterly |

### Lifecycle Assignment Guidance

- **Policies and certifications**: `date_bound` (tied to renewal dates)
- **Q&A pairs from bid library imports**: `bid_discovered` (verify and promote to `evergreen` after review)
- **Industry standards articles**: `regulation` (changes when standards update)
- **Case studies**: `evergreen` (historical facts don't change, but relevance decays)
- **Capability statements**: `evergreen` (update when capabilities change)

## Quality Flags

Quality flags indicate content issues detected by automated checks or manual review:

### Common Quality Issue Types

| Flag | Meaning | Action |
|------|---------|--------|
| **Missing classification** | Item has no domain/subtopic assigned | Classify using `classify_content` tool |
| **Low classification confidence** | AI classification confidence <0.6 | Review and manually adjust if needed |
| **Missing summary** | No AI summary generated | Generate using `generate_summary` tool |
| **Short content** | Content is unusually brief | Review — may need expansion or may be a stub |
| **Duplicate candidate** | Content appears to overlap with another item | Review both items; merge or differentiate |
| **Missing metadata** | Key metadata fields are empty | Fill in domain, subtopic, content type |

### Quality Triage

When reviewing quality flags, prioritise:
1. **Items referenced in active bids** — these affect live submissions
2. **High-priority items** — marked as high priority by users
3. **Frequently accessed items** — high-traffic content should be high-quality
4. **Recently created items** — catch quality issues early

## Content Review vs Governance Review

The Knowledge Hub has two separate review workflows. They are distinct and should not be conflated.

### Content Review (`/review`)

- **Purpose**: Speed review of content quality (triage cards)
- **Focus**: Is the content accurate? Is it well-classified? Does the summary reflect the content?
- **Who**: Editors and admins reviewing content for quality
- **Trigger**: Manual (user navigates to /review) or flagged by quality checks
- **Outcome**: Content is approved, edited, or flagged for further work

### Governance Review (`/api/governance/review`)

- **Purpose**: Freshness and ownership governance
- **Focus**: Is the content still current? Does it have an owner? Is it approaching its review date?
- **Who**: System-generated, reviewed by content owners or admins
- **Trigger**: Automated freshness transitions and ownership checks
- **Outcome**: Content is refreshed, reassigned, or archived

### When to Recommend Each

| Situation | Recommend |
|-----------|-----------|
| User asks about content quality | Content review |
| User asks about stale/expired content | Governance review |
| User asks about items needing attention | Both — quality flags AND freshness issues |
| User asks about a specific item's accuracy | Content review |
| User asks about KB health overall | Governance review (freshness) + quality summary |

## Priority Levels

Content items have an optional priority field:

| Priority | Meaning |
|----------|---------|
| **high** | Critical content — actively used in bids, core policies |
| **medium** | Important content — frequently referenced, should be maintained |
| **low** | Supporting content — useful but not critical |
| **null (unset)** | Priority not yet assigned — treat as medium for triage purposes |

### Priority in Triage

When presenting items needing attention, always sort by:
1. Priority (high first)
2. Freshness state (expired first, then stale)
3. Whether referenced in active bids
4. Recency of last update (oldest first)

## Governance Recommendations

### When to Flag for Review

Flag content for review when:
- Freshness transitions from aging to stale
- Quality checks detect issues
- A user reports inaccuracy
- The content's domain has regulatory changes
- The content's lifecycle type transitions (e.g., certification renewal)

### When to Update Directly

Update content directly (skip review queue) when:
- Minor corrections (typos, formatting)
- Metadata-only changes (classification, tags)
- The user is the content owner and confirming accuracy
- AI-generated fields (summary, keywords) are being regenerated

### When to Archive

Consider archiving when:
- Content has been expired for >6 months with no review
- Content is superseded by a newer item on the same topic
- Content was created for a specific bid that has concluded
- Content is a duplicate of a better-maintained item

## Interpreting Dashboard Health Data

When the `get_dashboard_summary` tool returns KB health data, interpret it as:

### Good Health

- >80% of items are fresh
- <5% are stale or expired
- Quality flag count is low relative to total items
- Active bids have >75% question completion

### Moderate Health

- 60-80% of items are fresh
- 5-15% are stale or expired
- Some quality flags in important domains
- Active bids have 50-75% question completion

### Poor Health

- <60% of items are fresh
- >15% are stale or expired
- Multiple quality flags in bid-critical domains
- Active bids have <50% question completion

### Recommended Actions by Health Level

| Health | Action |
|--------|--------|
| Good | Monitor, review aging items proactively |
| Moderate | Schedule a review session, prioritise stale items in bid-active domains |
| Poor | Urgent: focus on expired items in domains used by active bids, then work outwards |

## Anti-Patterns

**Do not:**
- Treat all stale content as equally urgent — prioritise by bid impact and priority level
- Archive content without checking if it is referenced in active bids
- Conflate content review (`/review`) with governance review (`/api/governance/review`) — they are separate workflows
- Flag content for review when a direct update would be faster (e.g., typo fixes, metadata changes)
- Ignore freshness warnings in bid responses — using expired content in a tender is a submission risk
- Batch-update freshness states without reviewing content — "refreshed" should mean "verified accurate"
- Recommend archiving content simply because it is old — evergreen content may be old and still accurate

**Do:**
- Always sort attention items by bid impact first, then priority, then freshness severity
- Surface conflicts between content review and governance review recommendations
- Recommend specific actions ("update the certification expiry date") not vague ones ("review this item")
- Flag expired content used in active bids as critical, not just awareness
- Note when a freshness transition is routine (evergreen content aging) vs concerning (bid-critical content going stale)

## Related Skills

- **@classification** — How content is classified into the taxonomy
- **@knowledge-synthesis** — How source freshness affects confidence scoring
- **@bid-writing** — How freshness affects bid response quality
