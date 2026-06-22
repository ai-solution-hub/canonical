/**
 * Fixture: already-wrapped — route already using `defineRoute()`.
 *
 * The classifier (Subtask 32.6) does NOT have an `ALREADY_WRAPPED` verdict in
 * its `RouteShape` discriminated union — idempotency-skip detection is the
 * orthogonal concern owned by Subtask 32.13's `isAlreadyWrapped(sf, method)`.
 * This fixture therefore classifies under its UNDERLYING shape (AUTH_PLAIN —
 * single GET, `getAuthorisedClient`, no params, no body) so the 32.7 harness
 * pins the current contract; 32.13's idempotency tests will assert the
 * downstream skip behaviour against the same fixture file when those tests
 * land.
 *
 * Modelled on a hypothetical post-migration `app/api/insights/route.ts` where
 * the handler has already been rewritten to call `defineRoute()`. Includes
 * both the wrapper import and the wrapped export — the file would be passed
 * to the codemod as a no-op input per PRODUCT §4 (idempotency guarantee).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { defineRoute } from '@/lib/api/define-route';

const ResponseSchema = z.object({ ok: z.boolean() });

export const GET = defineRoute(
  ResponseSchema,
  async (_request: NextRequest) => {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    return NextResponse.json({ ok: true });
  },
);
