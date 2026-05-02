import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { NearDupConfirmUniqueBodySchema } from '@/lib/validation/schemas';
import { parsePairId } from '@/lib/dedup/pair-id';

export const maxDuration = 30;

/**
 * POST /api/admin/content-dedup/near-duplicates/[pairId]/confirm-unique
 *
 * §1.9 Near-Duplicate Merge Dashboard confirm-unique action. Flips both
 * pair members' `dedup_status` to `'confirmed_unique'` via the
 * transactional RPC `resolve_near_dup_confirm_unique` (migration
 * `20260429221541_resolve_near_dup_confirm_unique.sql`).
 *
 * The RPC handles BOTH the dedup_status UPDATEs AND the matching
 * content_history snapshot inserts in a single transaction so the audit
 * trail and the row state cannot diverge under partial-failure. The route
 * handler does NOT write a separate content_history row.
 *
 * Idempotency: the RPC short-circuits per-row on already-flipped state;
 * if both rows are already in `confirmed_unique`, no history rows are
 * written but the response is still 200 with the current pair state.
 *
 * Body shape (§5.2):
 *   { note?: string (max 500) }
 *
 * Returns: { pairId, leftDedupStatus: 'confirmed_unique', rightDedupStatus: 'confirmed_unique' }
 *
 * Auth: admin role only.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.6, §4.2, §4.3
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pairId: string }> },
) {
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
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
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
}
