import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import {
  resolveDedupSubject,
  subjectHistorySnapshot,
  writeDedupHistory,
} from '@/lib/dedup/review-actions';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { DedupActionBodySchema } from '@/lib/validation/schemas';
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
      const parsed = parseBody(DedupActionBodySchema, raw ?? {});
      if (!parsed.success) return parsed.response;
      const { note } = parsed.data;

      // 1. Idempotency guard — load + verify dedup_status.
      const resolved = await resolveDedupSubject(
        supabase,
        id,
        'admin.content-dedup.confirm-duplicate.load_subject',
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

      // 2. Archive + flip dedup_status in a single statement.
      const archivedAt = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabase
        .from('content_items')
        .update({
          archived_at: archivedAt,
          archived_by: user.id,
          archive_reason: 'dedup_admin_confirmed_duplicate',
          dedup_status: 'confirmed_duplicate',
        })
        .eq('id', id)
        .select('id, dedup_status, archived_at')
        .single();

      if (updateErr || !updated) {
        logger.error(
          {
            err: updateErr,
            op: 'admin.content-dedup.confirm-duplicate.update',
          },
          'Failed to confirm duplicate',
        );
        return NextResponse.json(
          { error: 'Failed to confirm duplicate' },
          { status: 500 },
        );
      }

      // 3. content_history snapshot — explicit because there is no UPDATE-side
      //    trigger. Best-effort: a failure here does not surface a 500 (the
      //    user-visible mutation already succeeded), but is logged so ops can
      //    spot the gap. (Spec §4.2 last-row, §4.3 reasons.)
      const summary = note
        ? `Confirmed duplicate via admin dedup review: ${note}`
        : 'Confirmed duplicate via admin dedup review';

      await writeDedupHistory(
        supabase,
        {
          contentItemId: id,
          ...subjectHistorySnapshot(subject),
          metadata: subject.metadata,
          changeType: 'archive',
          changeSummary: summary,
          // Memory feedback_content_history_change_reason_mandatory: every
          // history insert needs an explicit, category-specific reason.
          changeReason: 'dedup_admin_review_confirmed_duplicate',
          createdBy: user.id,
        },
        {
          op: 'admin.content-dedup.confirm-duplicate',
          errorChannel: 'logger',
          versionLookupMessage: 'Failed to read latest content_history version',
          insertMessage: 'Failed to insert dedup audit history',
        },
      );

      return NextResponse.json({
        id,
        dedup_status: 'confirmed_duplicate',
        archived_at: updated.archived_at,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to confirm duplicate') },
        { status: 500 },
      );
    }
  },
);
