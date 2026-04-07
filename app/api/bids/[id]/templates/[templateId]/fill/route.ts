import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { TemplateFillBodySchema } from '@/lib/validation/template-schemas';
import { parseBody } from '@/lib/validation';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/templates/:templateId/fill -- queue template fill job */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id: bidId, templateId } = await params;
    if (!UUID_RE.test(bidId) || !UUID_RE.test(templateId)) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const rl = checkRateLimit(`template-fill:${user.id}`, 5, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const body = await request.json().catch((_err) => ({}));
    const parsed = parseBody(TemplateFillBodySchema, body);
    // All fields have defaults, so parse({}) always succeeds.
    // If someone sends genuinely invalid data (e.g. skip_unmapped: "abc"),
    // return the 400 error rather than silently using defaults.
    if (!parsed.success) return parsed.response;
    const options = parsed.data;

    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id, project_id, storage_path, status')
      .eq('id', templateId)
      .eq('project_id', bidId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    if (template.status !== 'analysed' && template.status !== 'completed') {
      return NextResponse.json(
        { error: 'Template must be analysed before filling' },
        { status: 409 },
      );
    }

    // Fetch confirmed/manual mapped fields
    const { data: fields, error: fieldsError } = await supabase
      .from('template_fields')
      .select(
        'id, table_index, row_index, col_index, question_id, word_limit, mapping_status',
      )
      .eq('template_id', templateId)
      .in('mapping_status', ['confirmed', 'manual'])
      .not('question_id', 'is', null);

    if (fieldsError) {
      return NextResponse.json(
        { error: 'Failed to fetch template fields' },
        { status: 500 },
      );
    }

    if (!fields || fields.length === 0) {
      return NextResponse.json(
        {
          error:
            'No fields have been mapped to questions. Review and confirm field mappings first.',
        },
        { status: 400 },
      );
    }

    // Fetch responses for mapped questions
    const questionIds = fields
      .map((f) => f.question_id)
      .filter((id): id is string => id !== null);

    // Get latest response for each question, ordered by preference
    const { data: responses, error: responsesError } = await supabase
      .from('bid_responses')
      .select('question_id, response_text, review_status, version')
      .in('question_id', questionIds)
      .order('version', { ascending: false });

    if (responsesError) {
      return NextResponse.json(
        { error: 'Failed to fetch bid responses' },
        { status: 500 },
      );
    }

    // Build response map: question_id -> best response text
    const responseMap = new Map<string, string>();
    const seen = new Set<string>();

    // Sort by preference: approved > edited > ai_drafted > draft
    const statusOrder: Record<string, number> = {
      approved: 1,
      edited: 2,
      ai_drafted: 3,
      draft: 4,
    };

    const sortedResponses = (responses ?? []).sort((a, b) => {
      if (a.question_id !== b.question_id) return 0;
      return (
        (statusOrder[a.review_status] ?? 5) -
        (statusOrder[b.review_status] ?? 5)
      );
    });

    for (const r of sortedResponses) {
      if (seen.has(r.question_id)) continue;

      // Check if we should use this response based on options
      if (options.skip_unapproved && r.review_status !== 'approved') {
        continue;
      }
      if (
        !options.fallback_to_draft &&
        (r.review_status === 'draft' || r.review_status === 'ai_drafted')
      ) {
        continue;
      }

      if (r.response_text) {
        responseMap.set(r.question_id, r.response_text);
        seen.add(r.question_id);
      }
    }

    // Build field_mappings for the worker
    const fieldMappings = fields
      .filter((f) => f.question_id && responseMap.has(f.question_id!))
      .map((f) => ({
        field_id: f.id,
        table_index: f.table_index,
        row_index: f.row_index,
        col_index: f.col_index,
        response_text: responseMap.get(f.question_id!)!,
        word_limit: f.word_limit,
      }));

    if (fieldMappings.length === 0) {
      return NextResponse.json(
        {
          error:
            'No responses available for mapped questions. Draft responses first.',
        },
        { status: 400 },
      );
    }

    // Update template status to filling
    await supabase
      .from('templates')
      .update({ status: 'filling' })
      .eq('id', templateId);

    // Insert job into processing_queue
    const { data: job, error: jobError } = await supabase
      .from('processing_queue')
      .insert({
        job_type: 'template_fill',
        payload: {
          template_id: templateId,
          project_id: bidId,
          storage_path: template.storage_path,
          field_mappings: fieldMappings,
          user_id: user.id,
          options,
        },
        status: 'pending',
      })
      .select('id')
      .single();

    if (jobError || !job) {
      await supabase
        .from('templates')
        .update({ status: template.status })
        .eq('id', templateId);

      console.error('Failed to queue fill job:', jobError);
      return NextResponse.json(
        { error: 'Failed to queue fill job' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        job_id: job.id,
        status: 'queued',
        fields_to_fill: fieldMappings.length,
        message: 'Template fill queued',
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to trigger template fill') },
      { status: 500 },
    );
  }
}
