import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { GovernanceReviewBodySchema } from '@/lib/validation/schemas';

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

    const url = new URL(request.url);
    const countOnly = url.searchParams.get('count_only') === 'true';

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

    // Full list
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
      100,
    );
    const offset = Math.max(
      parseInt(url.searchParams.get('offset') ?? '0', 10) || 0,
      0,
    );

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
    if (!auth) return forbiddenResponse();
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
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
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
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 },
        );
    }

    const { error: updateError } = await supabase
      .from('content_items')
      .update(updateData)
      .eq('id', item_id);

    if (updateError) {
      console.error('Failed to process governance review:', updateError);
      return NextResponse.json(
        { error: 'Failed to process governance review' },
        { status: 500 },
      );
    }

    // Create a notification for the item's last editor if it's not the reviewer
    try {
      const { data: itemDetail } = await supabase
        .from('content_items')
        .select('updated_by')
        .eq('id', item_id)
        .single();

      if (itemDetail?.updated_by && itemDetail.updated_by !== user.id) {
        await supabase.from('notifications').insert({
          user_id: itemDetail.updated_by,
          type: `governance_${action}`,
          entity_type: 'content_item',
          entity_id: item_id,
          title: `Governance review: ${action.replace('_', ' ')}`,
          message: notes ?? null,
        });
      }
    } catch {
      // Notification is best-effort
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
