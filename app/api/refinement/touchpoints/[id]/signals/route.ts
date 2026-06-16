import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

/**
 * GET /api/refinement/touchpoints/[id]/signals
 *
 * Returns per-touchpoint `ai_call_events` rows (unprocessed signals) for the
 * given touchpoint id. Admin-gated — non-admins receive an authFailureResponse.
 * NOT in proxy.ts publicRoutes (admin-only; non-admins redirect to /login).
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
      .from('ai_call_events')
      .select(
        'id, touchpoint_id, model, tier, input_tokens, output_tokens, cost_usd, outcome_signal, created_at',
      )
      .eq('touchpoint_id', touchpointId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error(
        { err: error, op: 'refinement.touchpoints.signals' },
        'Failed to load signals for touchpoint',
      );
      return NextResponse.json(
        { error: 'Failed to load signals' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      touchpoint_id: touchpointId,
      signals: data ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load signals') },
      { status: 500 },
    );
  }
}
