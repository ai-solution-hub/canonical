/**
 * Entity tool registrations (1 tool):
 *  14. get_entity_relationships
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import {
  formatEntitySummary,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  EntitySummaryResult,
  EntityRelationship,
} from '@/lib/mcp/formatters';
import { type ToolExtra, toStructuredContent } from './shared';

export async function registerEntityTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 14. get_entity_relationships
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_entity_relationships',
    {
      title: 'Entity Relationships',
      description: 'Query entity relationships in the knowledge base. Find what certifications the company holds, what technologies are used, what sectors are served, and how entities connect to each other. Returns structured data from the entity graph at zero AI cost.',
      inputSchema: {
        entity_name: z.string().optional().describe('Entity name to search for (partial match supported)'),
        entity_type: z.string().optional().describe('Filter by entity type: organisation, certification, regulation, framework, capability, person, technology, project, sector'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // Resolve entity name aliases before querying
        const { canonicalise } = await import('@/lib/entity-dedup');
        const { resolveAlias } = await import('@/lib/entity-aliases');
        const resolvedName = args.entity_name
          ? resolveAlias(canonicalise(args.entity_name))
          : undefined;

        // Call get_entity_summary RPC
        const rpcArgs: Record<string, string> = {};
        if (resolvedName) rpcArgs.p_entity_name = resolvedName;
        if (args.entity_type) rpcArgs.p_entity_type = args.entity_type;

        const { data: summaryRows, error: summaryError } = await supabase.rpc(
          'get_entity_summary',
          rpcArgs as { p_entity_name?: string; p_entity_type?: string },
        );

        if (summaryError) {
          return {
            content: [{ type: 'text' as const, text: `Entity query failed: ${summaryError.message}. The database function may be temporarily unavailable.` }],
            isError: true,
          };
        }

        const summaries: EntitySummaryResult[] = ((summaryRows ?? []) as Record<string, unknown>[]).map((row) => ({
          canonical_name: row.canonical_name as string,
          entity_type: row.entity_type as string,
          mention_count: Number(row.mention_count),
          content_item_ids: (row.content_item_ids as string[]) ?? [],
          related_entities: (row.related_entities as Array<{ relationship: string; target?: string; source?: string }>) ?? [],
        }));

        // If a specific entity_name was provided, also fetch relationship details
        let relationships: EntityRelationship[] = [];
        if (resolvedName && summaries.length > 0) {
          const { data: relRows, error: relError } = await supabase.rpc(
            'get_entity_relationships_rpc',
            { p_entity_name: resolvedName },
          );

          if (!relError && relRows) {
            relationships = ((relRows ?? []) as Record<string, unknown>[]).map((row) => ({
              source_entity: row.source_entity as string,
              relationship_type: row.relationship_type as string,
              target_entity: row.target_entity as string,
              source_item_id: row.source_item_id as string,
              confidence: Number(row.confidence),
            }));
          }
        }

        const markdown = truncateResponse(
          formatEntitySummary(args.entity_name, args.entity_type, summaries, relationships),
        );

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            entity_name: args.entity_name ?? null,
            entity_type: args.entity_type ?? null,
            entity_count: summaries.length,
            summaries,
            relationships,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Entity query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );
}
