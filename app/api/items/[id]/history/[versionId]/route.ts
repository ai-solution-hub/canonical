import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/items/[id]/history/[versionId]
 *
 * Retrieve a single version history entry with full content.
 * Used for diff comparison against the current version.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const { id, versionId } = await params;

    if (!UUID_RE.test(id) || !UUID_RE.test(versionId)) {
      return NextResponse.json(
        { error: 'Invalid ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('content_history')
      .select(
        'id, content_item_id, version, title, content, brief, detail, reference, metadata, change_summary, change_type, created_by, created_at',
      )
      .eq('id', versionId)
      .eq('content_item_id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch version') },
      { status: 500 },
    );
  }
}
