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
        proposals: [],
        deferred: true,
        // The deferred organs this empty anchor backs ({104.19} / B-INV-24):
        // the parallel A/B runner + the auto-rollback registry fill this body.
        deferred_organs: deferredOrgansForAnchor('proposals'),
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load proposals') },
        { status: 500 },
      );
    }
  },
);
