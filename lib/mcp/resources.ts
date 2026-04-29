/**
 * MCP resource and prompt registrations for the Knowledge Hub server.
 *
 * Resources (12):
 *   - kb://items/{id}    — Full content item with metadata
 *   - kb://bids/{id}     — Bid with questions and responses
 *   - kb://qa/{id}       — Q&A pair with standard/advanced answers
 *   - kb://coverage      — Current taxonomy coverage state
 *   - kb://dashboard     — Current dashboard state
 *   - kb://taxonomy      — Domains and subtopics
 *   - kb://entities      — Entity overview with types, counts, and top entities
 *   - ui://coverage-matrix/app.html   — Coverage Matrix MCP App (interactive UI)
 *   - ui://bid-dashboard/app.html     — Bid Dashboard MCP App (interactive UI)
 *   - ui://reorient-me/app.html       — Reorient Me MCP App (interactive UI)
 *   - ui://intelligence-feed/app.html — Intelligence Feed MCP App (interactive UI)
 *   - kb://quality-briefing           — Aggregated quality intelligence briefing
 *
 * Prompts (7):
 *   - reorient              — "What has changed since I was last active?"
 *   - bid_briefing          — "Give me a briefing on {bid_name}"
 *   - coverage_analysis     — "Analyse coverage gaps and suggest content to create"
 *   - draft_response        — "Draft a response to this bid question"
 *   - review_item           — "Review this content item for quality"
 *   - sector_briefing       — "Domain-scoped briefing: KB content + SI + change reports"
 *   - bid_pipeline_review   — "Pipeline-wide action review: blockers + stalled drafts"
 */
import { z } from 'zod';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerRequest,
  ServerNotification,
} from '@modelcontextprotocol/sdk/types.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import { loadSkill } from '@/lib/ai/skills/loader';
import { sb } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';

// Lazy import — dashboard module pulls in bid-queries and other heavy modules
// that can cause Vercel serverless cold start crashes at module evaluation time.
async function getDashboardModule() {
  return await import('@/lib/dashboard');
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export async function registerResources(server: McpServer): Promise<void> {
  // 1. kb://items/{id} — Content item
  server.registerResource(
    'content_item',
    new ResourceTemplate('kb://items/{id}', {
      list: async (extra: Extra) => {
        try {
          const supabase = createMcpClient(extra.authInfo);
          const items = await sb(
            supabase
              .from('content_items')
              .select('id, title, suggested_title, content_type')
              .order('updated_at', { ascending: false })
              .limit(10),
            'mcp.resources.content_item.list',
          );

          return {
            resources: items.map(
              (item: {
                id: string;
                title: string | null;
                suggested_title: string | null;
                content_type: string | null;
              }) => ({
                uri: `kb://items/${item.id}`,
                name: item.suggested_title || item.title || 'Untitled',
                description: item.content_type
                  ? `Type: ${item.content_type}`
                  : undefined,
                mimeType: 'application/json',
              }),
            ),
          };
        } catch (err) {
          logger.error({ err }, 'Failed to list content item resources');
          return { resources: [] };
        }
      },
    }),
    {
      description: 'A knowledge base content item with full metadata',
      mimeType: 'application/json',
    },
    async (uri: URL, variables: Variables, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const itemId = Array.isArray(variables.id)
          ? variables.id[0]
          : variables.id;
        const { data: item, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, summary, ai_keywords, freshness, content, created_at, updated_at',
          )
          .eq('id', itemId)
          .single();

        if (error || !item) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Item not found: ${itemId}`,
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(item, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 2. kb://bids/{id} — Bid workspace
  server.registerResource(
    'bid_workspace',
    new ResourceTemplate('kb://bids/{id}', {
      list: async (extra: Extra) => {
        try {
          const supabase = createMcpClient(extra.authInfo);
          const workspaces = await sb(
            supabase
              .from('workspaces')
              .select('id, name, domain_metadata')
              .eq('type', 'bid')
              .eq('is_archived', false)
              .order('updated_at', { ascending: false })
              .limit(10),
            'mcp.resources.bid_workspace.list',
          );

          return {
            resources: workspaces.map(
              (ws: {
                id: string;
                name: string | null;
                domain_metadata: unknown;
              }) => {
                const meta = ws.domain_metadata as Record<
                  string,
                  unknown
                > | null;
                const buyer = (meta?.buyer as string) ?? null;
                return {
                  uri: `kb://bids/${ws.id}`,
                  name: ws.name || 'Untitled Bid',
                  description: buyer ? `Buyer: ${buyer}` : undefined,
                  mimeType: 'application/json',
                };
              },
            ),
          };
        } catch (err) {
          logger.error({ err }, 'Failed to list bid workspace resources');
          return { resources: [] };
        }
      },
    }),
    {
      description: 'A bid workspace with questions and response progress',
      mimeType: 'application/json',
    },
    async (uri: URL, variables: Variables, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const bidId = Array.isArray(variables.id)
          ? variables.id[0]
          : variables.id;
        const { data: workspace, error } = await supabase
          .from('workspaces')
          .select('id, name, description, domain_metadata, is_archived')
          .eq('id', bidId)
          .eq('type', 'bid')
          .single();

        if (error || !workspace) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Bid not found: ${bidId}`,
              },
            ],
          };
        }

        const questions = await sb(
          supabase
            .from('bid_questions')
            .select(
              'id, question_text, section_name, status, confidence_posture',
            )
            .eq('project_id', bidId)
            .order('section_sequence')
            .order('question_sequence'),
          'mcp.resources.bid_workspace.questions',
        );

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ ...workspace, questions }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 3. kb://qa/{id} — Q&A pair
  server.registerResource(
    'qa_pair',
    new ResourceTemplate('kb://qa/{id}', {
      list: async (extra: Extra) => {
        try {
          const supabase = createMcpClient(extra.authInfo);
          const items = await sb(
            supabase
              .from('content_items')
              .select('id, title, suggested_title, primary_domain')
              .eq('content_type', 'q_a_pair')
              .order('updated_at', { ascending: false })
              .limit(10),
            'mcp.resources.qa_pair.list',
          );

          return {
            resources: items.map(
              (item: {
                id: string;
                title: string | null;
                suggested_title: string | null;
                primary_domain: string | null;
              }) => ({
                uri: `kb://qa/${item.id}`,
                name: item.suggested_title || item.title || 'Untitled Q&A',
                description: item.primary_domain
                  ? `Domain: ${item.primary_domain}`
                  : undefined,
                mimeType: 'application/json',
              }),
            ),
          };
        } catch (err) {
          logger.error({ err }, 'Failed to list Q&A pair resources');
          return { resources: [] };
        }
      },
    }),
    {
      description: 'A Q&A pair with standard and advanced answers',
      mimeType: 'application/json',
    },
    async (uri: URL, variables: Variables, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const qaId = Array.isArray(variables.id)
          ? variables.id[0]
          : variables.id;
        const { data: item, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content, answer_standard, answer_advanced, primary_domain, primary_subtopic, summary',
          )
          .eq('id', qaId)
          .eq('content_type', 'q_a_pair')
          .single();

        if (error || !item) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Q&A pair not found: ${qaId}`,
              },
            ],
          };
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(item, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 4. kb://coverage — Taxonomy coverage
  server.registerResource(
    'coverage_matrix',
    'kb://coverage',
    {
      description:
        'Current taxonomy coverage state — domains, subtopics, and item counts',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Count items per domain
        const domainCounts = await sb(
          supabase
            .from('content_items')
            .select('primary_domain')
            .not('primary_domain', 'is', null),
          'mcp.resources.coverage.read',
        );

        const coverage: Record<string, number> = {};
        for (const row of domainCounts as Array<{
          primary_domain: string | null;
        }>) {
          if (row.primary_domain) {
            coverage[row.primary_domain] =
              (coverage[row.primary_domain] ?? 0) + 1;
          }
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ domains: coverage }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 5. kb://dashboard — Dashboard state
  server.registerResource(
    'dashboard',
    'kb://dashboard',
    {
      description:
        'Current dashboard state — freshness, attention items, activity',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const { fetchUnifiedDashboardData, unifiedToDashboardData } =
          await getDashboardModule();
        const unified = await fetchUnifiedDashboardData(
          supabase,
          userId,
          isAdmin,
          role,
        );
        const data = unifiedToDashboardData(unified);

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 6. kb://taxonomy — Domains and subtopics
  server.registerResource(
    'taxonomy',
    'kb://taxonomy',
    {
      description:
        'The full taxonomy of domains and subtopics used to classify content',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const domains = await sb(
          supabase
            .from('taxonomy_domains')
            .select('id, name, display_order')
            .order('display_order'),
          'mcp.resources.taxonomy.domains',
        );

        const subtopics = await sb(
          supabase
            .from('taxonomy_subtopics')
            .select('id, name, domain_id, display_order')
            .order('display_order'),
          'mcp.resources.taxonomy.subtopics',
        );

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ domains, subtopics }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 7. kb://entities — Entity overview
  server.registerResource(
    'entities',
    'kb://entities',
    {
      description:
        'Overview of all entities in the knowledge base — entity types, counts per type, and top entities by mention count',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Two bounded queries instead of one unbounded RPC call:
        // 1. Entity type counts (lightweight — only fetches entity_type column)
        // 2. Top 20 entities via RPC with p_limit parameter

        // Query 1: Count distinct entities per type
        const { data: typeRows, error: typeError } = await supabase
          .from('entity_mentions')
          .select('entity_type, canonical_name')
          .limit(5000);

        if (typeError) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Error: ${typeError.message}`,
              },
            ],
          };
        }

        // Count unique entities per type (deduplicate by canonical_name + entity_type)
        const seen = new Set<string>();
        const byType: Record<string, number> = {};
        let totalEntities = 0;
        for (const row of (typeRows ?? []) as Array<{
          entity_type: string;
          canonical_name: string;
        }>) {
          const key = `${row.entity_type}:${row.canonical_name}`;
          if (!seen.has(key)) {
            seen.add(key);
            byType[row.entity_type] = (byType[row.entity_type] ?? 0) + 1;
            totalEntities++;
          }
        }

        // Query 2: Top entities via RPC (ordered by mention_count DESC, bounded to 20)
        const { data: topRows, error: topError } = await supabase.rpc(
          'get_entity_summary',
          { p_limit: 20 },
        );

        if (topError) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Error: ${topError.message}`,
              },
            ],
          };
        }

        const topEntities = (
          (topRows ?? []) as Array<{
            canonical_name: string;
            entity_type: string;
            mention_count: number;
          }>
        )
          .slice(0, 20)
          .map((e) => ({
            canonical_name: e.canonical_name,
            entity_type: e.entity_type,
            mention_count: Number(e.mention_count),
          }));

        const overview = {
          total_entities: totalEntities,
          by_type: byType,
          top_entities: topEntities,
        };

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(overview, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );

  // 8. ui://coverage-matrix/app.html — Coverage Matrix MCP App
  const { registerAppResource, RESOURCE_MIME_TYPE } =
    await import('@modelcontextprotocol/ext-apps/server');

  // Lazy import — keeps the ~400 KB HTML string out of module evaluation
  async function getAppBundles() {
    return await import('@/lib/mcp/app-bundles');
  }

  registerAppResource(
    server,
    'Coverage Matrix App',
    'ui://coverage-matrix/app.html',
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const { COVERAGE_MATRIX_HTML } = await getAppBundles();
      if (!COVERAGE_MATRIX_HTML) {
        return {
          contents: [
            {
              uri: 'ui://coverage-matrix/app.html',
              mimeType: 'text/plain',
              text: 'Coverage Matrix app not built. Run: bun run build:mcp-apps',
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: 'ui://coverage-matrix/app.html',
            mimeType: RESOURCE_MIME_TYPE,
            text: COVERAGE_MATRIX_HTML,
          },
        ],
      };
    },
  );

  // 9. ui://bid-dashboard/app.html — Bid Dashboard MCP App
  registerAppResource(
    server,
    'Bid Dashboard App',
    'ui://bid-dashboard/app.html',
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const { BID_DASHBOARD_HTML } = await getAppBundles();
      if (!BID_DASHBOARD_HTML) {
        return {
          contents: [
            {
              uri: 'ui://bid-dashboard/app.html',
              mimeType: 'text/plain',
              text: 'Bid Dashboard app not built.',
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: 'ui://bid-dashboard/app.html',
            mimeType: RESOURCE_MIME_TYPE,
            text: BID_DASHBOARD_HTML,
          },
        ],
      };
    },
  );

  // 10. ui://reorient-me/app.html — Reorient Me MCP App
  registerAppResource(
    server,
    'Reorient Me App',
    'ui://reorient-me/app.html',
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const { REORIENT_ME_HTML } = await getAppBundles();
      if (!REORIENT_ME_HTML) {
        return {
          contents: [
            {
              uri: 'ui://reorient-me/app.html',
              mimeType: 'text/plain',
              text: 'Reorient Me app not built. Run: bun run build:mcp-apps',
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: 'ui://reorient-me/app.html',
            mimeType: RESOURCE_MIME_TYPE,
            text: REORIENT_ME_HTML,
          },
        ],
      };
    },
  );

  // 12. ui://intelligence-feed/app.html — Intelligence Feed MCP App
  registerAppResource(
    server,
    'Intelligence Feed App',
    'ui://intelligence-feed/app.html',
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const { INTELLIGENCE_FEED_HTML } = await getAppBundles();
      if (!INTELLIGENCE_FEED_HTML) {
        return {
          contents: [
            {
              uri: 'ui://intelligence-feed/app.html',
              mimeType: 'text/plain',
              text: 'Intelligence Feed app not built. Run: bun run build:mcp-apps',
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: 'ui://intelligence-feed/app.html',
            mimeType: RESOURCE_MIME_TYPE,
            text: INTELLIGENCE_FEED_HTML,
          },
        ],
      };
    },
  );

  // 13. kb://quality-briefing — Aggregated quality intelligence briefing
  server.registerResource(
    'quality_briefing',
    'kb://quality-briefing',
    {
      description:
        'Aggregated quality intelligence briefing — below-threshold items, score drops, freshness transitions, quality flags, coverage alerts, and certification warnings. Use this for proactive "what needs attention" briefings.',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { fetchQualityBriefingData } =
          await import('@/lib/mcp/tools/shared');
        const { formatQualityBriefing } =
          await import('@/lib/mcp/formatters/briefing');

        const briefingData = await fetchQualityBriefingData(supabase);
        const markdown = formatQualityBriefing(briefingData);

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                { ...briefingData, formatted: markdown },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error generating quality briefing: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          ],
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * System context prepended to all prompt messages so the LLM has KB awareness.
 */
const KB_SYSTEM_CONTEXT =
  'You are an AI assistant for the Knowledge Hub, a UK bid management knowledge base. Use UK English throughout. The knowledge base contains articles, policies, case studies, Q&A pairs, and other content organised by domain and subtopic.\n\n';

export function registerPrompts(server: McpServer): void {
  // 1. reorient
  server.registerPrompt(
    'reorient',
    {
      title: 'Reorientation Briefing',
      description:
        'Get a briefing on what has changed since your last visit. Shows urgent items, team activity, and bid status.',
    },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              KB_SYSTEM_CONTEXT +
              'What has changed in my knowledge base since I was last active? Give me a briefing covering urgent items, team activity, my recent work, and active bid status. Use the get_reorientation tool.',
          },
        },
      ],
    }),
  );

  // 2. bid_briefing
  server.registerPrompt(
    'bid_briefing',
    {
      title: 'Bid Briefing',
      description:
        'Get a comprehensive briefing on a specific bid including progress, gaps, and next steps.',
      argsSchema: {
        bid_name: z.string().describe('Name or ID of the bid to brief on'),
      },
    },
    async (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              KB_SYSTEM_CONTEXT +
              `Give me a comprehensive briefing on the bid "${args.bid_name}". Include the current status, question completion progress, any gaps or blockers, upcoming deadlines, and recommended next steps. First list bids to find the matching ID, then use get_bid_detail. Use the list_active_bids and get_bid_detail tools.`,
          },
        },
      ],
    }),
  );

  // 3. coverage_analysis
  server.registerPrompt(
    'coverage_analysis',
    {
      title: 'Coverage Analysis',
      description:
        'Analyse knowledge base coverage gaps and suggest content to create.',
    },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              KB_SYSTEM_CONTEXT +
              'Analyse the coverage of my knowledge base. Identify domains or topics with thin coverage and suggest specific content items to create to fill the gaps. Use the get_coverage_gaps tool to find prioritised gaps across taxonomy, templates, and guides, then use suggest_content_creation for actionable recommendations. Supplement with get_quality_summary and get_freshness_report for broader context.',
          },
        },
      ],
    }),
  );

  // 4. draft_response
  server.registerPrompt(
    'draft_response',
    {
      title: 'Draft Bid Response',
      description:
        'Draft a response to a bid question using relevant knowledge base content.',
      argsSchema: {
        question_text: z.string().describe('The bid question to respond to'),
      },
    },
    async (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              KB_SYSTEM_CONTEXT +
              `Draft a bid response to the following question, using relevant content from my knowledge base:\n\n"${args.question_text}"\n\nSearch the knowledge base and Q&A library for relevant content, then compose a well-structured response with citations. Use the search_knowledge_base and search_qa_library tools.`,
          },
        },
      ],
    }),
  );

  // 5. review_item
  //
  // Loads the governance skill (`lib/ai/skills/governance.md`) and inlines it
  // into the prompt text so external LLM clients (Claude Desktop / Claude.ai)
  // have the freshness lifecycle, quality scoring factors, and review trigger
  // definitions in context when assessing an item. Skill content is inlined
  // at build time via `lib/ai/skills/inlined.generated.ts`; loadSkill is a
  // pure in-memory lookup with no filesystem access.
  server.registerPrompt(
    'review_item',
    {
      title: 'Review Content Item',
      description:
        'Review a content item for quality, accuracy, and completeness.',
      argsSchema: {
        item_id: z.string().describe('The UUID of the content item to review'),
      },
    },
    async (args) => {
      const governanceSkill = await loadSkill('governance');
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                KB_SYSTEM_CONTEXT +
                'Use the following governance reference when assessing this item. It defines the freshness lifecycle, quality scoring factors, review triggers, and governance principles that determine whether content is fresh, healthy, and trusted in the Knowledge Hub.\n\n' +
                '---\n\n' +
                governanceSkill +
                '\n\n---\n\n' +
                `Review the content item with ID "${args.item_id}" for quality, accuracy, and completeness. Apply the governance reference above when judging freshness state, quality score factors, and review-trigger conditions. Check: Is the classification correct? Is the summary accurate? Is the content up to date for its lifecycle type? Are there any quality issues or review triggers active? Use the get_content_item tool to fetch the item, then provide a detailed assessment with recommendations grounded in the governance model above.`,
            },
          },
        ],
      };
    },
  );

  // 6. sector_briefing
  //
  // Domain-scoped briefing combining KB content (guides, items, Q&A) + SI
  // intelligence highlights + change report + outstanding governance items.
  // Parallel to `reorient` (account-wide) but scoped to a single domain.
  //
  // References `get_change_report` which ships in the same session via WP6
  // (P1-35). If the tool is not yet registered at invocation time, Claude
  // will skip that step; the other three data sources still produce useful
  // output.
  server.registerPrompt(
    'sector_briefing',
    {
      title: 'Sector Briefing',
      description:
        'Get a domain-scoped briefing covering KB content, sector intelligence, and recent change reports.',
      argsSchema: {
        domain: z
          .string()
          .describe(
            'Domain key (e.g. "audit-content", "social-housing-compliance") to scope the briefing',
          ),
        period_days: z
          .string()
          .optional()
          .describe(
            'Optional look-back window in days for change reports and SI highlights. Default 7.',
          ),
      },
    },
    async (args) => {
      const period = args.period_days ?? '7';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                KB_SYSTEM_CONTEXT +
                `Assemble a sector briefing for the domain "${args.domain}" covering the last ${period} days.\n\n` +
                'Use these tools in sequence and compose a single structured briefing:\n\n' +
                `1. **Domain content inventory.**\n` +
                `   - \`list_guides(guide_type: undefined, domain_filter: "${args.domain}", published_only: true)\` — guide catalogue for the domain.\n` +
                `   - \`search_knowledge_base(query: "${args.domain}", domain: "${args.domain}", limit: 10)\` — recent / high-relevance items.\n` +
                `   - \`search_qa_library(query: "${args.domain}", limit: 5)\` — Q&A pairs.\n` +
                `2. **Sector intelligence.**\n` +
                `   - \`get_intelligence_summary(period: "${period}d", limit: 15)\` — recent SI feed highlights. Filter results to entries touching the domain (by matching the domain key or its synonyms against article tags / summary text). If the tool requires a workspace_id, call it for each active workspace and merge results.\n` +
                `3. **Change report.**\n` +
                `   - \`get_change_report(period_days: ${period}, domain: "${args.domain}")\` — structured additions / updates / removals for the domain. If the tool is unavailable, note "Change report tool not yet available" and continue.\n` +
                `4. **Outstanding governance items.**\n` +
                `   - \`get_governance_queue(limit: 10, domain: "${args.domain}")\` — pending governance reviews, domain-scoped. If the tool is unavailable, note "Governance queue tool not yet available" and continue.\n\n` +
                'Structure the briefing as:\n\n' +
                `## Sector briefing — ${args.domain} — [DD/MM/YYYY]\n\n` +
                '### At a glance\n' +
                '- Content count: [N] guides, [M] items, [K] Q&A pairs\n' +
                `- Change activity (${period} days): [N added / N updated / N removed]\n` +
                '- Pending governance review: [N items]\n' +
                '- SI signals: [N relevant feed articles]\n\n' +
                '### What changed\n' +
                '[Narrative summary of change report, grouped by content_type]\n\n' +
                '### Sector intelligence\n' +
                '[Top 3-5 SI highlights relevant to the domain with source links]\n\n' +
                '### Governance queue\n' +
                '[Pending items with due dates]\n\n' +
                '### Recommendations\n' +
                '[Prioritised 2-4 actions]\n\n' +
                'Use UK English. DD/MM/YYYY dates. If any tool returns empty, note the gap explicitly (e.g. "No SI feeds currently cover this domain — consider seeding a starter pack.").',
            },
          },
        ],
      };
    },
  );

  // 7. bid_pipeline_review
  //
  // Pipeline-wide workflow review — blockers across bids, stalled drafts,
  // recent activity, and a flat prioritised action list. Complements
  // `/kb:bid-status` (per-bid read) with a cross-bid action framing.
  server.registerPrompt(
    'bid_pipeline_review',
    {
      title: 'Bid Pipeline Review',
      description:
        'Workflow-oriented review of the active bid pipeline: blockers, stalled drafts, and prioritised next actions.',
      argsSchema: {
        stale_threshold_days: z
          .string()
          .optional()
          .describe(
            'Optional: days since last edit to consider a draft "stale". Default 5.',
          ),
      },
    },
    async (args) => {
      const staleDays = args.stale_threshold_days ?? '5';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                KB_SYSTEM_CONTEXT +
                'Produce a pipeline-wide action review for all active bids. Focus on blockers, stalled drafts, and recent activity — NOT per-bid status (that lives in `/kb:bid-status`).\n\n' +
                'Tool sequence:\n\n' +
                '1. **Pipeline overview.** `list_active_bids(limit: 50)` — full list with deadlines and completion %.\n' +
                '2. **Per-bid detail.** For each active bid, `get_bid_detail(id: <bid_id>)` — extract:\n' +
                '   - Unanswered questions (status: unanswered)\n' +
                '   - Questions with confidence = "no_content" (hard blockers — need new KB material)\n' +
                '   - Questions with confidence = "needs_sme" (soft blockers — need expert input)\n' +
                `   - Questions with draft responses updated more than ${staleDays} days ago (stalled drafts)\n` +
                '3. **Recent activity.** From the per-bid detail, pull response `updated_at` timestamps and identify which bids have seen edits in the last 7 days vs which have gone silent.\n\n' +
                'Structure the output as:\n\n' +
                '## Bid pipeline review — [DD/MM/YYYY]\n\n' +
                '### Critical blockers (action today)\n' +
                '[Bulleted list: "BidName — Question N: no_content on topic X. Need KB item on X."]\n\n' +
                '### Stalled drafts (action this week)\n' +
                `[Bulleted list: "BidName — Question N: last edit DD/MM/YYYY (N days ago, threshold ${staleDays}). Was in draft state."]\n\n` +
                '### SME input needed\n' +
                '[Bulleted list: "BidName — Question N: needs_sme on topic X."]\n\n' +
                '### Recent activity\n' +
                '- Active (edited in last 7 days): [BidA, BidB]\n' +
                '- Silent (no edits in 7+ days): [BidC, BidD]\n\n' +
                '### Prioritised next actions\n' +
                '[Numbered 3-5 actions cutting across bids, ordered by deadline proximity × blocker severity.]\n\n' +
                'Use UK English. DD/MM/YYYY. If the pipeline is empty, say so and suggest `/kb:bid-status` for historical context. If a bid has zero blockers, omit it from the blocker sections (still include in Recent activity).',
            },
          },
        ],
      };
    },
  );
}
