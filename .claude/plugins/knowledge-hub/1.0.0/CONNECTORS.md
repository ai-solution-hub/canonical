# Connectors

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~knowledge base` means the Knowledge Hub MCP server, which provides direct access to the knowledge base.

Plugins are **tool-agnostic** — they describe workflows in terms of categories rather than specific products. The `.mcp.json` pre-configures the Knowledge Hub MCP server, but the commands and skills work with any connected tools.

This plugin uses `~~knowledge base` as its primary connector. Unlike enterprise search plugins that aggregate across many tools, this plugin provides deep access to a single, structured knowledge base purpose-built for UK bid management.

## Connectors for this plugin

| Category | Placeholder | Included servers | Other options |
|----------|-------------|-----------------|---------------|
| Knowledge base | `~~knowledge base` | Knowledge Hub | — |

## What the Knowledge Hub server provides

The Knowledge Hub MCP server exposes 23 tools, 9 resources, and 5 prompts for accessing the knowledge base.

### Tools (23)

| # | Tool | Purpose | Role required |
|---|------|---------|---------------|
| 1 | `search_knowledge_base` | Semantic + keyword search across all KB content | Any |
| 2 | `get_dashboard_summary` | Overview of KB health and attention items | Any |
| 3 | `list_active_bids` | Active bids with status, progress, and deadlines | Any |
| 4 | `get_content_item` | Retrieve a specific content item by ID | Any |
| 5 | `get_reorientation` | Personal briefing on what changed and what needs attention | Any |
| 6 | `get_bid_detail` | Bid with questions, responses, progress, and gaps | Any |
| 7 | `get_bid_question` | Specific question with response and confidence posture | Any |
| 8 | `get_quality_summary` | Quality issue counts and breakdown | Any |
| 9 | `get_freshness_report` | Content freshness breakdown | Any |
| 10 | `classify_content` | Trigger AI classification of an item | Editor+ |
| 11 | `generate_summary` | Generate AI summary for an item | Editor+ |
| 12 | `create_content_item` | Create a new KB content item | Editor+ |
| 13 | `search_qa_library` | Search Q&A pairs specifically | Any |
| 14 | `get_entity_relationships` | Query entity relationships from the entity graph | Any |
| 15 | `cite_content` | Record that a content item was used in a bid response | Editor+ |
| 16 | `get_content_effectiveness` | Get win rate stats for a content item | Any |
| 17 | `get_coverage_gaps` | Identify domains/subtopics with thin or zero coverage | Any |
| 18 | `audit_content` | Find items matching quality criteria (thin, low confidence, etc.) | Any |
| 19 | `update_content_item` | Edit content item metadata and fields | Editor+ |
| 20 | `find_similar_items` | Find similar items by cosine similarity | Any |
| 21 | `get_content_items` | Batch fetch multiple content items by ID array | Any |
| 22 | `show_coverage_matrix` | Interactive coverage matrix app (app trigger) | Any |
| 23 | `show_bid_dashboard` | Interactive bid dashboard app (app trigger) | Any |

### Resources (9)

| URI | Description |
|-----|-------------|
| `kb://items/{id}` | Full content item with metadata |
| `kb://bids/{id}` | Bid workspace with questions and responses |
| `kb://qa/{id}` | Q&A pair with standard/advanced answers |
| `kb://coverage` | Current taxonomy coverage state |
| `kb://dashboard` | Current dashboard state |
| `kb://taxonomy` | Domains and subtopics |
| `kb://entities` | Entity overview with types, counts, and top entities |
| `ui://coverage-matrix/app.html` | Coverage Matrix MCP App (interactive UI) |
| `ui://bid-dashboard/app.html` | Bid Dashboard MCP App (interactive UI) |

### Prompts (5)

| Prompt | Description |
|--------|-------------|
| `reorient` | What has changed since I was last active? |
| `bid_briefing` | Give me a briefing on a specific bid |
| `coverage_analysis` | Analyse coverage gaps and suggest content to create |
| `draft_response` | Draft a response to a bid question |
| `review_item` | Review a content item for quality |

## Connecting

1. Open Claude.ai **Settings** (or Cowork settings)
2. Navigate to **Connectors**
3. Click **Add connector**
4. Paste the server URL: `https://knowledge-hub-seven-kappa.vercel.app/api/mcp/mcp`
5. Authenticate with your Knowledge Hub credentials when prompted

Once connected, all 23 tools, 9 resources, and 5 prompts become available automatically.
