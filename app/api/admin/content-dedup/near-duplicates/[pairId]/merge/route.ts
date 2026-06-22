import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { parsePairId } from '@/lib/dedup/pair-id';
import { safeErrorMessage } from '@/lib/error';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { setSupersession, SupersessionError } from '@/lib/supersession/set';
import { parseBody } from '@/lib/validation';
import {
  NearDupMergeBodySchema,
  NearDupMergeResultSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

export const POST = defineRoute(
  NearDupMergeResultSchema,
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
      const body = parseBody(NearDupMergeBodySchema, raw ?? {});
      if (!body.success) return body.response;
      const {
        oldId,
        newId,
        note,
        similarity_at_resolution: similarityAtResolution,
        threshold_at_resolution: thresholdAtResolution,
      } = body.data;

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

      // OQ2 audit context (`similarity_at_resolution`, `threshold_at_resolution`)
      // arrives via the parsed Zod body and is recorded in `content_history.metadata`.
      // Falls back to `null` when omitted by the caller.

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
        similarity_at_resolution: similarityAtResolution ?? null,
        threshold_at_resolution: thresholdAtResolution ?? null,
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
  },
);
