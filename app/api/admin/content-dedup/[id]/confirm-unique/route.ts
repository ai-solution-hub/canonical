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

      // 1. Idempotency guard.
      const resolved = await resolveDedupSubject(
        supabase,
        id,
        'admin.content-dedup.confirm-unique.load_subject',
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

      // 2. Flip dedup_status only — `archived_at` stays NULL.
      const { data: updated, error: updateErr } = await supabase
        .from('content_items')
        .update({ dedup_status: 'confirmed_unique' })
        .eq('id', id)
        .select('id, dedup_status')
        .single();

      if (updateErr || !updated) {
        logger.error(
          { err: updateErr, op: 'admin.content-dedup.confirm-unique.update' },
          'Failed to confirm unique',
        );
        return NextResponse.json(
          { error: 'Failed to confirm unique' },
          { status: 500 },
        );
      }

      // 3. content_history snapshot — change_type='metadata_change'.
      //    Best-effort: a failure here does not surface a 500; it is logged.
      const summary = note
        ? `Confirmed unique via admin dedup review: ${note}`
        : 'Confirmed unique via admin dedup review';

      await writeDedupHistory(
        supabase,
        {
          contentItemId: id,
          ...subjectHistorySnapshot(subject),
          metadata: subject.metadata,
          changeType: 'metadata_change',
          changeSummary: summary,
          changeReason: 'dedup_admin_review_confirmed_unique',
          createdBy: user.id,
        },
        {
          op: 'admin.content-dedup.confirm-unique',
          errorChannel: 'logger',
          versionLookupMessage: 'Failed to read latest content_history version',
          insertMessage: 'Failed to insert dedup audit history',
        },
      );

      return NextResponse.json({
        id,
        dedup_status: 'confirmed_unique',
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to confirm unique') },
        { status: 500 },
      );
    }
  },
);
