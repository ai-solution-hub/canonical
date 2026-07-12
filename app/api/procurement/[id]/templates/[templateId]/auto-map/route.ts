import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { similarity } from '@/lib/domains/procurement/form-templating/template-auto-map';
import { parseBody } from '@/lib/validation';
import { AutoMapBodySchema } from '@/lib/validation/template-schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string; templateId: string }> },
  ) => {
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

      const rl = checkRateLimit(`template-automap:${user.id}`, 10, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const body = await request.json().catch((_err) => ({}));
      const parsed = parseBody(AutoMapBodySchema, body);
      // All fields have defaults, so parse({}) always succeeds.
      // If someone sends genuinely invalid data (e.g. threshold: "abc"),
      // return the 400 error rather than silently using defaults.
      if (!parsed.success) return parsed.response;
      const { threshold } = parsed.data;

      // Verify the form exists and is analysed.
      // ID-145 {145.6} M3 (TECH.md section 2): `form_templates` -> `form_instances`,
      // `status` -> `processing_status`, `workspace_id` DROPPED (BI-1 -- the item
      // IS the form, no second workspace-mediated home). `templateId` is the
      // form_instances row's own id -- there is no longer a workspace scope to
      // join against; `procurementId` stays format-validated above for the
      // route's URL shape but is not a query predicate here.
      const { data: template, error: templateError } = await supabase
        .from('form_instances')
        .select('id, processing_status')
        .eq('id', templateId)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      if (
        template.processing_status !== 'analysed' &&
        template.processing_status !== 'completed'
      ) {
        return NextResponse.json(
          { error: 'Template must be analysed before auto-mapping' },
          { status: 409 },
        );
      }

      // Fetch unmapped fields for this form.
      // ID-145 {145.6} M3: `form_template_fields` -> `form_instance_fields`,
      // `template_id` -> `form_instance_id` (BI-21 -- un-orphaned against real
      // rows once {145.10}/{145.11} restore the Plane-2 writer).
      const { data: fields, error: fieldsError } = await supabase
        .from('form_instance_fields')
        .select('id, question_text')
        .eq('form_instance_id', templateId)
        .in('mapping_status', ['unreviewed', 'unmapped'])
        .not('question_text', 'is', null);

      if (fieldsError) {
        return NextResponse.json(
          { error: 'Failed to fetch template fields' },
          { status: 500 },
        );
      }

      if (!fields || fields.length === 0) {
        return NextResponse.json({
          mapped: 0,
          unmapped: 0,
          total: 0,
          mappings: [],
        });
      }

      // Fetch this form's questions.
      // ID-145 {145.6} M3: `form_questions.workspace_id` (dropped) ->
      // `form_questions.form_instance_id` (NOT NULL, BI-7 -- every question
      // belongs to exactly one form, by construction).
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select('id, question_text')
        .eq('form_instance_id', templateId);

      if (questionsError || !questions || questions.length === 0) {
        return NextResponse.json({
          mapped: 0,
          unmapped: fields.length,
          total: fields.length,
          mappings: [],
        });
      }

      // Auto-map each field to the best-matching question
      const mappings: Array<{
        field_id: string;
        question_id: string;
        confidence: number;
        field_question_text: string;
        bid_question_text: string;
      }> = [];

      let mapped = 0;
      let unmapped = 0;

      for (const field of fields) {
        if (!field.question_text) {
          unmapped++;
          continue;
        }

        let bestMatch: {
          question_id: string;
          confidence: number;
          question_text: string;
        } | null = null;

        for (const question of questions) {
          const score = similarity(field.question_text, question.question_text);
          if (
            score >= threshold &&
            (!bestMatch || score > bestMatch.confidence)
          ) {
            bestMatch = {
              question_id: question.id,
              confidence: score,
              question_text: question.question_text,
            };
          }
        }

        if (bestMatch) {
          // Update field with auto-mapped question.
          // ID-145 {145.6} M3: `form_template_fields` -> `form_instance_fields`.
          await supabase
            .from('form_instance_fields')
            .update({
              question_id: bestMatch.question_id,
              mapping_status: 'unreviewed',
              mapping_confidence: bestMatch.confidence,
            })
            .eq('id', field.id);

          mappings.push({
            field_id: field.id,
            question_id: bestMatch.question_id,
            confidence: bestMatch.confidence,
            field_question_text: field.question_text,
            bid_question_text: bestMatch.question_text,
          });

          mapped++;
        } else {
          unmapped++;
        }
      }

      // Update mapped_count on the form.
      // ID-145 {145.6} M3: `form_template_fields` -> `form_instance_fields`,
      // `template_id` -> `form_instance_id`, `form_templates` -> `form_instances`.
      const { count } = await supabase
        .from('form_instance_fields')
        .select('id', { count: 'exact', head: true })
        .eq('form_instance_id', templateId)
        .not('question_id', 'is', null)
        .in('mapping_status', ['unreviewed', 'confirmed', 'manual']);

      await supabase
        .from('form_instances')
        .update({ mapped_count: count ?? 0 })
        .eq('id', templateId);

      return NextResponse.json({
        mapped,
        unmapped,
        total: fields.length,
        mappings,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to auto-map template fields') },
        { status: 500 },
      );
    }
  },
);
