import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/refinement/touchpoints/[id]/version-history
 *
 * Returns the current `contract_version` and `registry_version` for the
 * given touchpoint, read from `eval_touchpoints` (T5 / B-INV-5).
 * Intended for operator use via curl to check when a touchpoint's contract
 * last advanced.
 *
 * Admin-gated — NOT in proxy.ts publicRoutes.
 *
 * ID-104.16 — T22 / B-INV-22.
 * Spec: specs/id-104-eval-engine/TECH.md §T22.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: touchpointId } = await params;

    const { data, error } = await supabase
      .from('eval_touchpoints')
      .select(
        'touchpoint_id, contract_version, registry_version, kind, owner, suite_name',
      )
      .eq('touchpoint_id', touchpointId)
      .maybeSingle();

    if (error) {
      logger.error(
        { err: error, op: 'refinement.touchpoints.version-history' },
        'Failed to load version history for touchpoint',
      );
      return NextResponse.json(
        { error: 'Failed to load version history' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: `Touchpoint not registered: ${touchpointId}` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      touchpoint_id: data.touchpoint_id,
      contract_version: data.contract_version,
      registry_version: data.registry_version,
      kind: data.kind,
      owner: data.owner,
      suite_name: data.suite_name,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load version history') },
      { status: 500 },
    );
  }
}
