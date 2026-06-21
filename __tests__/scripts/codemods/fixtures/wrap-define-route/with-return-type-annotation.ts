/**
 * Fixture: with-return-type-annotation — Source B inference path.
 *
 * The handler carries a `Promise<NextResponse<X>>` return-type annotation per
 * TECH §3.B. Subtask 32.9 will extract `X` (here `ReviewQueueResponse`) and
 * resolve it via the same name-convention lookup as Source A
 * (`${interfaceName}Schema`).
 *
 * Modelled on one of the 2 `route-only` annotated routes from R-WP17. The
 * annotation is a rare pattern in the current codebase — most routes return
 * `NextResponse.json()` without an explicit return-type annotation. The
 * fixture pins the shape so 32.9's `extractNextResponseTypeArg()` has a
 * predictable input.
 *
 * For the 32.7 classifier harness this fixture is just an AUTH_PLAIN route —
 * the Source B extraction contract is owned by Subtask 32.9 and is gated by
 * TECH §3's "recommended ranking" (Source B is optional).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

interface ReviewQueueResponse {
  items: ReadonlyArray<{ id: string; title: string }>;
  total: number;
}

export async function GET(
  _request: NextRequest,
): Promise<NextResponse<ReviewQueueResponse>> {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) {
    // Auth failure response is shape-incompatible with the annotated success
    // type — production routes that DO carry this annotation handle the
    // success branch only via the annotation and let the auth-failure branch
    // surface as `unknown` to the framework. Modelled here with a typed cast
    // so the annotation extraction (Subtask 32.9) sees a clean
    // `NextResponse<ReviewQueueResponse>` at the return-type position.
    return authFailureResponse(
      auth,
    ) as unknown as NextResponse<ReviewQueueResponse>;
  }
  return NextResponse.json<ReviewQueueResponse>({ items: [], total: 0 });
}
