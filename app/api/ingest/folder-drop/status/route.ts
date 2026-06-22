import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { tryQuery, isOk } from '@/lib/supabase/safe';
import { logger, withRequestContext } from '@/lib/logger';

export const maxDuration = 15;

/**
 * GET /api/ingest/folder-drop/status?source_file=<name> — folder-drop ingest
 * poll ({56.12}, ID-56 Path B).
 *
 * Answers the single question the folder-drop UI polls on: "has cocoindex
 * ingested a content_items row for this dropped filename yet?" cocoindex stamps
 * `content_items.source_file` with the dropped filename at ingest time, so a
 * row matching `source_file` is the correlation signal. This is intentionally
 * agnostic of publication/governance state — the row may land in any state, and
 * the poll only needs to detect arrival.
 *
 * AUTHED (admin/editor) — absent from `proxy.ts` publicRoutes. Uses `tryQuery`
 * so a DB error surfaces as a 500 rather than being silently swallowed into a
 * misleading "not ingested yet" response.
 */
export const GET = withRequestContext(async (request: NextRequest) => {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { supabase } = auth;

  const sourceFile = request.nextUrl.searchParams.get('source_file');
  if (!sourceFile) {
    return NextResponse.json(
      { error: 'source_file query parameter is required' },
      { status: 400 },
    );
  }

  // Newest matching row first — a re-drop of the same filename surfaces the most
  // recent ingest. `maybeSingle` tolerates the pre-ingest "no row yet" state
  // without erroring (that is the normal polling state, not a failure).
  const result = await tryQuery(
    supabase
      .from('content_items')
      .select('id')
      .eq('source_file', sourceFile)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'ingest.folder-drop.status',
  );

  if (!isOk(result)) {
    logger.error(
      { err: result.error, sourceFile },
      'folder-drop ingest status query failed',
    );
    return NextResponse.json(
      { error: 'Failed to check ingest status' },
      { status: 500 },
    );
  }

  const row = result.data as { id: string } | null;
  return NextResponse.json({
    ingested: row !== null,
    itemId: row?.id ?? null,
  });
});
