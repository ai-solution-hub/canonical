import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { tryQuery, isOk } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  GovernanceReviewBodySchema,
  GovernanceReviewParamsSchema,
} from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/governance/review
 *
 * List items pending governance review.
 * If ?count_only=true, returns just the count (used by the needs-attention banner).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const parsed = parseSearchParams(
      GovernanceReviewParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { count_only: countOnly, limit, offset } = parsed.data;

    if (countOnly) {
      const { count, error } = await supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .eq('governance_review_status', 'pending');

      if (error) {
        console.error('Failed to count governance reviews:', error);
        return NextResponse.json({ count: 0 });
      }

      return NextResponse.json({ count: count ?? 0 });
    }

    const { data, error } = await supabase
      .from('content_items')
      .select(
        'id, title, suggested_title, primary_domain, governance_review_status, governance_review_due, governance_reviewer_id, updated_by, updated_at',
      )
      .eq('governance_review_status', 'pending')
      .order('governance_review_due', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch governance reviews:', error);
      return NextResponse.json(
        { error: 'Failed to fetch governance reviews' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch governance reviews') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/governance/review
 *
 * Process a governance review action on an item.
 * Actions: approve, request_changes, revert
 * Editor+ role required.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(GovernanceReviewBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { item_id, action, notes } = parsed.data;

    // Verify the item exists and is pending review
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select('id, governance_review_status')
      .eq('id', item_id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.governance_review_status !== 'pending') {
      return NextResponse.json(
        { error: 'Item is not pending governance review' },
        { status: 400 },
      );
    }

    let updateData: Record<string, unknown>;

    switch (action) {
      case 'approve':
        updateData = {
          governance_review_status: 'approved',
          governance_reviewer_id: user.id,
          governance_review_due: null,
        };
        break;

      case 'request_changes':
        updateData = {
          governance_review_status: 'changes_requested',
          governance_reviewer_id: user.id,
        };
        break;

      case 'revert':
        // Revert to last approved version (latest history entry before the pending change)
        updateData = {
          governance_review_status: 'reverted',
          governance_reviewer_id: user.id,
          governance_review_due: null,
        };
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('content_items')
      .update(updateData)
      .eq('id', item_id)
      .select('id')
      .single();

    if (updateError || !updated) {
      console.error('Failed to process governance review:', updateError);
      return NextResponse.json(
        { error: 'Item not found or governance review update failed' },
        { status: updateError ? 500 : 404 },
      );
    }

    // Create notifications for the content owner and/or last editor.
    // Notification dispatch is best-effort: a failure here must not roll
    // back the governance review action that already succeeded above.
    try {
      const itemDetailResult = await tryQuery(
        supabase
          .from('content_items')
          .select('updated_by, content_owner_id' as 'updated_by')
          .eq('id', item_id)
          .maybeSingle(),
        'governance.review.item_detail',
      );
      if (!isOk(itemDetailResult)) {
        console.warn(
          'governance.review.item_detail failed — skipping notifications',
          itemDetailResult.error,
        );
      }
      const itemDetail = isOk(itemDetailResult) ? itemDetailResult.data : null;

      const detail = itemDetail as Record<string, unknown> | null;
      const notifyTargets = new Set<string>();

      // Notify content owner first (primary recipient)
      if (detail?.content_owner_id && detail.content_owner_id !== user.id) {
        notifyTargets.add(detail.content_owner_id as string);
      }
      // Also notify last editor if different from owner and reviewer
      if (detail?.updated_by && detail.updated_by !== user.id) {
        notifyTargets.add(detail.updated_by as string);
      }

      for (const targetUserId of notifyTargets) {
        await supabase.from('notifications').insert({
          user_id: targetUserId,
          type: `governance_${action}`,
          entity_type: 'content_item',
          entity_id: item_id,
          title: `Governance review: ${action.replace('_', ' ')}`,
          message: notes ?? null,
        });
      }
    } catch (err) {
      console.warn('Failed to create governance notification:', err);
    }

    return NextResponse.json({
      success: true,
      action,
      item_id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process governance review') },
      { status: 500 },
    );
  }
}
