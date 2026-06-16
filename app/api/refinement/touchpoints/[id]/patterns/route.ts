import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

/**
 * GET /api/refinement/touchpoints/[id]/patterns
 *
 * Ships PRESENT-BUT-EMPTY — returns an empty-200 with a stable shape.
 * NOT 404/absent. Backs the deferred cross-touchpoint pattern-detector
 * organ (T24 / {104.19}); the follow-up only fills the body.
 *
 * Admin-gated — NOT in proxy.ts publicRoutes.
 *
 * ID-104.16 — T22 / B-INV-22, T24 / B-INV-24.
 * Spec: specs/id-104-eval-engine/TECH.md §T22.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);

    const { id: touchpointId } = await params;

    return NextResponse.json({
      touchpoint_id: touchpointId,
      patterns: [],
      deferred: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load patterns') },
      { status: 500 },
    );
  }
}
