import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/items/:id/owner — assign or clear content owner */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const { owner_id } = raw as { owner_id: string | null };

    // Validate owner_id format if provided
    if (owner_id !== null && owner_id !== undefined) {
      if (typeof owner_id !== 'string' || !UUID_RE.test(owner_id)) {
        return NextResponse.json(
          { error: 'Invalid owner_id — must be a valid UUID or null' },
          { status: 400 },
        );
      }
    }

    const { data, error } = await supabase
      .from('content_items')
      .update({
        content_owner_id: owner_id ?? null,
        updated_by: user.id,
      })
      .eq('id', id)
      .select('id')
      .single();

    if (error || !data) {
      if (!data && !error) {
        return NextResponse.json(
          { error: 'Item not found' },
          { status: 404 },
        );
      }
      console.error('Failed to update content owner:', error);
      return NextResponse.json(
        { error: 'Failed to update content owner' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, owner_id: owner_id ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update content owner') },
      { status: 500 },
    );
  }
}
