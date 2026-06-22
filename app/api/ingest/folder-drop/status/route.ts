import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { logger, withRequestContext } from '@/lib/logger';
import { isOk, tryQuery } from '@/lib/supabase/safe';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 15;

// TODO(OPS-T1): author ResponseSchema
export const GET = withRequestContext(
  defineRoute(z.unknown(), async (request: NextRequest) => {
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
  }),
);
