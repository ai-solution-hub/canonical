import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/items/[id]/history
 *
 * List version history for a content item, ordered by version descending.
 * Supports pagination via ?limit=N&offset=N query params.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
      100,
    );
    const offset = Math.max(
      parseInt(url.searchParams.get('offset') ?? '0', 10) || 0,
      0,
    );

    const { data, error, count } = await supabase
      .from('content_history')
      .select('id, content_item_id, version, title, change_summary, change_type, created_by, created_at', { count: 'exact' })
      .eq('content_item_id', id)
      .order('version', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch version history:', error);
      return NextResponse.json(
        { error: 'Failed to fetch version history' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      versions: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch version history') },
      { status: 500 },
    );
  }
}
