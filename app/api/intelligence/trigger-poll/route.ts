// app/api/intelligence/trigger-poll/route.ts
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { runPipeline } from '@/lib/intelligence/pipeline';
import { createServiceClient } from '@/lib/supabase/server';
import { TriggerPollResponseSchema } from '@/lib/validation/schemas';
import { NextResponse } from 'next/server';

export const POST = defineRoute(TriggerPollResponseSchema, async () => {
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
});
