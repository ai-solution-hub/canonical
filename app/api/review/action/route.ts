import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ReviewActionBodySchema } from '@/lib/validation/schemas';

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(ReviewActionBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { item_id, action } = parsed.data;

    if (action === 'read') {
      const { error } = await supabase
        .from('read_marks')
        .upsert(
          { content_item_id: item_id, source: 'review' },
          { onConflict: 'content_item_id' },
        );

      if (error) {
        console.error('Failed to mark as read:', error);
        return NextResponse.json(
          { error: 'Failed to mark item as read' },
          { status: 500 },
        );
      }
    } else if (action === 'star') {
      const { error: starError } = await supabase.rpc('toggle_star', {
        p_item_id: item_id,
        p_starred: true,
      });

      if (starError) {
        console.error('Failed to star item:', starError);
        return NextResponse.json(
          { error: 'Failed to star item' },
          { status: 500 },
        );
      }

      // Also mark as read when starring
      await supabase
        .from('read_marks')
        .upsert(
          { content_item_id: item_id, source: 'review' },
          { onConflict: 'content_item_id' },
        );
    } else if (action === 'undo_read') {
      const { error } = await supabase
        .from('read_marks')
        .delete()
        .eq('content_item_id', item_id);

      if (error) {
        console.error('Failed to undo read mark:', error);
        return NextResponse.json(
          { error: 'Failed to undo read mark' },
          { status: 500 },
        );
      }
    } else if (action === 'undo_star') {
      const { error: unstarError } = await supabase.rpc('toggle_star', {
        p_item_id: item_id,
        p_starred: false,
      });

      if (unstarError) {
        console.error('Failed to unstar item:', unstarError);
        return NextResponse.json(
          { error: 'Failed to unstar item' },
          { status: 500 },
        );
      }

      // Also remove the read mark that was created with the star
      await supabase.from('read_marks').delete().eq('content_item_id', item_id);
    }
    // action === 'skip': no database operation needed

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process review action') },
      { status: 500 },
    );
  }
}
