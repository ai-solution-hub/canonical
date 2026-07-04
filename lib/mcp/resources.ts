/**
 * MCP resource and prompt registrations for the Knowledge Hub server.
 *
 * Resources (12):
 *   - kb://items/{id}    — Full content item with metadata
 *   - kb://forms/{id}    — Procurement with questions and responses
 *   - kb://qa/{id}       — Q&A pair with standard/advanced answers
 *   - kb://coverage      — Current taxonomy coverage state
 *   - kb://dashboard     — Current dashboard state
 *   - kb://taxonomy      — Domains and subtopics
 *   - kb://entities      — Entity overview with types, counts, and top entities
 *   - ui://coverage-matrix/app.html   — Coverage Matrix MCP App (interactive UI)
 *   - ui://form-dashboard/app.html    — Procurement Dashboard MCP App (interactive UI)
 *   - ui://reorient-me/app.html       — Reorient Me MCP App (interactive UI)
 *   - ui://intelligence-feed/app.html — Intelligence Feed MCP App (interactive UI)
 *   - kb://quality-briefing           — Aggregated quality intelligence briefing
 *
 * Prompts (7):
 *   - reorient              — "What has changed since I was last active?"
 *   - form_briefing         — "Give me a briefing on {form_name}"
 *   - coverage_analysis     — "Analyse coverage gaps and suggest content to create"
 *   - draft_response        — "Draft a response to this form question"
 *   - review_item           — "Review this content item for quality"
 *   - sector_briefing       — "Domain-scoped briefing: KB content + SI + change reports"
 *   - form_pipeline_review  — "Pipeline-wide action review: blockers + stalled drafts"
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
          // ID-131 (G-MCP-REPOINT, BI-9/11): content_items no longer exists
          // — this is a document-shaped resource, re-pointed to
          // source_documents. `title` has no successor; `suggested_title`
          // is the sole display name (the `suggested_title || title`
          // fallback below degrades gracefully either way).
          const items = await sb(
            supabase
              .from('source_documents')
              .select('id, suggested_title, content_type')
              .order('updated_at', { ascending: false })
              .limit(10),
            'mcp.resources.content_item.list',
          );

          return {
            resources: items.map(
              (item: {
                id: string;
                suggested_title: string | null;
                content_type: string | null;
              }) => ({
                uri: `kb://items/${item.id}`,
                name: item.suggested_title || 'Untitled',
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
        // ID-131 (G-MCP-REPOINT): source_documents + record_lifecycle facet
        // join (freshness — source_document owner axis, BI-18/20). `content`
        // now reads `extracted_text`.
        const { data: sd, error } = await supabase
          .from('source_documents')
          .select(
            'id, suggested_title, content_type, primary_domain, primary_subtopic, summary, ai_keywords, extracted_text, created_at, updated_at',
          )
          .eq('id', itemId)
          .single();

        if (error || !sd) {
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

        const lifecycleRow = await sb(
          supabase
            .from('record_lifecycle')
            .select('freshness')
            .eq('owner_kind', 'source_document')
            .eq('source_document_id', sd.id!)
            .maybeSingle(),
          'mcp.resources.content_item.read.lifecycle',
        );

        const item = {
          ...sd,
          content: sd.extracted_text,
          freshness: lifecycleRow?.freshness ?? null,
        };

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

  // 2. kb://forms/{id} — Procurement workspace
  server.registerResource(
    'form_workspace',
    new ResourceTemplate('kb://forms/{id}', {
      list: async (extra: Extra) => {
        try {
          const supabase = createMcpClient(extra.authInfo);
          // Post-T2: discriminator is application_types.key via JOIN, not the
          // dropped workspaces.type col. 'bid' maps to 'procurement'.
          const workspaces = await sb(
            supabase
              .from('workspaces')
              .select('id, name, domain_metadata, application_types!inner(key)')
              .eq('application_types.key', 'procurement')
              .eq('is_archived', false)
              .order('updated_at', { ascending: false })
              .limit(10),
            'mcp.resources.form_workspace.list',
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
                  uri: `kb://forms/${ws.id}`,
                  name: ws.name || 'Untitled Procurement',
                  description: buyer ? `Buyer: ${buyer}` : undefined,
                  mimeType: 'application/json',
                };
              },
            ),
          };
        } catch (err) {
          logger.error({ err }, 'Failed to list form workspace resources');
          return { resources: [] };
        }
      },
    }),
    {
      description: 'A form workspace with questions and response progress',
      mimeType: 'application/json',
    },
    async (uri: URL, variables: Variables, extra: Extra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const procurementId = Array.isArray(variables.id)
          ? variables.id[0]
          : variables.id;
        const { data: workspace, error } = await supabase
          .from('workspaces')
          .select(
            'id, name, description, domain_metadata, is_archived, application_types!inner(key)',
          )
          .eq('id', procurementId)
          .eq('application_types.key', 'procurement')
          .single();

        if (error || !workspace) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'text/plain',
                text: `Procurement not found: ${procurementId}`,
              },
            ],
          };
        }

        const questions = await sb(
          supabase
            .from('form_questions')
            .select(
              'id, question_text, section_name, status, confidence_posture',
            )
            .eq('workspace_id', procurementId)
            .order('section_sequence')
            .order('question_sequence'),
          'mcp.resources.form_workspace.questions',
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
          // ID-131 (G-MCP-REPOINT, BI-9): Q&A pairs now live in their own
          // `q_a_pairs` table (no more `content_items.content_type =
          // 'q_a_pair'` discriminator). `question_text` is the sole
          // title-equivalent — q_a_pairs has no domain of its own, so the
          // description's domain context comes from a join through
          // `source_document_id`.
          const items = await sb(
            supabase
              .from('q_a_pairs')
              .select('id, question_text, source_document_id')
              .order('updated_at', { ascending: false })
              .limit(10),
            'mcp.resources.qa_pair.list',
          );

          const sdIds = (items as Array<{ source_document_id: string | null }>)
            .map((i) => i.source_document_id)
            .filter((id): id is string => !!id);
          const domainBySdId = new Map<string, string | null>();
          if (sdIds.length > 0) {
            const sds = await sb(
              supabase
                .from('source_documents')
                .select('id, primary_domain')
                .in('id', sdIds),
              'mcp.resources.qa_pair.list.domains',
            );
            for (const sd of sds as Array<{
              id: string | null;
              primary_domain: string | null;
            }>) {
              if (sd.id) domainBySdId.set(sd.id, sd.primary_domain);
            }
          }

          return {
            resources: items.map(
              (item: {
                id: string;
                question_text: string | null;
                source_document_id: string | null;
              }) => {
                const domain = item.source_document_id
                  ? (domainBySdId.get(item.source_document_id) ?? null)
                  : null;
                return {
                  uri: `kb://qa/${item.id}`,
                  name: item.question_text || 'Untitled Q&A',
                  description: domain ? `Domain: ${domain}` : undefined,
                  mimeType: 'application/json',
                };
              },
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
        // ID-131 (G-MCP-REPOINT, BI-9): re-pointed to q_a_pairs.
        // `title`/`content`/`primary_domain`/`primary_subtopic`/`summary`
        // had no successor on q_a_pairs itself (those are source_documents
        // concepts, BI-11) — domain/subtopic/summary context is joined
        // through `source_document_id`; `question_text` replaces `title`.
        const { data: qa, error } = await supabase
          .from('q_a_pairs')
          .select(
            'id, question_text, answer_standard, answer_advanced, source_document_id',
          )
          .eq('id', qaId)
          .single();

        if (error || !qa) {
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

        let sourceContext: {
          primary_domain: string | null;
          primary_subtopic: string | null;
          summary: string | null;
        } | null = null;
        if (qa.source_document_id) {
          sourceContext = await sb(
            supabase
              .from('source_documents')
              .select('primary_domain, primary_subtopic, summary')
              .eq('id', qa.source_document_id)
              .maybeSingle(),
            'mcp.resources.qa_pair.read.source_context',
          );
        }

        const item = {
          id: qa.id,
          question_text: qa.question_text,
          answer_standard: qa.answer_standard,
          answer_advanced: qa.answer_advanced,
          primary_domain: sourceContext?.primary_domain ?? null,
          primary_subtopic: sourceContext?.primary_subtopic ?? null,
          summary: sourceContext?.summary ?? null,
        };

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

        // Count items per domain. ID-131 (G-MCP-REPOINT, BI-9/11):
        // content_items no longer exists — primary_domain now lives on
        // source_documents.
        const domainCounts = await sb(
          supabase
            .from('source_documents')
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

  // 7. kb://entities — Entity overview (ontology-grounding entry on the
  // answering surface; ID-71.11 / B-INV-28). Discoverable alongside `find`:
  // the overview orients you in the entity graph, then `get_entity_relationships`
  // grounds a specific answer in structured facts.
  server.registerResource(
    'entities',
    'kb://entities',
    {
      description:
        'Overview of all entities in the knowledge base — entity types, counts per type, and top entities by mention count. An ontology-grounding entry for the answering surface: use it alongside `find` to orient, then `get_entity_relationships` to ground a specific answer in the entity graph.',
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

  // 9. ui://form-dashboard/app.html — Procurement Dashboard MCP App
  registerAppResource(
    server,
    'Procurement Dashboard App',
    'ui://form-dashboard/app.html',
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const { FORM_DASHBOARD_HTML } = await getAppBundles();
      if (!FORM_DASHBOARD_HTML) {
        return {
          contents: [
            {
              uri: 'ui://form-dashboard/app.html',
              mimeType: 'text/plain',
              text: 'Procurement Dashboard app not built.',
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: 'ui://form-dashboard/app.html',
            mimeType: RESOURCE_MIME_TYPE,
            text: FORM_DASHBOARD_HTML,
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
              'What has changed in my knowledge base since I was last active? Give me a briefing covering urgent items, team activity, my recent work, and active procurement status. Use the get_reorientation tool.',
          },
        },
      ],
    }),
  );

  // 2. form_briefing
  server.registerPrompt(
    'form_briefing',
    {
      title: 'Procurement Briefing',
      description:
        'Get a comprehensive briefing on a specific form including progress, gaps, and next steps.',
      argsSchema: {
        form_name: z.string().describe('Name or ID of the form to brief on'),
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
              `Give me a comprehensive briefing on the form "${args.form_name}". Include the current status, question completion progress, any gaps or blockers, upcoming deadlines, and recommended next steps. First list forms to find the matching ID, then use get_procurement_detail. Use the list_active_procurement and get_procurement_detail tools.`,
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
              'Analyse the coverage of my knowledge base. Identify domains or topics with thin coverage and suggest specific content items to create to fill the gaps. Use the where_are_we_exposed tool to read the five exposure layers (the data you have, its quality, how you could use it today, the gaps, and the opportunities) — the gaps and quality layers surface prioritised coverage gaps across taxonomy, templates, and guides plus freshness and quality context in one read. Then use suggest_content_creation for actionable recommendations.',
          },
        },
      ],
    }),
  );

  // 4. draft_response
  server.registerPrompt(
    'draft_response',
    {
      title: 'Draft Procurement Response',
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
              `Draft a bid response to the following question, using relevant content from my knowledge base:\n\n"${args.question_text}"\n\nSearch the knowledge base for relevant content, then compose a well-structured response with citations. Use the find tool — it searches knowledge-base items, Q&A pairs, and document chunks in one call (set the type/scope parameters to widen or narrow as needed). After finding candidate items, use get to fetch the verbatim content you cite.`,
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
                `Review the content item with ID "${args.item_id}" for quality, accuracy, and completeness. Apply the governance reference above when judging freshness state, quality score factors, and review-trigger conditions. Check: Is the classification correct? Is the summary accurate? Is the content up to date for its lifecycle type? Are there any quality issues or review triggers active? Use the \`get\` tool (pass \`id\`) to fetch the verbatim item, then provide a detailed assessment with recommendations grounded in the governance model above.`,
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
                `   - \`find(query: "${args.domain}", scope: "${args.domain}", limit: 10)\` — recent / high-relevance items.\n` +
                `   - \`find(query: "${args.domain}", type: "q_a_pair", limit: 5)\` — reusable Q&A pairs (the \`find\` entry serves search, Q&A lookup, and chunk retrieval — set \`type\`/\`scope\` to widen or narrow).\n` +
                `2. **Sector intelligence.**\n` +
                `   - \`get_intelligence_summary(period: "${period}d", limit: 15)\` — recent SI feed highlights. Filter results to entries touching the domain (by matching the domain key or its synonyms against article tags / summary text). If the tool requires a workspace_id, call it for each active workspace and merge results.\n` +
                `3. **Change report.**\n` +
                `   - \`get_change_report(period_days: ${period}, domain: "${args.domain}")\` — structured additions / updates / removals for the domain. If the tool is unavailable, note "Change report tool not yet available" and continue.\n` +
                `4. **Outstanding governance items.**\n` +
                `   - \`whats_in_my_queue(facet: "governance")\` — pending governance reviews (one queue, governance facet). Filter the returned items to the "${args.domain}" domain. Requires editor/admin role; if you lack permission or the queue is empty, note "No governance queue items for this domain" and continue.\n\n` +
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

  // 7. form_pipeline_review
  //
  // Pipeline-wide workflow review — blockers across forms, stalled drafts,
  // recent activity, and a flat prioritised action list. Complements
  // `/kb:form-status` (per-form read) with a cross-form action framing.
  server.registerPrompt(
    'form_pipeline_review',
    {
      title: 'Procurement Pipeline Review',
      description:
        'Workflow-oriented review of the active form pipeline: blockers, stalled drafts, and prioritised next actions.',
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
                'Produce a pipeline-wide action review for all active procurements. Focus on blockers, stalled drafts, and recent activity — NOT per-form status (that lives in `/kb:form-status`).\n\n' +
                'Tool sequence:\n\n' +
                '1. **Pipeline overview.** `list_active_procurement(limit: 50)` — full list with deadlines and completion %.\n' +
                '2. **Per-form detail.** For each active form, `get_procurement_detail(id: <form_id>)` — extract:\n' +
                '   - Unanswered questions (status: unanswered)\n' +
                '   - Questions with confidence = "no_content" (hard blockers — need new KB material)\n' +
                '   - Questions with confidence = "needs_sme" (soft blockers — need expert input)\n' +
                `   - Questions with draft responses updated more than ${staleDays} days ago (stalled drafts)\n` +
                '3. **Recent activity.** From the per-form detail, pull response `updated_at` timestamps and identify which forms have seen edits in the last 7 days vs which have gone silent.\n\n' +
                'Structure the output as:\n\n' +
                '## Procurement pipeline review — [DD/MM/YYYY]\n\n' +
                '### Critical blockers (action today)\n' +
                '[Bulleted list: "ProcurementName — Question N: no_content on topic X. Need KB item on X."]\n\n' +
                '### Stalled drafts (action this week)\n' +
                `[Bulleted list: "ProcurementName — Question N: last edit DD/MM/YYYY (N days ago, threshold ${staleDays}). Was in draft state."]\n\n` +
                '### SME input needed\n' +
                '[Bulleted list: "ProcurementName — Question N: needs_sme on topic X."]\n\n' +
                '### Recent activity\n' +
                '- Active (edited in last 7 days): [FormA, FormB]\n' +
                '- Silent (no edits in 7+ days): [FormC, FormD]\n\n' +
                '### Prioritised next actions\n' +
                '[Numbered 3-5 actions cutting across forms, ordered by deadline proximity × blocker severity.]\n\n' +
                'Use UK English. DD/MM/YYYY. If the pipeline is empty, say so and suggest `/kb:form-status` for historical context. If a form has zero blockers, omit it from the blocker sections (still include in Recent activity).',
            },
          },
        ],
      };
    },
  );
}
