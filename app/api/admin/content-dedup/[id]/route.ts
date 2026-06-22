import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { DedupItemResponseSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_ITEM_PROJECTION =
  'id, title, content, dedup_status, created_at, primary_domain, content_owner_id, ingestion_source, superseded_by, metadata, publication_status, archived_at, content_text_hash';

export const GET = defineRoute(
  DedupItemResponseSchema,
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid item ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      // 1. Load subject row.
      const { data: subject, error: subjectErr } = await supabase
        .from('content_items')
        .select(CONTENT_ITEM_PROJECTION)
        .eq('id', id)
        .single();

      if (subjectErr && subjectErr.code !== 'PGRST116') {
        logger.error(
          { err: subjectErr, op: 'admin.content-dedup.item.load_subject' },
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

      // 2. Find the canonical id. Prefer metadata stamp; fall back to RPC.
      let canonicalId: string | null = null;
      const meta = subject.metadata;
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        const stamped = (meta as Record<string, unknown>)
          .suspected_duplicate_of;
        if (typeof stamped === 'string' && UUID_RE.test(stamped)) {
          canonicalId = stamped;
        }
      }

      if (!canonicalId && subject.content_text_hash) {
        const { data: matches, error: rpcErr } = await supabase.rpc(
          'find_exact_duplicates',
          {
            p_content_hash: subject.content_text_hash,
            p_exclude_id: subject.id,
          },
        );
        if (rpcErr) {
          logger.error(
            { err: rpcErr, op: 'admin.content-dedup.item.rpc_fallback' },
            'Dedup RPC fallback failed',
          );
        } else if (matches && matches.length > 0) {
          canonicalId = matches[0].id;
        }
      }

      // 3. Load canonical row (may be null if all candidates have vanished —
      //    edge case; UI shows "no canonical" panel).
      let canonical: typeof subject | null = null;
      if (canonicalId) {
        const { data: canonicalRow, error: canonicalErr } = await supabase
          .from('content_items')
          .select(CONTENT_ITEM_PROJECTION)
          .eq('id', canonicalId)
          .maybeSingle();

        if (canonicalErr) {
          logger.error(
            {
              err: canonicalErr,
              op: 'admin.content-dedup.item.load_canonical',
            },
            'Failed to load canonical row',
          );
        }
        canonical = canonicalRow ?? null;
      }

      return NextResponse.json({
        subject,
        canonical,
        similarity: 1.0,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to load dedup item') },
        { status: 500 },
      );
    }
  },
);
