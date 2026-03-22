/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 37 tools across 10 category files:
 *   - search.ts     (3): search_knowledge_base, search_qa_library, find_similar_items
 *   - content.ts    (7): get_content_item, create_content_item, update_content_item, get_content_items, assign_content_owner, get_document_versions, get_document_diff
 *   - bids.ts       (5): list_active_bids, get_bid_detail, get_bid_question, cite_content, get_content_effectiveness
 *   - dashboard.ts  (3): get_dashboard_summary, get_reorientation, get_freshness_report
 *   - quality.ts    (7): get_quality_summary, get_coverage_gaps, audit_content, find_all_duplicates, suggest_content_creation, get_quality_briefing, get_quality_actions
 *   - governance.ts (2): delete_content_item, update_governance_status
 *   - ai.ts         (2): classify_content, generate_summary
 *   - entities.ts   (2): get_entity_relationships, get_certification_status
 *   - templates.ts  (3): list_templates, get_template_coverage, get_template_gaps
 *   - apps.ts       (3): show_coverage_matrix, show_bid_dashboard, show_reorient_me
 *
 * All tools use per-user Supabase clients via extra.authInfo so that
 * RLS policies are applied based on the authenticated user.
 *
 * Tool naming: names intentionally omit a service prefix (e.g. kb_). The
 * Knowledge Hub MCP server is designed as a single-purpose connector —
 * users won't have multiple KB servers. Adding prefixes would make names
 * unnecessarily verbose for Claude. Revisit if multi-server scenarios arise.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchTools } from './search';
import { registerContentTools } from './content';
import { registerBidTools } from './bids';
import { registerDashboardTools } from './dashboard';
import { registerQualityTools } from './quality';
import { registerAITools } from './ai';
import { registerEntityTools } from './entities';
import { registerTemplateTools } from './templates';
import { registerAppTools } from './apps';
import { registerGovernanceTools } from './governance';

export async function registerTools(server: McpServer): Promise<void> {
  // Registration order determines tool discovery order in MCP clients.
  // Preserve the original ordering: search, dashboard, bids, content,
  // reorientation, quality, AI, entities, templates, apps, governance.
  //
  // Within each category file, tools are registered in their original
  // numeric order from the monolith.

  await registerSearchTools(server);
  await registerDashboardTools(server);
  await registerBidTools(server);
  await registerContentTools(server);
  await registerQualityTools(server);
  await registerAITools(server);
  await registerEntityTools(server);
  await registerTemplateTools(server);
  await registerAppTools(server);
  await registerGovernanceTools(server);
}
