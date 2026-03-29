/**
 * Dashboard tool registrations (4 tools):
 *   2. get_dashboard_summary
 *   5. get_reorientation
 *   9. get_freshness_report
 *  38. get_expiring_content
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import {
  formatDashboardSummary,
  formatReorientation,
  formatFreshnessReport,
  formatExpiringContent,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  FreshnessReport,
  ExpiringContentItem,
  ExpiringEntityMention,
  ExpiringContentData,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
  getReorientModule,
} from './shared';

interface OwnershipSummary {
  owned_items: number;
  stale_owned: number;
  expired_owned: number;
  needs_attention: number;
}

export async function registerDashboardTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 2. get_dashboard_summary
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_dashboard_summary',
    {
      title: 'Dashboard Summary',
      description: 'Get an overview of the knowledge base health including items needing attention, content freshness breakdown, active bids, and recent activity. Use this to understand the current state of the knowledge base at a glance.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const { fetchUnifiedDashboardData, unifiedToDashboardData } = await getDashboardModule();
        const unified = await fetchUnifiedDashboardData(supabase, userId, isAdmin, role);
        const data = unifiedToDashboardData(unified);
        const markdown = truncateResponse(formatDashboardSummary(data));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Dashboard query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 5. get_reorientation
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_reorientation',
    {
      title: 'Reorientation Briefing',
      description: 'Get a personal briefing on what has changed in the knowledge base since your last visit. Includes urgent items needing attention, team activity, your recent work, and active bid status. Use this to quickly catch up on what happened while you were away.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const { fetchReorientData, resolveDisplayNames } = await getReorientModule();
        const data = await fetchReorientData(supabase, userId, isAdmin, role);

        // Resolve team member display names server-side
        const userIds = data.team_changes.map(c => c.user_id).filter(Boolean);
        const displayNames = await resolveDisplayNames(userIds);
        for (const change of data.team_changes) {
          if (change.user_id && displayNames.has(change.user_id)) {
            change.user_name = displayNames.get(change.user_id)!;
          }
        }

        // Query content ownership summary for the requesting user
        let ownershipSummary: OwnershipSummary | null = null;
        try {
          const { data: ownedItems } = await supabase
            .from('content_items')
            .select('id, freshness')
            .eq('content_owner_id', userId)
            .is('archived_at', null);

          if (ownedItems && ownedItems.length > 0) {
            const staleCount = ownedItems.filter(
              (i: { freshness: string | null }) => i.freshness === 'stale',
            ).length;
            const expiredCount = ownedItems.filter(
              (i: { freshness: string | null }) => i.freshness === 'expired',
            ).length;
            ownershipSummary = {
              owned_items: ownedItems.length,
              stale_owned: staleCount,
              expired_owned: expiredCount,
              needs_attention: staleCount + expiredCount,
            };
          }
        } catch {
          // Non-critical — ownership context is supplementary
        }

        let markdown = truncateResponse(formatReorientation(data));

        // Append ownership section if the user owns any items
        if (ownershipSummary && ownershipSummary.owned_items > 0) {
          const ownerSection = [
            '',
            '## Content Ownership',
            `You own ${ownershipSummary.owned_items} item${ownershipSummary.owned_items === 1 ? '' : 's'}`,
          ];
          if (ownershipSummary.needs_attention > 0) {
            ownerSection.push(
              `${ownershipSummary.needs_attention} need${ownershipSummary.needs_attention === 1 ? 's' : ''} attention (${ownershipSummary.stale_owned} stale, ${ownershipSummary.expired_owned} expired)`,
            );
          } else {
            ownerSection.push('All your owned items are in good health');
          }
          markdown += '\n' + ownerSection.join('\n');
        }

        const structuredData = {
          ...data,
          ...(ownershipSummary && { ownership: ownershipSummary }),
        };

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(structuredData),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Reorientation briefing failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 9. get_freshness_report
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_freshness_report',
    {
      title: 'Freshness Report',
      description: 'Get a breakdown of content freshness across the knowledge base — how many items are fresh, aging, stale, or expired. Use this to understand the health of your content.',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { data: rows, error } = await supabase.rpc('get_freshness_breakdown');

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Freshness query failed: ${error.message}` }],
            isError: true,
          };
        }

        const report: FreshnessReport = { fresh: 0, aging: 0, stale: 0, expired: 0 };
        for (const row of (rows ?? []) as Array<{ freshness: string; count: number }>) {
          const key = row.freshness as keyof FreshnessReport;
          if (key in report) {
            report[key] = Number(row.count);
          }
        }

        const markdown = formatFreshnessReport(report);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(report),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Freshness query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 38. get_expiring_content
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_expiring_content',
    {
      title: 'Expiring Content',
      description:
        'Get a list of content items and certifications/registrations approaching their expiry date. Shows items grouped by urgency (overdue, urgent, soon, upcoming). Use this to plan renewals and keep the knowledge base current.',
      inputSchema: {
        days_ahead: z
          .number()
          .optional()
          .describe('How many days ahead to look for expiring content (default: 30, max: 365)'),
        domain: z
          .string()
          .optional()
          .describe('Filter content items by domain (e.g. "compliance")'),
        include_entities: z
          .boolean()
          .optional()
          .describe('Include entity mention expiry dates such as certifications and registrations (default: true)'),
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
        const daysAhead = Math.min(Math.max(args.days_ahead ?? 30, 1), 365);
        const includeEntities = args.include_entities ?? true;

        const now = new Date();
        const cutoffDate = new Date(now);
        cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

        // Query 1: Content items with expiry_date within the window
        let contentQuery = supabase
          .from('content_items')
          .select('id, title, expiry_date, primary_domain, lifecycle_type')
          .is('archived_at', null)
          .not('expiry_date', 'is', null)
          .lte('expiry_date', cutoffDate.toISOString())
          .order('expiry_date', { ascending: true });

        if (args.domain) {
          contentQuery = contentQuery.eq('primary_domain', args.domain);
        }

        const { data: contentRows, error: contentError } = await contentQuery;

        if (contentError) {
          return {
            content: [{ type: 'text' as const, text: `Expiring content query failed: ${contentError.message}` }],
            isError: true,
          };
        }

        const contentItems: ExpiringContentItem[] = ((contentRows ?? []) as unknown as Array<{
          id: string;
          title: string;
          expiry_date: string;
          primary_domain: string | null;
          lifecycle_type: string | null;
        }>).map((row) => {
          const expiryDate = new Date(row.expiry_date);
          const diffMs = expiryDate.getTime() - now.getTime();
          const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          return {
            id: row.id,
            title: row.title,
            expiry_date: row.expiry_date,
            days_remaining: daysRemaining,
            domain: row.primary_domain,
            lifecycle_type: row.lifecycle_type,
          };
        });

        // Query 2: Entity mentions with expiry_date in metadata (if requested)
        let entityMentions: ExpiringEntityMention[] = [];

        if (includeEntities) {
          const { deriveExpiryStatus } = await import('@/lib/certification-status');

          const { data: entityRows, error: entityError } = await supabase
            .from('entity_mentions')
            .select('canonical_name, entity_type, metadata')
            .not('metadata', 'is', null);

          if (entityError) {
            // Non-critical — entity mentions are supplementary
            // Log but continue with content items only
          } else {
            // Filter and deduplicate by canonical_name (keep nearest expiry)
            const entityMap = new Map<string, ExpiringEntityMention>();

            for (const row of (entityRows ?? []) as Array<{
              canonical_name: string;
              entity_type: string;
              metadata: Record<string, unknown> | null;
            }>) {
              const meta = row.metadata;
              if (!meta) continue;
              const expiryDateStr = meta.expiry_date as string | undefined;
              if (!expiryDateStr) continue;

              const expiryDate = new Date(expiryDateStr);
              if (isNaN(expiryDate.getTime())) continue;

              // Only include if within the lookahead window
              if (expiryDate.getTime() > cutoffDate.getTime()) continue;

              const diffMs = expiryDate.getTime() - now.getTime();
              const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              const status = deriveExpiryStatus(expiryDateStr);

              const existing = entityMap.get(row.canonical_name);
              // Keep the entry with the nearest (most urgent) expiry date
              if (!existing || daysRemaining < existing.days_remaining) {
                entityMap.set(row.canonical_name, {
                  canonical_name: row.canonical_name,
                  entity_type: row.entity_type,
                  expiry_date: expiryDateStr,
                  days_remaining: daysRemaining,
                  expiry_status: status,
                });
              }
            }

            entityMentions = Array.from(entityMap.values()).sort(
              (a, b) => a.days_remaining - b.days_remaining,
            );
          }
        }

        const reportData: ExpiringContentData = {
          content_items: contentItems,
          entity_mentions: entityMentions,
          days_ahead: daysAhead,
        };

        const markdown = truncateResponse(formatExpiringContent(reportData));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(reportData),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Expiring content query failed: ${message}. The database function may be temporarily unavailable.` }],
          isError: true,
        };
      }
    },
  );
}
