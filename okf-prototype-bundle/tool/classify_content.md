---
type: tool
title: Classify Content (MCP tool)
description:
  An MCP tool that triggers AI classification of a content item, assigning a domain,
  subtopic, keywords, summary, and suggested title.
timestamp: '2026-07-21T10:27:50.047223Z'
tags:
  - mcp-tool
  - ai
  - classification
  - content
  - permissions
expected_behaviour:
  tool: classify_content
  source_ref: lib/mcp/tools/ai.ts#L27-L95
  input:
    - item_id
    - force
  output: []
  claim:
    'Trigger AI classification of a content item — assigns domain, subtopic, keywords,
    summary and a suggested title; requires editor or admin role.'
  check: input-contract-only
---

## Purpose

The `classify_content` tool invokes AI-based classification on a single content item. When
run, the AI assigns a domain, subtopic, keywords, a summary, and a suggested title to the
specified item. This is useful when an agent needs to enrich or categorise content
automatically.

## Inputs

The tool accepts the following parameters:

- **`item_id`** (required) — A UUID string identifying the content item to classify.
- **`force`** (optional, boolean) — When `true`, the tool re-classifies the item even if
  it has already been classified. Defaults to `false`.

## Permissions

Calling this tool requires an **editor** or **admin** role. If the caller lacks either
role, the tool returns an error response indicating that permission is denied.

## Output

On success, the tool returns two parts:

1. **Text content** — A Markdown-formatted summary of the classification result, produced
   by the platform's `formatClassification` helper.
2. **Structured content** — A machine-readable representation of the same result
   (converted via `toStructuredContent`), allowing agents to parse the assigned domain,
   subtopic, keywords, summary, and suggested title programmatically.

## Error Handling

If classification fails for any reason, the tool returns an `isError` response whose text
message includes the underlying error detail and a reminder that editor or admin
permissions are required. Errors may originate from the AI service layer or from general
runtime failures.

## When to Call

An agent should call this tool when it needs to:

- Classify a newly created or unclassified content item.
- Re-classify an existing item whose content has changed (using `force: true`).
- Retrieve an AI-generated summary, keywords, domain, subtopic, and suggested title for a
  content item.

The tool performs a write operation (annotated as a safe write), so it is appropriate for
classification workflows but requires appropriate role-based authentication.

# Citations

[1]
[https://github.com/ai-solution-hub/canonical/blob/e384c77c4c9b4c499f21dd07a069cc92aa9452e7/lib/mcp/tools/ai.ts#L27-L95](https://github.com/ai-solution-hub/canonical/blob/e384c77c4c9b4c499f21dd07a069cc92aa9452e7/lib/mcp/tools/ai.ts#L27-L95)
