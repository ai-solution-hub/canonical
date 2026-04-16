// app/api/intelligence/trigger-poll/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { runPipeline } from '@/lib/intelligence/pipeline';

export async function POST() {
  // Admin-only manual trigger
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) return authFailureResponse(auth);

  try {
    const supabase = createServiceClient();
    const result = await runPipeline(supabase);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
