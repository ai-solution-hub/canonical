import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
} from '@/lib/auth';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import { countWords } from '@/lib/editor-utils';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import {
  ProcurementResponseSchema,
  ResponseUpdateBodySchema,
} from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import type {
  ProcurementResponseMetadata,
  QualityData,
} from '@/types/procurement-metadata';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type ProcurementResponseUpdate =
  Database['public']['Tables']['form_responses']['Update'];

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = defineRoute(
  ProcurementResponseSchema,
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

      // Fetch the response
      const { data: response, error: responseError } = await supabase
        .from('form_responses')
        .select(
          'id, question_id, response_text, response_text_advanced, source_content_ids, metadata, review_status, version, drafted_by, last_edited_by, approved_by, created_at, updated_at, overall_score',
        )
        .eq('id', rId)
        .single();

      if (responseError || !response) {
        return NextResponse.json(
          { error: 'Response not found' },
          { status: 404 },
        );
      }

      // Verify the response belongs to a question in this bid
      const { data: question, error: questionError } = await supabase
        .from('form_questions')
        .select(
          'id, question_text, word_limit, section_name, confidence_posture',
        )
        .eq('id', response.question_id)
        .eq('workspace_id', id)
        .single();

      if (questionError || !question) {
        return NextResponse.json(
          { error: 'Response not found in this bid' },
          { status: 404 },
        );
      }

      // Parse metadata
      const meta = (response.metadata ?? {}) as ProcurementResponseMetadata;
      const citations = meta.citations_data?.citations ?? [];
      const qualityCheck = meta.quality_data ?? null;

      // Fetch source content summaries if there are source IDs
      let sourceContent: Array<{
        id: string;
        title: string | null;
        content_type: string | null;
        primary_domain: string | null;
        summary: string | null;
      }> = [];

      if (
        response.source_content_ids &&
        response.source_content_ids.length > 0
      ) {
        const contentItems = await sb(
          supabase
            .from('content_items')
            .select(
              'id, suggested_title, content_type, primary_domain, primary_subtopic, summary',
            )
            .in('id', response.source_content_ids),
          'bids.response.detail.sourceContent',
        );

        sourceContent = contentItems.map((item) => ({
          id: item.id,
          title: item.suggested_title,
          content_type: item.content_type,
          primary_domain: item.primary_domain,
          primary_subtopic: item.primary_subtopic,
          summary: item.summary,
        }));
      }

      // Prefer overall_score from the dedicated column; fall back to metadata for pre-migration data
      const overallScore =
        response.overall_score ?? qualityCheck?.overall_score ?? null;

      return NextResponse.json({
        id: response.id,
        question_id: response.question_id,
        question: {
          question_text: question.question_text,
          word_limit: question.word_limit,
          section_name: question.section_name,
          confidence_posture: question.confidence_posture,
        },
        response_text: response.response_text,
        response_text_advanced: response.response_text_advanced,
        version: response.version,
        citations,
        source_content: sourceContent,
        quality_check: qualityCheck,
        overall_score: overallScore,
        review_status: response.review_status,
        drafted_by: response.drafted_by,
        last_edited_by: response.last_edited_by,
        approved_by: response.approved_by,
        created_at: response.created_at,
        updated_at: response.updated_at,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch response') },
        { status: 500 },
      );
    }
  },
);

// TODO(OPS-T1): author ResponseSchema
export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; rId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id, rId } = await params;
      if (!UUID_RE.test(id) || !UUID_RE.test(rId)) {
        return NextResponse.json(
          { error: 'Invalid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();
      const parsed = parseBody(ResponseUpdateBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const {
        response_text,
        response_text_advanced,
        review_status,
        change_reason,
        source_content_ids,
      } = parsed.data;

      // Verify the response exists and belongs to this bid
      const { data: existing, error: fetchError } = await supabase
        .from('form_responses')
        .select('id, question_id, metadata')
        .eq('id', rId)
        .single();

      if (fetchError || !existing) {
        return NextResponse.json(
          { error: 'Response not found' },
          { status: 404 },
        );
      }

      // Verify the question belongs to this bid
      const question = await sb(
        supabase
          .from('form_questions')
          .select('id, word_limit')
          .eq('id', existing.question_id)
          .eq('workspace_id', id)
          .maybeSingle(),
        'bids.response.update.questionOwnership',
      );

      if (!question) {
        return NextResponse.json(
          { error: 'Response not found in this bid' },
          { status: 404 },
        );
      }

      // Build update payload
      const updates: ProcurementResponseUpdate = {
        last_edited_by: user.id,
        updated_at: new Date().toISOString(),
      };

      if (response_text !== undefined) updates.response_text = response_text;
      if (response_text_advanced !== undefined)
        updates.response_text_advanced = response_text_advanced;
      if (review_status !== undefined) updates.review_status = review_status;
      if (source_content_ids !== undefined)
        updates.source_content_ids = source_content_ids;

      // Set approved_by when status changes to approved
      if (review_status === 'approved') {
        updates.approved_by = user.id;
      }

      // Recalculate word count in metadata if response text changed
      if (response_text !== undefined) {
        const existingMeta = (existing.metadata ??
          {}) as ProcurementResponseMetadata;
        const wordCount = countWords(stripMarkdown(response_text));
        const wordLimitCompliance = question.word_limit
          ? wordCount <= question.word_limit
          : true;

        const updatedQuality: QualityData = {
          ...(existingMeta.quality_data ?? {
            overall_score: 0,
            citation_count: 0,
            unsupported_claims: [],
            suggestions: [],
            issues: [],
          }),
          word_count: wordCount,
          word_limit_compliance: wordLimitCompliance,
        };

        updates.metadata = {
          ...existingMeta,
          quality_data: updatedQuality,
        } as unknown as ProcurementResponseUpdate['metadata'];

        // Also write overall_score to the dedicated column (backward compat: metadata still has it)
        updates.overall_score = updatedQuality.overall_score ?? null;
      }

      // Set change_reason session variable for the trigger to capture.
      if (change_reason) {
        await supabase.rpc('set_config', {
          setting: 'app.change_reason',
          value: change_reason,
          is_local: true,
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from('form_responses')
        .update(updates)
        .eq('id', rId)
        .select(
          'id, question_id, response_text, response_text_advanced, review_status, version, last_edited_by, approved_by, updated_at',
        )
        .single();

      if (updateError) {
        logger.error({ err: updateError }, 'Failed to update response');
        return NextResponse.json(
          { error: 'Failed to update response' },
          { status: 500 },
        );
      }

      // Update question status based on review status
      if (review_status === 'edited' || review_status === 'approved') {
        await supabase
          .from('form_questions')
          .update({ status: 'complete' })
          .eq('id', existing.question_id)
          .eq('workspace_id', id);
      } else if (review_status === 'needs_review') {
        await supabase
          .from('form_questions')
          .update({ status: 'needs_review' })
          .eq('id', existing.question_id)
          .eq('workspace_id', id);
      }

      return NextResponse.json(updated);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update response') },
        { status: 500 },
      );
    }
  },
);
