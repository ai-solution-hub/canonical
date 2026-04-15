/**
 * Governance and lifecycle tool registrations (2 tools):
 *  25. delete_content_item
 *  30. update_governance_status
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createMcpClient,
  getMcpUserId,
  getMcpUserRole,
  checkMcpRole,
} from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import {
  formatDeleteContent,
  formatGovernanceStatusUpdate,
} from '@/lib/mcp/formatters';
import type {
  DeleteContentResult,
  GovernanceStatusItemResult,
  GovernanceStatusUpdateResult,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateEmbedding,
  defineTool,
  DESTRUCTIVE_WRITE_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
} from './shared';

export async function registerGovernanceTools(
  server: McpServer,
): Promise<void> {
  // -------------------------------------------------------------------------
  // 25. delete_content_item (Write tool — editor+ only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'delete_content_item',
    {
      title: 'Delete or Archive Content Item',
      description:
        'Archive or permanently delete a content item. Use "archive" (soft-delete) to hide it from search and analytics while preserving history. Use "delete" (hard-delete) to permanently remove the item and its history — only for mistakes or GDPR requests. Archive requires editor role; delete requires admin role.',
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to archive/delete'),
        mode: z
          .enum(['archive', 'delete'])
          .describe('Type of deletion: archive (soft) or delete (hard)'),
        reason: z
          .string()
          .describe('Explanation for the deletion (stored in audit trail)'),
      },
      annotations: DESTRUCTIVE_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const role = await getMcpUserRole(extra.authInfo!);

        // Permission check
        if (args.mode === 'delete') {
          if (role !== 'admin') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Hard-delete requires admin role.',
                },
              ],
              isError: true,
            };
          }
        } else {
          // Archive requires editor or admin
          if (role !== 'admin' && role !== 'editor') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Archive requires editor or admin role.',
                },
              ],
              isError: true,
            };
          }
        }

        // Fetch item first for audit logging
        const { data: item, error: fetchError } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content, brief, detail, reference, metadata, archived_at',
          )
          .eq('id', args.id)
          .single();

        if (fetchError || !item) {
          return {
            content: [
              { type: 'text' as const, text: `Item not found: ${args.id}` },
            ],
            isError: true,
          };
        }

        const displayTitle = item.title || item.suggested_title || 'Untitled';

        // Check if already archived
        if (args.mode === 'archive' && item.archived_at) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item "${displayTitle}" (${args.id}) is already archived.`,
              },
            ],
          };
        }

        if (args.mode === 'archive') {
          // Get latest version
          const history = await sb(
            supabase
              .from('content_history')
              .select('version')
              .eq('content_item_id', args.id)
              .order('version', { ascending: false })
              .limit(1),
            'mcp.governance.history_latest_version_archive',
          );

          const nextVersion = (history?.[0]?.version ?? 0) + 1;

          // Archive logic
          const { error: updateError } = await supabase
            .from('content_items')
            .update({
              archived_at: new Date().toISOString(),
              archived_by: userId,
              archive_reason: args.reason,
            })
            .eq('id', args.id);

          if (updateError) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Archive failed: ${updateError.message}`,
                },
              ],
              isError: true,
            };
          }

          // Record history for archive
          await supabase.from('content_history').insert({
            content_item_id: args.id,
            version: nextVersion,
            title: item.title || item.suggested_title || 'Untitled',
            content: item.content || '',
            brief: item.brief,
            detail: item.detail,
            reference: item.reference,
            metadata: item.metadata,
            change_type: 'archive',
            change_summary: `Item archived: ${args.reason || 'No reason provided'}`,
            // S152B WP3 / S153: canonical archive reason.
            change_reason: 'archive',
            created_by: userId,
          });

          const result: DeleteContentResult = {
            id: args.id,
            title: displayTitle,
            mode: 'archive',
            reason: args.reason,
            archived_at: new Date().toISOString(),
          };

          const markdown = formatDeleteContent(result);
          return {
            content: [{ type: 'text' as const, text: markdown }],
            structuredContent: toStructuredContent(result),
          };
        } else {
          // Hard Delete: Record history before deletion (preserved via ON DELETE SET NULL)
          const history = await sb(
            supabase
              .from('content_history')
              .select('version')
              .eq('content_item_id', args.id)
              .order('version', { ascending: false })
              .limit(1),
            'mcp.governance.history_latest_version_delete',
          );

          const nextVersion = (history?.[0]?.version ?? 0) + 1;

          await supabase.from('content_history').insert({
            content_item_id: args.id,
            version: nextVersion,
            title: item.title || item.suggested_title || 'Untitled',
            content: item.content || '',
            brief: item.brief,
            detail: item.detail,
            reference: item.reference,
            metadata: item.metadata,
            change_type: 'delete',
            change_summary: `Item hard-deleted: ${args.reason}`,
            // S152B WP3 / S153: canonical hard_delete reason (note: the row
            // will be preserved via ON DELETE SET NULL after content_items
            // delete, so the reason survives the deletion).
            change_reason: 'hard_delete',
            created_by: userId,
          });

          // Delete logic (hard delete)
          const { error: deleteError } = await supabase
            .from('content_items')
            .delete()
            .eq('id', args.id);

          if (deleteError) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Delete failed: ${deleteError.message}`,
                },
              ],
              isError: true,
            };
          }

          const result: DeleteContentResult = {
            id: args.id,
            title: displayTitle,
            mode: 'delete',
            reason: args.reason,
          };

          const markdown = formatDeleteContent(result);
          return {
            content: [{ type: 'text' as const, text: markdown }],
            structuredContent: toStructuredContent(result),
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            { type: 'text' as const, text: `Operation failed: ${message}.` },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 30. update_governance_status (write tool — editor+ only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'update_governance_status',
    {
      title: 'Update Governance Status',
      description:
        'Batch publish or draft content items. Use "publish" to move draft items into the live knowledge base (generates embeddings and clears governance_review_status). Use "draft" to pull live items back to draft status. Publishing generates embeddings synchronously before making items searchable — items that fail embedding are reported but do not block other items. Requires editor or admin role.',
      inputSchema: {
        item_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe('UUIDs of content items to update (1–50)'),
        status: z
          .enum(['publish', 'draft'])
          .describe(
            'Target status: "publish" makes items live and searchable, "draft" hides them from search',
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
        const items: GovernanceStatusItemResult[] = [];

        // Fetch all items in one query
        const { data: rows, error: fetchError } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content, governance_review_status',
          )
          .in('id', args.item_ids);

        if (fetchError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch items: ${fetchError.message}`,
              },
            ],
            isError: true,
          };
        }

        const rowMap = new Map(
          (
            (rows ?? []) as Array<{
              id: string;
              title: string | null;
              suggested_title: string | null;
              content: string | null;
              governance_review_status: string | null;
            }>
          ).map((r) => [r.id, r]),
        );

        // Process each item
        for (const itemId of args.item_ids) {
          const row = rowMap.get(itemId);
          const displayTitle = row?.title || row?.suggested_title || 'Untitled';

          if (!row) {
            items.push({
              id: itemId,
              title: 'Not found',
              success: false,
              error: 'Item not found',
            });
            continue;
          }

          try {
            if (args.status === 'publish') {
              // CRITICAL: embed-then-commit ordering
              // Generate embedding BEFORE clearing governance_review_status
              // to prevent items appearing in search without embeddings
              let embedding: number[] | null = null;
              try {
                const generateEmbedding = await getGenerateEmbedding();
                const textForEmbedding =
                  (row.title || row.suggested_title || '') +
                  ' ' +
                  (row.content ?? '').slice(0, 5000);
                embedding = await generateEmbedding(textForEmbedding);
              } catch (embErr) {
                const embMsg =
                  embErr instanceof Error
                    ? embErr.message
                    : 'Unknown embedding error';
                items.push({
                  id: itemId,
                  title: displayTitle,
                  success: false,
                  error: `Embedding failed: ${embMsg}`,
                });
                continue;
              }

              // Update: set embedding and clear governance_review_status in one operation
              const { error: updateError } = await supabase
                .from('content_items')
                .update({
                  embedding: JSON.stringify(embedding),
                  governance_review_status: null,
                  updated_by: userId,
                } satisfies Database['public']['Tables']['content_items']['Update'])
                .eq('id', itemId);

              if (updateError) {
                items.push({
                  id: itemId,
                  title: displayTitle,
                  success: false,
                  error: updateError.message,
                });
                continue;
              }
            } else {
              // Draft: set governance_review_status to 'draft'
              const { error: updateError } = await supabase
                .from('content_items')
                .update({
                  governance_review_status: 'draft',
                  updated_by: userId,
                } satisfies Database['public']['Tables']['content_items']['Update'])
                .eq('id', itemId);

              if (updateError) {
                items.push({
                  id: itemId,
                  title: displayTitle,
                  success: false,
                  error: updateError.message,
                });
                continue;
              }
            }

            // Record content_history entry
            const history = await sb(
              supabase
                .from('content_history')
                .select('version')
                .eq('content_item_id', itemId)
                .order('version', { ascending: false })
                .limit(1),
              'mcp.governance.history_latest_version_status',
            );

            const nextVersion = (history?.[0]?.version ?? 0) + 1;
            const changeType = args.status === 'publish' ? 'publish' : 'draft';

            await supabase.from('content_history').insert({
              content_item_id: itemId,
              version: nextVersion,
              title: displayTitle,
              content: row.content || '',
              change_type: changeType,
              change_summary:
                args.status === 'publish'
                  ? 'Item published from draft to live'
                  : 'Item moved to draft status',
              // S152B WP3 / S153: canonical status_change reason (draft/publish
              // via the MCP governance set_status tool).
              change_reason: `status_change_${args.status}`,
              created_by: userId,
            });

            items.push({ id: itemId, title: displayTitle, success: true });
          } catch (itemErr) {
            const msg =
              itemErr instanceof Error ? itemErr.message : 'Unknown error';
            items.push({
              id: itemId,
              title: displayTitle,
              success: false,
              error: msg,
            });
          }
        }

        const succeeded = items.filter((i) => i.success).length;
        const failed = items.filter((i) => !i.success).length;

        const result: GovernanceStatusUpdateResult = {
          action: args.status,
          total: args.item_ids.length,
          succeeded,
          failed,
          items,
        };

        const markdown = formatGovernanceStatusUpdate(result);
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
              text: `Governance status update failed: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
