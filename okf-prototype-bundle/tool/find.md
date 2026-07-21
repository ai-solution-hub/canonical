---
type: tool
title: find — Knowledge Base Search Tool
description: The canonical find MCP tool provides unified search, Q&A lookup, section-level retrieval, and similar-item discovery across the knowledge base.
timestamp: "2026-07-21T10:28:11.144064Z"
tags:
  - mcp-tool
  - search
  - retrieval
  - read-only
expected_behaviour:
  tool: find
  source_ref: lib/mcp/tools/search.ts#L581-L737
  input:
    - query
    - granularity
    - type
    - scope
    - similar_to
    - threshold
    - limit
    - offset
    - workspace_id
    - content_item_id
    - overdue_review
    - review_due_within_days
    - visibility_filter
  output: []
  claim: "The single entry point for search, Q&A lookup, section-level retrieval and similar-item discovery; returns ranked list/preview metadata to feed a follow-up get."
  check: input-contract-only
---
## Purpose

`find` is the single entry point for discovering content in the knowledge base. It consolidates what were formerly separate operations — whole-item search, Q&A library lookup, section-level chunk search, and similar-item discovery — into one read-only tool. Agents should call it whenever they need to locate knowledge, answer a question from stored content, drill into a specific section of a long document, or find items related to a known content item.

After `find` returns ranked previews, use the `get` tool to fetch the verbatim content of an accepted result.

## Inputs

All parameters are optional except that either `query` or `similar_to` must be supplied.

- **query** — Natural-language search string. Required unless `similar_to` is given.
- **granularity** — `item` (default) returns whole content items; `chunk` returns individual document sections with heading-path breadcrumbs for fine-grained retrieval inside long documents.
- **type** — Filters results by content type. Use `q_a_pair` to retrieve reusable Q&A answers. Applies only to item granularity.
- **scope** — Filters by domain corpus; valid values are drawn from the system's domain list. The `kb://taxonomy` resource exposes the full subtopic list. Applies only to item granularity.
- **similar_to** — A content item identifier. When supplied, the tool performs vector cosine-similarity discovery against published items and ignores `query`, `scope`, `type`, and `granularity`. Items above 95% similarity are flagged as likely duplicates. No AI cost is incurred.
- **threshold** — For `similar_to` only: minimum cosine similarity (default 0.8, range 0.5–1.0).
- **limit** — Maximum results. Defaults and caps differ by branch: item (default 10, max 50), chunk (default 10, max 30), similar_to (default 10, max 25).
- **offset** — Pagination offset for item granularity (default 0).
- **workspace_id** — Influences the ranking profile via the workspace application type at item granularity. As of milestone ID-131.19 (M6), this no longer restricts results to workspace-assigned items; it only affects ranking.
- **content_item_id** — For chunk granularity: restricts search to sections within a single known document.
- **overdue_review** — Chunk-granularity review-cadence filter. `true` returns only chunks from items overdue for review; `false` excludes them; omit for no filter.
- **review_due_within_days** — Chunk-granularity filter (1–365): only return chunks from items whose next review date falls within this many days from today.
- **visibility_filter** — Publication-state filter. `default` (or omitted) returns published-only live content; `all` returns draft, in_review, and published (non-archived); `admin` returns every state including archived.

## Behaviour and Branches

The tool dispatches to one of three internal branches:

1. **Similar-items discovery** — Triggered when `similar_to` is set. Returns published items ranked by vector cosine similarity, with likely-duplicate flags above 95%. All other search parameters are ignored.
2. **Chunk search** — Triggered when `granularity` is `chunk` and a `query` is supplied. Returns section-level results with heading breadcrumbs, optionally scoped to a single document or filtered by review cadence and visibility.
3. **Item search (default)** — Triggered otherwise. Performs whole-item search with support for `scope`, `type`, `offset`, `workspace_id`, and visibility filtering. The `q_a_pair` type slice replaces the former Q&A library search.

If neither `query` nor `similar_to` is supplied, the tool returns an error response instructing the caller to provide a natural-language query or a content item identifier for similarity search.

## Output Shape

The response is a ranked list of preview metadata — typically title, domain, summary, and a relevance score — sufficient for an agent or human to decide which result to accept. The union response schema is intentionally not emitted as a formal output schema due to an MCP SDK limitation around Zod unions.

## When to Call

Call `find` when you need to:

- Answer a question from knowledge-base content.
- Locate a whole document or content item by topic.
- Retrieve reusable Q&A answers (set `type` to `q_a_pair`).
- Find a specific section inside a long document (set `granularity` to `chunk`).
- Discover items similar to a known content item, or detect likely duplicates (set `similar_to`).

Follow up with `get` once a result has been accepted to retrieve its verbatim content.

# Citations

[1] [https://github.com/ai-solution-hub/canonical/blob/0636ab2e7e473cd7e047c48919dc4eea9d8c05ce/lib/mcp/tools/search.ts#L581-L737](https://github.com/ai-solution-hub/canonical/blob/0636ab2e7e473cd7e047c48919dc4eea9d8c05ce/lib/mcp/tools/search.ts#L581-L737)

