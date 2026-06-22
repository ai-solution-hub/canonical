import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
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

    const { data, error } = await supabase.rpc('get_quality_issue_counts');

    if (error) {
      logger.error({ err: error }, 'Quality counts query error');
      return NextResponse.json(
        { error: 'Failed to fetch quality issue counts' },
        { status: 500 },
      );
    }

    const counts = (data ?? []) as Array<{
      flag_type: string;
      severity: string;
      open_count: number;
    }>;

    const totalOpen = counts.reduce((sum, r) => sum + r.open_count, 0);
    const byType: Record<string, number> = {};
    for (const r of counts) {
      byType[r.flag_type] = (byType[r.flag_type] ?? 0) + r.open_count;
    }

    return NextResponse.json({
      total_open: totalOpen,
      by_type: byType,
      details: counts,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch quality statistics') },
      { status: 500 },
    );
  }
});
