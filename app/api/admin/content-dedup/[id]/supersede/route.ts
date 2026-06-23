import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import {
  resolveDedupSubject,
  subjectHistorySnapshot,
  writeDedupHistory,
} from '@/lib/dedup/review-actions';
import { safeErrorMessage } from '@/lib/error';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { setSupersession, SupersessionError } from '@/lib/supersession/set';
import { parseBody } from '@/lib/validation';
import { DedupSupersedeBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID — must be a valid UUID' },
          { status: 400 },
        );
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
      const parsed = parseBody(DedupSupersedeBodySchema, raw ?? {});
      if (!parsed.success) return parsed.response;
      const { canonicalId, direction, note } = parsed.data;

      // Pre-helper SAME_ID guard — the helper raises SAME_ID after a DB hop;
      // catch the obvious self-supersede here so we don't waste round-trips.
      // Distinct error code keeps the route's contract self-describing.
      if (canonicalId === id) {
        return NextResponse.json(
          {
            error: 'canonicalId cannot equal path id',
            code: 'SAME_ID_PRE_HELPER',
          },
          { status: 400 },
        );
      }

      // 1. Idempotency guard on subject (the helper does its own checks but
      //    this route is gated on the suspected_duplicate flow specifically —
      //    the path id is always the queue row regardless of direction).
      const resolved = await resolveDedupSubject(
        supabase,
        id,
        'admin.content-dedup.supersede.load_subject',
      );
      if (!resolved.ok) {
        if (resolved.reason === 'load_error') {
          return NextResponse.json(
            { error: 'Failed to load dedup subject' },
            { status: 500 },
          );
        }
        if (resolved.reason === 'not_found') {
          return NextResponse.json(
            { error: 'Item not found' },
            { status: 404 },
          );
        }
        return NextResponse.json(
          {
            error: 'row already resolved',
            current_status: resolved.currentStatus,
          },
          { status: 409 },
        );
      }
      const subject = resolved.subject;

      // 2. Derive (oldId, newId) from direction. The path id is ALWAYS the
      //    subject (queue row); direction selects which side becomes the
      //    "old" (retired) row in setSupersession() terms.
      const oldId =
        direction === 'canonical-supersedes-subject' ? id : canonicalId;
      const newId =
        direction === 'canonical-supersedes-subject' ? canonicalId : id;

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
          // Any unmapped SupersessionError → 500 (defensive — keep route
          // response shape stable if new codes are added later).
          return NextResponse.json(
            { error: helperErr.message, code: helperErr.code },
            { status: 500 },
          );
        }
        // Non-SupersessionError surfaces from the helper (e.g. SupabaseError)
        // → 500 with a generic message via safeErrorMessage().
        return NextResponse.json(
          { error: safeErrorMessage(helperErr, 'Failed to supersede item') },
          { status: 500 },
        );
      }

      // 3. Direction B (subject-supersedes-canonical) needs the subject to
      //    exit the queue. Helper retired the canonical; flip subject to
      //    `confirmed_unique` so it's no longer a suspected_duplicate.
      //    Best-effort: a partial write here is recoverable via a follow-up
      //    confirm-unique call — we DO NOT 500 the response.
      if (direction === 'subject-supersedes-canonical') {
        const { error: subjectFlipErr } = await supabase
          .from('content_items')
          .update({ dedup_status: 'confirmed_unique' })
          .eq('id', id);
        if (subjectFlipErr) {
          logBestEffortWarn(
            'admin.dedup.supersede.subject_flip',
            'Failed to flip subject dedup_status to confirmed_unique after Direction-B supersede',
            { subjectId: id, canonicalId, error: subjectFlipErr },
          );
        }
      }

      // 4. content_history snapshots — change_reason='dedup_admin_review_superseded'
      //    for both directions, but the rows (and change_type) differ. The
      //    supersession helper does not write history itself (per its docstring:
      //    "callers that need a content_history entry write their own snapshot").
      const baseSummary =
        direction === 'canonical-supersedes-subject'
          ? `Superseded by ${canonicalId} via admin dedup review`
          : `${canonicalId} retired; ${id} kept as canonical via admin dedup review`;
      const summary = note ? `${baseSummary}: ${note}` : baseSummary;

      // Coerce subject metadata to a plain object so we can spread into
      // history.metadata. Subject's existing metadata may be null/array/scalar.
      const baseSubjectMeta =
        subject.metadata &&
        typeof subject.metadata === 'object' &&
        !Array.isArray(subject.metadata)
          ? (subject.metadata as Record<string, unknown>)
          : {};

      if (direction === 'canonical-supersedes-subject') {
        // Direction A: 1 row against the subject (the retired side).
        const subjectHistoryMetadata = {
          ...baseSubjectMeta,
          superseded_by: canonicalId,
          dedup_review_action: 'supersede',
          direction: 'canonical-supersedes-subject',
          peerId: canonicalId,
        };

        await writeDedupHistory(
          supabase,
          {
            contentItemId: id,
            ...subjectHistorySnapshot(subject),
            metadata: subjectHistoryMetadata,
            changeType: 'merge',
            changeSummary: summary,
            changeReason: 'dedup_admin_review_superseded',
            createdBy: user.id,
          },
          {
            op: 'admin.dedup.supersede',
            errorChannel: 'bestEffort',
            versionLookupMessage:
              'Failed to read latest content_history version for subject',
            insertMessage: 'Failed to insert dedup audit history for subject',
            warnContext: { subjectId: id },
          },
        );

        return NextResponse.json({
          pathId: id,
          retiredId: id,
          canonicalId,
          direction: 'canonical-supersedes-subject',
          retiredDedupStatus: 'superseded',
        });
      }

      // Direction B: 2 rows. Each content_item_id has its own version sequence,
      // so writeDedupHistory looks up the next version per row independently.

      // First row: against the RETIRED canonical (change_type='merge'). The
      // synthetic snapshot uses placeholder literals, NOT subjectHistorySnapshot.
      const canonicalHistoryMetadata = {
        superseded_by: id,
        dedup_review_action: 'supersede',
        direction: 'subject-supersedes-canonical',
        peerId: id,
      };

      await writeDedupHistory(
        supabase,
        {
          contentItemId: canonicalId,
          title: 'Superseded canonical',
          content: '',
          brief: null,
          detail: null,
          reference: null,
          metadata: canonicalHistoryMetadata,
          changeType: 'merge',
          changeSummary: summary,
          changeReason: 'dedup_admin_review_superseded',
          createdBy: user.id,
        },
        {
          op: 'admin.dedup.supersede',
          errorChannel: 'bestEffort',
          versionLookupMessage:
            'Failed to read latest content_history version for canonical (retired side)',
          insertMessage:
            'Failed to insert dedup audit history for retired canonical',
          warnContext: { canonicalId },
        },
      );

      // Second row: against the KEPT subject (change_type='metadata_change').
      const subjectHistoryMetadata = {
        ...baseSubjectMeta,
        dedup_review_action: 'supersede',
        direction: 'subject-supersedes-canonical',
        peerId: canonicalId,
        resolution: 'kept_as_canonical',
      };

      await writeDedupHistory(
        supabase,
        {
          contentItemId: id,
          ...subjectHistorySnapshot(subject),
          metadata: subjectHistoryMetadata,
          changeType: 'metadata_change',
          changeSummary: summary,
          changeReason: 'dedup_admin_review_superseded',
          createdBy: user.id,
        },
        {
          op: 'admin.dedup.supersede',
          errorChannel: 'bestEffort',
          versionLookupMessage:
            'Failed to read latest content_history version for subject (kept side)',
          insertMessage:
            'Failed to insert dedup audit history for kept subject',
          warnContext: { subjectId: id },
        },
      );

      return NextResponse.json({
        pathId: id,
        retiredId: canonicalId,
        canonicalId,
        direction: 'subject-supersedes-canonical',
        retiredDedupStatus: 'superseded',
        pathDedupStatus: 'confirmed_unique',
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to supersede item') },
        { status: 500 },
      );
    }
  },
);
