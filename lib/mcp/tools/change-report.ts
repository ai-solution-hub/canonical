/**
 * Change report tool registration (1 tool):
 *   get_change_report
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, checkMcpRole } from '@/lib/mcp/auth';
import {
  formatChangeReport,
  truncateResponse,
  type ChangeReportItem,
  type ChangeReportData,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerChangeReportTools(
  server: McpServer,
): Promise<void> {
  // -------------------------------------------------------------------------
  // get_change_report
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_change_report',
    {
      title: 'Get Change Report',
      description:
        'Summarise content additions, updates, and removals over a recent period. ' +
        'Optionally filter by domain or keywords. Used by the daily-briefing and ' +
        'sector-briefing workflows to surface what changed in the knowledge base. ' +
        'Example: get_change_report({ period_days: 7 })',
      inputSchema: {
        period_days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(7)
          .describe('Look-back window in days (1-90, default 7)'),
        domain: z
          .string()
          .optional()
          .describe('Optional primary_domain filter'),
        keywords: z
          .array(z.string())
          .optional()
          .describe('Optional keyword filter — matches title via ILIKE'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        // Editor+ role gate
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required for change reports.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const periodDays = args.period_days ?? 7;

        // Compute the cutoff timestamp
        const now = new Date();
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - periodDays);
        const cutoffISO = cutoff.toISOString();

        // Build keyword ILIKE filter for PostgREST .or() syntax. Strip
        // comma + parenthesis + backslash from each keyword — they are
        // PostgREST metacharacters and would break the .or() filter string.
        // (Real-world keywords rarely contain these, but defend in depth.)
        const sanitiseKeyword = (kw: string) =>
          kw.replace(/[,()\\]/g, '').trim();
        const keywordOrFilter =
          args.keywords && args.keywords.length > 0
            ? args.keywords
                .map(sanitiseKeyword)
                .filter((kw) => kw.length > 0)
                .map((kw) => `title.ilike.%${kw}%`)
                .join(',') || null
            : null;

        // ----- Additions: created within window, not archived -----
        let additionsQuery = supabase
          .from('content_items')
          .select('id, title, primary_domain, content_type, created_at')
          .gte('created_at', cutoffISO)
          .is('archived_at', null)
          .order('created_at', { ascending: false })
          .limit(100);

        if (args.domain) {
          additionsQuery = additionsQuery.eq('primary_domain', args.domain);
        }
        if (keywordOrFilter) {
          additionsQuery = additionsQuery.or(keywordOrFilter);
        }

        // ----- Updates: updated within window but created before it, not archived -----
        let updatesQuery = supabase
          .from('content_items')
          .select('id, title, primary_domain, content_type, updated_at')
          .gte('updated_at', cutoffISO)
          .lt('created_at', cutoffISO)
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
          .limit(100);

        if (args.domain) {
          updatesQuery = updatesQuery.eq('primary_domain', args.domain);
        }
        if (keywordOrFilter) {
          updatesQuery = updatesQuery.or(keywordOrFilter);
        }

        // ----- Removals: archived within window -----
        let removalsQuery = supabase
          .from('content_items')
          .select('id, title, primary_domain, content_type, archived_at')
          .gte('archived_at', cutoffISO)
          .order('archived_at', { ascending: false })
          .limit(100);

        if (args.domain) {
          removalsQuery = removalsQuery.eq('primary_domain', args.domain);
        }
        if (keywordOrFilter) {
          removalsQuery = removalsQuery.or(keywordOrFilter);
        }

        // Execute all three queries in parallel
        const [additionsResult, updatesResult, removalsResult] =
          await Promise.all([additionsQuery, updatesQuery, removalsQuery]);

        // Surface DB errors explicitly — the `?? []` fallback below would
        // otherwise mask a DB failure as "no changes in this period".
        const queryErrors = [
          additionsResult.error &&
            `additions: ${additionsResult.error.message}`,
          updatesResult.error && `updates: ${updatesResult.error.message}`,
          removalsResult.error && `removals: ${removalsResult.error.message}`,
        ].filter(Boolean);
        if (queryErrors.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Change report query failed — ${queryErrors.join('; ')}`,
              },
            ],
            isError: true,
          };
        }

        // Map results to ChangeReportItem arrays
        const additions: ChangeReportItem[] = (additionsResult.data ?? [])
          // Post-types-regen (S186 WP-B.7): explicit row annotations here
          // drifted from the generated query types. Drop them and let TS
          // infer from the Supabase query builder — the mapper body only
          // reads id/title/primary_domain/content_type/<date> which all
          // exist.
          .map((row) => ({
            id: row.id,
            title: row.title,
            primary_domain: row.primary_domain,
            content_type: row.content_type,
            date: row.created_at,
          }));

        const updates: ChangeReportItem[] = (updatesResult.data ?? []).map(
          (row) => ({
            id: row.id,
            title: row.title,
            primary_domain: row.primary_domain,
            content_type: row.content_type,
            date: row.updated_at ?? '',
          }),
        );

        const removals: ChangeReportItem[] = (removalsResult.data ?? []).map(
          (row) => ({
            id: row.id,
            title: row.title,
            primary_domain: row.primary_domain,
            content_type: row.content_type,
            date: row.archived_at ?? '',
          }),
        );

        const reportData: ChangeReportData = {
          period_days: periodDays,
          start_date: cutoffISO,
          end_date: now.toISOString(),
          domain: args.domain ?? null,
          keywords: args.keywords ?? null,
          additions: { count: additions.length, items: additions },
          updates: { count: updates.length, items: updates },
          removals: { count: removals.length, items: removals },
        };

        const markdown = truncateResponse(formatChangeReport(reportData));
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
              text: `Change report failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
