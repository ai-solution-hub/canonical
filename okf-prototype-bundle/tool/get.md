---
type: tool
title: get — Retrieve content items from the knowledge base
description:
  An MCP tool that retrieves one or many content items from the knowledge base, returning
  either a single verbatim item with its chunks or a batch preview list.
timestamp: '2026-07-21T10:28:33.731201Z'
tags:
  - mcp
  - tool
  - retrieval
  - read-only
  - content
expected_behaviour:
  tool: get
  source_ref: lib/mcp/tools/content.ts#L162-L391
  input:
    - id
    - ids
  output:
    - mode
    - item
    - count
    - items
    - not_found
  claim:
    'Given a content-item id returns that item verbatim with its chunks; given ids (max
    50) returns a truncated batch list/preview; exactly one of id or ids must be supplied.'
  check: contract-match
---

## Purpose

The `get` tool is the **accept step** of the two-step retrieval flow on the Canonical
knowledge base. After an agent has used a search tool to identify candidate content items,
it calls `get` to fetch the actual item contents — either one item in full, or a batch of
items as a lightweight preview.

It is registered with read-only annotations, so it performs no mutations.

## When to call it

- **After searching** — use search first to obtain item identifiers, then use `get` to
  retrieve the full text and metadata of the items you actually need.
- **Single verbatim retrieval** — when you need the complete content, summary, keywords,
  freshness status, and document-section chunks for one specific item.
- **Batch audit / preview** — when you want to review or audit several items together
  without fetching their full bodies.
- Use `get_entity_relationships` to explore connected entities rather than this tool.

## Inputs

The tool accepts **exactly one** of the following parameters. Passing neither or both
causes an immediate error.

- `id` — a single content item identifier (UUID). Returns the verbatim item.
- `ids` — an array of content item identifiers (UUIDs), minimum 1 and maximum 50. Returns
  a batch list/preview.

## Outputs

The response uses an `outputSchema` with a discriminated `mode` field:

- `mode` — either `"single"` or `"batch"`, indicating which retrieval shape was returned.
- `item` — the verbatim item (including chunks) in single mode; `null` in batch mode.
- `count` — number of items returned. Always `1` in single mode; the number found in batch
  mode.
- `items` — the list/preview items in batch mode; empty array in single mode.
- `not_found` — requested identifiers that could not be located (batch mode).

### Single mode

The item returned includes: identifier, suggested title, content type, primary domain,
primary subtopic, summary, AI keywords, classification confidence, source URL, the full
extracted text, freshness status, governance review status, and creation/update
timestamps. Document-section chunks are also included as lightweight metadata (heading
text, heading level, heading path, position, character count, word count) — chunk content
itself is not returned.

Both the human-readable markdown text and the structured content are truncated if they
exceed an internal character limit, which protects against oversized responses from large
PDFs.

### Batch mode

Each item carries the same descriptive fields but with **content truncated** and **chunks
omitted**, making it suitable for auditing or reviewing many items in a single call. Any
requested identifiers that were not found are listed in `not_found`.

## Behavioural notes

- **Exactly-one-of guard:** if both `id` and `ids` are supplied, or neither is, the tool
  returns an error instructing the caller to provide exactly one.
- **Lifecycle facet (single mode):** freshness and governance review status are joined
  from a lifecycle record on a best-effort basis. If that facet read fails, the call
  degrades gracefully to a null governance state rather than failing outright.
- **Chunk fetch (single mode):** chunk metadata is fetched non-fatally. If the chunk query
  fails, chunks are omitted from the response and a warning is logged, but the item itself
  is still returned.
- **Error handling:** a missing single item, a failed batch fetch, or an unexpected
  exception each produce a clear text error message with `isError: true`.
- **Truncation:** both markdown text and structured content are truncated when they would
  exceed the configured character limit.

## Response shape

The tool returns an MCP-style response containing:

- `content` — an array with a single `text` part holding formatted markdown.
- `structuredContent` — the structured payload described above (single or batch mode).
- `isError` — set to `true` on validation or retrieval failures.

# Citations

[1]
[https://github.com/ai-solution-hub/canonical/blob/c256466c64f13012e405a1a3b26398ebb0f6bfd7/lib/mcp/tools/content.ts#L162-L391](https://github.com/ai-solution-hub/canonical/blob/c256466c64f13012e405a1a3b26398ebb0f6bfd7/lib/mcp/tools/content.ts#L162-L391)
