import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { parsePairId } from '@/lib/dedup/pair-id';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import {
  NearDupConfirmUniqueBodySchema,
  NearDupConfirmUniqueResultSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const POST = defineRoute(
  NearDupConfirmUniqueResultSchema,
  async (
    request: NextRequest,
    { params }: { params: Promise<{ pairId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { pairId } = await params;
      const parsedPair = parsePairId(pairId);
      if (!parsedPair) {
        return NextResponse.json({ error: 'Invalid pair id' }, { status: 400 });
      }

      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 },
        );
      }
      // Empty body is valid (note is optional) — coerce missing body to {}.
      const body = parseBody(NearDupConfirmUniqueBodySchema, raw ?? {});
      if (!body.success) return body.response;

      // Verify pair existence — the RPC happily returns no rows if the
      // pair-id encodes UUIDs that do not exist; surface that as 404 so
      // the dashboard can route the user back to the list.
      const { data: existing, error: existingErr } = await supabase
        .from('content_items')
        .select('id')
        .in('id', [parsedPair.leftId, parsedPair.rightId]);
      if (existingErr) {
        logger.error(
          {
            err: existingErr,
            op: 'admin.content-dedup.near-duplicates.confirm-unique.precheck',
          },
          '[near-duplicates confirm-unique] pre-check error',
        );
        return NextResponse.json(
          { error: existingErr.message ?? 'Failed to verify pair' },
          { status: 500 },
        );
      }
      if (!existing || existing.length !== 2) {
        return NextResponse.json({ error: 'Pair not found' }, { status: 404 });
      }

      const { error: rpcErr } = await supabase.rpc(
        'resolve_near_dup_confirm_unique',
        {
          p_left_id: parsedPair.leftId,
          p_right_id: parsedPair.rightId,
          p_actor_user_id: user.id,
          p_pair_id: pairId,
          p_note: body.data.note ?? undefined,
          p_similarity_at_resolution:
            body.data.similarity_at_resolution ?? undefined,
          p_threshold_at_resolution:
            body.data.threshold_at_resolution ?? undefined,
        },
      );

      if (rpcErr) {
        logger.error(
          {
            err: rpcErr,
            op: 'admin.content-dedup.near-duplicates.confirm-unique.rpc',
          },
          '[near-duplicates confirm-unique] RPC error',
        );
        return NextResponse.json(
          { error: rpcErr.message ?? 'Failed to confirm pair as unique' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        pairId,
        leftDedupStatus: 'confirmed_unique',
        rightDedupStatus: 'confirmed_unique',
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            err,
            'Failed to confirm near-duplicate pair as unique',
          ),
        },
        { status: 500 },
      );
    }
  },
);
