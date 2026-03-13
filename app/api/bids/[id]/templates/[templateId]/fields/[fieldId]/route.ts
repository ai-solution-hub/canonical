import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { FieldMappingUpdateSchema } from '@/lib/validation/template-schemas';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/bids/:id/templates/:templateId/fields/:fieldId -- update single field mapping */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; templateId: string; fieldId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: bidId, templateId, fieldId } = await params;
    if (
      !UUID_RE.test(bidId) ||
      !UUID_RE.test(templateId) ||
      !UUID_RE.test(fieldId)
    ) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const parsed = FieldMappingUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Verify template exists and belongs to this bid
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id')
      .eq('id', templateId)
      .eq('project_id', bidId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    // Update field
    const { data: field, error: fieldError } = await supabase
      .from('template_fields')
      .update({
        question_id: parsed.data.question_id,
        mapping_status: parsed.data.mapping_status,
      })
      .eq('id', fieldId)
      .eq('template_id', templateId)
      .select('id, question_id, mapping_status, updated_at')
      .single();

    if (fieldError || !field) {
      return NextResponse.json(
        { error: 'Field not found' },
        { status: 404 },
      );
    }

    // Update mapped_count on template
    const { count } = await supabase
      .from('template_fields')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', templateId)
      .not('question_id', 'is', null)
      .in('mapping_status', ['confirmed', 'manual']);

    await supabase
      .from('templates')
      .update({ mapped_count: count ?? 0 })
      .eq('id', templateId);

    return NextResponse.json(field);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update field mapping') },
      { status: 500 },
    );
  }
}
