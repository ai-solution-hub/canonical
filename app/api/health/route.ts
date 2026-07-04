import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * /api/health is the runtime drift-detector for env validation.
 *
 * In normal operation, boot-time Zod validation in lib/env*.ts already
 * guarantees these vars are present — the build fails if any required
 * one is missing. But if a future deployment ever bypasses validation
 * (e.g. someone marks a previously-required field optional or stubs the
 * parse for a debug build), this route is the only place that surfaces
 * that drift to monitoring dashboards. That is why this route reads
 * process.env directly by literal name — substituting clientEnv.X here
 * would defeat the purpose of the check.
 *
 * Variable names match the new schema (post-WP-FU.1 rename): publishable
 * key not anon key, service-role key not secret key.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ];
  const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
  const envOk = missingEnvVars.length === 0;

  let supabaseOk = false;
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      // ID-131 {131.19}: content_items dies wholesale at M6 — smoke count
      // re-pointed onto source_documents (a live, permanent typed record).
      const { count, error } = await supabase
        .from('source_documents')
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
      version: process.env.NEXT_PUBLIC_RELEASE_VERSION ?? 'unknown',
    },
    { status: statusCode },
  );
}
