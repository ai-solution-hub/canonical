import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────
// GET /api/procurement/:id/fields -- form field/slot detail (fields, summary,
// completions). DR-075 (ID-147 TECH.md §6 row B, ratified S474): folds the
// retired `templates/[templateId]/route.ts` GET into the canonical `[id]` =
// form_instances.id shape (BI-1: the item IS the form -- no separate
// workspace/template container). `id` here IS the form's own PK, matching
// the {145.6}/{145.15} fill + auto-map convention (`procurementId` is
// URL-namespacing only elsewhere in this family, never a scoping filter).
// ──────────────────────────────────────────

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Fetch the form.
      const { data: template, error: templateError } = await supabase
        .from('form_instances')
        .select(
          'id, name, description, filename, storage_path, file_size, mime_type, processing_status, field_count, mapped_count, structure_path, created_by, created_at, updated_at',
        )
        .eq('id', id)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      // Fetch fields with their mapped bid question data.
      const { data: fields, error: fieldsError } = await supabase
        .from('form_instance_fields')
        .select(
          'id, form_instance_id, field_type, table_index, row_index, col_index, question_text, section_name, word_limit, placeholder_text, question_id, mapping_status, mapping_confidence, fill_status, fill_error, sequence, created_at, updated_at',
        )
        .eq('form_instance_id', id)
        .order('sequence', { ascending: true });

      if (fieldsError) {
        logger.error({ err: fieldsError }, 'Failed to fetch form fields');
        return NextResponse.json(
          { error: 'Failed to fetch template fields' },
          { status: 500 },
        );
      }

      // Enrich fields with matched question data
      const questionIds = (fields ?? [])
        .map((f) => f.question_id)
        .filter((qid): qid is string => qid !== null);

      const questionMap = new Map<
        string,
        {
          id: string;
          question_text: string;
          status: string;
          response_preview: string | null;
        }
      >();

      const warnings: string[] = [];

      if (questionIds.length > 0) {
        // Fetch bid questions
        const { data: questions, error: questionsError } = await supabase
          .from('form_questions')
          .select('id, question_text, status')
          .in('id', questionIds);

        if (questionsError) {
          logger.error(
            { err: questionsError },
            'Failed to fetch matched bid questions for form fields',
          );
          warnings.push(
            'Matched questions could not be loaded: ' +
              safeErrorMessage(questionsError, 'questions fetch failed'),
          );
        }

        if (questions) {
          for (const q of questions) {
            questionMap.set(q.id, {
              id: q.id,
              question_text: q.question_text,
              status: q.status ?? 'pending',
              response_preview: null,
            });
          }

          // Fetch latest response preview for each question
          const { data: responses, error: responsesError } = await supabase
            .from('form_responses')
            .select('question_id, response_text, version')
            .in('question_id', questionIds)
            .order('version', { ascending: false });

          if (responsesError) {
            logger.error(
              { err: responsesError },
              'Failed to fetch response previews for form fields',
            );
            warnings.push(
              'Response previews could not be loaded: ' +
                safeErrorMessage(responsesError, 'responses fetch failed'),
            );
          }

          if (responses) {
            // Group by question_id, take latest (already ordered DESC)
            const seen = new Set<string>();
            for (const r of responses) {
              if (!seen.has(r.question_id)) {
                seen.add(r.question_id);
                const q = questionMap.get(r.question_id);
                if (q) {
                  q.response_preview = r.response_text
                    ? r.response_text.substring(0, 200) +
                      (r.response_text.length > 200 ? '...' : '')
                    : null;
                }
              }
            }
          }
        }
      }

      const enrichedFields = (fields ?? []).map((f) => ({
        ...f,
        matched_question: f.question_id
          ? (questionMap.get(f.question_id) ?? null)
          : null,
      }));

      // Field-mapping/fill summary -- computed in-process from the `fields`
      // array already fetched above. ID-147 TECH.md §6 row B flagged the old
      // `get_template_summary(p_template_id)` RPC for a p_template_id ->
      // form_instance re-key, but empirically that RPC's body has queried a
      // bare `template_fields` table since before even the pre-{145.6}
      // `form_template_fields` rename existed (grep across
      // supabase/migrations/ for "template_fields" hits only that RPC's own
      // stale body) -- it has had ZERO working callers and 42P01s on every
      // invocation. Computing the summary here reproduces its exact filter
      // logic (mapping_status/fill_status COUNT FILTERs) without depending
      // on a migration fix outside this Subtask's file-ownership boundary,
      // and drops a round trip.
      const summary = {
        total_fields: fields?.length ?? 0,
        confirmed_fields: (fields ?? []).filter(
          (f) =>
            f.mapping_status === 'confirmed' || f.mapping_status === 'manual',
        ).length,
        rejected_fields: (fields ?? []).filter(
          (f) => f.mapping_status === 'rejected',
        ).length,
        unmapped_fields: (fields ?? []).filter(
          (f) => f.mapping_status === 'unmapped',
        ).length,
        unreviewed_fields: (fields ?? []).filter(
          (f) => f.mapping_status === 'unreviewed',
        ).length,
        filled_fields: (fields ?? []).filter((f) => f.fill_status === 'filled')
          .length,
        pending_fields: (fields ?? []).filter(
          (f) => f.fill_status === 'pending',
        ).length,
        skipped_fields: (fields ?? []).filter(
          (f) => f.fill_status === 'skipped',
        ).length,
        failed_fields: (fields ?? []).filter((f) => f.fill_status === 'failed')
          .length,
      };

      // Fetch completions
      const { data: completions, error: completionsError } = await supabase
        .from('template_completions')
        .select(
          'id, form_instance_id, job_id, storage_path, fields_filled, fields_skipped, fields_failed, file_size, created_by, created_at',
        )
        .eq('form_instance_id', id)
        .order('created_at', { ascending: false });

      if (completionsError) {
        logger.error(
          { err: completionsError },
          'Failed to fetch form completions',
        );
        warnings.push(
          'Completions history could not be loaded: ' +
            safeErrorMessage(completionsError, 'completions fetch failed'),
        );
      }

      const responseBody: Record<string, unknown> = {
        ...template,
        fields: enrichedFields,
        summary,
        completions: completions ?? [],
      };
      if (warnings.length > 0) {
        responseBody.warnings = warnings;
      }
      return NextResponse.json(responseBody);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch template detail') },
        { status: 500 },
      );
    }
  },
);
