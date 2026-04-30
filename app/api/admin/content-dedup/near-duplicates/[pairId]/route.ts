import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parsePairId } from '@/lib/dedup/pair-id';

export const maxDuration = 30;

/**
 * GET /api/admin/content-dedup/near-duplicates/[pairId]
 *
 * §1.9 Near-Duplicate Merge Dashboard detail endpoint. Returns both
 * pair members + the re-computed similarity score.
 *
 * Similarity is re-computed by re-calling `find_duplicate_pairs` with
 * threshold=0 + limit=200 and post-filtering to the requested pair. A
 * dedicated single-pair RPC is OQ6-deferred.
 *
 * Returns: { left: ContentItem, right: ContentItem, similarity: number }
 *
 * Auth: admin role only.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.4
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pairId: string }> },
) {
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
        'id, title, content, dedup_status, created_at, primary_domain, content_type, content_owner_id, ingest_source, superseded_by, archived_at, publication_status',
      )
      .in('id', [leftId, rightId]);

    if (rowsErr) {
      console.error('[near-duplicates detail] rows lookup error:', rowsErr);
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
      console.error('[near-duplicates detail] RPC error:', pairsErr);
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
}
