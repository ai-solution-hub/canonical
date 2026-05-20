import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { TemplateAnalyseBodySchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/templates/:templateId/analyse -- queue template analysis */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id: procurementId, templateId } = await params;
    if (!UUID_RE.test(procurementId) || !UUID_RE.test(templateId)) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const rl = checkRateLimit(`template-analyse:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    // Fetch template to verify it exists and get storage path.
    // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
    const { data: template, error: templateError } = await supabase
      .from('form_templates')
      .select('id, workspace_id, storage_path, status')
      .eq('id', templateId)
      .eq('workspace_id', procurementId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    // Parse and validate request body
    let raw;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = parseBody(TemplateAnalyseBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { force } = parsed.data;

    if (
      !force &&
      template.status !== 'uploaded' &&
      template.status !== 'analysis_failed'
    ) {
      return NextResponse.json(
        {
          error: `Template is already in '${template.status}' state. Use { "force": true } to re-analyse.`,
        },
        { status: 409 },
      );
    }

    // If re-analysing, clear existing fields.
    // Post-T2: `template_fields` → `form_template_fields`.
    if (
      force &&
      (template.status === 'analysed' || template.status === 'completed')
    ) {
      await supabase
        .from('form_template_fields')
        .delete()
        .eq('template_id', templateId);
    }

    // Update template status to analysing.
    // Post-T2: `templates` → `form_templates`.
    await supabase
      .from('form_templates')
      .update({ status: 'analysing' })
      .eq('id', templateId);

    // Insert job into processing_queue.
    // payload.workspace_id retained — that's a JSONB blob shape, not a SQL column.
    const { data: job, error: jobError } = await supabase
      .from('processing_queue')
      .insert({
        job_type: 'template_analyse',
        payload: {
          template_id: templateId,
          workspace_id: procurementId,
          storage_path: template.storage_path,
        },
        status: 'pending',
      })
      .select('id')
      .single();

    if (jobError || !job) {
      // Revert template status.
      await supabase
        .from('form_templates')
        .update({ status: template.status })
        .eq('id', templateId);

      logger.error({ err: jobError }, 'Failed to queue analysis job');
      return NextResponse.json(
        { error: 'Failed to queue analysis job' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        job_id: job.id,
        status: 'queued',
        message: 'Template analysis queued',
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to trigger template analysis') },
      { status: 500 },
    );
  }
}
