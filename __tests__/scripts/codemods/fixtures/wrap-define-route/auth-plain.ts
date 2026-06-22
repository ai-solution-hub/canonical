/**
 * Fixture: AUTH_PLAIN — single GET, `getAuthorisedClient`, no params, no body.
 *
 * Modelled on `app/api/insights/route.ts` / `app/api/activity/route.ts` per
 * route-shape-inventory.md §4.1. Used by `wrap-define-route.test.ts` fixture
 * harness; the file's content provides the classifier's auth-import +
 * single-method signals.
 *
 * The fixture is loaded into a virtual ts-morph `Project` by the harness with
 * a synthetic filePath (e.g. `/repo/app/api/insights/route.ts`); the path is
 * supplied at load time so the classifier's path-based discriminators
 * (`/cron/`, `/mcp/`, `[id]`) can be exercised without the fixture having to
 * live in a contrived directory tree.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';

export async function GET(_request: NextRequest) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  return NextResponse.json({ ok: true });
}
