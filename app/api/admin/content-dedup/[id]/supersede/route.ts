import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
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
      const { data: subject, error: subjectErr } = await supabase
        .from('content_items')
        .select(
          'id, title, suggested_title, content, brief, detail, reference, metadata, dedup_status, archived_at, superseded_by',
        )
        .eq('id', id)
        .single();

      if (subjectErr && subjectErr.code !== 'PGRST116') {
        logger.error(
          {
            err: subjectErr,
            op: 'admin.content-dedup.supersede.load_subject',
          },
          'Failed to load dedup subject',
        );
        return NextResponse.json(
          { error: 'Failed to load dedup subject' },
          { status: 500 },
        );
      }
      if (!subject) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      if (subject.dedup_status !== 'suspected_duplicate') {
        return NextResponse.json(
          {
            error: 'row already resolved',
            current_status: subject.dedup_status,
          },
          { status: 409 },
        );
      }

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
        const { data: latestSubjectHistory, error: latestSubjectHistoryErr } =
          await supabase
            .from('content_history')
            .select('version')
            .eq('content_item_id', id)
            .order('version', { ascending: false })
            .limit(1);

        if (latestSubjectHistoryErr) {
          logBestEffortWarn(
            'admin.dedup.supersede.history_version_lookup',
            'Failed to read latest content_history version for subject',
            { subjectId: id, error: latestSubjectHistoryErr },
          );
        }

        const subjectVersion = (latestSubjectHistory?.[0]?.version ?? 0) + 1;

        const subjectHistoryMetadata = {
          ...baseSubjectMeta,
          superseded_by: canonicalId,
          dedup_review_action: 'supersede',
          direction: 'canonical-supersedes-subject',
          peerId: canonicalId,
        };

        const { error: subjectHistoryErr } = await supabase
          .from('content_history')
          .insert({
            content_item_id: id,
            version: subjectVersion,
            title: subject.title || subject.suggested_title || 'Untitled',
            content: subject.content || '',
            brief: subject.brief,
            detail: subject.detail,
            reference: subject.reference,
            metadata: subjectHistoryMetadata,
            change_type: 'merge',
            change_summary: summary,
            change_reason: 'dedup_admin_review_superseded',
            created_by: user.id,
          });

        if (subjectHistoryErr) {
          logBestEffortWarn(
            'admin.dedup.supersede.history_insert',
            'Failed to insert dedup audit history for subject',
            { subjectId: id, error: subjectHistoryErr },
          );
        }

        return NextResponse.json({
          pathId: id,
          retiredId: id,
          canonicalId,
          direction: 'canonical-supersedes-subject',
          retiredDedupStatus: 'superseded',
        });
      }

      // Direction B: 2 rows. Each content_item_id has its own version sequence,
      // so we look up the next version per row independently.
      const { data: latestCanonicalHistory, error: latestCanonicalHistoryErr } =
        await supabase
          .from('content_history')
          .select('version')
          .eq('content_item_id', canonicalId)
          .order('version', { ascending: false })
          .limit(1);

      if (latestCanonicalHistoryErr) {
        logBestEffortWarn(
          'admin.dedup.supersede.history_version_lookup',
          'Failed to read latest content_history version for canonical (retired side)',
          { canonicalId, error: latestCanonicalHistoryErr },
        );
      }

      const canonicalVersion = (latestCanonicalHistory?.[0]?.version ?? 0) + 1;

      // First row: against the RETIRED canonical (change_type='merge').
      const canonicalHistoryMetadata = {
        superseded_by: id,
        dedup_review_action: 'supersede',
        direction: 'subject-supersedes-canonical',
        peerId: id,
      };

      const { error: canonicalHistoryErr } = await supabase
        .from('content_history')
        .insert({
          content_item_id: canonicalId,
          version: canonicalVersion,
          title: 'Superseded canonical',
          content: '',
          brief: null,
          detail: null,
          reference: null,
          metadata: canonicalHistoryMetadata,
          change_type: 'merge',
          change_summary: summary,
          change_reason: 'dedup_admin_review_superseded',
          created_by: user.id,
        });

      if (canonicalHistoryErr) {
        logBestEffortWarn(
          'admin.dedup.supersede.history_insert',
          'Failed to insert dedup audit history for retired canonical',
          { canonicalId, error: canonicalHistoryErr },
        );
      }

      // Second row: against the KEPT subject (change_type='metadata_change').
      const { data: latestSubjectHistory, error: latestSubjectHistoryErr } =
        await supabase
          .from('content_history')
          .select('version')
          .eq('content_item_id', id)
          .order('version', { ascending: false })
          .limit(1);

      if (latestSubjectHistoryErr) {
        logBestEffortWarn(
          'admin.dedup.supersede.history_version_lookup',
          'Failed to read latest content_history version for subject (kept side)',
          { subjectId: id, error: latestSubjectHistoryErr },
        );
      }

      const subjectVersion = (latestSubjectHistory?.[0]?.version ?? 0) + 1;

      const subjectHistoryMetadata = {
        ...baseSubjectMeta,
        dedup_review_action: 'supersede',
        direction: 'subject-supersedes-canonical',
        peerId: canonicalId,
        resolution: 'kept_as_canonical',
      };

      const { error: subjectHistoryErr } = await supabase
        .from('content_history')
        .insert({
          content_item_id: id,
          version: subjectVersion,
          title: subject.title || subject.suggested_title || 'Untitled',
          content: subject.content || '',
          brief: subject.brief,
          detail: subject.detail,
          reference: subject.reference,
          metadata: subjectHistoryMetadata,
          change_type: 'metadata_change',
          change_summary: summary,
          change_reason: 'dedup_admin_review_superseded',
          created_by: user.id,
        });

      if (subjectHistoryErr) {
        logBestEffortWarn(
          'admin.dedup.supersede.history_insert',
          'Failed to insert dedup audit history for kept subject',
          { subjectId: id, error: subjectHistoryErr },
        );
      }

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
