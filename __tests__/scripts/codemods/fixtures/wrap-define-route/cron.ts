/**
 * Fixture: CRON — single POST under `/cron/`, cron-secret auth model (no
 * `getAuthorisedClient`), uses `createServiceClient()` to bypass user-scoped
 * RLS per route-shape-inventory.md §4.7.
 *
 * Codemod verdict: MANUAL per PRODUCT §6.1 — different auth model, no user
 * context. The classifier matches `/cron/` in the synthetic path before any
 * other discriminator runs (TECH §2.3 priority 1) so this fixture exercises
 * the path-first short-circuit; no auth import is needed for the verdict to
 * be CRON.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Production cron routes validate either the `x-vercel-cron` header or
  // `Authorization: Bearer ${CRON_SECRET}`. The fixture mirrors that surface
  // without contacting Supabase — the classifier only inspects file content,
  // not runtime behaviour.
  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (provided !== expected) {
    return new NextResponse('unauthorised', { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
