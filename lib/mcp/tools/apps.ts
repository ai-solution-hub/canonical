/**
 * MCP App trigger tool registrations (4 tools):
 *  22. show_coverage_matrix
 *  23. show_procurement_dashboard
 *  24. show_reorient_me
 *  25. show_intelligence_feed
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import { parseProcurementMetadata } from '@/lib/validation/schemas';
import { sb } from '@/lib/supabase/safe';
import {
  formatCoverageMatrix,
  formatProcurementDashboard,
  formatReorientation,
  truncateResponse,
} from '@/lib/mcp/formatters';
// Lazy imports — intelligence modules loaded on-demand to prevent cold start crashes
// and to avoid breaking when lib/intelligence/summary.ts doesn't exist yet.
import type {
  CoverageMatrixData,
  ProcurementDashboardData,
} from '@/lib/mcp/formatters';
import type { ActiveProcurementSummary } from '@/lib/dashboard';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
  getReorientModule,
  getExtAppsServer,
  fetchProcurementSections,
  defineAppTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerAppTools(server: McpServer): Promise<void> {
  const { registerAppTool } = await getExtAppsServer();

  // -------------------------------------------------------------------------
  // 22. show_coverage_matrix (App trigger tool — renders Coverage Matrix MCP App)
  // -------------------------------------------------------------------------
  const coverageMatrixUri = 'ui://coverage-matrix/app.html';
  defineAppTool(
    registerAppTool,
    server,
    'show_coverage_matrix',
    {
      title: 'Show Coverage Matrix',
      description:
        'Display an interactive coverage matrix showing taxonomy domains, freshness breakdown, quality issues, and gaps. This tool renders a visual grid inside the conversation. Use it when the user asks to see coverage, analyse gaps, or wants a visual overview of knowledge base health.',
      inputSchema: {
        include_gaps: z
          .boolean()
          .optional()
          .describe('Whether to include gap analysis (default: true)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
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
        const { fetchUnifiedDashboardData } = await getDashboardModule();
        const dashData = await fetchUnifiedDashboardData(
          supabase,
          userId,
          isAdmin,
          role,
        );

        // Freshness breakdown
        const freshness = dashData.freshness_summary;
        const totalItems =
          freshness.fresh +
          freshness.aging +
          freshness.stale +
          freshness.expired;

        // Domain-level freshness breakdown. ID-131 (G-MCP-REPOINT, BI-9/18):
        // content_items no longer exists — primary_domain/primary_subtopic
        // now live on source_documents; freshness moved to the
        // record_lifecycle facet (source_document owner axis). Two-step
        // fetch + client-side join (this call aggregates the whole corpus,
        // so a per-id join isn't practical).
        const sourceDocs = await sb(
          supabase
            .from('source_documents')
            .select('id, primary_domain, primary_subtopic'),
          'mcp.tools.apps.coverage.source_documents',
        );
        const freshnessRows = await sb(
          supabase
            .from('record_lifecycle')
            .select('source_document_id, freshness')
            .eq('owner_kind', 'source_document'),
          'mcp.tools.apps.coverage.freshness',
        );
        const freshnessBySourceDocId = new Map<string, string | null>();
        for (const fr of freshnessRows as Array<{
          source_document_id: string | null;
          freshness: string | null;
        }>) {
          if (fr.source_document_id) {
            freshnessBySourceDocId.set(fr.source_document_id, fr.freshness);
          }
        }
        const items = (
          sourceDocs as Array<{
            id: string | null;
            primary_domain: string | null;
            primary_subtopic: string | null;
          }>
        ).map((sd) => ({
          primary_domain: sd.primary_domain,
          primary_subtopic: sd.primary_subtopic,
          freshness: sd.id ? (freshnessBySourceDocId.get(sd.id) ?? null) : null,
        }));

        // Build domain map from taxonomy
        const taxonomyDomains = await sb(
          supabase
            .from('taxonomy_domains')
            .select('id, name, display_order')
            .order('display_order'),
          'mcp.tools.apps.coverage.domains',
        );

        const taxonomySubtopics = await sb(
          supabase
            .from('taxonomy_subtopics')
            .select('id, name, domain_id, display_order')
            .order('display_order'),
          'mcp.tools.apps.coverage.subtopics',
        );

        // Build domain name -> subtopics map
        const domainMap = new Map<string, string>();
        for (const d of taxonomyDomains as unknown as Array<{
          id: string;
          name: string;
        }>) {
          domainMap.set(d.id, d.name);
        }

        // Group subtopics by domain
        const subtopicsByDomain = new Map<string, Array<{ name: string }>>();
        for (const st of taxonomySubtopics as unknown as Array<{
          id: string;
          name: string;
          domain_id: string;
        }>) {
          const domainName = domainMap.get(st.domain_id);
          if (!domainName) continue;
          const existing = subtopicsByDomain.get(domainName) ?? [];
          existing.push({ name: st.name });
          subtopicsByDomain.set(domainName, existing);
        }

        // Count items per domain+subtopic+freshness
        type ItemRow = {
          primary_domain: string | null;
          primary_subtopic: string | null;
          freshness: string | null;
        };
        type FreshnessCounts = {
          total: number;
          fresh: number;
          aging: number;
          stale: number;
          expired: number;
        };
        const domainCounts = new Map<string, FreshnessCounts>();
        const subtopicCounts = new Map<string, FreshnessCounts>();

        for (const item of items as unknown as ItemRow[]) {
          if (!item.primary_domain) continue;

          // Domain level
          const dc = domainCounts.get(item.primary_domain) ?? {
            total: 0,
            fresh: 0,
            aging: 0,
            stale: 0,
            expired: 0,
          };
          dc.total++;
          if (item.freshness === 'fresh') dc.fresh++;
          else if (item.freshness === 'aging') dc.aging++;
          else if (item.freshness === 'stale') dc.stale++;
          else if (item.freshness === 'expired') dc.expired++;
          domainCounts.set(item.primary_domain, dc);

          // Subtopic level
          if (item.primary_subtopic) {
            const stKey = `${item.primary_domain}|${item.primary_subtopic}`;
            const sc = subtopicCounts.get(stKey) ?? {
              total: 0,
              fresh: 0,
              aging: 0,
              stale: 0,
              expired: 0,
            };
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
        const allDomainNames = [
          ...new Set([
            ...(taxonomyDomains as unknown as Array<{ name: string }>).map(
              (d) => d.name,
            ),
            ...domainCounts.keys(),
          ]),
        ];

        // Sort by taxonomy display_order
        const domainOrder = new Map<string, number>();
        for (const d of taxonomyDomains as unknown as Array<{
          name: string;
          display_order: number;
        }>) {
          domainOrder.set(d.name, d.display_order);
        }
        allDomainNames.sort(
          (a, b) => (domainOrder.get(a) ?? 999) - (domainOrder.get(b) ?? 999),
        );

        for (const domainName of allDomainNames) {
          const dc = domainCounts.get(domainName) ?? {
            total: 0,
            fresh: 0,
            aging: 0,
            stale: 0,
            expired: 0,
          };
          const subtopics = subtopicsByDomain.get(domainName) ?? [];

          const subtopicData = subtopics.map((st) => {
            const stKey = `${domainName}|${st.name}`;
            const sc = subtopicCounts.get(stKey) ?? {
              total: 0,
              fresh: 0,
              aging: 0,
              stale: 0,
              expired: 0,
            };
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
        const qualityData = await sb(
          supabase
            .from('ingestion_quality_log')
            .select('flag_type, severity')
            .eq('resolved', false),
          'mcp.tools.apps.coverage.quality',
        );

        const qualityByType: Record<string, number> = {};
        let totalFlagged = 0;
        for (const row of qualityData as Array<{ flag_type: string }>) {
          qualityByType[row.flag_type] =
            (qualityByType[row.flag_type] ?? 0) + 1;
          totalFlagged++;
        }

        // Coverage targets
        const targetRows = await sb(
          supabase
            .from('coverage_targets')
            .select(
              'domain_id, metric_name, target_value, taxonomy_domains(name)',
            )
            .order('domain_id'),
          'mcp.tools.apps.coverage.targets',
        );

        type TargetRow = {
          domain_id: string;
          metric_name: string;
          target_value: number;
          taxonomy_domains: { name: string } | null;
        };
        const coverageTargets: Array<{
          domain_name: string;
          metric_name: string;
          target_value: number;
        }> = [];
        for (const row of targetRows as unknown as TargetRow[]) {
          const domName = row.taxonomy_domains?.name;
          if (domName) {
            coverageTargets.push({
              domain_name: domName,
              metric_name: row.metric_name,
              target_value: row.target_value,
            });
          }
        }

        // Coverage gaps
        const gaps: CoverageMatrixData['gaps'] = [];
        if (includeGaps) {
          for (const domain of domains) {
            if (domain.total_items === 0) {
              gaps.push({
                domain: domain.name,
                subtopic: null,
                item_count: 0,
                issue: 'empty',
              });
            }
            for (const st of domain.subtopics) {
              if (st.total_items === 0) {
                gaps.push({
                  domain: domain.name,
                  subtopic: st.name,
                  item_count: 0,
                  issue: 'empty',
                });
              } else if (st.total_items < 3) {
                gaps.push({
                  domain: domain.name,
                  subtopic: st.name,
                  item_count: st.total_items,
                  issue: 'thin',
                });
              } else if (
                st.stale + st.expired === st.total_items &&
                st.total_items > 0
              ) {
                gaps.push({
                  domain: domain.name,
                  subtopic: st.name,
                  item_count: st.total_items,
                  issue: 'stale_only',
                });
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

        // Add targets to structured response
        const structuredData = {
          ...result,
          targets: coverageTargets.length > 0 ? coverageTargets : undefined,
        };

        // Build markdown with optional target comparison
        let markdown = formatCoverageMatrix(result);
        if (coverageTargets.length > 0) {
          const targetLines: string[] = [
            '',
            '## Coverage Targets',
            '',
            '| Domain | Metric | Target | Current | Status |',
            '|--------|--------|--------|---------|--------|',
          ];
          for (const target of coverageTargets) {
            const domain = domains.find((d) => d.name === target.domain_name);
            let current = '—';
            let status = '—';
            if (domain) {
              if (target.metric_name === 'item_count') {
                current = String(domain.total_items);
                status =
                  domain.total_items >= target.target_value
                    ? 'On track'
                    : 'Below target';
              } else if (target.metric_name === 'fresh_pct') {
                const totalDomain = domain.total_items || 1;
                const freshPct = Math.round((domain.fresh / totalDomain) * 100);
                current = `${freshPct}%`;
                status =
                  freshPct >= target.target_value ? 'On track' : 'Below target';
              } else if (target.metric_name === 'max_expired') {
                current = String(domain.expired);
                status =
                  domain.expired <= target.target_value
                    ? 'On track'
                    : 'Below target';
              }
            }
            const metricLabel = target.metric_name.replace(/_/g, ' ');
            const targetDisplay =
              target.metric_name === 'fresh_pct'
                ? `${target.target_value}%`
                : String(target.target_value);
            targetLines.push(
              `| ${target.domain_name} | ${metricLabel} | ${targetDisplay} | ${current} | ${status} |`,
            );
          }
          markdown += targetLines.join('\n');
        }

        return {
          content: [
            { type: 'text' as const, text: truncateResponse(markdown) },
          ],
          structuredContent: toStructuredContent(structuredData),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Coverage matrix failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 23. show_procurement_dashboard (App trigger tool — renders Procurement Dashboard MCP App)
  // -------------------------------------------------------------------------
  const procurementDashboardUri = 'ui://form-dashboard/app.html';
  defineAppTool(
    registerAppTool,
    server,
    'show_procurement_dashboard',
    {
      title: 'Show Procurement Dashboard',
      description:
        'Display an interactive form dashboard showing active procurements with progress bars, deadline countdowns, and question completion stats. This tool renders a visual dashboard inside the conversation. Use it when the user asks about form status, pipeline overview, or wants to see all active procurements at a glance.',
      inputSchema: {
        form_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Optionally focus on a specific form (auto-expands that card)',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: procurementDashboardUri } },
    },
    async (args: { form_id?: string }, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';

        // Fetch active procurements
        const { fetchUnifiedDashboardData } = await getDashboardModule();
        const dashData = await fetchUnifiedDashboardData(
          supabase,
          userId,
          isAdmin,
          role,
        );
        const bids = dashData.active_bids as ActiveProcurementSummary[];

        const result: ProcurementDashboardData = {
          offset: 0,
          count: bids.length,
          total_count: bids.length,
          has_more: false,
          procurements: bids.map((bid) => ({
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

        // If a specific form_id is requested, fetch detail
        if (args.form_id) {
          // Post-T2: discriminator is application_types.key via JOIN, not the
          // dropped workspaces.type col. 'bid' maps to 'procurement'.
          const workspace = await sb(
            supabase
              .from('workspaces')
              .select(
                'id, name, description, domain_metadata, application_types!inner(key)',
              )
              .eq('id', args.form_id)
              .eq('application_types.key', 'procurement')
              .maybeSingle(),
            'mcp.tools.apps.workspace.load',
          );

          if (workspace) {
            const stats = await sb(
              supabase.rpc('get_form_question_stats', {
                p_project_id: args.form_id,
              }),
              'mcp.tools.apps.workspace.stats',
            );
            const { sections, status_breakdown, confidence_breakdown } =
              await fetchProcurementSections(supabase, args.form_id);
            const meta = parseProcurementMetadata(workspace.domain_metadata);
            (result as unknown as Record<string, unknown>).focused_form_detail =
              {
                id: workspace.id,
                name: workspace.name ?? 'Untitled Procurement',
                buyer: meta?.buyer ?? null,
                status: meta?.status ?? 'draft',
                deadline: meta?.deadline ?? null,
                reference_number: meta?.reference_number ?? null,
                description: workspace.description,
                question_stats: stats?.[0] ?? null,
                sections,
                status_breakdown,
                confidence_breakdown,
              };
          }
        }

        const markdown = truncateResponse(formatProcurementDashboard(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Procurement dashboard failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 24. show_reorient_me (App trigger tool — renders Reorient Me MCP App)
  // -------------------------------------------------------------------------
  const reorientMeUri = 'ui://reorient-me/app.html';
  defineAppTool(
    registerAppTool,
    server,
    'show_reorient_me',
    {
      title: 'Show Reorient Me',
      description:
        'Display an interactive personal briefing showing what has changed since your last visit, urgent items needing attention, team activity, and active procurement status. This tool renders a visual briefing inside the conversation. Use it when the user says "reorient me", "catch me up", "what did I miss?", "what should I focus on?", or wants a personal briefing.',
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: reorientMeUri } },
    },
    async (_args: Record<string, unknown>, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';

        const { fetchReorientData, resolveDisplayNames } =
          await getReorientModule();
        const data = await fetchReorientData(supabase, userId, isAdmin, role);

        // Resolve team member display names server-side
        // Note: resolveDisplayNames creates its own service-role client internally
        // — the user-scoped MCP client cannot access auth.admin
        const userIds = data.team_changes.map((c) => c.user_id).filter(Boolean);
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
          content: [
            { type: 'text' as const, text: `Reorient Me failed: ${message}.` },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 25. show_intelligence_feed (App trigger tool — renders Intelligence Feed MCP App)
  // -------------------------------------------------------------------------
  const intelligenceFeedUri = 'ui://intelligence-feed/app.html';
  defineAppTool(
    registerAppTool,
    server,
    'show_intelligence_feed',
    {
      title: 'Show Intelligence Feed',
      description:
        'Display an interactive intelligence feed showing sector intelligence articles, filter statistics, category breakdowns, and top articles by relevance score. This tool renders a visual feed inside the conversation. Use it when the user asks to see intelligence, sector news, or wants a visual overview of their intelligence workspace.',
      inputSchema: {
        workspace_id: z
          .string()
          .uuid()
          .describe('The intelligence workspace UUID'),
        period: z
          .enum(['7d', '14d', '30d', '90d'])
          .optional()
          .describe('Time period for the feed (default: "7d")'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: { ui: { resourceUri: intelligenceFeedUri } },
    },
    async (
      args: { workspace_id: string; period?: '7d' | '14d' | '30d' | '90d' },
      extra: ToolExtra,
    ) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        const { fetchIntelligenceSummary } =
          await import('@/lib/intelligence/summary');
        const { formatIntelligenceSummary } =
          await import('@/lib/mcp/formatters/intelligence');

        const data = await fetchIntelligenceSummary(
          supabase,
          args.workspace_id,
          args.period ?? '7d',
        );

        const markdown = truncateResponse(formatIntelligenceSummary(data));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(data),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Intelligence feed failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
