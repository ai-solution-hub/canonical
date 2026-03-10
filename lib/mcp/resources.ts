/**
 * MCP resource and prompt registrations for the Knowledge Hub server.
 *
 * Resources (9):
 *   - kb://items/{id}    — Full content item with metadata
 *   - kb://bids/{id}     — Bid with questions and responses
 *   - kb://qa/{id}       — Q&A pair with standard/advanced answers
 *   - kb://coverage      — Current taxonomy coverage state
 *   - kb://dashboard     — Current dashboard state
 *   - kb://taxonomy      — Domains and subtopics
 *   - kb://entities      — Entity overview with types, counts, and top entities
 *   - ui://coverage-matrix/app.html   — Coverage Matrix MCP App (interactive UI)
 *   - ui://bid-dashboard/app.html     — Bid Dashboard MCP App (interactive UI)
 *
 * Prompts (5):
 *   - reorient           — "What has changed since I was last active?"
 *   - bid_briefing       — "Give me a briefing on {bid_name}"
 *   - coverage_analysis  — "Analyse coverage gaps and suggest content to create"
 *   - draft_response     — "Draft a response to this bid question"
 *   - review_item        — "Review this content item for quality"
 */
import { z } from 'zod';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';

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
          const { data: items } = await supabase
            .from('content_items')
            .select('id, title, suggested_title, content_type')
            .order('updated_at', { ascending: false })
            .limit(10);

          return {
            resources: (items ?? []).map((item: { id: string; title: string | null; suggested_title: string | null; content_type: string | null }) => ({
              uri: `kb://items/${item.id}`,
              name: item.suggested_title || item.title || 'Untitled',
              description: item.content_type ? `Type: ${item.content_type}` : undefined,
              mimeType: 'application/json',
            })),
          };
        } catch {
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
        const itemId = Array.isArray(variables.id) ? variables.id[0] : variables.id;
        const { data: item, error } = await supabase
          .from('content_items')
          .select('id, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_summary, ai_keywords, freshness, content, created_at, updated_at')
          .eq('id', itemId)
          .single();

        if (error || !item) {
          return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Item not found: ${itemId}` }] };
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(item, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
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
          const { data: workspaces } = await supabase
            .from('workspaces')
            .select('id, name, domain_metadata')
            .eq('type', 'bid')
            .eq('is_archived', false)
            .order('updated_at', { ascending: false })
            .limit(10);

          return {
            resources: (workspaces ?? []).map((ws: { id: string; name: string | null; domain_metadata: unknown }) => {
              const meta = ws.domain_metadata as Record<string, unknown> | null;
              const buyer = (meta?.buyer as string) ?? null;
              return {
                uri: `kb://bids/${ws.id}`,
                name: ws.name || 'Untitled Bid',
                description: buyer ? `Buyer: ${buyer}` : undefined,
                mimeType: 'application/json',
              };
            }),
          };
        } catch {
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
        const bidId = Array.isArray(variables.id) ? variables.id[0] : variables.id;
        const { data: workspace, error } = await supabase
          .from('workspaces')
          .select('id, name, description, domain_metadata, is_archived')
          .eq('id', bidId)
          .eq('type', 'bid')
          .single();

        if (error || !workspace) {
          return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Bid not found: ${bidId}` }] };
        }

        const { data: questions } = await supabase
          .from('bid_questions')
          .select('id, question_text, section_name, status, confidence_posture')
          .eq('project_id', bidId)
          .order('section_sequence')
          .order('question_sequence');

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ ...workspace, questions: questions ?? [] }, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
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
          const { data: items } = await supabase
            .from('content_items')
            .select('id, title, suggested_title, primary_domain')
            .eq('content_type', 'q_a_pair')
            .order('updated_at', { ascending: false })
            .limit(10);

          return {
            resources: (items ?? []).map((item: { id: string; title: string | null; suggested_title: string | null; primary_domain: string | null }) => ({
              uri: `kb://qa/${item.id}`,
              name: item.suggested_title || item.title || 'Untitled Q&A',
              description: item.primary_domain ? `Domain: ${item.primary_domain}` : undefined,
              mimeType: 'application/json',
            })),
          };
        } catch {
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
        const qaId = Array.isArray(variables.id) ? variables.id[0] : variables.id;
        const { data: item, error } = await supabase
          .from('content_items')
          .select('id, title, suggested_title, content, answer_standard, answer_advanced, primary_domain, primary_subtopic, ai_summary')
          .eq('id', qaId)
          .eq('content_type', 'q_a_pair')
          .single();

        if (error || !item) {
          return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Q&A pair not found: ${qaId}` }] };
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(item, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
        };
      }
    },
  );

  // 4. kb://coverage — Taxonomy coverage
  server.registerResource(
    'coverage_matrix',
    'kb://coverage',
    {
      description: 'Current taxonomy coverage state — domains, subtopics, and item counts',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Count items per domain
        const { data: domainCounts } = await supabase
          .from('content_items')
          .select('primary_domain')
          .not('primary_domain', 'is', null);

        const coverage: Record<string, number> = {};
        for (const row of (domainCounts ?? []) as Array<{ primary_domain: string | null }>) {
          if (row.primary_domain) {
            coverage[row.primary_domain] = (coverage[row.primary_domain] ?? 0) + 1;
          }
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ domains: coverage }, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
        };
      }
    },
  );

  // 5. kb://dashboard — Dashboard state
  server.registerResource(
    'dashboard',
    'kb://dashboard',
    {
      description: 'Current dashboard state — freshness, attention items, activity',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const { fetchDashboardData } = await getDashboardModule();
        const data = await fetchDashboardData(supabase, userId, isAdmin, role);

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
        };
      }
    },
  );

  // 6. kb://taxonomy — Domains and subtopics
  server.registerResource(
    'taxonomy',
    'kb://taxonomy',
    {
      description: 'The full taxonomy of domains and subtopics used to classify content',
      mimeType: 'application/json',
    },
    async (uri: URL, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { data: domains } = await supabase
          .from('taxonomy_domains')
          .select('id, name, sort_order')
          .order('sort_order');

        const { data: subtopics } = await supabase
          .from('taxonomy_subtopics')
          .select('id, name, domain_id, sort_order')
          .order('sort_order');

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ domains: domains ?? [], subtopics: subtopics ?? [] }, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
        };
      }
    },
  );

  // 7. kb://entities — Entity overview
  server.registerResource(
    'entities',
    'kb://entities',
    {
      description: 'Overview of all entities in the knowledge base — entity types, counts per type, and top entities by mention count',
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
          .select('entity_type, canonical_name');

        if (typeError) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${typeError.message}`,
            }],
          };
        }

        // Count unique entities per type (deduplicate by canonical_name + entity_type)
        const seen = new Set<string>();
        const byType: Record<string, number> = {};
        let totalEntities = 0;
        for (const row of (typeRows ?? []) as Array<{ entity_type: string; canonical_name: string }>) {
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
            contents: [{
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error: ${topError.message}`,
            }],
          };
        }

        const topEntities = ((topRows ?? []) as Array<{
          canonical_name: string;
          entity_type: string;
          mention_count: number;
        }>).slice(0, 20).map((e) => ({
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
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(overview, null, 2),
          }],
        };
      } catch (err) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }],
        };
      }
    },
  );

  // 8. ui://coverage-matrix/app.html — Coverage Matrix MCP App
  const { registerAppResource, RESOURCE_MIME_TYPE } = await import('@modelcontextprotocol/ext-apps/server');

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
          contents: [{
            uri: 'ui://coverage-matrix/app.html',
            mimeType: 'text/plain',
            text: 'Coverage Matrix app not built. Run: bun run build:mcp-apps',
          }],
        };
      }
      return {
        contents: [{
          uri: 'ui://coverage-matrix/app.html',
          mimeType: RESOURCE_MIME_TYPE,
          text: COVERAGE_MATRIX_HTML,
        }],
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
          contents: [{
            uri: 'ui://bid-dashboard/app.html',
            mimeType: 'text/plain',
            text: 'Bid Dashboard app not built.',
          }],
        };
      }
      return {
        contents: [{
          uri: 'ui://bid-dashboard/app.html',
          mimeType: RESOURCE_MIME_TYPE,
          text: BID_DASHBOARD_HTML,
        }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * System context prepended to all prompt messages so the LLM has KB awareness.
 */
const KB_SYSTEM_CONTEXT = 'You are an AI assistant for the Knowledge Hub, a UK bid management knowledge base. Use UK English throughout. The knowledge base contains articles, policies, case studies, Q&A pairs, and other content organised by domain and subtopic.\n\n';

export function registerPrompts(server: McpServer): void {
  // 1. reorient
  server.registerPrompt(
    'reorient',
    {
      title: 'Reorientation Briefing',
      description: 'Get a briefing on what has changed since your last visit. Shows urgent items, team activity, and bid status.',
    },
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: KB_SYSTEM_CONTEXT + 'What has changed in my knowledge base since I was last active? Give me a briefing covering urgent items, team activity, my recent work, and active bid status. Use the get_reorientation tool.',
        },
      }],
    }),
  );

  // 2. bid_briefing
  server.registerPrompt(
    'bid_briefing',
    {
      title: 'Bid Briefing',
      description: 'Get a comprehensive briefing on a specific bid including progress, gaps, and next steps.',
      argsSchema: {
        bid_name: z.string().describe('Name or ID of the bid to brief on'),
      },
    },
    async (args) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: KB_SYSTEM_CONTEXT + `Give me a comprehensive briefing on the bid "${args.bid_name}". Include the current status, question completion progress, any gaps or blockers, upcoming deadlines, and recommended next steps. First list bids to find the matching ID, then use get_bid_detail. Use the list_active_bids and get_bid_detail tools.`,
        },
      }],
    }),
  );

  // 3. coverage_analysis
  server.registerPrompt(
    'coverage_analysis',
    {
      title: 'Coverage Analysis',
      description: 'Analyse knowledge base coverage gaps and suggest content to create.',
    },
    async () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: KB_SYSTEM_CONTEXT + 'Analyse the coverage of my knowledge base. Identify domains or topics with thin coverage and suggest specific content items to create to fill the gaps. Use the get_dashboard_summary, get_quality_summary, and get_freshness_report tools.',
        },
      }],
    }),
  );

  // 4. draft_response
  server.registerPrompt(
    'draft_response',
    {
      title: 'Draft Bid Response',
      description: 'Draft a response to a bid question using relevant knowledge base content.',
      argsSchema: {
        question_text: z.string().describe('The bid question to respond to'),
      },
    },
    async (args) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: KB_SYSTEM_CONTEXT + `Draft a bid response to the following question, using relevant content from my knowledge base:\n\n"${args.question_text}"\n\nSearch the knowledge base and Q&A library for relevant content, then compose a well-structured response with citations. Use the search_knowledge_base and search_qa_library tools.`,
        },
      }],
    }),
  );

  // 5. review_item
  server.registerPrompt(
    'review_item',
    {
      title: 'Review Content Item',
      description: 'Review a content item for quality, accuracy, and completeness.',
      argsSchema: {
        item_id: z.string().describe('The UUID of the content item to review'),
      },
    },
    async (args) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: KB_SYSTEM_CONTEXT + `Review the content item with ID "${args.item_id}" for quality, accuracy, and completeness. Check: Is the classification correct? Is the summary accurate? Is the content up to date? Are there any quality issues? Use the get_content_item tool to fetch the item, then provide a detailed assessment with recommendations.`,
        },
      }],
    }),
  );
}
