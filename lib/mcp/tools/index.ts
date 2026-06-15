/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 42 tools across 16 category files (canonical surface after the
 * S357 Wave-1 consolidations — see scripts/mcp-eval/fixtures.ts, drift-guarded
 * by mcp-fixture-sync.test.ts):
 *   - search.ts     (2): find_duplicates, find
 *   - content.ts    (7): get, create_content_item, update_content_item, get_workspace_items, assign, get_document_versions, get_document_diff
 *   - procurement.ts (5): list_active_procurement, get_procurement_detail, get_form_question, cite_content, get_content_effectiveness
 *   - dashboard.ts  (2): get_reorientation, where_are_we_exposed
 *   - quality.ts    (1): suggest_content_creation
 *   - governance.ts (4): delete_content_item, update_governance_status, update_publication_status, review_governance_item
 *   - supersession.ts (1): supersede_content_item
 *   - review.ts     (2): whats_in_my_queue, create_review_assignment
 *   - ai.ts         (2): classify_content, generate_summary
 *   - entities.ts   (1): get_entity_relationships
 *   - templates.ts  (3): list_templates, get_template_coverage, get_template_gaps
 *   - apps.ts       (4): show_coverage_matrix, show_procurement_dashboard, show_reorient_me, show_intelligence_feed
 *   - intelligence.ts (2): get_intelligence_summary, trigger_intelligence_poll
 *   - guides.ts     (4): list_guides, get_guide, create_guide, update_guide
 *   - change-report.ts (1): get_change_report
 *   - workspaces.ts (1): list_user_workspaces
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
import { registerProcurementTools } from './procurement';
import { registerDashboardTools } from './dashboard';
import { registerQualityTools } from './quality';
import { registerAITools } from './ai';
import { registerEntityTools } from './entities';
import { registerTemplateTools } from './templates';
import { registerAppTools } from './apps';
import { registerGovernanceTools } from './governance';
import { registerSupersessionTools } from './supersession';
import { registerReviewTools } from './review';
import { registerIntelligenceTools } from './intelligence';
import { registerGuideTools } from './guides';
import { registerChangeReportTools } from './change-report';
import { registerWorkspaceTools } from './workspaces';

export async function registerTools(server: McpServer): Promise<void> {
  // Registration order determines tool discovery order in MCP clients.
  // Preserve the original ordering: search, dashboard, bids, content,
  // reorientation, quality, AI, entities, templates, apps, governance.
  // Review tools (S180 P0-23) register after governance so review/governance
  // tools appear together in client discovery.
  //
  // Within each category file, tools are registered in their original
  // numeric order from the monolith.

  await registerSearchTools(server);
  await registerDashboardTools(server);
  await registerProcurementTools(server);
  await registerContentTools(server);
  await registerQualityTools(server);
  await registerAITools(server);
  await registerEntityTools(server);
  await registerTemplateTools(server);
  await registerAppTools(server);
  await registerGovernanceTools(server);
  await registerSupersessionTools(server);
  await registerReviewTools(server);
  await registerIntelligenceTools(server);
  await registerGuideTools(server);
  await registerChangeReportTools(server);
  await registerWorkspaceTools(server);
}
