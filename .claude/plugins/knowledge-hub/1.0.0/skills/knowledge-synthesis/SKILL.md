---
name: knowledge-synthesis
description: Combines search results from multiple KB sources into coherent, deduplicated responses with source attribution. Handles confidence assessment based on source freshness and classification confidence, citation formatting with item IDs, and summarisation strategies for different result set sizes.
---

# Knowledge Synthesis

The last mile of Knowledge Hub search. Takes raw search results and produces a coherent, trustworthy answer with proper source attribution and confidence assessment.

## The Goal

Transform this:
```
Result 1: Q&A pair about ISO 27001 certification scope (similarity: 0.85, fresh)
Result 2: Policy document on information security management (similarity: 0.72, aging)
Result 3: Case study referencing ISO certification in healthcare project (similarity: 0.68, fresh)
Result 4: Q&A pair about annual surveillance audits (similarity: 0.61, stale)
```

Into this:
```
Our ISO 27001:2022 certification covers all information processing facilities
and is maintained through annual surveillance audits conducted by [certifying body].
The Information Security Management System (ISMS) underpins our approach to data
protection across all client engagements, as demonstrated in our healthcare sector
delivery where [specific outcome].

Sources:
- "ISO 27001 Certification Scope" (kb://qa/abc123) — Q&A pair, fresh
- "Information Security Policy" (kb://items/def456) — Policy, aging
- "[Healthcare Client] Case Study" (kb://items/ghi789) — Case study, fresh
```

## Deduplication

### Cross-Source Deduplication

The same information often appears in multiple KB items. A Q&A pair about ISO 27001 may overlap with the ISO policy document and the security case study. Identify and merge duplicates.

**Signals that results are about the same thing:**
- Same or very similar text content
- Same topic/subtopic classification
- Both reference the same standard, certification, or process
- One item is a summary of the other (Q&A pair summarises a policy)

**How to merge:**
- Combine into a single narrative section
- Cite all source items
- Use the most complete version as the primary text
- Add unique details from each source
- Prefer Q&A pair wording for the "answer" (it is the pre-approved standard answer)

### Deduplication Priority

When the same information exists in multiple forms:
```
1. Q&A pair (pre-approved standard answer — use this wording)
2. Policy document (authoritative, detailed)
3. Case study (evidence of practice)
4. Article (general knowledge)
5. Note (informal, may be incomplete)
```

### What NOT to Deduplicate

Keep as separate items when:
- Different case studies covering the same topic (each is unique evidence)
- The same topic addressed from different angles (policy vs methodology)
- Content at different levels of detail (summary vs comprehensive)
- Conflicting information (surface the conflict)

## Citation and Source Attribution

Every claim in the synthesised answer must be attributable to a KB source.

### Citation Format

**Inline references:**
```
Our ISO 27001:2022 certification covers all information processing facilities
(kb://qa/abc123). This is maintained through the ISMS documented in our
Information Security Policy (kb://items/def456).
```

**Source list:**
```
Sources:
- "ISO 27001 Certification Scope" (kb://qa/abc123) — Q&A pair, Security domain, fresh
- "Information Security Policy" (kb://items/def456) — Policy, Security domain, aging
- "NHS Trust Case Study" (kb://items/ghi789) — Case study, Methodology domain, fresh
```

### Attribution Rules

- Always include the item title
- Always include the resource URI (`kb://items/{id}` or `kb://qa/{id}`)
- Include the content type
- Include the domain if classified
- Include the freshness status if not "fresh"
- Note the similarity score only if it is relevant to confidence assessment

## Confidence Assessment

Not all KB results are equally trustworthy. Assess confidence based on:

### Source Freshness

| Freshness | Confidence impact |
|-----------|------------------|
| Fresh | High — content is current and maintained |
| Aging | Moderate — probably still accurate |
| Stale | Low — may be outdated, flag to user |
| Expired | Very low — likely outdated, warn explicitly |

For form responses, stale or expired sources must be flagged. Using outdated information in a tender response is a risk.

### Classification Confidence

| Confidence | Meaning |
|------------|---------|
| >0.8 | Well-classified — the item is in the right domain and subtopic |
| 0.6-0.8 | Moderately classified — probably correct but verify |
| <0.6 | Low confidence — may be misclassified, check the content directly |

### Expressing Confidence

**High confidence (multiple fresh, strong-match sources):**
```
Our ISO 27001:2022 certification covers all information processing facilities.
[Direct, authoritative statement]
```

**Moderate confidence (single source or somewhat dated):**
```
Based on our current security policy documentation, ISO 27001 certification
covers all information processing facilities. This information was last
updated [date] and should be verified for the latest scope.
```

**Low confidence (old data or weak matches only):**
```
I found a reference to ISO 27001 certification in the knowledge base, but
the source is flagged as stale (last updated [date]). The scope information
may have changed. Recommend verifying with the security team before including
in a form response.
```

### Conflicting Information

When KB sources disagree:
```
I found potentially conflicting information:
- The Q&A pair (updated [date]) states: [version A]
- The policy document (updated [date]) states: [version B]

The more recent source indicates [which version], but this should be verified
as the documents may refer to different scopes or time periods.
```

Always surface conflicts rather than silently picking one version. In form writing, accuracy is critical.

## Summarisation Strategies

### For Small Result Sets (1-3 results)

Present each result with context. No heavy summarisation needed:
```
[Synthesised answer combining the results]

[Specific detail from source 1]
[Specific detail from source 2]

Sources: [full attribution]
```

### For Medium Result Sets (4-10 results)

Group by theme or content type and summarise each group:
```
[Overall answer]

From Q&A library:
- [Key answer 1 with source]
- [Key answer 2 with source]

Supporting evidence:
- [Case study reference]
- [Policy reference]

Key sources: [top 3-5 most relevant]
Found [N] relevant items across [N] domains.
```

### For Large Result Sets (10+ results)

Provide a high-level synthesis with the option to drill down:
```
[Overall answer based on strongest results]

Summary:
- [Key finding 1] (supported by [N] sources)
- [Key finding 2] (supported by [N] sources)

Top sources:
- [Most relevant source]
- [Second most relevant]
- [Third most relevant]

Found [N] results across [domains]. Want me to dig deeper into [specific aspect]?
```

### Summarisation Rules

- Lead with the answer, not the search process
- Do not list raw search results — synthesise them into narrative
- Group by topic or theme, not by content type
- Preserve important nuance and caveats (especially freshness warnings)
- Include enough detail to decide whether to dig deeper
- Always offer to provide more detail if the result set was large
- For form responses, always include the confidence posture

## Synthesis Workflow

```
[Raw search results]
         |
[1. Deduplicate — merge overlapping content from different items]
         |
[2. Cluster — group related results by theme/subtopic]
         |
[3. Rank — order by similarity score, freshness, authority]
         |
[4. Assess confidence — freshness x classification confidence x match strength]
         |
[5. Synthesise — produce narrative answer with attribution]
         |
[6. Format — choose detail level based on result count]
         |
[Coherent answer with sources and confidence]
```

## Anti-Patterns

**Do not:**
- List results by content type ("Q&A pairs: ... Articles: ... Case studies: ...")
- Include irrelevant results just because they matched a keyword
- Bury the answer under search methodology explanation
- Present conflicting information without flagging the conflict
- Omit source attribution or item IDs
- Present stale information with the same confidence as fresh
- Summarise so aggressively that useful evidence is lost

**Do:**
- Lead with the answer
- Group by topic or theme
- Flag confidence levels and freshness issues
- Surface conflicts explicitly
- Attribute all claims to sources with `kb://` URIs
- Offer to go deeper when result sets are large
- Note gaps in coverage where they affect the answer

## Related Skills

- **@search-strategy** — How to construct the queries that feed into synthesis
- **@completing-forms** — How to use synthesised content in form responses
- **@content-governance** — How to assess and act on freshness/quality issues
