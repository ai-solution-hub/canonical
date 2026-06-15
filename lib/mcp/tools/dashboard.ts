/**
 * Dashboard / orientation tool registrations (3 tools):
 *   2. get_dashboard_summary
 *   5. get_reorientation
 *      where_are_we_exposed  (ID-71.8 — M29/M4, B-INV-4/29; five-layer
 *                             exposure framing consolidating the former
 *                             freshness / coverage / quality / certification
 *                             reads with first-class resolution affordances)
 *
 * ID-71.8 retired into `where_are_we_exposed`: `get_freshness_report`,
 * `get_expiring_content` (this file), `get_coverage_gaps`, `audit_content`,
 * `get_quality_summary`, `get_quality_briefing`, `get_quality_actions`
 * (quality.ts), `get_certification_status` (entities.ts).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import {
  formatDashboardSummary,
  formatReorientation,
  formatWhereAreWeExposed,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  FreshnessReport,
  ExposureLayer,
  ExposureResolution,
  WhereAreWeExposedData,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
  getReorientModule,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

interface OwnershipSummary {
  owned_items: number;
  stale_owned: number;
  expired_owned: number;
  needs_attention: number;
}

// ---------------------------------------------------------------------------
// where_are_we_exposed — outputSchema (M37 forward standard, new entry)
// ---------------------------------------------------------------------------

const ExposureResolutionSchema = z.object({
  tool: z.string(),
  prompt: z.string(),
  label: z.string(),
});

const ExposureLayerSchema = z.object({
  key: z.enum(['data', 'quality', 'use_today', 'gaps', 'opportunities']),
  title: z.string(),
  summary: z.string(),
  facts: z.array(z.string()),
  resolutions: z.array(ExposureResolutionSchema).optional(),
});

const WhereAreWeExposedOutputSchema = {
  layers: z.array(ExposureLayerSchema),
  generated_at: z.string(),
};

export async function registerDashboardTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 2. get_dashboard_summary
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_dashboard_summary',
    {
      title: 'Dashboard Summary',
      description:
        'Get an overview of the knowledge base health including items needing attention, content freshness breakdown, active procurements, and recent activity. Use this to understand the current state of the knowledge base at a glance.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (extra: ToolExtra) => {
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
        const markdown = truncateResponse(formatDashboardSummary(data));

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
              text: `Dashboard query failed: ${message}. The database function may be temporarily unavailable.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 5. get_reorientation
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_reorientation',
    {
      title: 'Reorientation Briefing',
      description:
        'Get a personal briefing on what has changed in the knowledge base since your last visit. Includes urgent items needing attention, team activity, your recent work, and active procurement status. Use this to quickly catch up on what happened while you were away.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);
        const isAdmin = role === 'admin';
        const { fetchReorientData, resolveDisplayNames } =
          await getReorientModule();
        const data = await fetchReorientData(supabase, userId, isAdmin, role);

        // Resolve team member display names server-side
        const userIds = data.team_changes.map((c) => c.user_id).filter(Boolean);
        const displayNames = await resolveDisplayNames(userIds);
        for (const change of data.team_changes) {
          if (change.user_id && displayNames.has(change.user_id)) {
            change.user_name = displayNames.get(change.user_id)!;
          }
        }

        // Query content ownership summary for the requesting user
        let ownershipSummary: OwnershipSummary | null = null;
        try {
          const ownedItems = await sb(
            supabase
              .from('content_items')
              .select('id, freshness')
              .eq('content_owner_id', userId)
              .is('archived_at', null),
            'mcp.dashboard.owned_items',
          );

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
          content: [
            {
              type: 'text' as const,
              text: `Reorientation briefing failed: ${message}. The database function may be temporarily unavailable.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // where_are_we_exposed (ID-71.8 — M29/M4, B-INV-4/29)
  //
  // ONE outcome-shaped read consolidating the former exposure reads
  // (get_freshness_report, get_expiring_content, get_coverage_gaps,
  // audit_content, get_quality_summary, get_quality_briefing,
  // get_quality_actions, get_certification_status) into the five-layer
  // consumption framing:
  //   data you have → its quality → how you could use it today → the gaps →
  //   the opportunities.
  // Gaps and opportunities carry first-class suggested-resolution affordances
  // (B-INV-4) that reference the KEPT `suggest_content_creation` tool.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'where_are_we_exposed',
    {
      title: 'Where Are We Exposed?',
      outputSchema: WhereAreWeExposedOutputSchema,
      description:
        'Assess the knowledge base across five consumption layers, in order: (1) the data you have, (2) its quality, (3) how you could use it today, (4) the gaps, and (5) the opportunities. Gaps and opportunities come with first-class suggested resolutions ("Draft content for X", "Discuss options for Y"). Use this to understand exposure — freshness, coverage, quality, and certification — in one read.',
      inputSchema: {
        domain: z
          .string()
          .optional()
          .describe('Filter the analysis to a specific primary domain'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const domainFilter = args.domain || undefined;

        // --- Layer 1: data you have (freshness breakdown) ------------------
        const { data: freshnessRows, error: freshnessError } =
          await supabase.rpc('get_freshness_breakdown');
        if (freshnessError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Exposure analysis failed (freshness): ${freshnessError.message}.`,
              },
            ],
            isError: true,
          };
        }
        const freshness: FreshnessReport = {
          fresh: 0,
          aging: 0,
          stale: 0,
          expired: 0,
        };
        for (const row of (freshnessRows ?? []) as Array<{
          freshness: string;
          count: number;
        }>) {
          const key = row.freshness as keyof FreshnessReport;
          if (key in freshness) freshness[key] = Number(row.count);
        }
        const totalItems =
          freshness.fresh +
          freshness.aging +
          freshness.stale +
          freshness.expired;

        // --- Layer 2: its quality (open quality issues) --------------------
        const { data: qualityRows, error: qualityError } = await supabase.rpc(
          'get_quality_issue_counts',
        );
        if (qualityError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Exposure analysis failed (quality): ${qualityError.message}.`,
              },
            ],
            isError: true,
          };
        }
        const qualityByType: Record<string, number> = {};
        let totalOpenQuality = 0;
        for (const row of (qualityRows ?? []) as Array<{
          flag_type: string;
          open_count: number;
        }>) {
          qualityByType[row.flag_type] =
            (qualityByType[row.flag_type] ?? 0) + Number(row.open_count);
          totalOpenQuality += Number(row.open_count);
        }

        // --- Layer 3: how you could use it today (live certifications) -----
        // Items currently fresh/aging are usable today; expired certifications
        // are surfaced as a use-today caveat.
        const usableItems = freshness.fresh + freshness.aging;

        // --- Layer 4: the gaps (coverage gaps over the taxonomy) -----------
        const domains = await sb(
          supabase
            .from('taxonomy_domains')
            .select('id, name, display_order')
            .order('display_order'),
          'mcp.exposure.taxonomy_domains',
        );
        const subtopics = await sb(
          supabase
            .from('taxonomy_subtopics')
            .select('id, name, domain_id, display_order')
            .order('display_order'),
          'mcp.exposure.taxonomy_subtopics',
        );
        const items = await sb(
          supabase
            .from('content_items')
            .select('primary_domain, primary_subtopic, freshness'),
          'mcp.exposure.content_items_for_coverage',
        );

        const domainMap = new Map<string, string>();
        for (const d of (domains ?? []) as Array<{
          id: string;
          name: string;
        }>) {
          domainMap.set(d.id, d.name);
        }

        const countMap = new Map<string, number>();
        for (const item of (items ?? []) as Array<{
          primary_domain: string | null;
          primary_subtopic: string | null;
        }>) {
          if (!item.primary_domain || !item.primary_subtopic) continue;
          if (domainFilter && item.primary_domain !== domainFilter) continue;
          const key = `${item.primary_domain}|${item.primary_subtopic}`;
          countMap.set(key, (countMap.get(key) ?? 0) + 1);
        }

        let emptyCount = 0;
        let thinCount = 0;
        for (const st of (subtopics ?? []) as Array<{
          id: string;
          name: string;
          domain_id: string;
        }>) {
          const domainName = domainMap.get(st.domain_id);
          if (!domainName) continue;
          if (domainFilter && domainName !== domainFilter) continue;
          const count = countMap.get(`${domainName}|${st.name}`) ?? 0;
          if (count === 0) emptyCount++;
          else if (count < 3) thinCount++;
        }
        const totalGaps = emptyCount + thinCount;

        // --- Layer 5: the opportunities (content suggestions) --------------
        const { generateContentSuggestions } =
          await import('@/lib/content/content-suggestions');
        const suggestions = await generateContentSuggestions({
          supabase,
          maxSuggestions: 5,
          domainFilter,
          includeTemplateGaps: true,
        });

        // Resolution affordances (B-INV-4) reference the KEPT
        // suggest_content_creation tool.
        const draftResolution: ExposureResolution = {
          tool: 'suggest_content_creation',
          prompt:
            'Draft content for the highest-priority gap and suggest a content type.',
          label: 'Draft content for X',
        };
        const discussResolution: ExposureResolution = {
          tool: 'suggest_content_creation',
          prompt:
            'Discuss options for the opportunities surfaced and prioritise the next item to create.',
          label: 'Discuss options for Y',
        };

        const layers: ExposureLayer[] = [
          {
            key: 'data',
            title: 'Data you have',
            summary: `The knowledge base holds ${totalItems} content ${totalItems === 1 ? 'item' : 'items'}.`,
            facts: [
              `${freshness.fresh} fresh, ${freshness.aging} aging, ${freshness.stale} stale, ${freshness.expired} expired`,
            ],
          },
          {
            key: 'quality',
            title: 'Its quality',
            summary: `${totalOpenQuality} open quality ${totalOpenQuality === 1 ? 'issue' : 'issues'} across the corpus.`,
            facts: Object.entries(qualityByType).map(
              ([type, count]) => `${count} × ${type.replace(/_/g, ' ')}`,
            ),
          },
          {
            key: 'use_today',
            title: 'How you could use it today',
            summary: `${usableItems} ${usableItems === 1 ? 'item is' : 'items are'} fresh enough to answer questions today.`,
            facts: [
              `${freshness.expired} expired ${freshness.expired === 1 ? 'item needs' : 'items need'} refreshing before reuse`,
            ],
          },
          {
            key: 'gaps',
            title: 'The gaps',
            summary: `${totalGaps} coverage ${totalGaps === 1 ? 'gap' : 'gaps'} identified (${emptyCount} empty, ${thinCount} thin).`,
            facts: [
              `${emptyCount} subtopics have no content`,
              `${thinCount} subtopics are thin (fewer than 3 items)`,
            ],
            resolutions: [draftResolution],
          },
          {
            key: 'opportunities',
            title: 'The opportunities',
            summary: `${suggestions.length} content-creation ${suggestions.length === 1 ? 'opportunity' : 'opportunities'} ready to act on.`,
            facts: suggestions.map(
              (s) => `${s.title} (${s.domain} > ${s.subtopic}, ${s.priority})`,
            ),
            resolutions: [discussResolution],
          },
        ];

        const reportData: WhereAreWeExposedData = {
          layers,
          generated_at: new Date().toISOString(),
        };

        const markdown = truncateResponse(formatWhereAreWeExposed(reportData));
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
              text: `Exposure analysis failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
