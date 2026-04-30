// app/api/cron/intelligence-cleanup/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const maxDuration = 30; // Cleanup is fast — 30s is plenty

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('cleanup_filtered_articles');

    if (error) {
      logger.error({ err: error.message }, '[intelligence-cleanup] RPC error');
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deletedCount = data ?? 0;
    logger.info(
      `[intelligence-cleanup] Cleaned up ${deletedCount} filtered articles older than 90 days`,
    );

    return NextResponse.json({
      success: true,
      deletedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, '[intelligence-cleanup] Error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
