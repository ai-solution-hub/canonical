import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { clientEnv } from '@/lib/env-client';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const timestamp = new Date().toISOString();

  // Boot-time Zod validation in lib/env*.ts already guarantees that all
  // required vars are present — if we got here, they're all set. Keep the
  // runtime check anyway so /api/health continues to surface "degraded"
  // (rather than 500) if any future optional field is added and unset.
  const requiredVars = {
    NEXT_PUBLIC_SUPABASE_URL: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    ANTHROPIC_API_KEY: serverEnv.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: serverEnv.OPENAI_API_KEY,
  };
  const envOk = Object.values(requiredVars).every((v) => Boolean(v));

  // Check Supabase connectivity
  let supabaseOk = false;
  try {
    const supabase = createClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    const { count, error } = await supabase
      .from('content_items')
      .select('*', { count: 'exact', head: true });
    supabaseOk = !error && count !== null;
  } catch {
    supabaseOk = false;
  }

  const status = envOk && supabaseOk ? 'ok' : 'degraded';
  const statusCode = status === 'ok' ? 200 : 503;

  return NextResponse.json(
    {
      status,
      supabase: supabaseOk,
      env: envOk,
      timestamp,
    },
    { status: statusCode },
  );
}
