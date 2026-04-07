import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { createNotification } from '@/lib/notifications';
import { parseBody } from '@/lib/validation';
import { SendToReviewBodySchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * POST /api/source-documents/[id]/send-to-review — batch-send affected
 * content items to the governance review queue.
 *
 * Sets `governance_review_status = 'pending'` and
 * `governance_review_due = NOW() + 7 days` for eligible items.
 * Items that are already pending or in draft status are silently skipped.
 *
 * Auth: editor or admin.
 *
 * Request body: { item_ids: string[] }
 * Response: { sent, already_pending, skipped_draft, total_requested, sent_ids, review_url }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Fetch items to check current governance_review_status
    const { data: items, error: fetchErr } = await supabase
      .from('content_items')
      .select('id, governance_review_status, content_owner_id, title')
      .in('id', itemIds);

    if (fetchErr) {
      return NextResponse.json(
        {
          error: safeErrorMessage(fetchErr, 'Failed to fetch content items'),
        },
        { status: 500 },
      );
    }

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

    // Batch update eligible items
    if (eligible.length > 0) {
      const reviewDue = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const { error: updateErr } = await supabase
        .from('content_items')
        .update({
          governance_review_status: 'pending',
          governance_review_due: reviewDue,
          updated_at: new Date().toISOString(),
        })
        .in('id', eligible);

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
          console.error(
            'Failed to look up admin roles for review fallback:',
            adminRolesError,
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
}
