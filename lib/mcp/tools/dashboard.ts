/**
 * Dashboard tool registrations (3 tools):
 *   2. get_dashboard_summary
 *   5. get_reorientation
 *   9. get_freshness_report
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import {
  formatDashboardSummary,
  formatReorientation,
  formatFreshnessReport,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type { FreshnessReport } from '@/lib/mcp/formatters';
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
        const { fetchDashboardData } = await getDashboardModule();
        const data = await fetchDashboardData(supabase, userId, isAdmin, role);
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
}
