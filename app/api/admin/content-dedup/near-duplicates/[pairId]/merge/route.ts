import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { NearDupMergeBodySchema } from '@/lib/validation/schemas';
import { setSupersession, SupersessionError } from '@/lib/supersession/set';
import { parsePairId } from '@/lib/dedup/pair-id';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

export const maxDuration = 30;

/**
 * POST /api/admin/content-dedup/near-duplicates/[pairId]/merge
 *
 * §1.9 Near-Duplicate Merge Dashboard merge action. Admin chooses the
 * direction in the body (`oldId` retired, `newId` kept); the route
 * validates that both ids match the URL pair, calls `setSupersession`,
 * and writes an explicit `content_history` snapshot row against the
 * retired row with `change_reason='dedup_admin_review_near_dup_merged'`.
 *
 * Body shape (§5.2):
 *   {
 *     oldId: uuid,            // retired row
 *     newId: uuid,            // canonical / replacement row
 *     similarity_at_resolution?: number,  // OQ2 audit context (0..1)
 *     threshold_at_resolution?: number,   // OQ2 audit context (0.85..0.99)
 *     note?: string (max 500),
 *   }
 *
 * Returns: { pairId, oldId, newId, dedup_status: 'superseded' }
 *
 * Errors:
 *   - 400: invalid pair id, malformed body, oldId/newId not members of pair
 *   - 401/403/500: auth / RBAC via authFailureResponse
 *   - 404: SupersessionError OLD_NOT_FOUND / NEW_NOT_FOUND
 *   - 409: SupersessionError SAME_ID / OLD_ALREADY_SUPERSEDED /
 *          NEW_ALREADY_SUPERSEDED
 *
 * Auth: admin role only. SupersessionError messages contain raw UUIDs;
 * leaking them is admin-safe per `lib/supersession/set.ts:24-26`.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.5, §4.2, §4.3
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
    const body = parseBody(NearDupMergeBodySchema, raw ?? {});
    if (!body.success) return body.response;
    const { oldId, newId, note } = body.data;

    // Pair-membership guard: both oldId AND newId must be exactly the
    // two ids encoded in the URL pair-id. Catches the "merge across
    // unrelated pairs via direct API call" attack vector. Also requires
    // oldId !== newId (the Zod refine() check covers this, but defence-
    // in-depth: the helper would raise SAME_ID otherwise).
    const expected = new Set([parsedPair.leftId, parsedPair.rightId]);
    if (!expected.has(oldId) || !expected.has(newId)) {
      return NextResponse.json(
        { error: 'oldId/newId must match pair members' },
        { status: 400 },
      );
    }

    // Fetch the loser row before the supersession call so we can write a
    // full content_history snapshot afterwards (matches §1.7 pattern).
    // The supersession helper validates existence itself, so this is a
    // best-effort read for the snapshot. If the read fails we still call
    // the helper — the helper raises OLD_NOT_FOUND if appropriate.
    const { data: loserRow, error: loserErr } = await supabase
      .from('content_items')
      .select(
        'id, title, suggested_title, content, brief, detail, reference, metadata',
      )
      .eq('id', oldId)
      .maybeSingle();

    if (loserErr) {
      logBestEffortWarn(
        'admin.dedup.near_dup_merge.loser_load',
        'Failed to pre-load loser row for history snapshot; continuing',
        { oldId, error: loserErr },
      );
    }

    try {
      await setSupersession({ oldId, newId, actorUserId: user.id }, supabase);
    } catch (helperErr) {
      if (helperErr instanceof SupersessionError) {
        if (
          helperErr.code === 'OLD_NOT_FOUND' ||
          helperErr.code === 'NEW_NOT_FOUND'
        ) {
          return NextResponse.json(
            { error: helperErr.message, code: helperErr.code },
            { status: 404 },
          );
        }
        if (
          helperErr.code === 'SAME_ID' ||
          helperErr.code === 'OLD_ALREADY_SUPERSEDED' ||
          helperErr.code === 'NEW_ALREADY_SUPERSEDED'
        ) {
          return NextResponse.json(
            { error: helperErr.message, code: helperErr.code },
            { status: 409 },
          );
        }
        // Unmapped SupersessionError → 500 (defensive).
        return NextResponse.json(
          { error: helperErr.message, code: helperErr.code },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: safeErrorMessage(helperErr, 'Failed to merge pair') },
        { status: 500 },
      );
    }

    // Pull OQ2 audit context off the request body (Zod schema treats
    // unknown keys as stripped, so we re-read the raw body for these
    // optional metadata-only fields). Pre-validated to be numeric finite
    // values within the dashboard's exposed range; if a malformed value
    // arrives it lands in metadata as-is and surfaces in audit review.
    const rawBody = raw as Record<string, unknown> | null;
    const similarityAtResolution =
      typeof rawBody?.similarity_at_resolution === 'number'
        ? rawBody.similarity_at_resolution
        : null;
    const thresholdAtResolution =
      typeof rawBody?.threshold_at_resolution === 'number'
        ? rawBody.threshold_at_resolution
        : null;

    // Explicit content_history snapshot — UPDATE-side trigger does not
    // exist (per §1.7 OQ1); routes write their own audit row. version
    // sequence is per-row; lookup the latest version for the loser id.
    const { data: latestHistory, error: latestHistoryErr } = await supabase
      .from('content_history')
      .select('version')
      .eq('content_item_id', oldId)
      .order('version', { ascending: false })
      .limit(1);

    if (latestHistoryErr) {
      logBestEffortWarn(
        'admin.dedup.near_dup_merge.history_version_lookup',
        'Failed to read latest content_history version for loser',
        { oldId, error: latestHistoryErr },
      );
    }

    const nextVersion = (latestHistory?.[0]?.version ?? 0) + 1;

    const baseLoserMeta =
      loserRow?.metadata &&
      typeof loserRow.metadata === 'object' &&
      !Array.isArray(loserRow.metadata)
        ? (loserRow.metadata as Record<string, unknown>)
        : {};

    const historyMetadata = {
      ...baseLoserMeta,
      pairId,
      oldId,
      newId,
      peerId: newId,
      dedup_review_action: 'near_dup_merge',
      similarity_at_resolution: similarityAtResolution,
      threshold_at_resolution: thresholdAtResolution,
      note: note ?? null,
    };

    const summary = note
      ? `Merged via admin near-dup review (${oldId} retired → ${newId}): ${note}`
      : `Merged via admin near-dup review (${oldId} retired → ${newId})`;

    const { error: historyErr } = await supabase
      .from('content_history')
      .insert({
        content_item_id: oldId,
        version: nextVersion,
        title: loserRow?.title || loserRow?.suggested_title || 'Untitled',
        content: loserRow?.content || '',
        brief: loserRow?.brief ?? null,
        detail: loserRow?.detail ?? null,
        reference: loserRow?.reference ?? null,
        metadata: historyMetadata,
        change_type: 'merge',
        change_summary: summary,
        change_reason: 'dedup_admin_review_near_dup_merged',
        created_by: user.id,
      });

    if (historyErr) {
      logBestEffortWarn(
        'admin.dedup.near_dup_merge.history_insert',
        'Failed to insert near-dup merge audit history',
        { oldId, newId, pairId, error: historyErr },
      );
    }

    return NextResponse.json({
      pairId,
      oldId,
      newId,
      dedup_status: 'superseded',
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to merge near-duplicate pair') },
      { status: 500 },
    );
  }
}
