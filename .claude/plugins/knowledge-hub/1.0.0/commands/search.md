---
description: Search the knowledge base using semantic and keyword search
argument-hint: "<query>"
---

# Search Command

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

```
+---------------------------------------------------------+
|  STANDALONE (always works)                              |
|  You provide content or context; Claude applies search  |
|  strategy, query decomposition, and synthesis skills    |
+---------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)             |
|  Claude searches your live KB directly, returns ranked  |
|  results with freshness, confidence, and citations      |
+---------------------------------------------------------+
```

Search the knowledge base for relevant content. Decompose the user's question, execute a hybrid semantic + keyword search, and present synthesised results with source attribution.

Search for: $ARGUMENTS
If a file is referenced: @$1

## What I Need From You

**Option A — Just ask (connector required):**
```
/kb:search what is our approach to data protection?
```

**Option B — Provide context manually (no connector needed):**
```
/kb:search
[Paste the content or context you want me to search through]
```

**Option C — Combine both:**
```
/kb:search ISO 27001 evidence
[Also paste any additional documents for cross-referencing]
```

## Usage

```
/kb:search what is our approach to data protection?
/kb:search ISO 27001 certification
/kb:search case studies healthcare sector last 3 years
/kb:search Q&A pairs about business continuity
```

## Instructions

### 1. Parse the Query

Analyse the search query to understand:

- **Intent**: What is the user looking for? (a fact, a policy, evidence for a bid, a Q&A pair, a case study)
- **Content type signals**: References to specific types ("Q&A", "policy", "case study", "certification")
- **Domain signals**: References to specific domains ("security", "compliance", "service delivery")
- **Freshness signals**: Recency requirements ("current", "latest", "up to date")
- **Scope signals**: Broad ("everything about X") vs narrow ("the specific policy on Y")

Use the @search-strategy skill to classify the query type and determine the optimal search approach.

### 2. Determine Search Strategy

Based on the query analysis, decide:

**Use `search_knowledge_base`** for:
- General questions across all content types
- Exploratory queries ("what do we know about...")
- Domain-specific searches
- Policy or procedure lookups
- Case study searches

**Use `search_qa_library`** for:
- Questions that are likely answered by existing Q&A pairs
- Bid-specific questions seeking standard answers
- Queries containing "Q&A", "standard answer", "bid response"

**Use both** when:
- Drafting comprehensive bid responses (Q&A for the answer, general search for supporting evidence)
- The user wants complete coverage of a topic

Apply domain filtering if the query clearly targets a specific domain.

### 3. Execute Search

**If `~~knowledge base` connector is available:**

Call `search_knowledge_base` with the query text and any applicable filters:
- `query` — the search query
- `limit` — number of results (default 10, increase for broad queries)
- `domain` — filter by primary domain if the query targets a specific area

If Q&A-specific, also call `search_qa_library` with the same query.

**If no connector available:**

```
To search your knowledge base, connect the Knowledge Hub server.

In your MCP settings, add the Knowledge Hub connector:
URL: https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp

Alternatively, paste the content you'd like me to search through and I'll help find what you need.
```

### 4. Assess Result Quality

For each result, evaluate using the @knowledge-synthesis skill:

- **Similarity score**: >0.7 strong match, 0.5-0.7 moderate, 0.3-0.5 weak — below 0.3 likely irrelevant
- **Freshness status**: fresh (reliable), aging (probably fine), stale (flag it), expired (warn the user)
- **Classification confidence**: >0.8 well-classified, 0.6-0.8 moderate, <0.6 may be misclassified
- **Content type**: Does it match what the user is looking for?

Filter out weak results (similarity <0.3) unless the result set is very small.

### 5. Synthesise Results

Use the @knowledge-synthesis skill to combine results into a coherent response.

**For factual queries ("What is our policy on X?"):**
```
[Direct answer synthesised from the most authoritative source]

Sources:
- [Title] (type, domain, freshness) — [brief description of relevance]
- [Title] (type, domain, freshness) — [brief description of relevance]
```

**For exploratory queries ("What do we know about X?"):**
```
[Synthesised summary combining information from all sources]

Found [N] relevant items across [domains]:
- [Count] Q&A pairs
- [Count] policies
- [Count] case studies
- [Other types as applicable]

Key sources:
- [Most relevant source with ID]
- [Second most relevant source]
```

**For bid-specific queries ("Evidence of similar projects"):**
```
[Summary of available evidence]

Strong matches:
- [Source 1] — [why it's relevant, key facts]
- [Source 2] — [why it's relevant, key facts]

Supporting evidence:
- [Additional sources]

Gaps: [Note any areas where KB coverage is thin]
```

### 6. Present with Citations

Every result should include:
- **Item title** (or suggested title)
- **Content type** (article, Q&A pair, case study, etc.)
- **Domain and subtopic** if classified
- **Freshness status** if not fresh
- **Similarity score** for transparency

Format item references as: `[Title] (kb://items/{id})` or `[Title] (kb://qa/{id})` for Q&A pairs.

### 7. Handle Edge Cases

**No results:**
```
I couldn't find anything matching "[query]" in the knowledge base.

Try:
- Broader terms (e.g., "security" instead of "ISO 27001 Annex A controls")
- Different phrasing (the KB uses semantic search, so rephrase rather than adding keywords)
- Checking if content exists in this domain (/kb:coverage to see domain health)
```

**Low-confidence results only:**
```
I found some results, but none are strong matches for "[query]":

[Results with similarity scores shown]

These may be tangentially related. Consider:
- Refining your search terms
- Checking if this topic has been added to the KB yet
- Creating a new content item if this is a gap
```

**Stale or expired results:**
```
[Results]

Note: [N] of these items are flagged as [stale/expired]. The information
may be outdated and should be verified before use in a bid response.
```

## Tips

- Always synthesise results into answers — do not present raw search result lists
- Include source attribution so users can access the full item
- When results span multiple domains, group by domain for clarity
- For bid-related queries, always note the confidence level and whether sources are current
- If only Q&A pairs are found, suggest searching the broader KB for supporting evidence
- If only articles are found, suggest checking the Q&A library for standard answers
