import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { tryQuery } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const authResult = await getAuthenticatedClient();
      if (!authResult.success) return authFailureResponse(authResult);
      const { id } = await params;

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return NextResponse.json(
          { error: 'Invalid document ID format' },
          { status: 400 },
        );
      }

      const serviceClient = createServiceClient();

      // Fetch the source document
      const { data: doc, error: docErr } = await serviceClient
        .from('source_documents')
        .select('*')
        .eq('id', id)
        .single();

      if (docErr || !doc) {
        return NextResponse.json(
          { error: 'Source document not found' },
          { status: 404 },
        );
      }

      // DR-012 (id-131 content_items-elimination sweep; id-135 {135.11}/BND-1
      // Path β consumer contract, TECH §3 BI-29): content_items is being
      // eliminated. This read now sources its "content_items" equivalent from
      // q_a_pairs (derived records) via source_document_id, published only —
      // `derived_pairs` replaces `content_items` in the response.
      //
      // Column mapping chosen (q_a_pairs has no content_type/primary_domain/
      // primary_subtopic/freshness/title columns — those were content_items-
      // only): question_text/answer_standard/publication_status/created_at.
      // `verified_at` is deliberately OMITTED — it lives on record_lifecycle
      // (the governance facet), which is PGRST106-unreachable via the `api`
      // schema until {131.19} regens the api views; it cannot be joined here.
      // FLAGGED for {131.13}/{135.13} coordination.
      const pairsResult = await tryQuery(
        serviceClient
          .from('q_a_pairs')
          .select(
            'id, question_text, answer_standard, publication_status, created_at',
          )
          .eq('source_document_id', id)
          .eq('publication_status', 'published')
          .order('created_at', { ascending: false }),
        'q_a_pairs.sourceDocumentDerivedPairs',
      );

      if (!pairsResult.ok) {
        logger.error(
          { err: pairsResult.error, sourceDocumentId: id },
          'Failed to fetch derived q_a_pairs for source document',
        );
      }

      return NextResponse.json({
        ...doc,
        derived_pairs: pairsResult.ok ? pairsResult.data : [],
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch source document') },
        { status: 500 },
      );
    }
  },
);
