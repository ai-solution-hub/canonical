import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  const timestamp = new Date().toISOString();

  // Check required env vars
  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ];
  const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
  const envOk = missingEnvVars.length === 0;

  // Check Supabase connectivity
  let supabaseOk = false;
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { count, error } = await supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true });
      supabaseOk = !error && count !== null;
    }
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
