// app/api/cron/intelligence-poll/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runPipeline } from '@/lib/intelligence/pipeline';
import { logger } from '@/lib/logger';

export const maxDuration = 120; // 2 minutes for Vercel Pro

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const result = await runPipeline(supabase);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, '[intelligence-poll] Pipeline error');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
