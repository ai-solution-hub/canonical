import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { parsePairId } from '@/lib/dedup/pair-id';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { NearDupPairDetailSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const GET = defineRoute(
  NearDupPairDetailSchema,
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ pairId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { pairId } = await params;
      const parsed = parsePairId(pairId);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid pair id' }, { status: 400 });
      }
      const { leftId, rightId } = parsed;

      const { data: rows, error: rowsErr } = await supabase
        .from('content_items')
        .select(
          'id, title, content, dedup_status, created_at, primary_domain, content_type, content_owner_id, ingestion_source, superseded_by, archived_at, publication_status',
        )
        .in('id', [leftId, rightId]);

      if (rowsErr) {
        logger.error(
          {
            err: rowsErr,
            op: 'admin.content-dedup.near-duplicates.detail.rows_lookup',
          },
          '[near-duplicates detail] rows lookup error',
        );
        return NextResponse.json(
          { error: rowsErr.message ?? 'Failed to load pair' },
          { status: 500 },
        );
      }
      if (!rows || rows.length !== 2) {
        return NextResponse.json({ error: 'Pair not found' }, { status: 404 });
      }

      // Re-compute similarity. A dedicated single-pair RPC is OQ6-deferred;
      // for v1 we re-call find_duplicate_pairs at threshold 0 + limit 200
      // and post-filter. The cost is acceptable for a single detail load.
      const { data: pairs, error: pairsErr } = await supabase.rpc(
        'find_duplicate_pairs',
        {
          similarity_threshold: 0,
          p_domain: undefined,
          limit_count: 200,
        },
      );
      if (pairsErr) {
        logger.error(
          {
            err: pairsErr,
            op: 'admin.content-dedup.near-duplicates.detail.rpc',
          },
          '[near-duplicates detail] RPC error',
        );
        return NextResponse.json(
          { error: pairsErr.message ?? 'Failed to compute similarity' },
          { status: 500 },
        );
      }

      const match = (pairs ?? []).find(
        (p) =>
          (p.id1 === leftId && p.id2 === rightId) ||
          (p.id1 === rightId && p.id2 === leftId),
      );
      const similarity = match?.similarity ? Number(match.similarity) : 0;

      const left = rows.find((r) => r.id === leftId);
      const right = rows.find((r) => r.id === rightId);
      if (!left || !right) {
        return NextResponse.json({ error: 'Pair not found' }, { status: 404 });
      }

      return NextResponse.json({ left, right, similarity });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load near-duplicate pair') },
        { status: 500 },
      );
    }
  },
);
