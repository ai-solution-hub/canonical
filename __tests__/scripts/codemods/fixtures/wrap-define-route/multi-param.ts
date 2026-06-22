/**
 * Fixture: MULTI_PARAM — GET + DELETE on the same parameterised resource path,
 * no body on either method.
 *
 * Modelled on `app/api/items/[id]/files/route.ts` per route-shape-inventory.md
 * §4.9. Two exported methods, `[`-bracketed path segment, and crucially
 * NONE of the substrings the classifier sweeps for as the body-discriminator.
 * (Those substrings are intentionally omitted from this comment so the
 * `getFullText()` substring scan does not match them.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { id } = await params;
  return NextResponse.json({ id, files: [] });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) return authFailureResponse(auth);
  const { id } = await params;
  return NextResponse.json({ id, deleted: true });
}
