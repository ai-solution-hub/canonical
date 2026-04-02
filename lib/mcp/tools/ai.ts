/**
 * AI tool registrations (2 tools):
 *  10. classify_content
 *  11. generate_summary
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import {
  formatClassification,
  formatSummaryResult,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getClassifyContent,
  getGenerateSummary,
  getAIErrors,
} from './shared';

export async function registerAITools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 10. classify_content (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'classify_content',
    {
      title: 'Classify Content',
      description:
        'Trigger AI classification of a content item. Assigns domain, subtopic, keywords, summary, and a suggested title. Requires editor or admin role.',
      inputSchema: {
        item_id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to classify'),
        force: z
          .boolean()
          .optional()
          .describe('Re-classify even if already classified (default: false)'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
        const classifyContent = await getClassifyContent();
        const result = await classifyContent({
          supabase,
          itemId: args.item_id,
          force: args.force ?? false,
          userId,
        });

        const markdown = formatClassification(result);
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
        return {
          content: [
            {
              type: 'text' as const,
              text: `Classification failed: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 11. generate_summary (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
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
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
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
