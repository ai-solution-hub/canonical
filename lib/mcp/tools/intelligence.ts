/**
 * Intelligence tool registrations (1 tool):
 *   get_intelligence_summary
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import {
  formatIntelligenceSummary,
  truncateResponse,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
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
}
