import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { FieldMappingUpdateSchema } from '@/lib/validation/template-schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    {
      params,
    }: { params: Promise<{ id: string; templateId: string; fieldId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: procurementId, templateId, fieldId } = await params;
      if (
        !UUID_RE.test(procurementId) ||
        !UUID_RE.test(templateId) ||
        !UUID_RE.test(fieldId)
      ) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const body = await request.json();
      const parsed = parseBody(FieldMappingUpdateSchema, body);
      if (!parsed.success) return parsed.response;

      // Verify template exists and belongs to this bid.
      // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
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

      // Update field.
      // Post-T2: `template_fields` → `form_template_fields`.
      const { data: field, error: fieldError } = await supabase
        .from('form_template_fields')
        .update({
          question_id: parsed.data.question_id,
          mapping_status: parsed.data.mapping_status,
        })
        .eq('id', fieldId)
        .eq('template_id', templateId)
        .select('id, question_id, mapping_status, updated_at')
        .single();

      if (fieldError || !field) {
        return NextResponse.json({ error: 'Field not found' }, { status: 404 });
      }

      // Update mapped_count on template.
      // Post-T2: `template_fields` → `form_template_fields`, `templates` → `form_templates`.
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

      return NextResponse.json(field);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update field mapping') },
        { status: 500 },
      );
    }
  },
);
