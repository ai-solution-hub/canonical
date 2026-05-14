import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { getAuthenticatedClient } from '@/lib/auth';
import { tryQuery, isOk } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  GovernanceReviewBodySchema,
  GovernanceReviewParamsSchema,
} from '@/lib/validation/schemas';
import {
  ALLOWED_REVIEW_INPUT_STATUSES,
  type AllowedReviewInputStatus,
} from '@/lib/governance/review-input-statuses';
import { computeNextReviewDate } from '@/lib/governance/cadence-renewal';
import { logger } from '@/lib/logger';
import type { Database } from '@/supabase/types/database.types';

type ContentItemUpdate =
  Database['public']['Tables']['content_items']['Update'];

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
    if (!auth.success) return authFailureResponse(auth);
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
        logger.error({ err: error }, 'Failed to count governance reviews');
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
      logger.error({ err: error }, 'Failed to fetch governance reviews');
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

    // Verify the item exists and is pending review.
    // §5.5 Phase 2 T2: also fetch `next_review_date` + `review_cadence_days`
    // (read by the `approve` branch below to compute auto-renewal). The
    // `verified_at` column is selected only to keep the SELECT shape stable
    // for future extension.
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'id, governance_review_status, next_review_date, review_cadence_days, verified_at',
      )
      .eq('id', item_id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (
      !ALLOWED_REVIEW_INPUT_STATUSES.includes(
        item.governance_review_status as AllowedReviewInputStatus,
      )
    ) {
      return NextResponse.json(
        { error: 'Item is not pending governance review' },
        { status: 400 },
      );
    }

    let updateData: ContentItemUpdate;

    switch (action) {
      case 'approve': {
        // §5.5 Phase 2 T2: when an item with a configured cadence is approved,
        // advance `next_review_date` to GREATEST(current, today) + cadence
        // and stamp `verified_at = NOW()`. Items without a cadence
        // (review_cadence_days IS NULL) leave `next_review_date` untouched.
        // Spec §6.5 + §6.9 AC8.
        const nextReviewDate = computeNextReviewDate(
          (item as { next_review_date: string | null }).next_review_date,
          (item as { review_cadence_days: number | null }).review_cadence_days,
        );
        updateData = {
          governance_review_status: 'approved',
          governance_reviewer_id: user.id,
          governance_review_due: null,
          verified_at: new Date().toISOString(),
          ...(nextReviewDate && { next_review_date: nextReviewDate }),
        };
        break;
      }

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
      logger.error({ err: updateError }, 'Failed to process governance review');
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
        logger.warn(
          { err: itemDetailResult.error },
          'governance.review.item_detail failed — skipping notifications',
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
      logger.warn({ err }, 'Failed to create governance notification');
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
