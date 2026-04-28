import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  ReadMarkBodySchema,
  ReadMarkCheckParamsSchema,
} from '@/lib/validation/schemas';

export const maxDuration = 30;

/**
 * GET /api/read-marks?item_ids=uuid1,uuid2,...
 *
 * Returns read status for the specified item IDs.
 * Also returns the user's total read count (for progress tracking)
 * and the total content item count.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const parsed = parseSearchParams(
      ReadMarkCheckParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    // Dual-mode: when item_ids is absent, return counts-only
    if (!parsed.data.item_ids) {
      const [readCountResult, totalCountResult] = await Promise.all([
        supabase
          .from('read_marks')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true }),
      ]);

      return NextResponse.json({
        read_item_ids: [],
        read_count: readCountResult.count ?? 0,
        total_count: totalCountResult.count ?? 0,
      });
    }

    const { item_ids } = parsed.data;

    // Fetch read marks for the specified items + counts in parallel
    const [readResult, readCountResult, totalCountResult] = await Promise.all([
      supabase
        .from('read_marks')
        .select('content_item_id')
        .eq('user_id', user.id)
        .in('content_item_id', item_ids),
      supabase
        .from('read_marks')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true }),
    ]);

    if (readResult.error) {
      console.error('Failed to check read status:', readResult.error);
      return NextResponse.json(
        { error: 'Failed to check read status' },
        { status: 500 },
      );
    }

    const readItemIds = (readResult.data ?? []).map(
      (r: { content_item_id: string }) => r.content_item_id,
    );

    return NextResponse.json({
      read_item_ids: readItemIds,
      read_count: readCountResult.count ?? 0,
      total_count: totalCountResult.count ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to check read marks') },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(ReadMarkBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { action } = parsed.data;

    if (action === 'mark_read') {
      const { item_id, source } = parsed.data;
      const { error } = await supabase
        .from('read_marks')
        .upsert(
          { content_item_id: item_id, source, user_id: user.id },
          { onConflict: 'user_id,content_item_id' },
        );
      if (error) {
        console.error('Failed to mark as read:', error);
        return NextResponse.json(
          { error: 'Failed to mark as read' },
          { status: 500 },
        );
      }
    } else if (action === 'mark_unread') {
      const { item_id } = parsed.data;
      const { error } = await supabase
        .from('read_marks')
        .delete()
        .eq('content_item_id', item_id)
        .eq('user_id', user.id);
      if (error) {
        console.error('Failed to mark as unread:', error);
        return NextResponse.json(
          { error: 'Failed to mark as unread' },
          { status: 500 },
        );
      }
    } else if (action === 'mark_bulk_read') {
      const { item_ids, source } = parsed.data;
      const rows = item_ids.map((id) => ({
        content_item_id: id,
        source,
        user_id: user.id,
      }));
      const { error } = await supabase
        .from('read_marks')
        .upsert(rows, { onConflict: 'user_id,content_item_id' });
      if (error) {
        console.error('Failed to bulk mark as read:', error);
        return NextResponse.json(
          { error: 'Failed to bulk mark as read' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process read mark') },
      { status: 500 },
    );
  }
}
