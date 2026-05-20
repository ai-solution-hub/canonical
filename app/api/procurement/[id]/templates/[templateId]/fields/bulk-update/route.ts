import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { BulkFieldMappingSchema } from '@/lib/validation/template-schemas';
import { parseBody } from '@/lib/validation';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/templates/:templateId/fields/bulk-update -- bulk update field mappings */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: procurementId, templateId } = await params;
    if (!UUID_RE.test(procurementId) || !UUID_RE.test(templateId)) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const parsed = parseBody(BulkFieldMappingSchema, body);
    if (!parsed.success) return parsed.response;

    // Verify template exists and belongs to this bid.
    // Post-T2: `templates` → `form_templates`, `project_id` → `workspace_id`.
    const { data: template, error: templateError } = await supabase
      .from('form_templates')
      .select('id')
      .eq('id', templateId)
      .eq('workspace_id', procurementId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    // Update each field.
    // Post-T2: `template_fields` → `form_template_fields`.
    let updated = 0;
    for (const mapping of parsed.data.mappings) {
      const { error } = await supabase
        .from('form_template_fields')
        .update({
          question_id: mapping.question_id,
          mapping_status: mapping.mapping_status,
        })
        .eq('id', mapping.field_id)
        .eq('template_id', templateId);

      if (!error) {
        updated++;
      }
    }

    // Update mapped_count on template.
    // Post-T2: same table renames.
    const { count } = await supabase
      .from('form_template_fields')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', templateId)
      .not('question_id', 'is', null)
      .in('mapping_status', ['confirmed', 'manual']);

    await supabase
      .from('form_templates')
      .update({ mapped_count: count ?? 0 })
      .eq('id', templateId);

    return NextResponse.json({
      updated,
      mapped_count: count ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to bulk update field mappings') },
      { status: 500 },
    );
  }
}
