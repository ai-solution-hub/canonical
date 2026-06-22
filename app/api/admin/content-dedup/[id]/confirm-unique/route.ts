import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
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
            op: 'admin.content-dedup.confirm-unique.load_subject',
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
      const { data: latestHistory, error: latestHistoryErr } = await supabase
        .from('content_history')
        .select('version')
        .eq('content_item_id', id)
        .order('version', { ascending: false })
        .limit(1);

      if (latestHistoryErr) {
        logger.error(
          {
            err: latestHistoryErr,
            op: 'admin.content-dedup.confirm-unique.history_version_lookup',
          },
          'Failed to read latest content_history version',
        );
      }

      const nextVersion = (latestHistory?.[0]?.version ?? 0) + 1;
      const summary = note
        ? `Confirmed unique via admin dedup review: ${note}`
        : 'Confirmed unique via admin dedup review';

      const { error: historyErr } = await supabase
        .from('content_history')
        .insert({
          content_item_id: id,
          version: nextVersion,
          title: subject.title || subject.suggested_title || 'Untitled',
          content: subject.content || '',
          brief: subject.brief,
          detail: subject.detail,
          reference: subject.reference,
          metadata: subject.metadata,
          change_type: 'metadata_change',
          change_summary: summary,
          change_reason: 'dedup_admin_review_confirmed_unique',
          created_by: user.id,
        });

      if (historyErr) {
        logger.error(
          {
            err: historyErr,
            op: 'admin.content-dedup.confirm-unique.history_insert',
          },
          'Failed to insert dedup audit history',
        );
      }

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
