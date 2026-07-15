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

// ──────────────────────────────────────────
// PATCH /api/procurement/:id/fields/:fieldId -- update a single field mapping
// DR-075 (ID-147 TECH.md §6 row B, ratified S474): re-keyed + re-pathed from
// `templates/[templateId]/fields/[fieldId]/route.ts` -- `id` IS the form's
// own PK (form_instances.id), matching the fill/auto-map convention; there
// is no longer a separate `templateId` segment.
// ──────────────────────────────────────────

export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; fieldId: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id, fieldId } = await params;
      if (!UUID_RE.test(id) || !UUID_RE.test(fieldId)) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const body = await request.json();
      const parsed = parseBody(FieldMappingUpdateSchema, body);
      if (!parsed.success) return parsed.response;

      // Verify the form exists.
      const { data: template, error: templateError } = await supabase
        .from('form_instances')
        .select('id')
        .eq('id', id)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      // Update field.
      const { data: field, error: fieldError } = await supabase
        .from('form_instance_fields')
        .update({
          question_id: parsed.data.question_id,
          mapping_status: parsed.data.mapping_status,
        })
        .eq('id', fieldId)
        .eq('form_instance_id', id)
        .select('id, question_id, mapping_status, updated_at')
        .single();

      if (fieldError || !field) {
        return NextResponse.json({ error: 'Field not found' }, { status: 404 });
      }

      // Update mapped_count on the form.
      const { count } = await supabase
        .from('form_instance_fields')
        .select('id', { count: 'exact', head: true })
        .eq('form_instance_id', id)
        .not('question_id', 'is', null)
        .in('mapping_status', ['confirmed', 'manual']);

      await supabase
        .from('form_instances')
        .update({ mapped_count: count ?? 0 })
        .eq('id', id);

      return NextResponse.json(field);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update field mapping') },
        { status: 500 },
      );
    }
  },
);
