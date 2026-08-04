/**
 * MCP tool registrations for the Knowledge Hub server.
 *
 * Registers 16 tools across 7 category files (the surface left by the
 * id-417 S530 deletion wave, which retired the search/procurement/
 * templates/apps/workspaces families wholesale — see
 * scripts/mcp-eval/fixtures.ts for the canonical register, including the
 * RETIRED_PENDING_REBUILD_TOOLS the id-71 successor work still owes;
 * drift-guarded bidirectionally by mcp-fixture-sync.test.ts):
 *   - question-matches.ts (1): get_question_matches
 *   - ai.ts         (2): classify_content, generate_summary
 *   - entities.ts   (1): get_entity_relationships
 *   - governance.ts (4): delete_content_item, update_governance_status, update_publication_status, review_governance_item
 *   - review.ts     (2): whats_in_my_queue, create_review_assignment
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
  // Review tools (S180 P0-23) register after governance so review/governance
  // tools appear together in client discovery.

  await registerQuestionMatchTools(server);
  await registerAITools(server);
  await registerEntityTools(server);
  await registerGovernanceTools(server);
  await registerReviewTools(server);
  await registerIntelligenceTools(server);
  await registerGuideTools(server);
}
