/**
 * Fixture: PARAM+WRC — single GET wrapped in `withRequestContext`,
 * `getAuthorisedClient`, `Promise<{ canonical_name }>` params (Next.js 15
 * async-params style), no body.
 *
 * Modelled on the `withRequestContext` sub-variant of the PARAM shape per
 * route-shape-inventory.md §4.11. The classifier appends `+WRC` to
 * MECHANISABLE / NEEDS-REVIEW shapes whose source contains the
 * `withRequestContext` substring (TECH §2.3). The inner handler preserves the
 * second-argument `{ params }` destructure verbatim. The discriminator
 * substrings for body presence are intentionally NOT named in this comment so
 * the classifier's substring sweep over `getFullText()` does not match them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { withRequestContext } from '@/lib/logger';

export const GET = withRequestContext(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ canonical_name: string }> },
  ) => {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { canonical_name } = await params;
    return NextResponse.json({ canonical_name, type: 'organisation' });
  },
);
