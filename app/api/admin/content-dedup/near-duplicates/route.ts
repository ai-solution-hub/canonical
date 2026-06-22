import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { buildPairId } from '@/lib/dedup/pair-id';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import {
  NearDupPairsQuerySchema,
  NearDupPairsResponseSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const GET = defineRoute(
  NearDupPairsResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const url = new URL(request.url);
      const parsed = parseSearchParams(
        NearDupPairsQuerySchema,
        url.searchParams,
      );
      if (!parsed.success) return parsed.response;

      const { threshold, domain, limit } = parsed.data;

      const { data: rpcRows, error: rpcErr } = await supabase.rpc(
        'find_duplicate_pairs',
        {
          similarity_threshold: threshold,
          p_domain: domain ?? undefined,
          limit_count: limit,
        },
      );

      if (rpcErr) {
        logger.error(
          { err: rpcErr, op: 'admin.content-dedup.near-duplicates.list.rpc' },
          '[near-duplicates list] RPC error',
        );
        return NextResponse.json(
          { error: rpcErr.message ?? 'Failed to load duplicate pairs' },
          { status: 500 },
        );
      }

      const pairs = rpcRows ?? [];

      // Filter out pairs whose either side is in a terminal dedup state.
      // The RPC already excludes archived rows + rows without embeddings,
      // but does NOT consider dedup_status. §1.7 owns suspected/confirmed
      // duplicates; supersession sets superseded; v1 of §1.9 lists only
      // truly-actionable rows.
      const TERMINAL = new Set([
        'suspected_duplicate',
        'confirmed_duplicate',
        'superseded',
      ]);

      let livePairs = pairs;
      if (pairs.length > 0) {
        const ids = Array.from(new Set(pairs.flatMap((p) => [p.id1, p.id2])));
        const { data: statusRows, error: statusErr } = await supabase
          .from('content_items')
          .select('id, dedup_status')
          .in('id', ids);

        if (statusErr) {
          logger.error(
            {
              err: statusErr,
              op: 'admin.content-dedup.near-duplicates.list.status_lookup',
            },
            '[near-duplicates list] status lookup error',
          );
          return NextResponse.json(
            {
              error: statusErr.message ?? 'Failed to load pair dedup statuses',
            },
            { status: 500 },
          );
        }

        const statusMap = new Map(
          (statusRows ?? []).map((r) => [r.id, r.dedup_status]),
        );
        livePairs = pairs.filter((p) => {
          const s1 = statusMap.get(p.id1);
          const s2 = statusMap.get(p.id2);
          return !TERMINAL.has(s1 ?? '') && !TERMINAL.has(s2 ?? '');
        });
      }

      // Remap RPC's flat ordinal columns (`id1`, `title1`, …) into the
      // nested `{ left, right }` shape that the fetcher's `NearDupPair`
      // type and the dashboard list view consume directly. This keeps the
      // API↔fetcher↔component contract aligned (V_W1 F1).
      return NextResponse.json({
        pairs: livePairs.map((p) => ({
          pairId: buildPairId(p.id1, p.id2),
          similarity: Number(p.similarity),
          left: {
            id: p.id1,
            title: p.title1 ?? null,
            contentType: p.type1 ?? null,
            primaryDomain: p.domain1 ?? null,
          },
          right: {
            id: p.id2,
            title: p.title2 ?? null,
            contentType: p.type2 ?? null,
            primaryDomain: p.domain2 ?? null,
          },
        })),
        threshold,
        total: livePairs.length,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load near-duplicate pairs') },
        { status: 500 },
      );
    }
  },
);
