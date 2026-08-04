/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 40 tools across 16 category files (canonical surface after the
 * S357 Wave-1 consolidations + ID-117.12 get_document_diff retirement +
 * ID-131.19 get_workspace_items retirement + ID-145 {145.17} R7 reader
 * addition + ID-417 supersede_content_item retirement — see
 * scripts/mcp-eval/fixtures.ts, drift-guarded by
 * mcp-fixture-sync.test.ts):
 *   - question-matches.ts (1): get_question_matches
 *   - governance.ts (4): delete_content_item, update_governance_status, update_publication_status, review_governance_item
 *   - review.ts     (2): whats_in_my_queue, create_review_assignment
 *   - ai.ts         (2): classify_content, generate_summary
 *   - entities.ts   (1): get_entity_relationships
 *   - apps.ts       (1): show_intelligence_feed
 *   - intelligence.ts (2): get_intelligence_summary, trigger_intelligence_poll
 *   - guides.ts     (4): list_guides, get_guide, create_guide, update_guide
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
import { registerQuestionMatchTools } from './question-matches';
import { registerAITools } from './ai';
import { registerEntityTools } from './entities';
import { registerGovernanceTools } from './governance';
import { registerReviewTools } from './review';
import { registerIntelligenceTools } from './intelligence';
import { registerGuideTools } from './guides';

export async function registerTools(server: McpServer): Promise<void> {
  // Registration order determines tool discovery order in MCP clients.
  // Preserve the original ordering: search, dashboard, procurement,
  // reorientation, quality, AI, entities, templates, apps, governance.
  // Review tools (S180 P0-23) register after governance so review/governance
  // tools appear together in client discovery. question-matches (ID-145
  // {145.17}) registers directly after procurement — same domain, new file
  // (kept disjoint from procurement.ts per TECH §4 / {145.21} ownership).

  await registerQuestionMatchTools(server);
  await registerAITools(server);
  await registerEntityTools(server);
  await registerGovernanceTools(server);
  await registerReviewTools(server);
  await registerIntelligenceTools(server);
  await registerGuideTools(server);
}
