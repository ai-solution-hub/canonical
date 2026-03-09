# Governance Skill

You are managing content governance for the Knowledge Hub, a knowledge base platform for UK SMBs. This skill covers freshness lifecycle management, quality scoring, and review triggers.

## Freshness Lifecycle

Content progresses through four freshness states:

**fresh → aging → stale → expired**

Freshness is calculated deterministically based on the content's `lifecycle_type` and either its last update date or expiry date.

## Lifecycle Types and Thresholds

### Evergreen (default)
Content that remains relevant over time. Thresholds based on time since last update:
- **Fresh:** < 12 months
- **Aging:** 12–18 months
- **Stale:** 18–24 months
- **Expired:** > 24 months

### Date-Bound
Content tied to a specific expiry date (contracts, certifications, accreditations). Thresholds based on time until expiry:
- **Fresh:** > 3 months until expiry
- **Aging:** 1–3 months until expiry
- **Stale:** < 1 month until expiry
- **Expired:** Past expiry date

### Regulation
Content governed by external regulatory changes. Shorter review cycles:
- **Fresh:** < 6 months
- **Aging:** 6–9 months
- **Stale:** 9–12 months
- **Expired:** > 12 months

### Bid-Discovered
Content surfaced or created during the bid process. Always treated as **fresh** since it is refreshed per bid cycle.

## Quality Scoring

Quality is scored on a 0–100 scale. Contributing factors include:

- **Completeness:** Does the content have a title, summary, domain classification, and keywords?
- **Citation coverage:** Are claims supported by evidence or source references?
- **Word count compliance:** Does the content meet minimum length expectations for its type?
- **Classification confidence:** Higher confidence indicates better-quality metadata.
- **Freshness state:** Fresh content scores higher than stale or expired content.

## Review Triggers

Content is automatically flagged for review when:
- **Classification confidence < 0.5:** AI classification is uncertain — human review required
- **Quality score < 60:** Content falls below the acceptable quality threshold
- **Ownership changes:** Content reassigned to a new owner should be reviewed for accuracy
- **Freshness transitions:** Content moving from fresh to aging triggers a review notification
- **Governance posture:** Domains configured as `review_on_change` require approval for any edit

## Content Lifecycle States

| State | Meaning |
|-------|---------|
| `draft` | Newly created, not yet reviewed |
| `unverified` | Ingested or AI-classified, awaiting human verification |
| `verified` | Human-reviewed and confirmed accurate |
| `flagged` | Identified issues requiring attention |

## Governance Principles

- **"Observe and intervene"** — trust users by default, flag for review when quality dips
- Governance should be lightweight for editors, visible for admins
- Notifications inform rather than block — users can proceed with their work
- Freshness recalculation runs daily via scheduled cron (03:00 UTC)
