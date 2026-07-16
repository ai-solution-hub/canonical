/**
 * Governance and lifecycle tool registrations (4 tools):
 *  25. delete_content_item
 *  30. update_governance_status
 *  31. update_publication_status (S202 §5.2 Phase 2 / T7)
 *  review_governance_item (S180 WP3 / P0-23 B2)
 *
 * ID-71.9 (M30/OQ-5, B-INV-30) retired `get_governance_queue` into the
 * consolidated `whats_in_my_queue` faceted queue (lib/mcp/tools/review.ts) —
 * the governance facet. The /api/governance/review ROUTE layer is UNCHANGED.
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
import type {
  FacetOwnerKind,
  RecordEmbeddingsOwnerKind,
} from '@/lib/validation/owner-kind';
import {
  formatDeleteContent,
  formatGovernanceReviewAction,
  formatGovernanceStatusUpdate,
  formatPublicationStatusUpdate,
} from '@/lib/mcp/formatters';
import type {
  DeleteContentResult,
  GovernanceReviewAction,
  GovernanceReviewActionResult,
  GovernanceStatusItemResult,
  GovernanceStatusUpdateResult,
  PublicationStatusUpdateResult,
} from '@/lib/mcp/formatters';
import { GovernanceReviewActionResultSchema } from '@/lib/mcp/formatters/governance';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateEmbedding,
  getClassifyContent,
  defineTool,
  DESTRUCTIVE_WRITE_ANNOTATIONS,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
} from './shared';
import {
  ALLOWED_REVIEW_INPUT_STATUSES,
  type AllowedReviewInputStatus,
} from '@/lib/governance/review-input-statuses';
import { computeNextReviewDate } from '@/lib/governance/cadence-renewal';
import { refusePublishForHeadlessActor } from '@/lib/mcp/actor';
import {
  VALID_PUBLICATION_STATUSES,
  computeAllowedTransitions,
  applyTransitionSideEffects,
  type PublicationStatus,
  type UserRole,
} from '@/lib/governance/publication-transitions';
import { logger } from '@/lib/logger';

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

        // ID-131 (G-MCP-REPOINT, BI-9): content_items no longer exists — an
        // `id` may now be either a source_document or a q_a_pair. Resolve
        // which typed record owns it before doing anything else. `brief` /
        // `detail` / `reference` / `metadata` were IMS-vestige content_items
        // columns dropped outright (BI-11) — no successor on either table.
        const sdRes = await tryQuery(
          supabase
            .from('source_documents')
            .select('id, suggested_title, extracted_text, archived_at')
            .eq('id', args.id)
            .maybeSingle(),
          'mcp.governance.delete.resolve.source_document',
        );
        let ownerKind: 'source_document' | 'q_a_pair' | null = null;
        let item: {
          title: string | null;
          content: string | null;
          archivedAt: string | null;
        } | null = null;
        if (isOk(sdRes) && sdRes.data) {
          ownerKind = 'source_document';
          item = {
            title: sdRes.data.suggested_title,
            content: sdRes.data.extracted_text,
            archivedAt: sdRes.data.archived_at,
          };
        } else {
          const qaRes = await tryQuery(
            supabase
              .from('q_a_pairs')
              .select('id, question_text, answer_standard')
              .eq('id', args.id)
              .maybeSingle(),
            'mcp.governance.delete.resolve.q_a_pair',
          );
          if (isOk(qaRes) && qaRes.data) {
            ownerKind = 'q_a_pair';
            item = {
              title: qaRes.data.question_text,
              content: qaRes.data.answer_standard,
              archivedAt: null,
            };
          }
        }

        if (!ownerKind || !item) {
          return {
            content: [
              { type: 'text' as const, text: `Item not found: ${args.id}` },
            ],
            isError: true,
          };
        }

        const displayTitle = item.title || 'Untitled';

        // Check if already archived (source_document only — see below)
        if (args.mode === 'archive' && item.archivedAt) {
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
          // ID-131 content-drift: `archived_at`/`archived_by` only exist on
          // source_documents — q_a_pairs have no archive columns at all
          // (their "retired" concept is `superseded_by`/`valid_to`, BI-20).
          // Archiving a q_a_pair via this tool is not structurally
          // supported post-131; refuse explicitly rather than silently
          // no-op or write to a non-existent column.
          if (ownerKind === 'q_a_pair') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Archiving is not supported for Q&A pairs under the current schema (no archived_at column). Use update_publication_status to set draft/archived state, or mode: "delete" instead.',
                },
              ],
              isError: true,
            };
          }

          // Archive logic (source_documents only — see guard above).
          // `archive_reason` had no successor column (BI-11). The reason was
          // previously captured in content_history.change_reason, but that
          // write is retired here — content_item_id has been a dead FK
          // since the M0c debris-wipe (content_items is permanently empty),
          // and content_history itself drops at M6 (BI-34). ID-131
          // FIX-SLICE (S447).
          const { error: updateError } = await supabase
            .from('source_documents')
            .update({
              archived_at: new Date().toISOString(),
              archived_by: userId,
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
          // Hard Delete — works for either owner kind. The pre-delete
          // content_history audit insert is retired here: content_item_id
          // has been a dead FK since the M0c debris-wipe, and
          // content_history itself drops at M6 (BI-34). ID-131 FIX-SLICE
          // (S447).
          const table =
            ownerKind === 'source_document' ? 'source_documents' : 'q_a_pairs';
          const { error: deleteError } = await supabase
            .from(table)
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
        // B-INV-6 (M6): publication is human-gated. A headless agent
        // attempting to PUBLISH is refused at the surface and routed to the
        // human gate, BEFORE any role/DB work. The `'draft'` branch is a
        // propose-write and is NOT gated.
        if (args.status === 'publish') {
          const refusal = refusePublishForHeadlessActor(extra.authInfo);
          if (refusal) return refusal;
        }

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

        // ID-131 (G-MCP-REPOINT, BI-9): content_items no longer exists — an
        // item_id may be either a source_document or a q_a_pair. Fetch both
        // typed tables in parallel; each supplied id resolves to at most one
        // owner kind. `governance_review_status` moved to the
        // `record_lifecycle` facet (BI-18) — read/cleared there via
        // `owner_id` (= source_document_id | q_a_pair_id), independent of
        // owner kind.
        const [sdRows, qaRows, lifecycleRows] = await Promise.all([
          supabase
            .from('source_documents')
            .select(
              'id, suggested_title, extracted_text, publication_status, classified_at',
            )
            .in('id', args.item_ids),
          supabase
            .from('q_a_pairs')
            .select('id, question_text, answer_standard, publication_status')
            .in('id', args.item_ids),
          supabase
            .from('record_lifecycle')
            .select('owner_id, governance_review_status')
            .in('owner_id', args.item_ids),
        ]);

        if (sdRows.error || qaRows.error) {
          const message =
            sdRows.error?.message ?? qaRows.error?.message ?? 'Unknown error';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch items: ${message}`,
              },
            ],
            isError: true,
          };
        }

        interface GovernanceRow {
          id: string;
          title: string | null;
          content: string | null;
          publication_status: string | null;
          classified_at: string | null;
          governanceReviewStatus: string | null;
          ownerKind: 'source_document' | 'q_a_pair';
        }

        const governanceStatusByOwnerId = new Map<string, string | null>();
        for (const lr of (lifecycleRows.data ?? []) as Array<{
          owner_id: string | null;
          governance_review_status: string | null;
        }>) {
          if (lr.owner_id) {
            governanceStatusByOwnerId.set(
              lr.owner_id,
              lr.governance_review_status,
            );
          }
        }

        const rowMap = new Map<string, GovernanceRow>();
        for (const r of (sdRows.data ?? []) as Array<{
          id: string;
          suggested_title: string | null;
          extracted_text: string | null;
          publication_status: string | null;
          classified_at: string | null;
        }>) {
          rowMap.set(r.id, {
            id: r.id,
            title: r.suggested_title,
            content: r.extracted_text,
            publication_status: r.publication_status,
            classified_at: r.classified_at,
            governanceReviewStatus: governanceStatusByOwnerId.get(r.id) ?? null,
            ownerKind: 'source_document',
          });
        }
        for (const r of (qaRows.data ?? []) as Array<{
          id: string;
          question_text: string | null;
          answer_standard: string | null;
          publication_status: string | null;
        }>) {
          rowMap.set(r.id, {
            id: r.id,
            title: r.question_text,
            content: r.answer_standard,
            publication_status: r.publication_status,
            classified_at: null,
            governanceReviewStatus: governanceStatusByOwnerId.get(r.id) ?? null,
            ownerKind: 'q_a_pair',
          });
        }

        // Process each item
        for (const itemId of args.item_ids) {
          const row = rowMap.get(itemId);
          const displayTitle = row?.title || 'Untitled';

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
              // to prevent items appearing in search without embeddings.
              // ID-131 content-drift: source_documents carries NO embedding
              // column under OKF (a document's searchability comes from its
              // cocoindex-populated content_chunks, not an item-level
              // vector) — the embed-then-commit step now only applies to
              // q_a_pairs (question_embedding). Publishing a source_document
              // skips embedding generation entirely rather than failing.
              let embedding: number[] | null = null;
              if (row.ownerKind === 'q_a_pair') {
                try {
                  const generateEmbedding = await getGenerateEmbedding();
                  const textForEmbedding =
                    (row.title || '') +
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
              }

              // Update: promote publication_status='published' when row is
              // currently `'draft'`. Conditional spread ensures
              // already-published / in_review rows are NOT touched on
              // publication_status (no-op for those branches).
              // `governance_review_status` no longer lives on this table —
              // cleared via the record_lifecycle facet below. Split by owner
              // kind: `updated_by` exists on source_documents but NOT on
              // q_a_pairs (ID-131 content-drift — no home there).
              //
              // ID-131.19 (M6, S450 GO tail): q_a_pairs.question_embedding
              // was DROPPED — the inline-column write is removed from this
              // UPDATE; the record_embeddings dual-write below (mirroring
              // lib/q-a-pairs/promote-corpus.ts's embedAndPublish) is now the
              // sole write path hybrid_search's q_a_pair arm reads.
              const publishPromotion =
                row.publication_status === 'draft'
                  ? { publication_status: 'published' as const }
                  : {};
              const { error: updateError } =
                row.ownerKind === 'source_document'
                  ? await supabase
                      .from('source_documents')
                      .update({
                        ...publishPromotion,
                        updated_by: userId,
                      } satisfies Database['public']['Tables']['source_documents']['Update'])
                      .eq('id', itemId)
                  : await supabase
                      .from('q_a_pairs')
                      .update({
                        ...publishPromotion,
                      } satisfies Database['public']['Tables']['q_a_pairs']['Update'])
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

              // ID-131.19: dual-write the freshly generated embedding into
              // the polymorphic record_embeddings store (the q_a_pair inline
              // column is gone). Best-effort — a failure here must NOT
              // un-publish a pair that already published successfully above.
              if (row.ownerKind === 'q_a_pair' && embedding) {
                const { error: recordEmbeddingError } = await supabase
                  .from('record_embeddings')
                  .upsert(
                    {
                      owner_kind: 'q_a_pair' satisfies RecordEmbeddingsOwnerKind,
                      owner_id: itemId,
                      model: 'text-embedding-3-large',
                      embedding: JSON.stringify(embedding),
                    },
                    { onConflict: 'owner_kind,owner_id,model' },
                  );
                if (recordEmbeddingError) {
                  logger.warn(
                    { err: recordEmbeddingError, itemId },
                    'review_governance_item: record_embeddings dual-write failed',
                  );
                }
              }

              // ID-131 BI-18: governance_review_status now lives on the
              // record_lifecycle facet, keyed by owner_id. Clear it via
              // upsert (a facet row may not exist yet for this owner).
              await sb(
                supabase.from('record_lifecycle').upsert(
                  {
                    owner_kind: row.ownerKind,
                    ...(row.ownerKind === 'source_document'
                      ? { source_document_id: itemId }
                      : { q_a_pair_id: itemId }),
                    governance_review_status: null,
                  },
                  { onConflict: 'owner_kind,owner_id' },
                ),
                'mcp.governance.update_governance_status.facet_clear',
              );

              // S183 WP1 G2 — first-time publish for draft-created items
              // needs classification + chunks. Drafts bypass the AI pipeline
              // in create_content_item, so an item with classified_at = NULL
              // has no entity_mentions, entity_relationships, summary, or
              // content_chunks. Running now fixes that so the item is fully
              // searchable + richly linked the moment it becomes live.
              // Non-fatal: failures log but do not un-publish. Classification
              // is a document-level concept (source_documents.classified_at)
              // — q_a_pairs have no classification axis, so this leg is
              // source_document-only (ID-131 content-drift).
              //
              // Uses the service client (not the RLS-scoped MCP client) for
              // parity with the API publish path and because classifyContent
              // performs a delete-before-insert on entity_mentions which
              // requires admin RLS — editor-role callers would silently
              // no-op the delete otherwise.
              if (
                row.ownerKind === 'source_document' &&
                !row.classified_at &&
                row.content
              ) {
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
                  logger.error(
                    { err: classifyErr },
                    `MCP publish classify failed for ${itemId}`,
                  );
                }
                await recordPipelineRun({
                  supabase: publishServiceClient,
                  pipelineName: 'publish_classify',
                  status: classifyStatus,
                  itemsProcessed: 1,
                  errorMessage: classifyError,
                });

                // Chunking removed (ID-56.11): cocoindex is the sole
                // content_chunks writer and re-ingests the corpus natively
                // (TECH §1 single-path). No app-side chunk regeneration on
                // MCP publish.
              }
            } else {
              // Draft: set publication_status to 'draft' (S202 §5.2 Phase 2.5
              // rewire — rewired from governance_review_status per spec §6.5).
              // The tool's external 'draft' action verb is unchanged so LLM
              // callers transparently target the new column. Split by owner
              // kind: `updated_by` exists on source_documents but NOT on
              // q_a_pairs (ID-131 content-drift — no home there).
              const { error: updateError } =
                row.ownerKind === 'source_document'
                  ? await supabase
                      .from('source_documents')
                      .update({
                        publication_status: 'draft',
                        updated_by: userId,
                      } satisfies Database['public']['Tables']['source_documents']['Update'])
                      .eq('id', itemId)
                  : await supabase
                      .from('q_a_pairs')
                      .update({
                        publication_status: 'draft',
                      } satisfies Database['public']['Tables']['q_a_pairs']['Update'])
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

            // content_history audit insert retired here: content_item_id
            // has been a dead FK since the M0c debris-wipe, and
            // content_history itself drops at M6 (BI-34). ID-131 FIX-SLICE
            // (S447).
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
  // MCP path uses the same T5 helpers and the same role-gate matrix. (The
  // `content_history` transition-snapshot write this comment used to
  // describe is retired on this path — ID-131 FIX-SLICE, BI-34.) Distinct
  // from `update_governance_status` which handles change-management states
  // (publish/draft on
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
        // B-INV-6 (M6): publication is human-gated. A headless agent
        // transitioning an item to `published` is refused at the surface and
        // routed to the human gate, BEFORE any role/DB work. Other
        // transitions (draft / in_review / archived) are not publication
        // events and are not gated here.
        if (args.new_status === 'published') {
          const refusal = refusePublishForHeadlessActor(extra.authInfo);
          if (refusal) return refusal;
        }

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

        // ID-131 (G-MCP-REPOINT, BI-9): content_items no longer exists — an
        // item_id may be either a source_document or a q_a_pair. `brief` /
        // `detail` / `reference` were IMS-vestige content_items columns
        // dropped outright (BI-11) — no successor on either table.
        const sdRes = await tryQuery(
          supabase
            .from('source_documents')
            .select(
              'id, publication_status, archived_at, archived_by, suggested_title, extracted_text',
            )
            .eq('id', args.item_id)
            .maybeSingle(),
          'mcp.governance.update_publication_status.fetch.source_document',
        );
        if (!isOk(sdRes)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Item lookup failed: ${sdRes.error.message}`,
              },
            ],
            isError: true,
          };
        }

        let ownerKind: 'source_document' | 'q_a_pair' | null = null;
        let current: {
          publication_status: string | null;
          title: string | null;
          content: string | null;
        } | null = null;
        if (sdRes.data) {
          ownerKind = 'source_document';
          current = {
            publication_status: sdRes.data.publication_status,
            title: sdRes.data.suggested_title,
            content: sdRes.data.extracted_text,
          };
        } else {
          const qaRes = await tryQuery(
            supabase
              .from('q_a_pairs')
              .select('id, publication_status, question_text, answer_standard')
              .eq('id', args.item_id)
              .maybeSingle(),
            'mcp.governance.update_publication_status.fetch.q_a_pair',
          );
          if (!isOk(qaRes)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Item lookup failed: ${qaRes.error.message}`,
                },
              ],
              isError: true,
            };
          }
          if (qaRes.data) {
            ownerKind = 'q_a_pair';
            current = {
              publication_status: qaRes.data.publication_status,
              title: qaRes.data.question_text,
              content: qaRes.data.answer_standard,
            };
          }
        }

        if (!ownerKind || !current) {
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
        let updatePayload = applyTransitionSideEffects(
          {
            publication_status: newStatus,
            updated_by: userId,
          },
          fromStatus,
          newStatus,
          userId,
          args.archive_reason,
        );

        // ID-131 content-drift: `archived_at`/`archived_by`/`archive_reason`
        // only exist on source_documents — q_a_pairs have no archive-metadata
        // columns at all (BI-20 — their "retired" concept is
        // `superseded_by`/`valid_to`). Strip those side-effect keys before
        // writing a q_a_pair; `publication_status` itself still transitions
        // correctly either way. Also `updated_by` has no home on q_a_pairs.
        if (ownerKind === 'q_a_pair') {
          const {
            archived_at,
            archived_by,
            archive_reason,
            updated_by,
            ...rest
          } = updatePayload as typeof updatePayload & { updated_by?: string };
          void archived_at;
          void archived_by;
          void archive_reason;
          void updated_by;
          updatePayload = rest;
        }

        // Persist the state change. `sb()` is fail-fast — any DB error
        // surfaces as SupabaseError, caught by the outer try/catch. Per
        // CLAUDE.md `silent-failure-prevention`.
        await sb(
          ownerKind === 'source_document'
            ? supabase
                .from('source_documents')
                .update(
                  updatePayload as Database['public']['Tables']['source_documents']['Update'],
                )
                .eq('id', args.item_id)
            : supabase
                .from('q_a_pairs')
                .update(
                  updatePayload as Database['public']['Tables']['q_a_pairs']['Update'],
                )
                .eq('id', args.item_id),
          'mcp.governance.update_publication_status.update',
        );

        // The content_history transition-snapshot insert is retired here:
        // content_item_id has been a dead FK since the M0c debris-wipe, and
        // content_history itself drops at M6 (BI-34). ID-131 FIX-SLICE
        // (S447).
        const displayTitle = current.title ?? '(untitled)';
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
      outputSchema: GovernanceReviewActionResultSchema,
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

        // ID-131 (G-MCP-REPOINT, BI-9/18): content_items no longer exists —
        // governance_review_status et al. now live on the record_lifecycle
        // facet, keyed by `owner_id` (= source_document_id | q_a_pair_id,
        // whichever the caller's item_id resolves to). Look up by owner_id
        // directly — no owner-kind branching needed for this table. §5.5
        // Phase 2 T2: `next_review_date` + `review_cadence_days` selected so
        // the `approve` branch can compute auto-renewal symmetrically with
        // the API route. `verified_at` is selected to keep the SELECT shape
        // stable for future extension.
        const { data: item, error: fetchError } = await supabase
          .from('record_lifecycle')
          .select(
            'owner_id, owner_kind, source_document_id, q_a_pair_id, governance_review_status, content_owner_id, next_review_date, review_cadence_days, verified_at',
          )
          .eq('owner_id', args.item_id)
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
                text: `Item ${args.item_id} not found or has no governance facet row (it has never entered review).`,
              },
            ],
            isError: true,
          };
        }

        // Display title + `updated_by` come from the typed owner record —
        // `updated_by` only exists on source_documents (ID-131
        // content-drift: q_a_pairs have no home for it).
        let displayTitle = '(untitled)';
        let ownerUpdatedBy: string | null = null;
        if (
          item.owner_kind === ('source_document' satisfies FacetOwnerKind) &&
          item.source_document_id
        ) {
          const sdRes = await tryQuery(
            supabase
              .from('source_documents')
              .select('suggested_title, updated_by')
              .eq('id', item.source_document_id)
              .maybeSingle(),
            'mcp.governance.review_governance_item.owner_source_document',
          );
          const sd = isOk(sdRes) ? sdRes.data : null;
          displayTitle = sd?.suggested_title ?? '(untitled)';
          ownerUpdatedBy = sd?.updated_by ?? null;
        } else if (
          item.owner_kind === ('q_a_pair' satisfies FacetOwnerKind) &&
          item.q_a_pair_id
        ) {
          const qaRes = await tryQuery(
            supabase
              .from('q_a_pairs')
              .select('question_text')
              .eq('id', item.q_a_pair_id)
              .maybeSingle(),
            'mcp.governance.review_governance_item.owner_q_a_pair',
          );
          const qa = isOk(qaRes) ? qaRes.data : null;
          displayTitle = qa?.question_text ?? '(untitled)';
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
        let updateData: Database['public']['Tables']['record_lifecycle']['Update'];

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
          .from('record_lifecycle')
          .update(updateData)
          .eq('owner_id', args.item_id);

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
        // ID-131 (G-MCP-REPOINT): the original code re-fetched
        // content_owner_id/updated_by from content_items immediately before
        // dispatch; both are already available from the initial facet fetch
        // above (`item.content_owner_id`, `ownerUpdatedBy`) — the extra
        // round-trip is dropped as an incidental simplification.
        try {
          const targets = new Set<string>();
          if (item.content_owner_id && item.content_owner_id !== userId) {
            targets.add(item.content_owner_id);
          }
          if (ownerUpdatedBy && ownerUpdatedBy !== userId) {
            targets.add(ownerUpdatedBy);
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
          logger.warn(
            { err: notifErr },
            'review_governance_item: notification dispatch failed',
          );
        }

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
