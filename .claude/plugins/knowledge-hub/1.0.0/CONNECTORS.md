# Connectors

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user
connects in that category. For example, `~~knowledge base` means the Knowledge
Hub MCP server, which provides direct access to the knowledge base.

Plugins are **tool-agnostic** — they describe workflows in terms of categories
rather than specific products. The `.mcp.json` pre-configures the Knowledge Hub
MCP server, but the commands and skills work with any connected tools.

This plugin uses `~~knowledge base` as its primary connector. Unlike enterprise
search plugins that aggregate across many tools, this plugin provides deep
access to a single, structured knowledge base purpose-built for UK bid
management.

## Connectors for this plugin

| Category       | Placeholder        | Included servers | Other options |
| -------------- | ------------------ | ---------------- | ------------- |
| Knowledge base | `~~knowledge base` | Knowledge Hub    | —             |

## What the Knowledge Hub server provides

The Knowledge Hub MCP server exposes 54 tools, 12 resources, and 7 prompts for
accessing the knowledge base.

### Tools (54)

| #   | Tool                        | Purpose                                                    | Role required |
| --- | --------------------------- | ---------------------------------------------------------- | ------------- |
| 1   | `search_knowledge_base`     | Semantic + keyword search across all KB content            | Any           |
| 2   | `search_qa_library`         | Search Q&A pairs specifically                              | Any           |
| 3   | `find_similar_items`        | Find similar items by cosine similarity                    | Any           |
| 4   | `search_content_chunks`     | Search content chunks with optional item filter            | Any           |
| 5   | `get_dashboard_summary`     | Overview of KB health and attention items                  | Any           |
| 6   | `get_reorientation`         | Personal briefing on what changed and what needs attention | Any           |
| 7   | `get_freshness_report`      | Content freshness breakdown                                | Any           |
| 8   | `get_expiring_content`      | Content expiring within a given window                     | Any           |
| 9   | `list_active_bids`          | Active bids with status, progress, and deadlines           | Any           |
| 10  | `get_bid_detail`            | Bid with questions, responses, progress, and gaps          | Any           |
| 11  | `get_bid_question`          | Specific question with response and confidence posture     | Any           |
| 12  | `cite_content`              | Record that a content item was used in a bid response      | Editor+       |
| 13  | `get_content_effectiveness` | Get win rate stats for a content item                      | Any           |
| 14  | `get_content_item`          | Retrieve a specific content item by ID                     | Any           |
| 15  | `create_content_item`       | Create a new KB content item                               | Editor+       |
| 16  | `update_content_item`       | Edit content item metadata and fields                      | Editor+       |
| 17  | `get_content_items`         | Batch fetch multiple content items by ID array             | Any           |
| 18  | `get_workspace_items`       | Get items in a workspace                                   | Any           |
| 19  | `assign_content_owner`      | Assign owner to content items                              | Editor+       |
| 20  | `get_document_versions`     | Get source document version history                        | Any           |
| 21  | `get_document_diff`         | Get source document diff                                   | Any           |
| 22  | `get_quality_summary`       | Quality issue counts and breakdown                         | Any           |
| 23  | `get_coverage_gaps`         | Identify domains/subtopics with thin or zero coverage      | Any           |
| 24  | `audit_content`             | Find items matching quality criteria                       | Any           |
| 25  | `find_all_duplicates`       | Find duplicate content across the KB                       | Any           |
| 26  | `suggest_content_creation`  | Suggest content to create for coverage gaps                | Any           |
| 27  | `get_quality_briefing`      | Quality intelligence briefing                              | Any           |
| 28  | `get_quality_actions`       | Quality improvement action recommendations                 | Any           |
| 29  | `classify_content`          | Trigger AI classification of an item                       | Editor+       |
| 30  | `generate_summary`          | Generate AI summary for an item                            | Editor+       |
| 31  | `get_entity_relationships`  | Query entity relationships from the entity graph           | Any           |
| 32  | `get_certification_status`  | Certification status report                                | Any           |
| 33  | `list_templates`            | List available templates                                   | Any           |
| 34  | `get_template_coverage`     | Template coverage analysis                                 | Any           |
| 35  | `get_template_gaps`         | Template gap analysis                                      | Any           |
| 36  | `show_coverage_matrix`      | Interactive coverage matrix app (app trigger)              | Any           |
| 37  | `show_bid_dashboard`        | Interactive bid dashboard app (app trigger)                | Any           |
| 38  | `show_reorient_me`          | Interactive reorientation app (app trigger)                | Any           |
| 39  | `show_intelligence_feed`    | Interactive intelligence feed app (app trigger)            | Any           |
| 40  | `delete_content_item`       | Delete or archive a content item                           | Admin         |
| 41  | `update_governance_status`  | Update governance review status                            | Editor+       |
| 42  | `get_governance_queue`      | Get governance review queue                                | Any           |
| 43  | `review_governance_item`    | Process a governance review action                         | Editor+       |
| 44  | `get_review_queue`          | Get content review queue                                   | Any           |
| 45  | `get_assignments_for_user`  | Get review assignments for a user                          | Any           |
| 46  | `create_review_assignment`  | Create a review assignment                                 | Editor+       |
| 47  | `get_intelligence_summary`  | Get intelligence summary for a workspace                   | Any           |
| 48  | `trigger_intelligence_poll` | Trigger intelligence feed poll                             | Editor+       |
| 49  | `list_guides`               | List knowledge base guides                                 | Any           |
| 50  | `get_guide`                 | Get a specific guide                                       | Any           |
| 51  | `create_guide`              | Create a new guide                                         | Editor+       |
| 52  | `update_guide`              | Update an existing guide                                   | Editor+       |
| 53  | `supersede_content_item`    | Mark a content item as superseded                          | Admin         |
| 54  | `get_change_report`         | Get a change report for a period                           | Any           |

### Resources (12)

| URI                               | Description                                          |
| --------------------------------- | ---------------------------------------------------- |
| `kb://items/{id}`                 | Full content item with metadata                      |
| `kb://bids/{id}`                  | Bid workspace with questions and responses           |
| `kb://qa/{id}`                    | Q&A pair with standard/advanced answers              |
| `kb://coverage`                   | Current taxonomy coverage state                      |
| `kb://dashboard`                  | Current dashboard state                              |
| `kb://taxonomy`                   | Domains and subtopics                                |
| `kb://entities`                   | Entity overview with types, counts, and top entities |
| `kb://quality-briefing`           | Aggregated quality intelligence briefing             |
| `ui://coverage-matrix/app.html`   | Coverage Matrix MCP App (interactive UI)             |
| `ui://bid-dashboard/app.html`     | Bid Dashboard MCP App (interactive UI)               |
| `ui://reorient-me/app.html`       | Reorient Me MCP App (interactive UI)                 |
| `ui://intelligence-feed/app.html` | Intelligence Feed MCP App (interactive UI)           |

### Prompts (7)

| Prompt                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `reorient`            | What has changed since I was last active?           |
| `bid_briefing`        | Give me a briefing on a specific bid                |
| `coverage_analysis`   | Analyse coverage gaps and suggest content to create |
| `draft_response`      | Draft a response to a bid question                  |
| `review_item`         | Review a content item for quality                   |
| `sector_briefing`     | Domain-scoped sector intelligence briefing          |
| `bid_pipeline_review` | Pipeline-wide bid action review                     |

## Connecting

1. Open Claude.ai **Settings** (or Cowork settings)
2. Navigate to **Connectors**
3. Click **Add connector**
4. Paste the server URL:
   `https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp`
5. Authenticate with your Knowledge Hub credentials when prompted

Once connected, all 54 tools, 12 resources, and 7 prompts become available
automatically.
