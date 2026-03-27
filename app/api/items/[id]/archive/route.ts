import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/items/:id/archive
 *
 * Soft-archives a content item by setting archived_at, archived_by, and
 * archive_reason. Requires editor or admin role.
 *
 * Body: { reason: string }
 * Returns the updated item on success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;

    // Validate UUID format
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const { reason } = body as { reason?: unknown };

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return NextResponse.json(
        { error: 'reason is required and must be a non-empty string' },
        { status: 400 },
      );
    }

    // Archive the content item
    const { data, error } = await supabase
      .from('content_items')
      .update({
        archived_at: new Date().toISOString(),
        archived_by: user.id,
        archive_reason: reason.trim(),
      })
      .eq('id', id)
      .select('id, title, archived_at, archived_by, archive_reason')
      .single();

    if (error) {
      console.error('Failed to archive content item:', error);
      return NextResponse.json(
        { error: 'Failed to archive item' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Item not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to archive item') },
      { status: 500 },
    );
  }
}
