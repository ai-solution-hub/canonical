import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import {
  SendToReviewBodySchema,
  SendToReviewResultSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const POST = defineRoute(
  SendToReviewResultSchema,
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['editor', 'admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: documentId } = await params;

      // Parse and validate request body
      const raw = await request.json();
      const parsed = parseBody(SendToReviewBodySchema, raw);
      if (!parsed.success) return parsed.response;
      const itemIds = parsed.data.item_ids;

      // Fetch items to check current governance_review_status. ID-131
      // {131.19} G-GOV-FACET: content_items is dying — governance_review_status
      // /content_owner_id live on the record_lifecycle facet (owner_kind=
      // 'source_document'); title has no direct SD column — derived from
      // suggested_title/filename below.
      const { data: rawItems, error: fetchErr } = await supabase
        .from('record_lifecycle')
        .select(
          'source_document_id, governance_review_status, content_owner_id, source_documents!inner(id, filename, suggested_title)',
        )
        .eq('owner_kind', 'source_document')
        .in('source_document_id', itemIds);

      if (fetchErr) {
        return NextResponse.json(
          {
            error: safeErrorMessage(fetchErr, 'Failed to fetch content items'),
          },
          { status: 500 },
        );
      }

      const items = (rawItems ?? [])
        .filter((row) => row.source_documents !== null)
        .map((row) => ({
          id: row.source_document_id!,
          governance_review_status: row.governance_review_status,
          content_owner_id: row.content_owner_id,
          title:
            row.source_documents!.suggested_title ??
            row.source_documents!.filename,
        }));

      // Partition items into three groups
      const eligible: string[] = [];
      const alreadyPending: string[] = [];
      const skippedDraft: string[] = [];
      const ownerMap = new Map<string, string | null>();
      let unnotifiedItems = 0;
      const warnings: string[] = [];

      for (const item of items ?? []) {
        const status = item.governance_review_status;
        if (status === 'pending') {
          alreadyPending.push(item.id);
        } else if (status === 'draft') {
          skippedDraft.push(item.id);
        } else {
          // Eligible: NULL, 'approved', 'changes_requested', 'reverted'
          eligible.push(item.id);
          ownerMap.set(item.id, item.content_owner_id ?? null);
        }
      }

      // No record_lifecycle facet row is ever minted anywhere in the system
      // yet (Phase 2 facet-mint migration proposed) — a gap that affects ALL
      // documents, not just pre-existing ones, until it ships. The facet
      // SELECT above (`.in('source_document_id', itemIds)`) simply omits any
      // requested id with no matching row, which would otherwise let items
      // silently vanish from all three partitions while `total_requested`
      // stayed honest. Diff the requested ids against what was actually
      // returned and surface the gap explicitly instead.
      const returnedIds = new Set(items.map((item) => item.id));
      const noGovernanceRecord = itemIds.filter((id) => !returnedIds.has(id));

      // Batch update eligible items
      if (eligible.length > 0) {
        const reviewDue = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();

        const { error: updateErr } = await supabase
          .from('record_lifecycle')
          .update({
            governance_review_status: 'pending',
            governance_review_due: reviewDue,
          })
          .eq('owner_kind', 'source_document')
          .in('source_document_id', eligible);

        if (updateErr) {
          return NextResponse.json(
            {
              error: safeErrorMessage(
                updateErr,
                'Failed to update content items',
              ),
            },
            { status: 500 },
          );
        }

        // updated_at lives on the owning source_documents row — best-effort
        // secondary write (matches the review/action verify-branch pattern).
        const { error: sdUpdateErr } = await supabase
          .from('source_documents')
          .update({ updated_at: new Date().toISOString() })
          .in('id', eligible);
        if (sdUpdateErr) {
          logger.error(
            { err: sdUpdateErr },
            'Failed to stamp updated_at on source_documents (send-to-review)',
          );
        }

        // Fetch the source document filename for notification context
        const sourceDoc = await sb(
          supabase
            .from('source_documents')
            .select('filename')
            .eq('id', documentId)
            .maybeSingle(),
          'source_documents.filename',
        );

        const filename = sourceDoc?.filename ?? 'Unknown document';

        // Create notifications for content owners (fall back to admins)
        // Collect items with no owner to look up admins
        const itemsWithoutOwner: string[] = [];

        for (const itemId of eligible) {
          const ownerId = ownerMap.get(itemId);
          if (ownerId) {
            await createNotification({
              supabase,
              userId: ownerId,
              type: 'governance_review_needed',
              entityType: 'content_item',
              entityId: itemId,
              title: 'Source document review',
              message: `Source document review: ${filename} was updated. This item needs reviewing.`,
            });
          } else {
            itemsWithoutOwner.push(itemId);
          }
        }

        // Fall back to admins for items without an owner
        if (itemsWithoutOwner.length > 0) {
          const { data: adminRoles, error: adminRolesError } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('role', 'admin');

          if (adminRolesError) {
            logger.error(
              { err: adminRolesError },
              'Failed to look up admin roles for review fallback',
            );
            // Items were sent to review, but no notifications could be
            // created for owner-less items. Surface as warning + count.
            unnotifiedItems = itemsWithoutOwner.length;
            warnings.push(
              'Items were sent to review, but admin notifications failed: ' +
                safeErrorMessage(adminRolesError, 'admin role lookup failed'),
            );
          } else {
            const adminIds = (adminRoles ?? []).map((r) => r.user_id);
            if (adminIds.length === 0) {
              unnotifiedItems = itemsWithoutOwner.length;
              warnings.push(
                'Items were sent to review, but no admins exist to notify',
              );
            }

            for (const itemId of itemsWithoutOwner) {
              for (const adminId of adminIds) {
                await createNotification({
                  supabase,
                  userId: adminId,
                  type: 'governance_review_needed',
                  entityType: 'content_item',
                  entityId: itemId,
                  title: 'Source document review',
                  message: `Source document review: ${filename} was updated. This item needs reviewing.`,
                });
              }
            }
          }
        }
      }

      const responseBody: Record<string, unknown> = {
        sent: eligible.length,
        already_pending: alreadyPending.length,
        skipped_draft: skippedDraft.length,
        total_requested: itemIds.length,
        sent_ids: eligible,
        unnotified: unnotifiedItems,
        // Every requested id lands in exactly one of: sent, already_pending,
        // skipped_draft, no_governance_record — so total_requested is always
        // fully accounted for.
        no_governance_record: noGovernanceRecord,
        review_url: `/review?status=all&source_document_id=${documentId}`,
      };
      if (warnings.length > 0) {
        responseBody.warnings = warnings;
      }
      return NextResponse.json(responseBody);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to send items to review') },
        { status: 500 },
      );
    }
  },
);
