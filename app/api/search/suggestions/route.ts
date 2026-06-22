import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async () => {
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
});
