---
type: tool
title: Get Procurement Detail
description: Read-only MCP tool that retrieves detailed information about a single procurement form, including buyer, deadline, status, question sections, and submission readiness.
timestamp: "2026-07-21T10:28:59.151280Z"
tags:
  - mcp-tool
  - procurement
  - read-only
  - form-detail
  - readiness
expected_behaviour:
  tool: get_procurement_detail
  source_ref: lib/mcp/tools/procurement.ts#L204-L378
  input:
    - id
  output: []
  claim: "Get detailed information about a specific procurement including buyer, deadline, status and question-completion progress; used after listing procurements to drill into one."
  check: input-contract-only
---
## Purpose

The `get_procurement_detail` tool drills into a single procurement form instance to return a comprehensive view of its metadata, question sections, response statistics, and submission readiness. It is intended to be called **after** an agent has listed procurements and identified a specific form of interest.

## Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id`      | string (UUID) | Yes | The unique identifier of the procurement form instance. |

## Behaviour

1. **Form lookup** — Queries the `form_instances` table for the given identifier, selecting name, description, issuing organisation, deadline, reference number, and workflow state. If no matching row is found, the tool returns an error response stating the procurement was not found.

2. **Question statistics** — Calls the `get_form_question_stats` RPC to retrieve aggregate statistics about the form's questions.

3. **Section breakdown** — Fetches all questions grouped by section, along with a status breakdown and a confidence breakdown for the form's responses.

4. **Readiness summary** — For every question on the form, the tool retrieves the corresponding `form_responses` records and computes:
   - **Answered** — questions with non-empty response text.
   - **Approved** — questions whose review status is `approved` or `edited`.
   - **Quality checked** — questions that carry quality-data metadata.
   - **Passing quality** — quality-checked questions whose overall score meets or exceeds a threshold of 60.
   - **Ready flag** — `true` only when every question is answered, every question is approved, and either no quality checks exist or all quality checks pass the threshold.

5. **Response formatting** — Assembles a `ProcurementDetail` object containing the form metadata, question stats, sections, breakdowns, and readiness summary. This is rendered into a truncated Markdown string for the text content and also provided as structured content.

## Output Shape

The tool returns two parallel payloads:

- **Text content** — A Markdown rendering of the procurement detail, appended with a one-line readiness indicator (e.g. *Ready to export* or *Not ready*) showing answered and approved counts out of the total.
- **Structured content** — A JSON object mirroring the procurement detail fields plus a `readiness_summary` object containing the boolean `ready` flag and a `summary` with counts for total questions, answered, approved, quality-checked, and passing-quality.

Key fields in the structured payload include:

| Field | Description |
|-------|-------------|
| `id` | Form instance identifier. |
| `name` | Display name (defaults to "Untitled Procurement" if absent). |
| `buyer` | Issuing organisation, if available. |
| `status` | Workflow state of the form. |
| `deadline` | Submission deadline. |
| `reference_number` | External reference number, if any. |
| `description` | Form description. |
| `question_stats` | Aggregate statistics from the RPC call. |
| `sections` | Array of sections, each containing its questions. |
| `status_breakdown` | Breakdown of response statuses across the form. |
| `confidence_breakdown` | Breakdown of confidence levels across the form. |
| `readiness_summary` | Object with `ready` boolean and a `summary` of counts. |

## Error Handling

- **Not found** — If the form identifier does not match a row, the tool returns `isError: true` with a message indicating the procurement was not found.
- **Unexpected failure** — Any exception during execution is caught and returned as an error with the underlying message, advising the caller to verify the identifier is a valid UUID.

## When to Call

Call this tool when an agent needs the full picture of a single procurement — its buyer, deadline, status, section-level question content, and whether it is ready to export. It is the natural follow-up to a procurement listing operation and should be used before any action that depends on question-level detail or submission readiness.

# Citations

[1] [https://github.com/ai-solution-hub/canonical/blob/667a99681418d44f10c088cbc72268b101297f84/lib/mcp/tools/procurement.ts#L204-L378](https://github.com/ai-solution-hub/canonical/blob/667a99681418d44f10c088cbc72268b101297f84/lib/mcp/tools/procurement.ts#L204-L378)

