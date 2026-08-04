/**
 * MCP resource and prompt registrations for the Knowledge Hub server.
 *
 * Resources (3):
 *   - kb://qa/{id}       — Q&A pair with standard/advanced answers
 *   - kb://entities      — Entity overview with types, counts, and top entities
 *   - ui://intelligence-feed/app.html — Intelligence Feed MCP App (interactive UI)
 *
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
import { fetchSourceDocumentBody } from '@/lib/source-documents/body';
import { loadSkill } from '@/lib/ai/skills/loader';
import { sb } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';
import type { FacetOwnerKind } from '@/lib/validation/owner-kind';

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

  const { registerAppResource, RESOURCE_MIME_TYPE } =
    await import('@modelcontextprotocol/ext-apps/server');

  // Lazy import — keeps the ~400 KB HTML string out of module evaluation
  async function getAppBundles() {
    return await import('@/lib/mcp/app-bundles');
  }

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
}
