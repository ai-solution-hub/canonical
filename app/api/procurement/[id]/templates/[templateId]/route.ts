import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────
// GET /api/procurement/:id/templates/:templateId -- template detail with fields
// ──────────────────────────────────────────

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; templateId: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: procurementId, templateId } = await params;
      if (!UUID_RE.test(procurementId) || !UUID_RE.test(templateId)) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Fetch template.
      // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
      const { data: template, error: templateError } = await supabase
        .from('form_templates')
        .select(
          'id, workspace_id, name, description, filename, storage_path, file_size, mime_type, status, field_count, mapped_count, structure_path, created_by, created_at, updated_at',
        )
        .eq('id', templateId)
        .eq('workspace_id', procurementId)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      // Fetch fields with their mapped bid question data.
      // Post-T2: `template_fields` → `form_template_fields`.
      const { data: fields, error: fieldsError } = await supabase
        .from('form_template_fields')
        .select(
          'id, template_id, field_type, table_index, row_index, col_index, question_text, section_name, word_limit, placeholder_text, question_id, mapping_status, mapping_confidence, fill_status, fill_error, sequence, created_at, updated_at',
        )
        .eq('template_id', templateId)
        .order('sequence', { ascending: true });

      if (fieldsError) {
        logger.error({ err: fieldsError }, 'Failed to fetch template fields');
        return NextResponse.json(
          { error: 'Failed to fetch template fields' },
          { status: 500 },
        );
      }

      // Enrich fields with matched question data
      const questionIds = (fields ?? [])
        .map((f) => f.question_id)
        .filter((id): id is string => id !== null);

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
            'Failed to fetch matched bid questions for template',
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
              'Failed to fetch response previews for template',
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

      // Fetch summary via RPC
      const { data: summaryRows, error: summaryError } = await supabase.rpc(
        'get_template_summary',
        {
          p_template_id: templateId,
        },
      );

      if (summaryError) {
        logger.error(
          { err: summaryError },
          'Failed to fetch template summary RPC',
        );
        warnings.push(
          'Field counts could not be loaded: ' +
            safeErrorMessage(summaryError, 'summary RPC failed'),
        );
      }

      const summary = summaryRows?.[0] ?? {
        total_fields: 0,
        confirmed_fields: 0,
        rejected_fields: 0,
        unmapped_fields: 0,
        unreviewed_fields: 0,
        filled_fields: 0,
        pending_fields: 0,
        skipped_fields: 0,
        failed_fields: 0,
      };

      // Fetch completions
      const { data: completions, error: completionsError } = await supabase
        .from('template_completions')
        .select(
          'id, template_id, job_id, storage_path, fields_filled, fields_skipped, fields_failed, file_size, created_by, created_at',
        )
        .eq('template_id', templateId)
        .order('created_at', { ascending: false });

      if (completionsError) {
        logger.error(
          { err: completionsError },
          'Failed to fetch template completions',
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

// ──────────────────────────────────────────
// DELETE /api/procurement/:id/templates/:templateId -- delete a template
// ──────────────────────────────────────────

export const DELETE = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; templateId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: procurementId, templateId } = await params;
      if (!UUID_RE.test(procurementId) || !UUID_RE.test(templateId)) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Fetch template to get storage paths for cleanup.
      // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
      const { data: template, error: templateError } = await supabase
        .from('form_templates')
        .select('id, storage_path, structure_path')
        .eq('id', templateId)
        .eq('workspace_id', procurementId)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      // Fetch completion storage paths for cleanup
      const { data: completions, error: completionsListError } = await supabase
        .from('template_completions')
        .select('storage_path')
        .eq('template_id', templateId);

      if (completionsListError) {
        // Non-fatal — log and continue. Worst case is orphaned storage files.
        logger.error(
          { templateId, error: completionsListError },
          'Template DELETE: failed to list completion storage paths (orphaned files possible)',
        );
      }

      // Delete template record (cascades to fields and completions).
      // Post-T2: `templates` → `form_templates`.
      const { error: deleteError } = await supabase
        .from('form_templates')
        .delete()
        .eq('id', templateId);

      if (deleteError) {
        logger.error({ err: deleteError }, 'Failed to delete template');
        return NextResponse.json(
          { error: 'Failed to delete template' },
          { status: 500 },
        );
      }

      // Clean up storage files (best effort -- don't fail if cleanup errors)
      const serviceClient = createServiceClient();
      const pathsToRemove = [template.storage_path];
      if (template.structure_path) {
        pathsToRemove.push(template.structure_path);
      }
      if (completions) {
        for (const c of completions) {
          pathsToRemove.push(c.storage_path);
        }
      }

      const { error: removeError } = await serviceClient.storage
        .from('templates')
        .remove(pathsToRemove);
      if (removeError) {
        logger.error(
          { templateId, error: removeError },
          'Template DELETE: storage cleanup failed (orphaned files possible)',
        );
      }

      return NextResponse.json({ deleted: true });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete template') },
        { status: 500 },
      );
    }
  },
);
