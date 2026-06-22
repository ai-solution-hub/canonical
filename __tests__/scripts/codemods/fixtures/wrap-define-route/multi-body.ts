/**
 * Fixture: MULTI_BODY — GET + POST on the same non-parameterised resource
 * path, with a body on POST.
 *
 * Modelled on `app/api/layers/route.ts` / `app/api/bids/route.ts` per
 * route-shape-inventory.md §4.6. Two exported methods, no `[`-bracketed path
 * segment so the classifier disambiguates from `MULTI_PARAM_BODY`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { parseBody } from '@/lib/validation';

const CreateBodySchema = z.object({ name: z.string() });

export async function GET(_request: NextRequest) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  return NextResponse.json({ items: [] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const raw = await request.json();
  const body = parseBody(CreateBodySchema, raw);
  if (!body.success) return body.response;
  return NextResponse.json({ name: body.data.name, id: 'stub' });
}
