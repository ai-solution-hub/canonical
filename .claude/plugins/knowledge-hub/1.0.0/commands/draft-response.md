---
description: Draft a bid response using KB content with citations and confidence assessment
argument-hint: "<bid question text>"
---

# Draft Response Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  Paste your question and any supporting material;       |
|  Claude drafts a response using bid writing best        |
|  practice with UK procurement conventions               |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude searches your live KB and Q&A library for       |
|  evidence, assesses source quality, and drafts with     |
|  full citations and confidence scoring                  |
+---------------------------------------------------------+
```

Draft a response to a bid question using relevant knowledge base content. Searches for supporting material, evaluates source quality, and produces a structured response following UK public procurement conventions.

Draft a response for: $ARGUMENTS
If a file is referenced: @$1

## What I Need From You

**Option A — Question text (connector required):**
```
/kb:draft-response "Describe your approach to information security management"
```

**Option B — Question with context (no connector needed):**
```
/kb:draft-response "Describe your approach to information security management"
[Paste relevant policies, case studies, or Q&A pairs to use as source material]
```

**Option C — Question from a file:**
```
/kb:draft-response @tender-questions.docx
```

## Usage

```
/kb:draft-response "Describe your approach to information security management"
/kb:draft-response "Provide evidence of similar projects delivered in the last 3 years"
/kb:draft-response "How do you ensure quality assurance across your delivery teams?"
```

## Instructions

### 1. Parse the Question

Analyse the bid question to understand:

- **Question type**: Descriptive ("describe your approach"), evidential ("provide evidence"), process ("how do you"), capability ("demonstrate your ability"), compliance ("confirm you meet")
- **Domain signals**: Which knowledge domains are relevant (security, compliance, delivery, etc.)
- **Scope**: Broad ("your approach to X") vs specific ("your ISO 27001 certification")
- **Evidence requirements**: Does it ask for examples, case studies, metrics, or certifications?
- **Word limit**: If mentioned, note the target (aim for 90-95% of limit per @bid-writing skill)

Use the @bid-writing skill to classify the question type and determine the response structure.

### 2. Search for Relevant Content

**If `~~knowledge base` connector is available:**

Execute searches in parallel:

1. Call `search_knowledge_base` with the question text to find relevant articles, policies, case studies, and other content
2. Call `search_qa_library` with the question text to find existing Q&A pairs with standard answers

If the question targets a specific domain, add domain filtering.

Use the @search-strategy skill to decompose the question into optimal search queries.

**If no connector available:**

```
To draft a response from your knowledge base, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, paste the relevant content you'd like me to work with and
I'll draft a response following UK bid writing conventions.
```

### 3. Evaluate Source Quality

For each search result, assess using @content-governance and @knowledge-synthesis skills:

| Factor | Assessment |
|--------|------------|
| **Similarity score** | >0.7 strong match, 0.5-0.7 moderate, <0.5 weak |
| **Freshness** | Fresh = safe to use, aging = probably fine, stale/expired = flag |
| **Content type** | Q&A pair = direct answer, case study = evidence, policy = authority |
| **Classification confidence** | >0.8 reliable, 0.6-0.8 check, <0.6 verify |

Determine the overall **confidence posture**:
- **strong_match**: Multiple fresh, high-quality sources directly address the question
- **partial_match**: Some relevant sources but gaps exist
- **needs_sme**: KB has partial coverage but subject matter expert input is needed
- **no_content**: No relevant KB material found — flag as a gap

### 4. Draft the Response

Use the @bid-writing skill to structure the response:

**Standard structure for descriptive questions:**
```
[Opening statement — directly answer the question in 1-2 sentences]

[Body — structured evidence and explanation]
- Key approach/methodology
- Specific processes or controls
- Evidence and examples

[Closing — measurable outcomes or commitment]
```

**For evidential questions (case studies, examples):**
```
[Brief context — what you will demonstrate]

[Example 1]
- Client/sector (anonymised if needed)
- Challenge
- Approach
- Outcome (with metrics)

[Example 2]
[Same structure]

[Summary — pattern of capability across examples]
```

**Response quality rules from @bid-writing skill:**
- Use UK English throughout (organisation, colour, DD/MM/YYYY)
- Be specific — use real figures, dates, and named standards
- Lead with the answer, then provide evidence
- Every claim should be backed by a KB source
- Match the tone to the question type (formal for compliance, confident for capability)
- If a word limit is provided, target 90-95%

### 5. Apply Word Limit

If a word limit is specified:
1. Draft at full length first
2. Count words
3. If over limit, trim secondary points and examples
4. If under 90% of limit, expand with additional evidence or detail
5. Note the final word count

### 6. Present the Draft

```
## Draft Response

**Question**: [The original question]
**Confidence**: [strong_match | partial_match | needs_sme | no_content]
**Word count**: [N] / [limit if specified]

---

[The drafted response text]

---

### Sources Used

| Source | Type | Domain | Freshness | Relevance |
|--------|------|--------|-----------|-----------|
| [Title] | Q&A pair | Security | Fresh | Strong |
| [Title] | Case study | Methodology | Aging | Moderate |

### Notes for Reviewer (internal — do not submit)

- **Confidence assessment**: [Explanation of overall confidence]
- **Gaps identified**: [What KB material is missing]
- **Verify before submission**: [Specific facts or dates to check]
- **Strengthen with**: [Suggestions for additional evidence]

### Quick Actions

- `/kb:search [topic]` — Find additional supporting evidence
- `/kb:coverage` — Check overall domain coverage
```

### 7. Offer Iterations

After presenting the draft:

```
Want me to:
- Adjust the tone? (more formal, more confident, more technical)
- Add or remove specific evidence?
- Expand or shorten the response?
- Draft a version with different emphasis?
- Search for additional supporting material?
```

### 8. Handle Edge Cases

**No relevant KB content found:**
```
## Draft Response — Low Confidence

**Confidence**: no_content

I couldn't find relevant content in the knowledge base for this question.

### What I'd recommend:

1. **Create a Q&A pair** covering this topic in the KB
2. **Check with your SME** for [specific topic] knowledge
3. **Consider these domains** where partial answers may exist: [suggestions]

### Placeholder response (needs SME input):

[Basic framework response with [PLACEHOLDER] markers where KB content would go]
```

**Stale sources only:**
```
## Draft Response — Freshness Warning

**Confidence**: partial_match (sources may be outdated)

[Draft using available sources]

**Warning**: All sources used are stale or expired. Verify the following
before submission:
- [Specific claim] — source last updated [date]
- [Specific claim] — source last updated [date]
```

## Tips

- Never submit a response with `no_content` confidence without explicit user confirmation
- Always include source citations — traceability is essential for bid responses
- UK procurement evaluators value specificity over generality
- If the question asks for word count compliance, always include the count
- Q&A pairs are the strongest source type — they contain pre-approved standard answers
- Case studies are the strongest evidence type — real examples beat descriptions
- Reference `kb://items/{id}` and `kb://qa/{id}` URIs for source traceability
