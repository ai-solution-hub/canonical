/**
 * Entity tool registrations (2 tools):
 *  14. get_entity_relationships
 *  34. get_certification_status
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
  CertificationReportEntry,
  CertificationReportData,
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
        const { canonicalise } = await import('@/lib/entities/entity-dedup');
        const { resolveAlias, loadAliases } = await import('@/lib/entities/entity-aliases');
        await loadAliases(supabase);
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

  // -------------------------------------------------------------------------
  // 34. get_certification_status
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_certification_status',
    {
      title: 'Certification Status Report',
      description:
        'Get a summary of all certifications, framework memberships, and registrations the organisation holds. Includes expiry dates, versions, issuing bodies, and links to supporting evidence. Use this to answer bid questions about certifications and compliance.',
      inputSchema: {
        include_suppliers: z
          .boolean()
          .optional()
          .describe('Include supplier certifications (default: false)'),
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

        // Query entity_relationships for 'holds' relationships
        const { data: relationships, error: relError } = await supabase
          .from('entity_relationships')
          .select('source_entity, target_entity')
          .eq('relationship_type', 'holds');

        if (relError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Certification query failed: ${relError.message}`,
              },
            ],
            isError: true,
          };
        }

        // Get unique target entity names
        const targetNames = [
          ...new Set((relationships ?? []).map((r) => r.target_entity)),
        ];

        if (targetNames.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '# Certification Status Report\n\nNo certifications, frameworks, or registrations found.',
              },
            ],
          };
        }

        // Query entity_mentions for target entities with metadata
        const { data: mentions, error: mentionError } = await supabase
          .from('entity_mentions')
          .select(
            'canonical_name, entity_type, entity_type_override, metadata, content_item_id',
          )
          .in('canonical_name', targetNames);

        if (mentionError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Certification query failed: ${mentionError.message}`,
              },
            ],
            isError: true,
          };
        }

        // Lazy imports to avoid serverless cold-start issues
        const { deriveExpiryStatus } = await import(
          '@/lib/certification-status'
        );
        const { formatCertificationReport, truncateResponse } = await import(
          '@/lib/mcp/formatters'
        );

        // Group by canonical_name and categorise
        const entityMap = new Map<
          string,
          {
            canonical_name: string;
            entity_type: string;
            metadata: Record<string, unknown>;
            content_item_ids: Set<string>;
            mention_count: number;
          }
        >();

        for (const mention of mentions ?? []) {
          const name = mention.canonical_name as string;
          const existing = entityMap.get(name);
          const mentionMeta = (mention.metadata as Record<string, unknown>) ?? {};
          const effectiveType =
            (mention.entity_type_override as string) ??
            (mention.entity_type as string);

          if (existing) {
            existing.mention_count += 1;
            if (mention.content_item_id) {
              existing.content_item_ids.add(mention.content_item_id as string);
            }
            // Merge metadata — later mentions with richer data win
            for (const [key, value] of Object.entries(mentionMeta)) {
              if (value !== null && value !== undefined && value !== '') {
                existing.metadata[key] = value;
              }
            }
            // Use the most specific entity type
            if (effectiveType && effectiveType !== existing.entity_type) {
              existing.entity_type = effectiveType;
            }
          } else {
            const contentIds = new Set<string>();
            if (mention.content_item_id) {
              contentIds.add(mention.content_item_id as string);
            }
            entityMap.set(name, {
              canonical_name: name,
              entity_type: effectiveType,
              metadata: { ...mentionMeta },
              content_item_ids: contentIds,
              mention_count: 1,
            });
          }
        }

        // Also look up holder information from relationships
        const holderMap = new Map<string, { holder: string; supplier_name?: string }>();
        for (const rel of relationships ?? []) {
          const source = rel.source_entity as string;
          const target = rel.target_entity as string;
          // Check if source looks like the main org or a supplier
          const entityData = entityMap.get(target);
          if (entityData) {
            const meta = entityData.metadata;
            const holder = (meta.holder as string) ?? 'self';
            holderMap.set(target, {
              holder,
              supplier_name: holder === 'supplier' ? (meta.supplier_name as string) ?? source : undefined,
            });
          }
        }

        // Build report entries
        const certifications: CertificationReportEntry[] = [];
        const frameworks: CertificationReportEntry[] = [];
        const registrations: CertificationReportEntry[] = [];

        let valid = 0;
        let expiringSoon = 0;
        let expired = 0;
        let unknown = 0;

        for (const [, entity] of entityMap) {
          const expiryDate =
            (entity.metadata.expiry_date as string) ?? undefined;
          const expiryStatus = deriveExpiryStatus(expiryDate);

          // Count statuses
          switch (expiryStatus) {
            case 'valid':
              valid++;
              break;
            case 'expiring_soon':
              expiringSoon++;
              break;
            case 'expired':
              expired++;
              break;
            default:
              unknown++;
          }

          const holderInfo = holderMap.get(entity.canonical_name);

          const entry: CertificationReportEntry = {
            canonical_name: entity.canonical_name,
            entity_type: entity.entity_type,
            metadata: entity.metadata,
            expiry_status: expiryStatus,
            mention_count: entity.mention_count,
            content_item_count: entity.content_item_ids.size,
            holder: holderInfo?.holder,
            supplier_name: holderInfo?.supplier_name,
          };

          // Categorise by entity type
          switch (entity.entity_type) {
            case 'certification':
              certifications.push(entry);
              break;
            case 'framework':
              frameworks.push(entry);
              break;
            case 'regulation':
              registrations.push(entry);
              break;
            default:
              // Default to certification for uncategorised
              certifications.push(entry);
          }
        }

        const reportData: CertificationReportData = {
          certifications,
          frameworks,
          registrations,
          summary: {
            total_certifications: entityMap.size,
            valid,
            expiring_soon: expiringSoon,
            expired,
            unknown,
          },
        };

        const markdown = truncateResponse(
          formatCertificationReport(
            reportData,
            args.include_suppliers ?? false,
          ),
        );

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(reportData),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Certification query failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
