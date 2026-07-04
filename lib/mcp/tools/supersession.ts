/**
 * Supersession MCP tool (S186 WP-B.4).
 *
 *  supersede_content_item — admin-only. Marks one content item as
 *  superseded by a newer one. Wraps the shared `setSupersession` helper
 *  so all three surfaces (UI / MCP / Python ingest) share one code path.
 *
 * Spec: docs/specs/supersession-model-spec.md §6
 * Plan: docs/plans/supersession-model-plan.md §B.4
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, getMcpUserRole } from '@/lib/mcp/auth';
import { setSupersession, SupersessionError } from '@/lib/supersession/set';
import { SupabaseError } from '@/lib/supabase/safe';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  DESTRUCTIVE_WRITE_ANNOTATIONS,
} from './shared';

// ID-131.37 F1 (owner S446 ruling): setSupersession now operates on
// q_a_pairs (id-120 archived model) rather than content_items, so this
// tool's row view follows — `question_text` replaces the retired `title`,
// `publication_status` replaces the retired `dedup_status`.
interface SupersessionRowView {
  id: string;
  question_text: string;
  superseded_by: string | null;
  publication_status: string;
}

interface SupersedeToolResult {
  old_item: SupersessionRowView;
  new_item: SupersessionRowView;
}

function formatSupersedeResult(result: SupersedeToolResult): string {
  const oldQuestion = result.old_item.question_text || '(no question text)';
  const newQuestion = result.new_item.question_text || '(no question text)';
  return [
    '**Supersession recorded.**',
    '',
    `* Old item (hidden from default search): ${oldQuestion}`,
    `  * \`${result.old_item.id}\``,
    `  * publication_status: ${result.old_item.publication_status}`,
    `  * superseded_by: ${result.old_item.superseded_by ?? '(none)'}`,
    '',
    `* New item (current): ${newQuestion}`,
    `  * \`${result.new_item.id}\``,
    `  * publication_status: ${result.new_item.publication_status}`,
  ].join('\n');
}

export async function registerSupersessionTools(
  server: McpServer,
): Promise<void> {
  defineTool(
    server,
    'supersede_content_item',
    {
      title: 'Mark Content Item Superseded',
      description:
        'Mark an existing content item as superseded by a newer item. ' +
        'The superseded (old) row is hidden from default search results; ' +
        'the new row remains current. Admin-only. Validates both IDs ' +
        'exist, are distinct, and that neither row is already part of a ' +
        'supersession chain. Direct ID lookup still returns the old row ' +
        'so existing links remain resolvable.',
      inputSchema: {
        old_id: z
          .string()
          .uuid()
          .describe(
            'UUID of the existing content item being retired. After this ' +
              'call its superseded_by will point at new_id and its ' +
              'publication_status will be "archived".',
          ),
        new_id: z
          .string()
          .uuid()
          .describe(
            'UUID of the newer content item that replaces old_id. Its ' +
              'own row is not modified.',
          ),
      },
      annotations: DESTRUCTIVE_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await getMcpUserRole(extra.authInfo!);
        if (role !== 'admin') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'supersede_content_item requires admin role.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const actorUserId = getMcpUserId(extra.authInfo);

        const { oldItem, newItem } = await setSupersession(
          {
            oldId: args.old_id,
            newId: args.new_id,
            actorUserId,
          },
          supabase,
        );

        const result: SupersedeToolResult = {
          old_item: oldItem,
          new_item: newItem,
        };

        return {
          content: [
            { type: 'text' as const, text: formatSupersedeResult(result) },
          ],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        if (err instanceof SupersessionError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot supersede: ${err.message}`,
              },
            ],
            isError: true,
            structuredContent: toStructuredContent({
              error_code: err.code,
              error_context: err.context ?? {},
            }),
          };
        }
        if (err instanceof SupabaseError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Supersession failed: ${err.message}`,
              },
            ],
            isError: true,
          };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unexpected error during supersession: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
