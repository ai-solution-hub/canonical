/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 54 tools across 15 category files:
 *   - search.ts     (4): search_knowledge_base, search_qa_library, find_similar_items, search_content_chunks
 *   - content.ts    (8): get_content_item, create_content_item, update_content_item, get_content_items, get_workspace_items, assign_content_owner, get_document_versions, get_document_diff
 *   - bids.ts       (5): list_active_bids, get_bid_detail, get_bid_question, cite_content, get_content_effectiveness
 *   - dashboard.ts  (4): get_dashboard_summary, get_reorientation, get_freshness_report, get_expiring_content
 *   - quality.ts    (7): get_quality_summary, get_coverage_gaps, audit_content, find_all_duplicates, suggest_content_creation, get_quality_briefing, get_quality_actions
 *   - governance.ts (4): delete_content_item, update_governance_status, get_governance_queue, review_governance_item
 *   - supersession.ts (1): supersede_content_item
 *   - review.ts     (3): get_review_queue, get_assignments_for_user, create_review_assignment
 *   - ai.ts         (2): classify_content, generate_summary
 *   - entities.ts   (2): get_entity_relationships, get_certification_status
 *   - templates.ts  (3): list_templates, get_template_coverage, get_template_gaps
 *   - apps.ts       (4): show_coverage_matrix, show_bid_dashboard, show_reorient_me, show_intelligence_feed
 *   - intelligence.ts (2): get_intelligence_summary, trigger_intelligence_poll
 *   - guides.ts     (4): list_guides, get_guide, create_guide, update_guide
 *   - change-report.ts (1): get_change_report
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
import { registerSupersessionTools } from './supersession';
import { registerReviewTools } from './review';
import { registerIntelligenceTools } from './intelligence';
import { registerGuideTools } from './guides';
import { registerChangeReportTools } from './change-report';

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
  await registerBidTools(server);
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
}
