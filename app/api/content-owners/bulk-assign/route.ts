import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { BulkOwnerAssignSchema } from '@/lib/validation/schemas';

export const maxDuration = 60;

/**
 * POST /api/content-owners/bulk-assign
 *
 * Bulk assign a content owner to multiple items.
 * Admin-only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(BulkOwnerAssignSchema, raw);
    if (!parsed.success) return parsed.response;

    const { item_ids, filter, owner_id } = parsed.data;

    let itemIds: string[];

    if (item_ids) {
      // Use explicit list
      itemIds = item_ids;
    } else if (filter) {
      // Query content_items with filters to resolve IDs
      let query = supabase
        .from('content_items')
        .select('id');

      if (filter.domain) {
        query = query.eq('primary_domain', filter.domain);
      }
      if (filter.subtopic) {
        query = query.eq('primary_subtopic', filter.subtopic);
      }
      if (filter.content_type) {
        query = query.eq('content_type', filter.content_type);
      }
      if (filter.unowned_only) {
        // Column exists in DB but types not yet regenerated
        query = query.is('content_owner_id' as 'id', null);
      }

      query = query.limit(500);

      const { data: items, error: queryError } = await query;

      if (queryError) {
        return NextResponse.json(
          { error: safeErrorMessage(queryError, 'Failed to query content items') },
          { status: 500 },
        );
      }

      itemIds = (items ?? []).map((item) => item.id);
    } else {
      // Should not reach here due to Zod refinement, but handle gracefully
      return NextResponse.json(
        { error: 'Either item_ids or filter must be provided' },
        { status: 400 },
      );
    }

    if (itemIds.length === 0) {
      return NextResponse.json({ success: true, items_updated: 0 });
    }

    // Cap at 500
    if (itemIds.length > 500) {
      itemIds = itemIds.slice(0, 500);
    }

    // Call bulk_assign_content_owner RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'bulk_assign_content_owner',
      {
        p_item_ids: itemIds,
        p_owner_id: owner_id,
        p_assigned_by: user.id,
      },
    ) as { data: number | null; error: { message: string } | null };

    if (rpcError) {
      return NextResponse.json(
        { error: safeErrorMessage(rpcError, 'Failed to bulk assign content owner') },
        { status: 500 },
      );
    }

    const count = typeof rpcResult === 'number' ? rpcResult : itemIds.length;

    // Create a single notification for the new owner summarising the bulk action
    if (owner_id !== user.id) {
      try {
        await supabase.from('notifications').insert({
          user_id: owner_id,
          type: 'owner_assignment',
          entity_type: 'content_item',
          entity_id: itemIds[0],
          title: `You have been assigned as owner of ${count} content item${count === 1 ? '' : 's'}`,
          message: null,
        });
      } catch (err) {
        console.warn('Failed to create bulk owner assignment notification:', err);
      }
    }

    return NextResponse.json({ success: true, items_updated: count });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to bulk assign content owner') },
      { status: 500 },
    );
  }
}
