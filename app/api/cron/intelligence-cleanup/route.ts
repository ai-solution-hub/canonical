// app/api/cron/intelligence-cleanup/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

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
      console.error('[intelligence-cleanup] RPC error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deletedCount = data ?? 0;
    console.log(
      `[intelligence-cleanup] Cleaned up ${deletedCount} filtered articles older than 90 days`,
    );

    return NextResponse.json({
      success: true,
      deletedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[intelligence-cleanup] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
