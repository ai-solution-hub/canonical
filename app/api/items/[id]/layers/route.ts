import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;
    const { id } = await params;

    // First get the item's topic_id
    const { data: item, error: itemError } = await supabase
      .from('content_items')
      .select('metadata')
      .eq('id', id)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const topicId = (item.metadata as Record<string, unknown>)?.topic_id as
      | string
      | undefined;
    if (!topicId) {
      return NextResponse.json({ layers: [] });
    }

    // Call RPC to get all items with same topic_id
    const { data, error } = await supabase.rpc('get_topic_layers', {
      p_topic_id: topicId,
    });

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch layers') },
        { status: 500 },
      );
    }

    return NextResponse.json({ layers: data ?? [], topic_id: topicId });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch layers') },
      { status: 500 },
    );
  }
}
