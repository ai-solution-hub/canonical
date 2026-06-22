import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { sb } from '@/lib/supabase/safe';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; rId: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id, rId } = await params;
      if (!UUID_RE.test(id) || !UUID_RE.test(rId)) {
        return NextResponse.json(
          { error: 'Invalid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Validate that the response belongs to this bid
      const { data: response, error: responseError } = await supabase
        .from('form_responses')
        .select('id, version, question_id')
        .eq('id', rId)
        .single();

      if (responseError || !response) {
        return NextResponse.json(
          { error: 'Response not found' },
          { status: 404 },
        );
      }

      // Verify the question belongs to this bid
      const question = await sb(
        supabase
          .from('form_questions')
          .select('id')
          .eq('id', response.question_id)
          .eq('workspace_id', id)
          .maybeSingle(),
        'bids.response.history.questionOwnership',
      );

      if (!question) {
        return NextResponse.json(
          { error: 'Response not found in this bid' },
          { status: 404 },
        );
      }

      // Fetch history versions
      const { data: history, error: historyError } = await supabase
        .from('form_response_history')
        .select(
          'id, version, response_text, response_text_advanced, review_status, edited_by, change_reason, created_at',
        )
        .eq('response_id', rId)
        .order('version', { ascending: false });

      if (historyError) {
        logger.error({ err: historyError }, 'Failed to fetch response history');
        return NextResponse.json(
          { error: 'Failed to fetch response history' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        versions: history ?? [],
        current_version: response.version,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch response history') },
        { status: 500 },
      );
    }
  },
);
