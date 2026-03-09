import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { PriorityUpdateBodySchema } from '@/lib/validation/schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    const raw = await request.json();
    const parsed = parseBody(PriorityUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { priority } = parsed.data;

    const { data, error } = await supabase
      .from('content_items')
      .update({ priority, updated_by: user.id })
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
      console.error('Failed to update priority:', error);
      return NextResponse.json(
        { error: 'Failed to update priority' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, priority });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update priority') },
      { status: 500 },
    );
  }
}
