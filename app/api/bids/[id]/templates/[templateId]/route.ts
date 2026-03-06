import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  unauthorisedResponse,
  forbiddenResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────
// GET /api/bids/:id/templates/:templateId -- template detail with fields
// ──────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id: bidId, templateId } = await params;
    if (!UUID_RE.test(bidId) || !UUID_RE.test(templateId)) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select(
        'id, project_id, name, description, filename, storage_path, file_size, mime_type, status, field_count, mapped_count, structure_path, created_by, created_at, updated_at',
      )
      .eq('id', templateId)
      .eq('project_id', bidId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    // Fetch fields with their mapped bid question data
    const { data: fields, error: fieldsError } = await supabase
      .from('template_fields')
      .select(
        'id, template_id, field_type, table_index, row_index, col_index, question_text, section_name, word_limit, placeholder_text, question_id, mapping_status, mapping_confidence, fill_status, fill_error, sequence, created_at, updated_at',
      )
      .eq('template_id', templateId)
      .order('sequence', { ascending: true });

    if (fieldsError) {
      console.error('Failed to fetch template fields:', fieldsError);
      return NextResponse.json(
        { error: 'Failed to fetch template fields' },
        { status: 500 },
      );
    }

    // Enrich fields with matched question data
    const questionIds = (fields ?? [])
      .map((f) => f.question_id)
      .filter((id): id is string => id !== null);

    const questionMap = new Map<string, {
      id: string;
      question_text: string;
      status: string;
      response_preview: string | null;
    }>();

    if (questionIds.length > 0) {
      // Fetch bid questions
      const { data: questions } = await supabase
        .from('bid_questions')
        .select('id, question_text, status')
        .in('id', questionIds);

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
        const { data: responses } = await supabase
          .from('bid_responses')
          .select('question_id, response_text, version')
          .in('question_id', questionIds)
          .order('version', { ascending: false });

        if (responses) {
          // Group by question_id, take latest (already ordered DESC)
          const seen = new Set<string>();
          for (const r of responses) {
            if (!seen.has(r.question_id)) {
              seen.add(r.question_id);
              const q = questionMap.get(r.question_id);
              if (q) {
                q.response_preview = r.response_text
                  ? r.response_text.substring(0, 200) + (r.response_text.length > 200 ? '...' : '')
                  : null;
              }
            }
          }
        }
      }
    }

    const enrichedFields = (fields ?? []).map((f) => ({
      ...f,
      matched_question: f.question_id ? questionMap.get(f.question_id) ?? null : null,
    }));

    // Fetch summary via RPC
    const { data: summaryRows } = await supabase.rpc(
      'get_template_summary',
      { p_template_id: templateId },
    );

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
    const { data: completions } = await supabase
      .from('template_completions')
      .select(
        'id, template_id, job_id, storage_path, fields_filled, fields_skipped, fields_failed, file_size, created_by, created_at',
      )
      .eq('template_id', templateId)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      ...template,
      fields: enrichedFields,
      summary,
      completions: completions ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch template detail') },
      { status: 500 },
    );
  }
}

// ──────────────────────────────────────────
// DELETE /api/bids/:id/templates/:templateId -- delete a template
// ──────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const { id: bidId, templateId } = await params;
    if (!UUID_RE.test(bidId) || !UUID_RE.test(templateId)) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Fetch template to get storage paths for cleanup
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id, storage_path, structure_path')
      .eq('id', templateId)
      .eq('project_id', bidId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    // Fetch completion storage paths for cleanup
    const { data: completions } = await supabase
      .from('template_completions')
      .select('storage_path')
      .eq('template_id', templateId);

    // Delete template record (cascades to fields and completions)
    const { error: deleteError } = await supabase
      .from('templates')
      .delete()
      .eq('id', templateId);

    if (deleteError) {
      console.error('Failed to delete template:', deleteError);
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

    await serviceClient.storage.from('templates').remove(pathsToRemove);

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete template') },
      { status: 500 },
    );
  }
}
