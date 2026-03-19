/**
 * MCP App trigger tool registrations (3 tools):
 *  22. show_coverage_matrix
 *  23. show_bid_dashboard
 *  24. show_reorient_me
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import {
  formatCoverageMatrix,
  formatBidDashboard,
  formatReorientation,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  CoverageMatrixData,
  BidDashboardData,
} from '@/lib/mcp/formatters';
import type { ActiveBidSummary } from '@/lib/dashboard';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
  getReorientModule,
  getExtAppsServer,
  fetchBidSections,
} from './shared';

export async function registerAppTools(server: McpServer): Promise<void> {
  const { registerAppTool } = await getExtAppsServer();

  // -------------------------------------------------------------------------
  // 22. show_coverage_matrix (App trigger tool — renders Coverage Matrix MCP App)
  // -------------------------------------------------------------------------
  const coverageMatrixUri = 'ui://coverage-matrix/app.html';
  registerAppTool(
    server,
    'show_coverage_matrix',
    {
      title: 'Show Coverage Matrix',
      description: 'Display an interactive coverage matrix showing taxonomy domains, freshness breakdown, quality issues, and gaps. This tool renders a visual grid inside the conversation. Use it when the user asks to see coverage, analyse gaps, or wants a visual overview of knowledge base health.',
      inputSchema: {
        include_gaps: z.boolean().optional().describe('Whether to include gap analysis (default: true)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: coverageMatrixUri } },
    },
    async (args: { include_gaps?: boolean }, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const includeGaps = args.include_gaps ?? true;

        // Aggregate data from multiple sources
        const { fetchDashboardData } = await getDashboardModule();
        const dashData = await fetchDashboardData(supabase, userId, isAdmin, role);

        // Freshness breakdown
        const freshness = dashData.freshness_summary;
        const totalItems = freshness.fresh + freshness.aging + freshness.stale + freshness.expired;

        // Domain-level freshness breakdown — query content_items
        const { data: items } = await supabase
          .from('content_items')
          .select('primary_domain, primary_subtopic, freshness');

        // Build domain map from taxonomy
        const { data: taxonomyDomains } = await supabase
          .from('taxonomy_domains')
          .select('id, name, display_order')
          .order('display_order');

        const { data: taxonomySubtopics } = await supabase
          .from('taxonomy_subtopics')
          .select('id, name, domain_id, display_order')
          .order('display_order');

        // Build domain name -> subtopics map
        const domainMap = new Map<string, string>();
        for (const d of (taxonomyDomains ?? []) as unknown as Array<{ id: string; name: string }>) {
          domainMap.set(d.id, d.name);
        }

        // Group subtopics by domain
        const subtopicsByDomain = new Map<string, Array<{ name: string }>>();
        for (const st of (taxonomySubtopics ?? []) as unknown as Array<{ id: string; name: string; domain_id: string }>) {
          const domainName = domainMap.get(st.domain_id);
          if (!domainName) continue;
          const existing = subtopicsByDomain.get(domainName) ?? [];
          existing.push({ name: st.name });
          subtopicsByDomain.set(domainName, existing);
        }

        // Count items per domain+subtopic+freshness
        type ItemRow = { primary_domain: string | null; primary_subtopic: string | null; freshness: string | null };
        type FreshnessCounts = { total: number; fresh: number; aging: number; stale: number; expired: number };
        const domainCounts = new Map<string, FreshnessCounts>();
        const subtopicCounts = new Map<string, FreshnessCounts>();

        for (const item of (items ?? []) as ItemRow[]) {
          if (!item.primary_domain) continue;

          // Domain level
          const dc = domainCounts.get(item.primary_domain) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
          dc.total++;
          if (item.freshness === 'fresh') dc.fresh++;
          else if (item.freshness === 'aging') dc.aging++;
          else if (item.freshness === 'stale') dc.stale++;
          else if (item.freshness === 'expired') dc.expired++;
          domainCounts.set(item.primary_domain, dc);

          // Subtopic level
          if (item.primary_subtopic) {
            const stKey = `${item.primary_domain}|${item.primary_subtopic}`;
            const sc = subtopicCounts.get(stKey) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
            sc.total++;
            if (item.freshness === 'fresh') sc.fresh++;
            else if (item.freshness === 'aging') sc.aging++;
            else if (item.freshness === 'stale') sc.stale++;
            else if (item.freshness === 'expired') sc.expired++;
            subtopicCounts.set(stKey, sc);
          }
        }

        // Build domains array
        const domains: CoverageMatrixData['domains'] = [];
        const allDomainNames = [...new Set([
          ...((taxonomyDomains ?? []) as unknown as Array<{ name: string }>).map(d => d.name),
          ...domainCounts.keys(),
        ])];

        // Sort by taxonomy display_order
        const domainOrder = new Map<string, number>();
        for (const d of (taxonomyDomains ?? []) as unknown as Array<{ name: string; display_order: number }>) {
          domainOrder.set(d.name, d.display_order);
        }
        allDomainNames.sort((a, b) => (domainOrder.get(a) ?? 999) - (domainOrder.get(b) ?? 999));

        for (const domainName of allDomainNames) {
          const dc = domainCounts.get(domainName) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
          const subtopics = subtopicsByDomain.get(domainName) ?? [];

          const subtopicData = subtopics.map(st => {
            const stKey = `${domainName}|${st.name}`;
            const sc = subtopicCounts.get(stKey) ?? { total: 0, fresh: 0, aging: 0, stale: 0, expired: 0 };
            return {
              name: st.name,
              total_items: sc.total,
              fresh: sc.fresh,
              aging: sc.aging,
              stale: sc.stale,
              expired: sc.expired,
            };
          });

          domains.push({
            name: domainName,
            total_items: dc.total,
            fresh: dc.fresh,
            aging: dc.aging,
            stale: dc.stale,
            expired: dc.expired,
            subtopics: subtopicData,
          });
        }

        // Quality summary
        const { data: qualityData } = await supabase
          .from('ingestion_quality_log')
          .select('flag_type, severity')
          .eq('status', 'open');

        const qualityByType: Record<string, number> = {};
        let totalFlagged = 0;
        for (const row of (qualityData ?? []) as Array<{ flag_type: string }>) {
          qualityByType[row.flag_type] = (qualityByType[row.flag_type] ?? 0) + 1;
          totalFlagged++;
        }

        // Coverage gaps
        const gaps: CoverageMatrixData['gaps'] = [];
        if (includeGaps) {
          for (const domain of domains) {
            if (domain.total_items === 0) {
              gaps.push({ domain: domain.name, subtopic: null, item_count: 0, issue: 'empty' });
            }
            for (const st of domain.subtopics) {
              if (st.total_items === 0) {
                gaps.push({ domain: domain.name, subtopic: st.name, item_count: 0, issue: 'empty' });
              } else if (st.total_items < 3) {
                gaps.push({ domain: domain.name, subtopic: st.name, item_count: st.total_items, issue: 'thin' });
              } else if (st.stale + st.expired === st.total_items && st.total_items > 0) {
                gaps.push({ domain: domain.name, subtopic: st.name, item_count: st.total_items, issue: 'stale_only' });
              }
            }
          }
        }

        const result: CoverageMatrixData = {
          total_items: totalItems,
          freshness: {
            fresh: freshness.fresh,
            aging: freshness.aging,
            stale: freshness.stale,
            expired: freshness.expired,
          },
          domains,
          quality: {
            total_flagged: totalFlagged,
            by_issue_type: qualityByType,
          },
          gaps,
        };

        const markdown = truncateResponse(formatCoverageMatrix(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Coverage matrix failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 23. show_bid_dashboard (App trigger tool — renders Bid Dashboard MCP App)
  // -------------------------------------------------------------------------
  const bidDashboardUri = 'ui://bid-dashboard/app.html';
  registerAppTool(
    server,
    'show_bid_dashboard',
    {
      title: 'Show Bid Dashboard',
      description: 'Display an interactive bid dashboard showing active bids with progress bars, deadline countdowns, and question completion stats. This tool renders a visual dashboard inside the conversation. Use it when the user asks about bid status, pipeline overview, or wants to see all active bids at a glance.',
      inputSchema: {
        bid_id: z.string().uuid().optional().describe('Optionally focus on a specific bid (auto-expands that card)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: bidDashboardUri } },
    },
    async (args: { bid_id?: string }, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';

        // Fetch active bids
        const { fetchDashboardData } = await getDashboardModule();
        const dashData = await fetchDashboardData(supabase, userId, isAdmin, role);
        const bids = dashData.active_bids as ActiveBidSummary[];

        const result: BidDashboardData = {
          offset: 0,
          count: bids.length,
          total_count: bids.length,
          has_more: false,
          bids: bids.map(bid => ({
            id: bid.id,
            name: bid.name,
            buyer: bid.buyer,
            status: bid.status,
            deadline: bid.deadline,
            days_until_deadline: bid.days_until_deadline,
            total_questions: bid.total_questions,
            answered_questions: bid.answered_questions,
            approved_questions: bid.approved_questions,
          })),
        };

        // If a specific bid_id is requested, fetch detail
        if (args.bid_id) {
          const { data: workspace } = await supabase
            .from('workspaces')
            .select('id, name, description, domain_metadata')
            .eq('id', args.bid_id)
            .eq('type', 'bid')
            .single();

          if (workspace) {
            const { data: stats } = await supabase.rpc('get_bid_question_stats', {
              p_project_id: args.bid_id,
            });
            const { sections, status_breakdown, confidence_breakdown } = await fetchBidSections(supabase, args.bid_id);
            const meta = workspace.domain_metadata as Record<string, unknown> | null;
            (result as unknown as Record<string, unknown>).focused_bid_detail = {
              id: workspace.id,
              name: workspace.name ?? 'Untitled Bid',
              buyer: (meta?.buyer as string) ?? null,
              status: (meta?.status as string) ?? 'draft',
              deadline: (meta?.deadline as string) ?? null,
              reference_number: (meta?.reference_number as string) ?? null,
              description: workspace.description,
              question_stats: stats?.[0] ?? null,
              sections,
              status_breakdown,
              confidence_breakdown,
            };
          }
        }

        const markdown = truncateResponse(formatBidDashboard(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Bid dashboard failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 24. show_reorient_me (App trigger tool — renders Reorient Me MCP App)
  // -------------------------------------------------------------------------
  const reorientMeUri = 'ui://reorient-me/app.html';
  registerAppTool(
    server,
    'show_reorient_me',
    {
      title: 'Show Reorient Me',
      description: 'Display an interactive personal briefing showing what has changed since your last visit, urgent items needing attention, team activity, and active bid status. This tool renders a visual briefing inside the conversation. Use it when the user says "reorient me", "catch me up", "what did I miss?", "what should I focus on?", or wants a personal briefing.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri: reorientMeUri } },
    },
    async (_args: Record<string, unknown>, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';

        const { fetchReorientData, resolveDisplayNames } = await getReorientModule();
        const data = await fetchReorientData(supabase, userId, isAdmin, role);

        // Resolve team member display names server-side
        // Note: resolveDisplayNames creates its own service-role client internally
        // — the user-scoped MCP client cannot access auth.admin
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
          content: [{ type: 'text' as const, text: `Reorient Me failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );
}
