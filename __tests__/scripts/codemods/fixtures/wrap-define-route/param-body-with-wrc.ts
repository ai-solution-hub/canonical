/**
 * Fixture: PARAM_BODY+WRC — single POST wrapped in `withRequestContext`,
 * `getAuthorisedClient`, `Promise<{ id }>` params (Next.js 15 async-params
 * style), `parseBody()`.
 *
 * Modelled on the `withRequestContext` sub-variant of the PARAM_BODY shape
 * per route-shape-inventory.md §4.11. The classifier appends `+WRC` to
 * MECHANISABLE / NEEDS-REVIEW shapes whose source contains the
 * `withRequestContext` substring (TECH §2.3). The inner handler preserves the
 * second-argument `{ params }` destructure verbatim; the outer wrapper receives
 * only the first argument (request) as the WRC call signature.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { parseBody } from '@/lib/validation';
import { withRequestContext } from '@/lib/logger';

const BodySchema = z.object({ note: z.string() });

export const POST = withRequestContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { id } = await params;
    const raw = await request.json();
    const body = parseBody(BodySchema, raw);
    if (!body.success) return body.response;
    return NextResponse.json({ id, note: body.data.note });
  },
);
