/**
 * Governance and lifecycle tool registrations (5 tools):
 *  25. delete_content_item
 *  30. update_governance_status
 *  31. update_publication_status (S202 §5.2 Phase 2 / T7)
 *  get_governance_queue (S180 WP3 / P0-23 A1; widened S202 §5.2 T7)
 *  review_governance_item (S180 WP3 / P0-23 B2)
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createMcpClient,
  getMcpUserId,
  getMcpUserRole,
  checkMcpRole,
} from '@/lib/mcp/auth';
import { sb, tryQuery, isOk } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import {
  formatDeleteContent,
  formatGovernanceQueue,
  formatGovernanceReviewAction,
  formatGovernanceStatusUpdate,
  formatPublicationStatusUpdate,
} from '@/lib/mcp/formatters';
import type {
  DeleteContentResult,
  GovernanceQueueData,
  GovernanceQueueItem,
  GovernanceReviewAction,
  GovernanceReviewActionResult,
  GovernanceStatusItemResult,
  GovernanceStatusUpdateResult,
  PublicationStatusUpdateResult,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateEmbedding,
  getClassifyContent,
  defineTool,
  DESTRUCTIVE_WRITE_ANNOTATIONS,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
} from './shared';
import {
  ALLOWED_REVIEW_INPUT_STATUSES,
  type AllowedReviewInputStatus,
} from '@/lib/governance/review-input-statuses';
import { computeNextReviewDate } from '@/lib/governance/cadence-renewal';
import {
  VALID_PUBLICATION_STATUSES,
  computeAllowedTransitions,
  applyTransitionSideEffects,
  type PublicationStatus,
  type UserRole,
} from '@/lib/governance/publication-transitions';

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
        'Batch publish or draft content items. Use "publish" to move draft items into the live knowledge base (generates embeddings and clears governance_review_status). Use "draft" to pull live items back to draft status (writes publication_status="draft" — S202 §5.2 Phase 2.5 rewire; tool surface unchanged for LLM callers). Publishing generates embeddings synchronously before making items searchable — items that fail embedding are reported but do not block other items. Requires editor or admin role.',
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

        // Fetch all items in one query. `publication_status` is selected so
        // the `'publish'` branch can be row-state-aware (V2-H1 fix): promote
        // `'draft' → 'published'` symmetrically with the T8a `'draft'` rewire,
        // refuse on `'archived'`, no-op for already-published / `'in_review'`.
        const { data: rows, error: fetchError } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content, governance_review_status, publication_status, classified_at',
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
              publication_status: string | null;
              classified_at: string | null;
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
              // V2-H1 fix: row-state-aware publication_status promotion to
              // restore symmetry with the T8a `'draft'` rewire below.
              //   - `'archived'`: refuse — caller must use
              //     `update_publication_status` to un-archive first.
              //   - `'draft'`: promote to `'published'` alongside the
              //     governance_review_status clear (matches T8a draft writer
              //     so publish-then-draft round-trips correctly).
              //   - `'published'` / `'in_review'`: no `publication_status`
                // mutation — clear governance_review_status only (legacy
              //     change-management semantics).
              if (row.publication_status === 'archived') {
                items.push({
                  id: itemId,
                  title: displayTitle,
                  success: false,
                  error:
                    'Cannot publish an archived item; use update_publication_status to restore first.',
                });
                continue;
              }

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

              // Update: set embedding, clear governance_review_status, and
              // (when row is currently `'draft'`) promote
              // publication_status='published'. Conditional spread ensures
              // already-published / in_review rows are NOT touched on
              // publication_status (no-op for those branches).
              const { error: updateError } = await supabase
                .from('content_items')
                .update({
                  embedding: JSON.stringify(embedding),
                  governance_review_status: null,
                  ...(row.publication_status === 'draft' && {
                    publication_status: 'published',
                  }),
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

              // S183 WP1 G2 — first-time publish for draft-created items
              // needs classification + chunks. Drafts bypass the AI pipeline
              // in create_content_item, so an item with classified_at = NULL
              // has no entity_mentions, entity_relationships, summary, or
              // content_chunks. Running now fixes that so the item is fully
              // searchable + richly linked the moment it becomes live.
              // Non-fatal: failures log but do not un-publish.
              //
              // Uses the service client (not the RLS-scoped MCP client) for
              // parity with the API publish path and because classifyContent
              // performs a delete-before-insert on entity_mentions which
              // requires admin RLS — editor-role callers would silently
              // no-op the delete otherwise.
              if (!row.classified_at && row.content) {
                const { createServiceClient } =
                  await import('@/lib/supabase/server');
                const { recordPipelineRun } =
                  await import('@/lib/pipeline/record-run');
                const publishServiceClient = createServiceClient();

                let classifyStatus: 'completed' | 'failed' = 'completed';
                let classifyError: string | null = null;
                try {
                  const classifyContent = await getClassifyContent();
                  await classifyContent({
                    supabase: publishServiceClient,
                    itemId,
                    force: true,
                    userId,
                  });
                } catch (classifyErr) {
                  classifyStatus = 'failed';
                  classifyError =
                    classifyErr instanceof Error
                      ? classifyErr.message
                      : 'Unknown classification error';
                  console.error(
                    `MCP publish classify failed for ${itemId}:`,
                    classifyErr,
                  );
                }
                await recordPipelineRun({
                  supabase: publishServiceClient,
                  pipelineName: 'publish_classify',
                  status: classifyStatus,
                  itemsProcessed: 1,
                  errorMessage: classifyError,
                });

                try {
                  const { regenerateChunks } =
                    await import('@/lib/content/chunk-store');
                  await regenerateChunks(
                    publishServiceClient,
                    itemId,
                    row.content,
                  );
                } catch (chunkErr) {
                  console.error(
                    `MCP publish chunking failed for ${itemId}:`,
                    chunkErr,
                  );
                }
              }
            } else {
              // Draft: set publication_status to 'draft' (S202 §5.2 Phase 2.5
              // rewire — rewired from governance_review_status per spec §6.5).
              // The tool's external 'draft' action verb is unchanged so LLM
              // callers transparently target the new column.
              const { error: updateError } = await supabase
                .from('content_items')
                .update({
                  publication_status: 'draft',
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

  // -------------------------------------------------------------------------
  // 31. update_publication_status (write tool — editor or admin)
  //
  // Mirrors the PATCH /api/items/[id] publication_status branch (T6) so the
  // MCP path uses the same T5 helpers, the same role-gate matrix, and writes
  // the same `content_history` rows. Distinct from `update_governance_status`
  // which handles change-management states (publish/draft on
  // `governance_review_status`) — this tool is about the publication
  // lifecycle column `publication_status`.
  //
  // Spec: docs/specs/publication-lifecycle-state-machine-spec.md §7.1, §7.1.1
  // Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T7
  // ACs:  AC4.4 (role-gate matrix via MCP), AC6.2 (registration fixture)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'update_publication_status',
    {
      title: 'Update Publication Status',
      description:
        'Transition a content item between publication lifecycle states (draft, in_review, published, archived). Use this tool to publish a draft item, return an in-review item to draft for revision, archive a published item, or restore an archived item. Each transition has role-based gates (some are admin-only). Returns the new state and any side-effects (archived_at, archive_reason). Distinct from update_governance_status which handles change-management workflow (pending/approved/changes_requested/reverted) — those are about whether a recent EDIT has been reviewed, separate from whether the item is published. Editor or admin role required.',
      inputSchema: {
        item_id: z
          .string()
          .uuid()
          .describe('UUID of the content item to transition'),
        new_status: z
          .enum(['draft', 'in_review', 'published', 'archived'])
          .describe(
            'Target publication lifecycle state. Allowed transitions are constrained by §3.2 of the spec and the caller role.',
          ),
        archive_reason: z
          .string()
          .max(500)
          .optional()
          .describe(
            'Optional human-readable reason. Stamped into the `archive_reason` column ONLY on transitions to `archived`; ignored otherwise.',
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
                text: 'Permission denied: editor or admin role required to update publication status.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const newStatus = args.new_status as PublicationStatus;

        // Fetch current state. Mirrors the PATCH route — selects all columns
        // needed for transition validation + content_history insert. Use
        // tryQuery + 404-style error message when the row is missing (per
        // CLAUDE.md "REST PATCH on wrong UUID" — silent 0-row no-ops are
        // unsafe).
        const currentRes = await tryQuery(
          supabase
            .from('content_items')
            .select(
              'id, publication_status, archived_at, archived_by, archive_reason, title, suggested_title, content, brief, detail, reference',
            )
            .eq('id', args.item_id)
            .maybeSingle(),
          'mcp.governance.update_publication_status.fetch',
        );
        if (!isOk(currentRes)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item lookup failed: ${currentRes.error.message}`,
              },
            ],
            isError: true,
          };
        }
        if (!currentRes.data) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item ${args.item_id} not found.`,
              },
            ],
            isError: true,
          };
        }
        const current = currentRes.data;
        const fromStatus = current.publication_status as PublicationStatus;

        // Validate transition + role gate per §3.2 + §3.4 via the T5 helper.
        // Mirrors the PATCH route's status-code policy:
        //   - 403-equivalent (forbidden) when the role has NO transitions out
        //     of the current state (e.g. viewer everywhere, editor on
        //     `'published'`/`'archived'` rows). MCP surfaces this via
        //     isError + a "Permission denied" / "Role cannot transition"
        //     message.
        //   - 409-equivalent (conflict) when the role CAN transition but not
        //     to this target (e.g. editor `'draft' → 'archived'`). MCP
        //     surfaces this via isError + "Transition not allowed".
        const allowedTransitions = computeAllowedTransitions(
          fromStatus,
          role as UserRole,
        );
        if (allowedTransitions.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Role '${role}' cannot transition out of '${fromStatus}'.`,
              },
            ],
            isError: true,
          };
        }
        if (!allowedTransitions.includes(newStatus)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Transition not allowed: '${fromStatus}' -> '${newStatus}' for role '${role}'.`,
              },
            ],
            isError: true,
          };
        }

        // Defensive guard against helper-vs-Zod drift (matches the PATCH
        // route's pattern). Reaching this branch with a non-enum value would
        // mean the Zod enum is out of sync with the helper's
        // VALID_PUBLICATION_STATUSES — exactly the drift case
        // `feedback_check_constraint_app_enum_drift` warns against.
        if (
          !(VALID_PUBLICATION_STATUSES as readonly string[]).includes(newStatus)
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid publication_status: ${String(newStatus)}`,
              },
            ],
            isError: true,
          };
        }

        // Assemble the side-effect payload via the T5 helper. Stamps
        // archived_at/by/reason on `published → archived`; clears archived_at
        // (preserving the audit trail) on un-archive transitions.
        const updatePayload = applyTransitionSideEffects(
          {
            publication_status: newStatus,
            updated_by: userId,
          },
          fromStatus,
          newStatus,
          userId,
          args.archive_reason,
        );

        // Persist the state change. `sb()` is fail-fast — any DB error
        // surfaces as SupabaseError, caught by the outer try/catch. Per
        // CLAUDE.md `silent-failure-prevention`.
        await sb(
          supabase
            .from('content_items')
            .update(
              updatePayload as Database['public']['Tables']['content_items']['Update'],
            )
            .eq('id', args.item_id),
          'mcp.governance.update_publication_status.update',
        );

        // Write a content_history row capturing the transition. Per
        // CLAUDE.md `feedback_content_history_change_reason_mandatory`, the
        // canonical phrasing is `Transition from ${from} to ${to}` (+
        // optional ` (reason: ${archive_reason})` suffix). The
        // change_type='publication_state' value was added to the CHECK enum
        // in commit eeb8ae25.
        const changeReasonText =
          `Transition from ${fromStatus} to ${newStatus}` +
          (args.archive_reason ? ` (reason: ${args.archive_reason})` : '');

        const maxVersionRes = await tryQuery(
          supabase
            .from('content_history')
            .select('version')
            .eq('content_item_id', args.item_id)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle(),
          'mcp.governance.update_publication_status.history_version_lookup',
        );
        const nextVersion = isOk(maxVersionRes)
          ? (maxVersionRes.data?.version ?? 0) + 1
          : 1;

        await sb(
          supabase.from('content_history').insert({
            content_item_id: args.item_id,
            version: nextVersion,
            title: current.title ?? '',
            content: current.content ?? '',
            brief: current.brief ?? null,
            detail: current.detail ?? null,
            reference: current.reference ?? null,
            change_summary: `Publication status: ${fromStatus} -> ${newStatus}`,
            change_reason: changeReasonText,
            change_type: 'publication_state',
            created_by: userId,
          }),
          'mcp.governance.update_publication_status.history_insert',
        );

        const displayTitle =
          current.title ?? current.suggested_title ?? '(untitled)';
        const result: PublicationStatusUpdateResult = {
          item_id: args.item_id,
          title: displayTitle,
          previous_status: fromStatus,
          new_status: newStatus,
          transition: `${fromStatus} -> ${newStatus}`,
          archive_reason: args.archive_reason ?? null,
        };

        const markdown = formatPublicationStatusUpdate(result);
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
              text: `Publication status update failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_governance_queue (read-only — editor+)
  //
  // Wraps GET /api/governance/review. Returns items pending governance
  // review ordered by due date ascending. Optional post-query domain filter.
  // S202 §5.2 T7: widened with optional `publication_status` filter that
  // composes with the existing filters via AND. Backwards-compat preserved
  // — existing callers (omitting the param) see no behaviour change.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_governance_queue',
    {
      title: 'Get Governance Queue',
      description:
        'List content items pending governance review. Returns each item with domain, due date, reviewer, and last-updated timestamp. Use this to triage the governance backlog via Claude (weekly cadence for most admins). Optional `domain` filter restricts by `primary_domain`; optional `publication_status` filter restricts by publication lifecycle state (e.g. set `publication_status="in_review"` to surface items awaiting publication approval — a separate axis from change-management `governance_review_status="pending"`). All filters compose via AND. Editor or admin role required.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Maximum items to return (default 20, max 100)'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Offset for pagination (default 0)'),
        domain: z
          .string()
          .optional()
          .describe(
            'Optional primary_domain filter applied at the query level (the underlying route does not support a domain filter — this tool extends the route).',
          ),
        publication_status: z
          .enum(['draft', 'in_review', 'published', 'archived'])
          .optional()
          .describe(
            'If set, restrict the queue to items in this publication state. Common usage: publication_status="in_review" to surface items awaiting publication approval (separate axis from change-management governance_review_status="pending").',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required to read the governance queue.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);

        let query = supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, primary_domain, governance_review_status, governance_review_due, governance_reviewer_id, updated_by, updated_at',
            { count: 'exact' },
          )
          .eq('governance_review_status', 'pending')
          .order('governance_review_due', {
            ascending: true,
            nullsFirst: false,
          })
          .range(args.offset, args.offset + args.limit - 1);

        if (args.domain) {
          query = query.eq('primary_domain', args.domain);
        }

        // S202 §5.2 T7 — publication_status filter composes via AND with the
        // existing filters. Omitted → no-op (backwards-compat preserved).
        if (args.publication_status) {
          query = query.eq('publication_status', args.publication_status);
        }

        const { data, error, count } = await query;

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch governance queue: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        const items = (data ?? []) as GovernanceQueueItem[];
        const result: GovernanceQueueData = {
          items,
          total: count ?? items.length,
          offset: args.offset,
          limit: args.limit,
          domain_filter: args.domain ?? null,
          publication_status_filter: args.publication_status ?? null,
        };

        const markdown = formatGovernanceQueue(result);
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
              text: `Governance queue read failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // review_governance_item (write — editor+)
  //
  // Wraps POST /api/governance/review. Processes a governance review action
  // (approve / request_changes / revert) on an item currently in the
  // `pending` review state. Distinct from `update_governance_status` which
  // handles publish/draft transitions — this tool handles the review verdict
  // workflow used by the P1-33 governance-review skill.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'review_governance_item',
    {
      title: 'Process Governance Review Action',
      description:
        'Process a governance review action on an item currently pending review. Actions: "approve" moves to approved, "request_changes" flags it back for editing, "revert" reverts the pending change. Does NOT handle publish/draft transitions — those live in `update_governance_status`. Editor or admin role required. Item must currently have `governance_review_status = "pending"`.',
      inputSchema: {
        item_id: z
          .string()
          .uuid()
          .describe(
            'UUID of the content item to review (must currently have governance_review_status = "pending")',
          ),
        action: z
          .enum(['approve', 'request_changes', 'revert'])
          .describe('Review action to take'),
        notes: z
          .string()
          .max(1000)
          .optional()
          .describe(
            'Optional reviewer notes — included in the reviewer notification and available to downstream audit tools.',
          ),
      },
      annotations: NON_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required to process governance reviews.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);

        // §5.5 Phase 2 T2: extend the fetch to include `next_review_date` +
        // `review_cadence_days` so the `approve` branch can compute auto-
        // renewal symmetrically with the API route. `verified_at` is
        // selected to keep the SELECT shape stable for future extension.
        const { data: item, error: fetchError } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, governance_review_status, content_owner_id, updated_by, next_review_date, review_cadence_days, verified_at',
          )
          .eq('id', args.item_id)
          .maybeSingle();

        if (fetchError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item lookup failed: ${fetchError.message}`,
              },
            ],
            isError: true,
          };
        }

        if (!item) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item ${args.item_id} not found.`,
              },
            ],
            isError: true,
          };
        }

        if (
          !ALLOWED_REVIEW_INPUT_STATUSES.includes(
            item.governance_review_status as AllowedReviewInputStatus,
          )
        ) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item is not pending governance review (current status: \`${item.governance_review_status ?? 'null'}\`). The review action can only be processed on items with \`governance_review_status = "pending"\`.`,
              },
            ],
            isError: true,
          };
        }

        const action = args.action as GovernanceReviewAction;
        let newStatus: string;
        let updateData: Database['public']['Tables']['content_items']['Update'];

        switch (action) {
          case 'approve': {
            // §5.5 Phase 2 T2: cadence-driven auto-renewal — symmetric with
            // app/api/governance/review/route.ts. Advance `next_review_date`
            // to GREATEST(current, today) + cadence and stamp `verified_at`.
            // Spec §6.5 + §6.9 AC8.
            const nextReviewDate = computeNextReviewDate(
              (item as { next_review_date: string | null }).next_review_date,
              (item as { review_cadence_days: number | null })
                .review_cadence_days,
            );
            newStatus = 'approved';
            updateData = {
              governance_review_status: 'approved',
              governance_reviewer_id: userId,
              governance_review_due: null,
              verified_at: new Date().toISOString(),
              ...(nextReviewDate && { next_review_date: nextReviewDate }),
            };
            break;
          }
          case 'request_changes':
            newStatus = 'changes_requested';
            updateData = {
              governance_review_status: 'changes_requested',
              governance_reviewer_id: userId,
            };
            break;
          case 'revert':
            newStatus = 'reverted';
            updateData = {
              governance_review_status: 'reverted',
              governance_reviewer_id: userId,
              governance_review_due: null,
            };
            break;
        }

        // We intentionally omit `.select('id').single()` here — the API
        // route uses that idiom to catch zero-row updates, but the fetch +
        // pending-status check above already guarantees the row exists at
        // update time. The only remaining race is a concurrent delete
        // between fetch and update, which the surrounding try/catch handles.
        const { error: updateError } = await supabase
          .from('content_items')
          .update(updateData)
          .eq('id', args.item_id);

        if (updateError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Governance review action failed: ${updateError.message}`,
              },
            ],
            isError: true,
          };
        }

        // Best-effort notification dispatch — mirrors the API route's
        // behaviour. Failures here MUST NOT roll back the review action.
        try {
          const detailResult = await tryQuery(
            supabase
              .from('content_items')
              .select('updated_by, content_owner_id' as 'updated_by')
              .eq('id', args.item_id)
              .maybeSingle(),
            'mcp.governance.review_governance_item.detail',
          );
          const detail = isOk(detailResult)
            ? (detailResult.data as Record<string, unknown> | null)
            : null;
          const targets = new Set<string>();
          if (detail?.content_owner_id && detail.content_owner_id !== userId) {
            targets.add(detail.content_owner_id as string);
          }
          if (detail?.updated_by && detail.updated_by !== userId) {
            targets.add(detail.updated_by as string);
          }
          for (const target of targets) {
            await supabase.from('notifications').insert({
              user_id: target,
              type: `governance_${action}`,
              entity_type: 'content_item',
              entity_id: args.item_id,
              title: `Governance review: ${action.replace('_', ' ')}`,
              message: args.notes ?? null,
            });
          }
        } catch (notifErr) {
          console.warn(
            'review_governance_item: notification dispatch failed',
            notifErr,
          );
        }

        const displayTitle = item.title ?? item.suggested_title ?? '(untitled)';
        const result: GovernanceReviewActionResult = {
          item_id: args.item_id,
          title: displayTitle,
          action,
          new_status: newStatus,
          reviewer_id: userId ?? '(unknown)',
          notes: args.notes ?? null,
        };

        const markdown = formatGovernanceReviewAction(result);
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
              text: `Governance review action failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
