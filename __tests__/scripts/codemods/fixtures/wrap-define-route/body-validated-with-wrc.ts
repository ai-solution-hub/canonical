/**
 * Fixture: BODY_VALIDATED+WRC — single POST wrapped in `withRequestContext`,
 * `getAuthorisedClient`, no params, `request.json()` + `parseBody()`.
 *
 * Modelled on the `withRequestContext` sub-variant of the BODY_VALIDATED shape
 * per route-shape-inventory.md §4.11. The classifier appends `+WRC` to
 * MECHANISABLE / NEEDS-REVIEW shapes whose source contains the
 * `withRequestContext` substring (TECH §2.3); both `request.json()` and
 * `parseBody(` substrings remain present inside the wrapped handler so the
 * body-signal discriminator fires correctly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { parseBody } from '@/lib/validation';
import { withRequestContext } from '@/lib/logger';

const SearchBodySchema = z.object({ query: z.string() });

export const POST = withRequestContext(async (request: NextRequest) => {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  // Read the raw payload first so the `request.json()` substring is present,
  // then re-parse via the validation helper. Mirrors a small number of
  // production routes that inspect the raw body before delegating to Zod.
  const raw = await request.json();
  const body = parseBody(SearchBodySchema, raw);
  if (!body.success) return body.response;
  return NextResponse.json({ query: body.data.query, hits: [] });
});
