import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth/client';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { data, error } = await supabase.rpc('get_popular_keywords', {
      p_limit: 12,
    });

    if (error) {
      logger.error({ err: error }, 'Failed to fetch popular keywords');
      return NextResponse.json({ keywords: [] });
    }

    const keywords = (data ?? []).map(
      (row: { keyword: string; item_count: number }) => row.keyword,
    );

    return NextResponse.json({ keywords });
  } catch (err) {
    logger.error({ err }, 'Search suggestions error');
    return NextResponse.json({ keywords: [] });
  }
}
