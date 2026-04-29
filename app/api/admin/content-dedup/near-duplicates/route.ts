import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { NearDupPairsQuerySchema } from '@/lib/validation/schemas';
import { buildPairId } from '@/lib/dedup/pair-id';

export const maxDuration = 30;

/**
 * GET /api/admin/content-dedup/near-duplicates
 *
 * §1.9 Near-Duplicate Merge Dashboard list endpoint. Returns the candidate
 * pairs above the chosen similarity threshold, excluding any pair where
 * either member has a terminal `dedup_status` (`suspected_duplicate`,
 * `confirmed_duplicate`, `superseded`) — those belong on the §1.7 queue
 * or are already resolved.
 *
 * Query params:
 *   - threshold (0.85-0.99, default 0.95)
 *   - domain    (optional content_items.primary_domain filter)
 *   - limit     (1-200, default 50)
 *
 * Returns: { pairs: NearDupPair[], threshold: number, total: number }
 *
 * Auth: admin role only.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.3
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const url = new URL(request.url);
    const parsed = parseSearchParams(NearDupPairsQuerySchema, url.searchParams);
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
      console.error('[near-duplicates list] RPC error:', rpcErr);
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
        console.error('[near-duplicates list] status lookup error:', statusErr);
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

    return NextResponse.json({
      pairs: livePairs.map((p) => ({
        pairId: buildPairId(p.id1, p.id2),
        id1: p.id1,
        title1: p.title1,
        type1: p.type1,
        domain1: p.domain1,
        id2: p.id2,
        title2: p.title2,
        type2: p.type2,
        domain2: p.domain2,
        similarity: Number(p.similarity),
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
}
