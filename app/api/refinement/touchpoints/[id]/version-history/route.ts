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
          .from('eval_touchpoints')
          .select(
            'touchpoint_id, contract_version, registry_version, kind, owner, suite_name',
          )
          .eq('touchpoint_id', touchpointId)
          .maybeSingle(),
        'refinement.touchpoints.version-history',
      );

      if (!result.ok) {
        logger.error(
          { err: result.error, op: 'refinement.touchpoints.version-history' },
          'Failed to load version history for touchpoint',
        );
        return NextResponse.json(
          { error: 'Failed to load version history' },
          { status: 500 },
        );
      }

      if (!result.data) {
        return NextResponse.json(
          { error: `Touchpoint not registered: ${touchpointId}` },
          { status: 404 },
        );
      }

      const row = result.data;
      return NextResponse.json({
        touchpoint_id: row.touchpoint_id,
        contract_version: row.contract_version,
        registry_version: row.registry_version,
        kind: row.kind,
        owner: row.owner,
        suite_name: row.suite_name,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load version history') },
        { status: 500 },
      );
    }
  },
);
