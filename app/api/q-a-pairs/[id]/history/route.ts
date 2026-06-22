// app/api/q-a-pairs/[id]/history/route.ts
//
// ID-59 {59.16} — Q&A revision-history fetch route (PC-14..17 / INV-14..17,
// the user-edit Diff-UI Q&A leg; bl-273 promote).
//
// AUTHENTICATED, READ-ONLY route. It is NOT in proxy.ts `publicRoutes` — it
// sits behind auth like the sibling PATCH route; the middleware rejects
// unauthenticated callers before the handler. Any signed-in role (admin /
// editor / viewer) may read history (INV-17: read-only, no write).
//
// Source = `q_a_pair_history` (INV-14), NOT `source_document_diffs`. Each
// history row carries the FULL revision body (question_text, answer_standard,
// answer_advanced) PLUS `edit_intent` (snapshotted by q_a_pairs_history_trigger
// per migration 20260609195444), so the compare-two-versions affordance derives
// both diff blobs straight from the list — there is no separate per-version
// detail route and NO diff table (INV-15/INV-17). Mirrors the content-item
// analog at app/api/items/[id]/history/route.ts.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseSearchParams } from '@/lib/validation';
import { paginationParams } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor', 'viewer']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;

      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid Q&A pair ID — must be a valid UUID' },
          { status: 400 },
        );
      }

      const HistoryParamsSchema = paginationParams({ limit: 50 });
      const parsed = parseSearchParams(
        HistoryParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const { limit, offset } = parsed.data;

      const { data, error, count } = await supabase
        .from('q_a_pair_history')
        .select(
          'id, q_a_pair_id, version, question_text, answer_standard, answer_advanced, origin_kind, publication_status, changed_at, changed_by, edit_intent',
          { count: 'exact' },
        )
        .eq('q_a_pair_id', id)
        .order('version', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error({ err: error }, 'Failed to fetch Q&A revision history');
        return NextResponse.json(
          { error: 'Failed to fetch Q&A revision history' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        versions: data ?? [],
        total: count ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to fetch Q&A revision history'),
        },
        { status: 500 },
      );
    }
  },
);
