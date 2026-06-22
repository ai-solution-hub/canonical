/**
 * Fixture: PARAM — single GET, `getAuthorisedClient`, `Promise<{ canonical_name }>`
 * params (Next.js 15 async-params style), no body.
 *
 * Modelled on `app/api/entities/[canonical_name]/route.ts` per
 * route-shape-inventory.md §4.4. The classifier disambiguates PARAM from
 * PARAM_BODY via the absence of the JSON-payload and Zod-parse substrings
 * inside the file's full text; the second-argument context destructure does
 * NOT introduce those substrings. (The discriminator substrings are
 * intentionally NOT named in this comment so the classifier's substring
 * sweep over `getFullText()` does not match them.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ canonical_name: string }> },
) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { canonical_name } = await params;
  return NextResponse.json({ canonical_name, type: 'organisation' });
}
