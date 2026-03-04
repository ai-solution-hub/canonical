import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ReadMarkBodySchema } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
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
      const rows = item_ids.map((id) => ({ content_item_id: id, source, user_id: user.id }));
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
