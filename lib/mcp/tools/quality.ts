/**
 * Quality tool registrations (7 tools):
 *   8. get_quality_summary
 *  17. get_coverage_gaps
 *  18. audit_content
 *  26. find_all_duplicates
 *  31. suggest_content_creation
 *  36. get_quality_briefing
 *  37. get_quality_actions
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import {
  formatQualitySummary,
  formatCoverageGaps,
  formatAuditResult,
  formatDuplicatePairs,
  formatQualityActions,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  QualitySummary,
  CoverageGapResult,
  AuditItem,
  AuditResult,
  DuplicatePairsResult,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerQualityTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 8. get_quality_summary
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_quality_summary',
    {
      title: 'Quality Summary',
      description:
        'Get a summary of open quality issues in the knowledge base, grouped by type and severity. Use this to understand what content quality problems need attention.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { data: details, error } = await supabase.rpc(
          'get_quality_issue_counts',
        );

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Quality query failed: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        const rows = (details ?? []) as Array<{
          flag_type: string;
          severity: string;
          open_count: number;
        }>;
        const totalOpen = rows.reduce(
          (sum, r) => sum + Number(r.open_count),
          0,
        );
        const byType: Record<string, number> = {};
        for (const r of rows) {
          byType[r.flag_type] =
            (byType[r.flag_type] ?? 0) + Number(r.open_count);
        }

        const summary: QualitySummary = {
          total_open: totalOpen,
          by_type: byType,
          details: rows,
        };
        const markdown = formatQualitySummary(summary);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(summary),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Quality query failed: ${message}. The database function may be temporarily unavailable.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 17. get_coverage_gaps
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_coverage_gaps',
    {
      title: 'Coverage Gaps',
      description:
        'Identify domains and subtopics with zero or thin content coverage. Compares the full taxonomy against actual content items to find gaps. Use this to understand where the knowledge base needs more content. Returns empty subtopics (0 items), thin subtopics (below threshold), and optionally subtopics where all items are stale or expired.',
      inputSchema: {
        min_items: z
          .number()
          .optional()
          .describe(
            'Threshold below which a subtopic is considered "thin" (default: 3)',
          ),
        include_stale: z
          .boolean()
          .optional()
          .describe(
            'Whether to flag subtopics where all items are stale/expired (default: true)',
          ),
        use_targets: z
          .boolean()
          .optional()
          .describe(
            'Use coverage_targets item_count to recalibrate thin thresholds per domain (default: true)',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const defaultMinItems = args.min_items ?? 3;
        const includeStale = args.include_stale ?? true;
        const useTargets = args.use_targets ?? true;

        // Fetch full taxonomy
        const domains = await sb(
          supabase
            .from('taxonomy_domains')
            .select('id, name, display_order')
            .order('display_order'),
          'mcp.quality.taxonomy_domains',
        );

        const subtopics = await sb(
          supabase
            .from('taxonomy_subtopics')
            .select('id, name, domain_id, display_order')
            .order('display_order'),
          'mcp.quality.taxonomy_subtopics',
        );

        // Fetch content items grouped by domain + subtopic
        const items = await sb(
          supabase
            .from('content_items')
            .select('primary_domain, primary_subtopic, freshness'),
          'mcp.quality.content_items_for_coverage',
        );

        // Build domain ID-to-name map
        const domainMap = new Map<string, string>();
        for (const d of (domains ?? []) as Array<{
          id: string;
          name: string;
        }>) {
          domainMap.set(d.id, d.name);
        }

        // Fetch coverage targets for item_count to recalibrate thin thresholds
        const domainTargetMinItems = new Map<string, number>();
        if (useTargets) {
          const targetRows = await sb(
            supabase
              .from('coverage_targets')
              .select('domain_id, metric_name, target_value')
              .eq('metric_name', 'item_count'),
            'mcp.quality.coverage_targets_item_count',
          );

          for (const row of (targetRows ?? []) as Array<{
            domain_id: string;
            metric_name: string;
            target_value: number;
          }>) {
            const domName = domainMap.get(row.domain_id);
            if (domName) {
              // Use target item_count as the thin threshold for this domain
              domainTargetMinItems.set(domName, row.target_value);
            }
          }
        }

        // Count items per domain+subtopic
        type ItemRow = {
          primary_domain: string | null;
          primary_subtopic: string | null;
          freshness: string | null;
        };
        const countMap = new Map<
          string,
          { total: number; stale: number; expired: number }
        >();
        for (const item of (items ?? []) as ItemRow[]) {
          if (!item.primary_domain || !item.primary_subtopic) continue;
          const key = `${item.primary_domain}|${item.primary_subtopic}`;
          const existing = countMap.get(key) ?? {
            total: 0,
            stale: 0,
            expired: 0,
          };
          existing.total++;
          if (item.freshness === 'stale') existing.stale++;
          if (item.freshness === 'expired') existing.expired++;
          countMap.set(key, existing);
        }

        // Analyse gaps
        const emptySubtopics: Array<{ domain: string; subtopic: string }> = [];
        const thinSubtopics: Array<{
          domain: string;
          subtopic: string;
          item_count: number;
        }> = [];
        const staleOnlySubtopics: Array<{
          domain: string;
          subtopic: string;
          stale_count: number;
          expired_count: number;
        }> = [];

        for (const st of (subtopics ?? []) as Array<{
          id: string;
          name: string;
          domain_id: string;
        }>) {
          const domainName = domainMap.get(st.domain_id);
          if (!domainName) continue;

          // Use domain-specific target threshold if available, otherwise default
          const minItems =
            domainTargetMinItems.get(domainName) ?? defaultMinItems;

          const key = `${domainName}|${st.name}`;
          const counts = countMap.get(key);

          if (!counts || counts.total === 0) {
            emptySubtopics.push({ domain: domainName, subtopic: st.name });
          } else if (counts.total < minItems) {
            thinSubtopics.push({
              domain: domainName,
              subtopic: st.name,
              item_count: counts.total,
            });
          }

          // Check stale-only (all items are stale or expired)
          if (includeStale && counts && counts.total > 0) {
            if (counts.stale + counts.expired === counts.total) {
              staleOnlySubtopics.push({
                domain: domainName,
                subtopic: st.name,
                stale_count: counts.stale,
                expired_count: counts.expired,
              });
            }
          }
        }

        const result: CoverageGapResult = {
          total_gaps:
            emptySubtopics.length +
            thinSubtopics.length +
            staleOnlySubtopics.length,
          empty_subtopics: emptySubtopics,
          thin_subtopics: thinSubtopics,
          stale_only_subtopics: staleOnlySubtopics,
        };

        const markdown = truncateResponse(formatCoverageGaps(result));
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
              text: `Coverage gap analysis failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 18. audit_content
  // -------------------------------------------------------------------------
  server.registerTool(
    'audit_content',
    {
      title: 'Audit Content',
      description:
        'Find content items with quality issues: thin content (under 20 chars), brief content (under 200-500 chars depending on content type), low classification confidence (under 60%), missing AI summary, missing keywords, no domain assigned, or stale/expired freshness. Use this to identify items that need attention. Filter by issue type or domain for targeted audits. Note: scans up to 500 items — for larger knowledge bases, use the domain filter to target specific areas.',
      inputSchema: {
        issue_type: z
          .enum([
            'thin_content',
            'low_confidence',
            'missing_summary',
            'missing_keywords',
            'no_domain',
            'stale',
            'brief_content',
          ])
          .optional()
          .describe('Filter to a specific issue type (default: all issues)'),
        domain: z
          .string()
          .optional()
          .describe('Filter to a specific domain (exact match)'),
        limit: z
          .number()
          .optional()
          .describe('Maximum items to return (default: 25, max: 100)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const auditLimit = Math.min(args.limit ?? 25, 100);

        // Fetch audit data via RPC — returns char_length(content) instead of
        // the full content body, avoiding megabytes of unnecessary transfer.
        const { data: rows, error } = await supabase.rpc(
          'get_audit_content_items',
          {
            p_domain: args.domain ?? undefined,
            p_limit: 500,
          },
        );

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Audit query failed: ${error.message}.`,
              },
            ],
            isError: true,
          };
        }

        // Categorise issues for each item
        type Row = {
          id: string;
          title: string | null;
          suggested_title: string | null;
          content_type: string | null;
          primary_domain: string | null;
          content_length: number;
          summary: string | null;
          ai_keywords: string[] | null;
          classification_confidence: number | null;
          freshness: string | null;
        };

        const auditItems: AuditItem[] = [];
        const byIssueType: Record<string, number> = {};

        for (const row of (rows ?? []) as Row[]) {
          const issues: string[] = [];
          const contentLen = row.content_length ?? 0;

          if (contentLen < 20) {
            issues.push('thin_content');
          } else {
            // brief_content: content-type-aware minimum length
            const briefThreshold = (() => {
              switch (row.content_type) {
                case 'article':
                case 'blog':
                case 'research':
                  return 500;
                case 'policy':
                case 'compliance':
                case 'certification':
                  return 300;
                default:
                  return 200;
              }
            })();
            if (contentLen < briefThreshold) {
              issues.push('brief_content');
            }
          }
          if (
            row.classification_confidence !== null &&
            row.classification_confidence < 0.6
          )
            issues.push('low_confidence');
          if (!row.summary) issues.push('missing_summary');
          if (!row.ai_keywords || row.ai_keywords.length === 0)
            issues.push('missing_keywords');
          if (!row.primary_domain) issues.push('no_domain');
          if (row.freshness === 'stale' || row.freshness === 'expired')
            issues.push('stale');

          // Filter by specific issue type if requested
          if (args.issue_type && !issues.includes(args.issue_type)) continue;

          if (issues.length > 0) {
            for (const issue of issues) {
              byIssueType[issue] = (byIssueType[issue] ?? 0) + 1;
            }
            auditItems.push({
              id: row.id,
              title: row.title,
              suggested_title: row.suggested_title,
              content_type: row.content_type,
              primary_domain: row.primary_domain,
              issues,
              content_length: contentLen,
              classification_confidence: row.classification_confidence,
              freshness: row.freshness,
            });
          }
        }

        // Apply limit
        const limited = auditItems.slice(0, auditLimit);

        const result: AuditResult = {
          total_flagged: auditItems.length,
          by_issue_type: byIssueType,
          items: limited,
        };

        const markdown = truncateResponse(formatAuditResult(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            { type: 'text' as const, text: `Audit failed: ${message}.` },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 26. find_all_duplicates (Read tool — all roles)
  // -------------------------------------------------------------------------
  server.registerTool(
    'find_all_duplicates',
    {
      title: 'Find All Duplicate Content',
      description:
        'Scan the entire knowledge base for duplicate pairs using high-similarity vector matching. Returns potential duplicates sorted by similarity. Use domain filter to target specific areas. Excludes archived items. Above 95% similarity is flagged as LIKELY DUPLICATE.',
      inputSchema: {
        threshold: z
          .number()
          .min(0.7)
          .max(0.99)
          .optional()
          .describe('Similarity threshold (default: 0.95)'),
        domain: z.string().optional().describe('Filter by primary domain'),
        limit: z
          .number()
          .optional()
          .transform((v) => (v != null ? Math.max(1, Math.min(200, v)) : v))
          .describe('Maximum pairs to return (default: 50, max: 200)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const threshold = args.threshold ?? 0.95;
        const limit = args.limit ?? 50;
        const domain = args.domain || undefined;

        const { data: pairs, error } = await supabase.rpc(
          'find_duplicate_pairs',
          {
            similarity_threshold: threshold,
            p_domain: domain,
            limit_count: limit,
          },
        );

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Duplicate scan failed: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        const result: DuplicatePairsResult = {
          count: (pairs ?? []).length,
          threshold,
          domain_filter: args.domain || undefined,
          pairs: (pairs ?? []).map((p: Record<string, unknown>) => ({
            item_a: {
              id: p.id1 as string,
              title: (p.title1 as string) ?? 'Untitled',
              content_type: (p.type1 as string | null) ?? null,
              domain: (p.domain1 as string | null) ?? null,
            },
            item_b: {
              id: p.id2 as string,
              title: (p.title2 as string) ?? 'Untitled',
              content_type: (p.type2 as string | null) ?? null,
              domain: (p.domain2 as string | null) ?? null,
            },
            similarity: p.similarity as number,
          })),
        };

        const markdown = truncateResponse(formatDuplicatePairs(result));
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
              text: `Duplicate scan failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 31. suggest_content_creation
  // -------------------------------------------------------------------------
  server.registerTool(
    'suggest_content_creation',
    {
      title: 'Suggest Content to Create',
      description:
        'Analyse coverage gaps and suggest specific content to create. Returns prioritised suggestions based on empty subtopics, thin coverage, stale content, and template gaps. Use this to identify what content the knowledge base most needs.',
      inputSchema: {
        domain: z
          .string()
          .optional()
          .describe('Filter suggestions to a specific domain'),
        limit: z
          .number()
          .optional()
          .transform((v) => (v != null ? Math.max(1, Math.min(20, v)) : v))
          .describe('Maximum suggestions to return (default: 10)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { generateContentSuggestions } =
          await import('@/lib/content/content-suggestions');

        const suggestions = await generateContentSuggestions({
          supabase,
          maxSuggestions: args.limit ?? 10,
          domainFilter: args.domain || undefined,
          includeTemplateGaps: true,
        });

        if (suggestions.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '# Content Suggestions\n\nNo content gaps found. The knowledge base has good coverage across all taxonomy subtopics.',
              },
            ],
            structuredContent: toStructuredContent({
              suggestions: [],
              count: 0,
            }),
          };
        }

        // Format as Markdown
        const lines: string[] = [
          '# Content Suggestions',
          '',
          `Found **${suggestions.length}** content creation ${suggestions.length === 1 ? 'opportunity' : 'opportunities'}:`,
          '',
        ];

        for (let i = 0; i < suggestions.length; i++) {
          const s = suggestions[i];
          lines.push(`## ${i + 1}. ${s.title}`);
          lines.push(`**Domain:** ${s.domain} > ${s.subtopic}`);
          lines.push(
            `**Priority:** ${s.priority} | **Type:** ${s.suggestion_type.replace(/_/g, ' ')}`,
          );
          if (s.suggested_content_type) {
            lines.push(
              `**Suggested content type:** ${s.suggested_content_type}`,
            );
          }
          if (s.related_template) {
            lines.push(`**Related template:** ${s.related_template}`);
          }
          lines.push(`**Current items:** ${s.item_count}`);
          if (s.freshness_breakdown) {
            const fb = s.freshness_breakdown;
            lines.push(
              `**Freshness:** ${fb.fresh} fresh, ${fb.aging} aging, ${fb.stale} stale, ${fb.expired} expired`,
            );
          }
          lines.push('');
          lines.push(s.description);
          lines.push('');
        }

        const markdown = truncateResponse(lines.join('\n'));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            suggestions,
            count: suggestions.length,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Content suggestion analysis failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 36. get_quality_briefing
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_quality_briefing',
    {
      title: 'Quality Briefing',
      description:
        'Get an aggregated quality intelligence briefing covering below-threshold items, score drops, freshness transitions, quality flags, coverage alerts, and certification warnings. Supports optional domain filter and quality threshold override. Use this for proactive quality monitoring.',
      inputSchema: {
        domain: z
          .string()
          .optional()
          .describe(
            'Filter to a specific domain (exact match on primary_domain)',
          ),
        threshold: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            'Override quality score threshold (default: from governance_config, fallback 40)',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { fetchQualityBriefingData } =
          await import('@/lib/mcp/tools/shared');
        const { formatQualityBriefing } =
          await import('@/lib/mcp/formatters/briefing');

        const briefingData = await fetchQualityBriefingData(supabase, {
          domain: args.domain || undefined,
          threshold: args.threshold ?? undefined,
        });

        const markdown = truncateResponse(formatQualityBriefing(briefingData));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(briefingData),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Quality briefing failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // 37. get_quality_actions
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_quality_actions',
    {
      title: 'Quality Improvement Actions',
      description:
        'Get prioritised, actionable quality improvement suggestions for existing content items. Analyses items below the quality threshold and identifies specific deficiencies: stale freshness, low classification confidence, missing summaries, incomplete depth layers, and zero citations. Use this to understand what existing content needs attention and how to improve quality scores.',
      inputSchema: {
        domain: z.string().optional().describe('Filter to a specific domain'),
        limit: z
          .number()
          .optional()
          .transform((v) => (v != null ? Math.max(1, Math.min(50, v)) : v))
          .describe('Maximum actions to return (default: 15)'),
        score_threshold: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe(
            'Override quality threshold (default: from governance config or 40)',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { getTopQualityActions } =
          await import('@/lib/quality/quality-actions');

        const result = await getTopQualityActions(supabase, {
          domain: args.domain || undefined,
          limit: args.limit ?? 15,
          scoreThreshold: args.score_threshold ?? undefined,
        });

        const markdown = truncateResponse(formatQualityActions(result));
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
              text: `Quality actions analysis failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
