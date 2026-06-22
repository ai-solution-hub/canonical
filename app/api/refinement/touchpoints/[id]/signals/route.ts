import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { tryQuery } from '@/lib/supabase/safe';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: touchpointId } = await params;

      const result = await tryQuery(
        supabase
          .from('ai_call_events')
          .select(
            'id, touchpoint_id, model, tier, input_tokens, output_tokens, cost_usd, outcome_signal, created_at',
          )
          .eq('touchpoint_id', touchpointId)
          .order('created_at', { ascending: false }),
        'refinement.touchpoints.signals',
      );

      if (!result.ok) {
        logger.error(
          { err: result.error, op: 'refinement.touchpoints.signals' },
          'Failed to load signals for touchpoint',
        );
        return NextResponse.json(
          { error: 'Failed to load signals' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        touchpoint_id: touchpointId,
        signals: result.data ?? [],
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load signals') },
        { status: 500 },
      );
    }
  },
);
