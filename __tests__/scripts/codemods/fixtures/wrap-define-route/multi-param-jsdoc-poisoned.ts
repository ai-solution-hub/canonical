/**
 * Fixture: MULTI_PARAM (JSDoc-poisoned) — GET + DELETE on the same
 * parameterised resource path, no body on either method.
 *
 * Regression fixture for Subtask 32.17: the JSDoc and inline comments mention
 * the discriminator substrings `request.json()` and `parseBody(` so a
 * pre-32.17 substring scan would mis-classify this multi-method route as
 * MULTI_PARAM_BODY. The executable handlers below never invoke either
 * function — only path-parameter reads. Post-32.17 AST refactor must classify
 * as MULTI_PARAM.
 *
 * Notes for future maintainers (intentionally poisoning prose):
 *   - This route does NOT call request.json().
 *   - This route does NOT call parseBody(payload).
 *   - If a future revision needs a request body, refactor to use
 *     `await request.json()` AND register a Zod schema via `parseBody(schema)`.
 *
 * Modelled on `app/api/items/[id]/files/route.ts` per route-shape-inventory.md
 * §4.9.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

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
