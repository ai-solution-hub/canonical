---
name: search-strategy
description: Query decomposition and hybrid search orchestration for the Knowledge Hub. Classifies query types, determines whether to use semantic or keyword search, applies domain and content type filtering, interprets similarity scores, and handles fallback strategies for low-result searches.
---

# Search Strategy

The core intelligence behind Knowledge Hub search. Transforms a natural language question into targeted searches across the knowledge base and produces ranked, contextualised results.

## The Goal

Turn this:
```
"What evidence do we have of delivering data protection services to NHS clients?"
```

Into targeted searches:
```
search_knowledge_base: "data protection services NHS" (semantic, domain: security)
search_qa_library: "data protection NHS healthcare" (Q&A-specific)
```

Then synthesise the results into a coherent answer with confidence assessment.

## Query Type Classification

### Step 1: Identify Query Type

Classify the user's question to determine search strategy:

| Query Type | Example | Strategy |
|-----------|---------|----------|
| **Factual** | "What is our ISO 27001 scope?" | Search Q&A library first, then general KB |
| **Exploratory** | "What do we know about GDPR?" | Broad search across all types |
| **Bid-specific** | "Evidence for data protection question" | Search Q&A library AND general KB in parallel |
| **Coverage-oriented** | "Do we have content about cloud security?" | Dashboard summary + domain-filtered search |
| **Compliance-related** | "Do we meet Cyber Essentials Plus?" | Search policies and certifications, then Q&A |
| **Evidence-seeking** | "Case studies in healthcare sector" | Filter for case_study content type |
| **Process** | "How do we handle data breaches?" | Search policies and methodologies |

### Step 2: Extract Search Components

From the query, extract:

- **Core terms**: The essential subject matter
- **Domain signals**: Keywords mapping to taxonomy domains (security, compliance, delivery, etc.)
- **Content type signals**: Keywords suggesting specific content types
- **Freshness requirements**: Signals about recency needs
- **Scope modifiers**: Broad vs narrow search intent

### Content Type Signal Mapping

| Signal words | Content type filter |
|-------------|-------------------|
| "Q&A", "standard answer", "bid answer" | q_a_pair |
| "case study", "example", "evidence" | case_study |
| "policy", "procedure" | policy |
| "certification", "accreditation", "ISO" | certification |
| "methodology", "approach", "framework" | methodology |
| "capability", "service" | capability |
| "compliance", "regulation" | compliance |

## Hybrid Search

The Knowledge Hub uses a hybrid search combining semantic (embedding-based) and keyword matching. Understanding how this works helps you construct better queries.

### When to Rely on Semantic Search

- Conceptual questions: "How do we ensure quality?"
- Paraphrased queries: the user's words may not match the KB exactly
- Exploratory searches: "What do we know about..."
- Cross-domain queries: content that spans multiple topics

**Tip:** For semantic search, use natural language phrasing. "Describe our approach to data protection" will work better than "data protection policy GDPR".

### When to Add Keyword Precision

- Specific terms: "ISO 27001", "Cyber Essentials Plus"
- Named entities: specific client names, project names
- Acronyms: "SLA", "KPI", "TUPE"
- Exact phrases: when you know the specific wording in the KB

**Tip:** The search combines both approaches automatically. A well-phrased natural language query with the right technical terms will get the best results.

## Domain-Aware Filtering

The KB uses a two-level taxonomy: domains and subtopics. Use domain filtering to narrow results when the query clearly targets a specific area.

<!-- TAXONOMY_INJECT_START -->
### Domain Filter Guidance

The KB uses 15 domains. Use the domain slug when filtering:

| If the query mentions... | Filter to domain |
|--------------------------|-----------------|
| Data protection, cyber security, encryption, access control, iso 27001 | security |
| Standards, regulatory, audit, certification, health and safety, environmental, modern slavery, equalities, safeguarding | compliance |
| Deployment, migration, onboarding, integration | implementation |
| Sla, helpdesk, maintenance, incident | support |
| Company info, financial, insurance, references, staffing, supply chain, financial standing, methodology | corporate |
| Functionality, technical, reporting, usability | product-feature |
| Approach, project management, quality, delivery | methodology |
|  | safeguarding-child-protection |
|  | safeguarding-adults |
|  | multi-academy-trusts |
|  | education |
|  | products-services |
| Kcsie, education act dfe, health social care legislation, gdpr data protection, funding policy, safeguarding guidance, cpd requirements | legislation-policy |
| Competitor products, competitor market activity, competitor leadership, market trends, procurement activity | market-intelligence |
| Mat leadership, mat restructuring, mat audits ofsted, education sector audits, health sector audits, local authority inspections, safeguarding practice | sector-news |

**When NOT to filter:**
<!-- TAXONOMY_INJECT_END -->
- Exploratory queries ("What do we know about...")
- Cross-domain questions ("How does our security approach support compliance?")
- When unsure which domain applies — let the search engine rank by relevance

## Result Ranking

### Similarity Score Interpretation

| Score Range | Meaning | Action |
|-------------|---------|--------|
| **>0.7** | Strong match — content directly addresses the query | Use with high confidence |
| **0.5-0.7** | Moderate match — content is relevant but may not be precise | Include, note it's a partial match |
| **0.3-0.5** | Weak match — tangentially related content | Include only if few results |
| **<0.3** | Likely irrelevant — keyword overlap but different topic | Exclude unless result set is tiny |

### Additional Ranking Factors

Beyond similarity score, consider:

- **Freshness**: Fresh content is more trustworthy than stale content
- **Content type authority**: Q&A pairs > policies > case studies > articles (for factual queries)
- **Classification confidence**: >0.8 means the item is well-classified and likely placed correctly
- **Content completeness**: Items with AI summaries and proper classification are better maintained

## Search Tool Selection

### `search_knowledge_base` vs `search_qa_library`

| Use case | Tool | Reason |
|----------|------|--------|
| General topic search | `search_knowledge_base` | Searches all content types |
| Standard bid answer | `search_qa_library` | Pre-approved Q&A pairs |
| Comprehensive bid research | Both in parallel | Q&A for answers, general for evidence |
| Policy lookup | `search_knowledge_base` | Policies are not Q&A pairs |
| Case study search | `search_knowledge_base` | Case studies are not Q&A pairs |
| "Do we have a standard answer for..." | `search_qa_library` | This is exactly what Q&A pairs are |

### Pagination

Both tools support `limit` and `offset` parameters:
- Default limit: 10 results
- Increase to 20-30 for broad exploratory queries
- Use offset for "show me more results" follow-up requests
- Maximum practical limit: 50 (beyond this, refine the query instead)

## Fallback Strategies

When initial search returns few or no results:

### Query Broadening

```
Original: "ISO 27001 Annex A control 8.1 asset management"
Broader:  "ISO 27001 asset management"
Broader:  "information asset management"
Broadest: "asset management security"
```

Remove constraints in this order:
1. Specific reference numbers (Annex A, clause numbers)
2. Exact standard names (try the topic instead)
3. Domain filter (search all domains)
4. Less important qualifiers

### Alternative Query Strategies

If the first search yields poor results:
1. **Rephrase**: Use different terminology for the same concept
2. **Decompose**: Split a complex query into simpler sub-queries
3. **Generalise**: Search for the parent topic, then scan results
4. **Switch tool**: If `search_knowledge_base` returns nothing, try `search_qa_library` and vice versa
5. **Check coverage**: Run `/kb:coverage` to see if the domain has any content at all

### No Results Response

When nothing is found:
```
No results found for "[query]". This could mean:
1. The topic hasn't been added to the KB yet (content gap)
2. The KB uses different terminology — try rephrasing
3. The content exists but is classified in a different domain

Suggestions:
- Try: "[alternative phrasing]"
- Check coverage: /kb:coverage
- Create new content: this may be a gap to fill
```

## Common Search Patterns

### Pattern: Bid Question Research

```
Step 1: Search Q&A library for standard answer
Step 2: Search general KB for supporting evidence (case studies, policies)
Step 3: Assess combined coverage → confidence posture
Step 4: Draft response (if using /kb:draft-response)
```

### Pattern: Domain Health Check

```
Step 1: Search with domain filter, high limit (30+)
Step 2: Review content types present vs missing
Step 3: Check freshness distribution
Step 4: Identify gaps and recommend content creation
```

### Pattern: Pre-Bid Knowledge Assessment

```
Step 1: Extract key themes from tender document
Step 2: Search for each theme separately
Step 3: Map coverage: strong / partial / no coverage per theme
Step 4: Prioritise content creation for gaps before deadline
```

## Related Skills

- **@knowledge-synthesis** — How to combine search results into coherent answers
- **@bid-writing** — How to use search results in bid responses
- **@classification** — Understanding the domain taxonomy used for filtering
