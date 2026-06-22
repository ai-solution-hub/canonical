/**
 * Fixture: BODY_VALIDATED — single POST, `getAuthorisedClient`, no params,
 * `request.json()` + `parseBody()`.
 *
 * Modelled on `app/api/search/route.ts` / `app/api/embed/route.ts` per
 * route-shape-inventory.md §4.3. The classifier detects the body signal via
 * the `request.json()` and `parseBody(` substrings in the file's full text
 * (TECH §2.3); both are present here so the discriminator fires regardless of
 * which substring the implementation checks first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { parseBody } from '@/lib/validation';

const SearchBodySchema = z.object({ query: z.string() });

export async function POST(request: NextRequest) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  // Read the raw payload first so the `request.json()` substring is present,
  // then re-parse via the validation helper. Mirrors a small number of
  // production routes that inspect the raw body before delegating to Zod.
  const raw = await request.json();
  const body = parseBody(SearchBodySchema, raw);
  if (!body.success) return body.response;
  return NextResponse.json({ query: body.data.query, hits: [] });
}
