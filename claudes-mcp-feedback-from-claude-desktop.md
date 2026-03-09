## Claude's feedback from using the MCP within the Claude Desktop application

"Great question. Having just spent a solid session as a real-world MCP consumer doing exactly the kind of work the platform is designed to support, I've got a pretty clear picture of what's working, what's friction, and what's missing. Let me lay it out."

---

### What works well today

The **read-side tools are strong**. `search_knowledge_base`, `search_qa_library`, and `get_content_item` gave me everything I needed to find content, drill into it, and assess quality. The search returns relevance scores, domain classifications, and summaries inline — that's exactly the right level of detail for an AI to triage without having to fetch every item individually. `get_dashboard_summary` and `get_quality_summary` are genuinely useful orientation tools; I used them naturally at the start of the session to understand the state of play.

`classify_content` handled edge cases honestly — it rejected empty items cleanly and downgraded confidence on near-empty ones with transparent reasoning. That's the right behaviour.

---

### The gaps I hit during this session

**1. No way to filter by content quality programmatically**

This was the single biggest friction point. I needed to answer "show me all items where the content is just 'Yes'" and had to do it by running broad searches, fetching items one by one, and manually checking content length. That's exactly the kind of task an AI shouldn't have to brute-force.

A tool like `list_quality_issues` or a filter parameter on `search_knowledge_base` would transform this. Something like:

```
search_knowledge_base(query="*", filter="content_length < 20")
search_knowledge_base(query="*", filter="classification_confidence < 50")
search_knowledge_base(query="*", filter="has_summary = false")
```

Or even better, a dedicated `audit_content` tool that returns items matching quality criteria — thin answers, missing summaries, low confidence, garbled keywords, duplicates. The deterministic quality checks you're planning for `lib/ai/quality.ts` could power this directly.

**2. No update/edit capability via MCP**

I can `create_content_item` and `classify_content`, but I can't *edit* an existing item. During this session, I identified items with truncated data (the ICO registration date, the DPO contact), garbled keywords, and "Yes" answers that need enrichment. But I couldn't fix any of them — I could only report them.

For the "Claude-first" philosophy to work fully, Claude needs to be able to propose edits. This doesn't have to be uncontrolled — it could create a draft edit that appears in the review queue, matching the "observe and intervene" principle. Something like:

```
update_content_item(id, fields: { content: "...", answer_standard: "..." }, reason: "Enriched thin answer")
```

With governance status automatically set to `pending` so a human reviews it. This would let Claude enrich the "Yes" items by drafting `answer_standard` content based on the question context and related KB items — exactly the workflow I recommended in the improvement document.

**3. `generate_summary` doesn't work via MCP**

Every `generate_summary` call returned "No approval received." This is presumably a confirmation dialog in the web UI that the MCP transport can't present. For `force=true` calls from an authenticated editor/admin, this should either bypass the approval or the MCP tool should handle it differently — perhaps returning the summary as a preview that the user can confirm via the web UI later, rather than blocking entirely.

**4. No batch operations**

I checked about 25 items individually during this session. Each `get_content_item` call is a separate round-trip. For quality audits, a `get_content_items` (plural) tool that accepts an array of IDs and returns them all would be significantly more efficient. Similarly, a batch classify or batch summary tool would be useful for the kind of "run this across 16 thin items" workflow that's needed now.

**5. No duplicate detection tool**

I identified duplicates by noticing identical titles and content during manual browsing. The platform already has embeddings for every item — a `find_duplicates` or `find_similar` tool that takes an item ID and returns items above a cosine similarity threshold would be powerful. This maps directly to the dedup work planned for the Python pipeline, but exposing it via MCP would let Claude flag duplicates during normal usage rather than needing a dedicated batch job.

**6. No entity/relationship query tool**

The context graph research document plans a `get_entity_relationships` MCP tool (Phase 3). From this session's experience, I can confirm it would be valuable — when I was trying to understand "what does example-client say about ISO 27001 across all items?", I was essentially doing manual entity traversal through search. An entity-centric query would have been much faster and more complete.

---

### New tools I'd recommend (prioritised)

**High priority — would have directly improved this session:**

| Tool | Purpose | Complexity |
|------|---------|------------|
| `audit_content` | Return items matching quality filters (thin content, low confidence, missing fields, garbled keywords) | Medium — wraps SQL queries against existing columns |
| `update_content_item` | Edit content/metadata with automatic governance flagging | Medium — CRUD already exists in API routes |
| `find_similar_items` | Return items above a cosine similarity threshold for a given item ID | Low — embeddings and pgvector already exist |
| `get_content_items` (batch) | Fetch multiple items by ID array | Low — trivial wrapper |

**Medium priority — would improve ongoing usage:**

| Tool | Purpose | Complexity |
|------|---------|------------|
| `get_entity_relationships` | Query the entity graph (once built) | Low once Phase 3 is done |
| `propose_enrichment` | AI drafts an `answer_standard` for a thin item, queued for human review | Medium — combines AI service layer + governance |
| `batch_classify` | Classify multiple items in one call | Low — loop wrapper with progress |
| `get_coverage_gaps` | Return domains/subtopics with no or thin content | Low — SQL query against taxonomy tables |

**Lower priority but valuable:**

| Tool | Purpose |
|------|---------|
| `merge_items` | Combine two duplicate items, keeping the richer content |
| `flag_for_review` | Let Claude flag an item with a specific quality concern |
| `get_item_usage` | Show where an item has been used in bids (for feedback loop) |

---

### Tool description improvements

The existing tool descriptions are good, but a few tweaks would help AI clients use them more effectively:

- **`search_knowledge_base`** — the `domain` filter parameter exists but the valid domain values aren't listed in the description. Including the taxonomy (or pointing to the `kb://taxonomy` resource) would help Claude filter correctly without guessing.
- **`search_qa_library`** — it would help to clarify how this differs from `search_knowledge_base` beyond just filtering to Q&A types. Does it search `answer_standard`/`answer_advanced` separately? Does it weight question text differently from answer text?
- **`create_content_item`** — the `content_type` enum is great, but there's no guidance on when to use `q_a_pair` vs `article` vs `policy`. A line in the description like "Use q_a_pair for question-and-answer format typically sourced from tender responses" would help.
- **`get_content_item`** — the return format includes entities and relationships now (given the 781 entities / 709 relationships you mentioned). The tool description should mention this so Claude knows to look for them.

---

### The bigger picture

The MCP server is already in a strong position — 13 tools covering read, search, classify, summarise, and create operations. The pattern of "Claude reads and analyses via MCP, humans curate via web UI" is working. The main evolution needed is closing the loop: letting Claude not just *identify* problems but *propose fixes* that flow through governance. That aligns perfectly with the "observe and intervene" design principle and the library-to-bid feedback loop.

The `audit_content` tool is probably the single highest-value addition. It turns the entire quality audit I just did manually into something Claude can do in one call at the start of any session — "here are the 28 items that need attention, categorised by issue type." That's the kind of thing that makes the "Reorient Me" pattern even more powerful.

Want me to write any of this up more formally as a spec for the Claude Code session, or is this level of detail enough to work from?