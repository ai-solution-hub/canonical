# Knowledge Hub

A knowledge base plugin primarily designed for [Cowork](https://claude.com/product/cowork), Anthropic's agentic desktop application — though it also works in Claude Code. Search your knowledge base, manage bids, and draft responses with full access to articles, policies, case studies, Q&A pairs, and more — all organised by domain with quality tracking and freshness monitoring.

> **Note:** This plugin is not yet available in the Cowork registry. Install locally via manual connector setup (see [Getting Started](#getting-started) below).

---

## How It Works

Knowledge Hub connects Claude to your structured knowledge base. Ask questions about your content, get briefings on active bids, draft responses to tender questions, and monitor the health of your knowledge base — all through natural conversation.

```
You: "What do we say about our ISO 27001 certification?"
              Claude searches
~~knowledge base: 3 Q&A pairs about ISO 27001 (confidence: strong)
~~knowledge base: 2 policies covering information security management
~~knowledge base: 1 case study referencing ISO certification
              Claude synthesises
"Your ISO 27001 certification was achieved in 2023 and covers
 all information processing facilities. The standard answer
 highlights annual surveillance audits and continuous improvement
 through the ISMS. Here are the key points for bid responses..."
```

One query. Full context. Ready-to-use answers.

---

## Standalone vs Supercharged

Every command works in two modes. Without the connector, you provide context and Claude applies its skills. With the connector, Claude searches your live knowledge base directly.

| Feature | Standalone | Supercharged (with connector) |
|---------|-----------|-------------------------------|
| **Search** | You paste content; Claude applies search strategy and synthesis | Claude searches live KB with semantic + keyword hybrid search |
| **Briefing** | You describe priorities; Claude organises and prioritises | Claude pulls reorientation data, bid status, and freshness alerts |
| **Bid Status** | You share bid details; Claude ranks urgency and identifies gaps | Claude fetches live bid data with question-level progress |
| **Coverage** | You describe your KB; Claude analyses gaps | Claude pulls dashboard, freshness, and quality data automatically |
| **Draft Response** | You paste source material; Claude drafts with bid writing best practice | Claude searches KB and Q&A library, cites sources, scores confidence |
| **Change Report** | You share recent changes; Claude categorises and prioritises | Claude generates change report from live dashboard and freshness data |
| **Classification** | Claude advises on taxonomy based on description | Claude triggers AI classification via `classify_content` tool |
| **Quality tracking** | Manual review guidance | Live freshness and quality data from KB |

---

## What It Searches

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](CONNECTORS.md).

The Knowledge Hub contains structured content organised by domain and subtopic:

| Content Type | What it covers |
|-------------|----------------|
| **Q&A Pairs** | Standard and advanced answers to common bid questions |
| **Articles** | In-depth knowledge base articles |
| **Policies** | Organisational policies and procedures |
| **Case Studies** | Project examples with outcomes and evidence |
| **Certifications** | ISO, Cyber Essentials, and other accreditations |
| **Compliance** | Regulatory and standards compliance documentation |
| **Methodologies** | Delivery approaches and frameworks |
| **Capabilities** | Service and product capability statements |

Each item is classified into a domain taxonomy, tracked for freshness, and scored for quality — giving you confidence in every answer.

---

## Commands

| Command | What it does |
|---------|--------------|
| `/kb:search` | Search the knowledge base using semantic and keyword search |
| `/kb:briefing` | Get a reorientation briefing on what changed and what needs attention |
| `/kb:bid-status` | Overview of active bids with progress, gaps, and deadlines |
| `/kb:coverage` | Analyse coverage gaps and identify thin domains |
| `/kb:draft-response` | Draft a bid response using KB content with citations |
| `/kb:change-report` | Generate a change report of recent KB changes and activity |

### Search

```
/kb:search what is our approach to data protection?
/kb:search ISO 27001 certification evidence
/kb:search case studies involving healthcare clients
```

Searches across all content types using hybrid semantic + keyword search. Results include similarity scores, freshness status, and domain classification.

### Briefing

```
/kb:briefing
```

Get a personalised briefing covering urgent items needing attention, recent team activity, your recent work, and active bid status. Ideal for starting your day or returning after time away.

### Bid Status

```
/kb:bid-status
/kb:bid-status NHS Digital Framework
```

See all active bids sorted by urgency, or focus on a specific bid. Shows question completion progress, response gaps, confidence postures, and upcoming deadlines.

### Coverage

```
/kb:coverage
```

Analyse which domains have strong coverage and which are thin. Identifies freshness issues, quality flags, and recommends specific content to create.

### Draft Response

```
/kb:draft-response "Describe your approach to information security management"
/kb:draft-response "Provide evidence of similar projects delivered in the last 3 years"
```

Searches the KB and Q&A library for relevant content, evaluates source quality, and drafts a structured response following UK public procurement conventions. Includes a confidence assessment and source citations.

### Change Report

```
/kb:change-report
/kb:change-report --daily
/kb:change-report --weekly
```

Summarise recent changes to the knowledge base — new content, freshness changes, quality issues, and items needing review. Helps you stay on top of KB health.

---

## Skills

Five skills power the Knowledge Hub experience:

**Search Strategy** — Query decomposition for hybrid search. Classifies query types, determines whether to use semantic or keyword search, applies domain filters, and interprets similarity scores.

**Bid Writing** — UK public procurement bid writing guidance. Covers PQQ/ITT conventions, response structure, confidence postures, word limit management, and evidence-backed writing with measurable outcomes. See [QUICKREF.md](skills/bid-writing/QUICKREF.md) for a compact reference card.

**Knowledge Synthesis** — Combines multiple KB sources into coherent responses. Handles deduplication, citation formatting, confidence assessment based on source freshness, and strategies for different result set sizes.

**Content Governance** — Freshness lifecycle management, quality flag interpretation, governance review vs content review workflows, lifecycle types, and priority level guidance.

**Classification** — Domain taxonomy guidance including content type classification, confidence interpretation, and when to trigger reclassification.

---

## Example Workflows

### Preparing a bid response

```
You: /kb:draft-response "Describe your organisation's approach to
     business continuity and disaster recovery"

Claude searches:
  ~~knowledge base -> 4 Q&A pairs about business continuity
  ~~knowledge base -> 1 policy document (Business Continuity Plan)
  ~~knowledge base -> 2 case studies with DR examples

Result: A structured response citing specific KB sources,
        following UK procurement conventions, with word count
        and confidence assessment.
```

### Morning briefing

```
You: /kb:briefing

Claude checks:
  ~~knowledge base -> Reorientation data
  ~~knowledge base -> Active bids and deadlines
  ~~knowledge base -> Items needing attention

Result: "3 items need review (2 stale, 1 quality flag).
        The NHS Framework bid has 4 unanswered questions
        with a deadline in 6 days. 12 new items were added
        since your last visit."
```

### Finding coverage gaps

```
You: /kb:coverage

Claude analyses:
  ~~knowledge base -> Dashboard summary
  ~~knowledge base -> Freshness report
  ~~knowledge base -> Quality summary

Result: Breakdown by domain showing item counts, freshness
        distribution, and quality scores. Identifies thin
        domains and recommends specific content to create.
```

### Classifying new content

```
You: I've just added 15 new Q&A pairs from the latest bid library
     import. Can you help classify them?

Claude:
  ~~knowledge base -> Fetches unclassified items
  ~~knowledge base -> Checks taxonomy for available domains

Result: Classification suggestions for each item with domain,
        subtopic, and confidence score. Items with low
        confidence flagged for manual review.
```

### Reviewing stale items

```
You: /kb:change-report --weekly

Claude checks:
  ~~knowledge base -> Freshness report shows 8 items moved to stale
  ~~knowledge base -> 3 of those are in domains used by active bids

Result: Prioritised list of stale items, grouped by impact.
        Bid-critical items flagged first with specific
        recommendations: update, archive, or verify.
```

---

## Maintenance

The plugin taxonomy and content types are automatically kept in sync with the Knowledge Hub codebase.

### Syncing Taxonomy
If the canonical taxonomy (in `docs/reference/classification-prompt.md`) or content types (in `lib/validation/schemas.ts`) change, run the sync script:
```bash
bun run sync:plugin-taxonomy
```
This updates the injection markers in `skills/classification/SKILL.md` and `skills/search-strategy/SKILL.md`.

### Bundling
The plugin is bundled as a Base64 ZIP string for deployment. A validation check runs before bundling to ensure taxonomy consistency:
```bash
bun run build:plugin
```
*Note: This generates `lib/mcp/plugin-bundle.ts` which must be committed to git.*

---

## Personalisation

Copy `settings.template.json` to `settings.local.json` to customise the plugin for your organisation. Settings include organisation name, certifications held, preferred response tone, and default taxonomy domains. See the template file for all available options.

---

## Getting Started

```
# In Cowork or Claude.ai:
# 1. Add the connector (Settings -> Connectors -> Add connector)
#    URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp
# 2. Authenticate with your Knowledge Hub credentials
# 3. Start searching
/kb:search [your question here]
```

Without the connector, commands still work — you provide context manually, and Claude applies the same frameworks and guidance. With the connector, Claude searches your knowledge base directly and returns results with full source attribution.

---

## Philosophy

Bid teams spend hours hunting for the right answer — digging through old documents, previous bids, and shared drives. The answer exists somewhere, but finding it and knowing it's current takes time.

Knowledge Hub treats your organisational knowledge as a structured, searchable, quality-tracked resource. One question, authoritative answers, with confidence scoring so you know what to trust. Your knowledge base should work for you, not the other way around.
