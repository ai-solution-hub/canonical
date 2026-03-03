import { NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';

export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { data, error } = await supabase.rpc('get_popular_keywords', {
      p_limit: 12,
    });

    if (error) {
      console.error('Failed to fetch popular keywords:', error);
      return NextResponse.json({ keywords: [] });
    }

    const keywords = (data ?? []).map(
      (row: { keyword: string; item_count: number }) => row.keyword,
    );

    return NextResponse.json({ keywords });
  } catch (err) {
    console.error('Search suggestions error:', err);
    return NextResponse.json({ keywords: [] });
  }
}
