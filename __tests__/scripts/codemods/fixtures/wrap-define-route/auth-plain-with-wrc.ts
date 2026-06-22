/**
 * Fixture: AUTH_PLAIN+WRC — single GET wrapped in `withRequestContext`,
 * `getAuthorisedClient`, no params, no body.
 *
 * Modelled on the `withRequestContext` sub-variant called out in
 * route-shape-inventory.md §4.11. The classifier appends `+WRC` to
 * MECHANISABLE / NEEDS-REVIEW shapes whose source contains the
 * `withRequestContext` substring (TECH §2.3); preserving the outer-wrap order
 * during rewrite is the AC-7 / TECH §8.1 concern owned by Subtask 32.10.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { withRequestContext } from '@/lib/logger';

export const GET = withRequestContext(async (_request: NextRequest) => {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  return NextResponse.json({ ok: true });
});
