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

        const markdown = truncateResponse(formatReorientation(data));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
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
