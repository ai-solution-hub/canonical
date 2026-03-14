import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/workspaces/[id]/items — recent items assigned to a workspace */
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
        { error: 'Invalid workspace ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? '10')),
      50,
    );

    const { data, error } = await supabase
      .from('content_item_workspaces')
      .select(
        `
        assigned_at,
        content_items!inner (
          id, suggested_title, content_type, captured_date
        )
      `,
      )
      .eq('workspace_id', id)
      .order('assigned_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch workspace items:', error);
      return NextResponse.json(
        { error: 'Failed to fetch workspace items' },
        { status: 500 },
      );
    }

    // Flatten the nested response for easier client consumption
    const items = (data ?? []).map((row) => ({
      assigned_at: row.assigned_at,
      ...(row.content_items as unknown as {
        id: string;
        suggested_title: string | null;
        content_type: string | null;
        captured_date: string | null;
      }),
    }));

    return NextResponse.json(items);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch workspace items') },
      { status: 500 },
    );
  }
}
