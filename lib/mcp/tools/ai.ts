/**
 * AI tool registrations (1 tool):
 *  11. generate_summary
 *
 * classify_content retired S531 (id-419): no id-71 contract outcome named
 * it, and the subject-classification axis it triggered is transitional
 * under DR-125. Library-level classification was retired after it, not
 * kept: id-417 / DR-130 deleted `lib/ai/classify.ts` outright along with
 * `getClassifyContent` (see the tombstone in `./shared`), because the
 * governance publish-time auto-classify leg was its only caller.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import { formatSummaryResult } from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateSummary,
  getAIErrors,
  defineTool,
  SAFE_WRITE_ANNOTATIONS,
} from './shared';

export async function registerAITools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 11. generate_summary (write tool — editor+ only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'generate_summary',
    {
      title: 'Generate Summary',
      description:
        'Generate an AI summary for a content item including executive summary, detailed summary, and key takeaways. Requires editor or admin role. If a summary already exists, pass force=true to regenerate it — otherwise the call will return an error.',
      inputSchema: {
        item_id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to summarise'),
        force: z
          .boolean()
          .optional()
          .describe(
            'Regenerate even if a summary already exists. Set to true when you want to refresh an existing summary (default: false)',
          ),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const generateSummary = await getGenerateSummary();
        const result = await generateSummary({
          supabase,
          itemId: args.item_id,
          force: args.force ?? false,
          userId,
        });

        const markdown = formatSummaryResult(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const AIServiceError = await getAIErrors();
        const message =
          err instanceof AIServiceError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        // Provide actionable guidance for common error cases
        const isConflict = err instanceof AIServiceError && err.status === 409;
        const hint = isConflict
          ? ' To regenerate an existing summary, call again with force=true.'
          : ' Ensure you have editor or admin permissions.';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Summary generation failed: ${message}.${hint}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
