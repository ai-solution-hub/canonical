/**
 * Intelligence tool registrations (2 tools):
 *   get_intelligence_summary
 *   trigger_intelligence_poll
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, checkMcpRole } from '@/lib/mcp/auth';
import {
  formatIntelligenceSummary,
  truncateResponse,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
  NON_IDEMPOTENT_OPEN_WORLD_WRITE_ANNOTATIONS,
} from './shared';

export async function registerIntelligenceTools(
  server: McpServer,
): Promise<void> {
  // -------------------------------------------------------------------------
  // get_intelligence_summary
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_intelligence_summary',
    {
      title: 'Get Intelligence Summary',
      description:
        'Get an aggregated summary of sector intelligence for a workspace. Shows ingestion totals, filter ratios, category and source breakdowns, top articles by relevance score, and unresolved flag counts. Only works for workspaces with type "intelligence".',
      inputSchema: {
        workspace_id: z
          .string()
          .uuid()
          .describe('The intelligence workspace UUID'),
        period: z
          .enum(['7d', '14d', '30d', '90d'])
          .optional()
          .describe('Time period (default: "7d")'),
        limit: z
          .number()
          .optional()
          .describe('Maximum top articles (default: 10, max: 25)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const articleLimit = Math.min(args.limit ?? 10, 25);

        // Lazy import to avoid cold start crashes
        const { fetchIntelligenceSummary } = await import(
          '@/lib/intelligence/summary'
        );

        const data = await fetchIntelligenceSummary(
          supabase,
          args.workspace_id,
          args.period ?? '7d',
          articleLimit,
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
              text: `Intelligence summary failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // trigger_intelligence_poll (admin-only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'trigger_intelligence_poll',
    {
      title: 'Trigger Intelligence Poll',
      description:
        'Manually trigger the sector intelligence pipeline to poll all due RSS sources, score new articles, and update workspace feeds. Admin-only — returns the pipeline run summary including sources processed, articles found, and filter results. Use when a user wants to refresh intelligence data immediately rather than waiting for the scheduled cron. The pipeline always processes all due sources across all workspaces.',
      inputSchema: {},
      annotations: NON_IDEMPOTENT_OPEN_WORLD_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        // Admin-only gate
        const role = await checkMcpRole(extra.authInfo, ['admin']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: admin role required to trigger intelligence polls.',
              },
            ],
            isError: true,
          };
        }

        // Lazy import to avoid cold start crashes
        const { createServiceClient } = await import(
          '@/lib/supabase/server'
        );
        const { runPipeline } = await import('@/lib/intelligence/pipeline');

        const supabase = createServiceClient();
        const result = await runPipeline(supabase);

        const markdown = [
          '## Intelligence Poll Triggered',
          '',
          `**Run ID:** ${result.runId}`,
          `**Started:** ${result.startedAt}`,
          `**Completed:** ${result.completedAt}`,
          `**Sources processed:** ${result.sourcesProcessed}`,
          `**Articles found:** ${result.totalArticlesFound}`,
          `**New articles:** ${result.totalArticlesNew}`,
          `**Passed filter:** ${result.totalArticlesPassed}`,
          ...(result.errors.length > 0
            ? [
                '',
                '### Errors',
                ...result.errors.map((e) => `- ${e}`),
              ]
            : []),
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            run_id: result.runId,
            started_at: result.startedAt,
            completed_at: result.completedAt,
            sources_processed: result.sourcesProcessed,
            total_articles_found: result.totalArticlesFound,
            total_articles_new: result.totalArticlesNew,
            total_articles_passed: result.totalArticlesPassed,
            errors: result.errors,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Intelligence poll failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
