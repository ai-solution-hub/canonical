import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { deferredOrgansForAnchor } from '@/lib/eval/deferred-organs';
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

      const { id: touchpointId } = await params;

      return NextResponse.json({
        touchpoint_id: touchpointId,
        patterns: [],
        deferred: true,
        // The deferred organ this empty anchor backs ({104.19} / B-INV-24):
        // the cross-touchpoint pattern detector fills this body.
        deferred_organs: deferredOrgansForAnchor('patterns'),
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load patterns') },
        { status: 500 },
      );
    }
  },
);
