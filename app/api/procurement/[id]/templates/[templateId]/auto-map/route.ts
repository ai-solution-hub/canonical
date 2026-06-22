import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { similarity } from '@/lib/templates/template-auto-map';
import { parseBody } from '@/lib/validation';
import { AutoMapBodySchema } from '@/lib/validation/template-schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(OPS-T1): author ResponseSchema
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

      // Verify template exists and is analysed.
      // Post-T2: `templates` → `form_templates`, `workspace_id` → `workspace_id`.
      const { data: template, error: templateError } = await supabase
        .from('form_templates')
        .select('id, status')
        .eq('id', templateId)
        .eq('workspace_id', procurementId)
        .single();

      if (templateError || !template) {
        return NextResponse.json(
          { error: 'Template not found' },
          { status: 404 },
        );
      }

      if (template.status !== 'analysed' && template.status !== 'completed') {
        return NextResponse.json(
          { error: 'Template must be analysed before auto-mapping' },
          { status: 409 },
        );
      }

      // Fetch unmapped template fields.
      // Post-T2: `template_fields` → `form_template_fields`.
      const { data: fields, error: fieldsError } = await supabase
        .from('form_template_fields')
        .select('id, question_text')
        .eq('template_id', templateId)
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

      // Fetch bid questions for this workspace.
      // Post-T2: `form_questions.workspace_id` → `workspace_id`.
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select('id, question_text')
        .eq('workspace_id', procurementId);

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
          // Post-T2: `template_fields` → `form_template_fields`.
          await supabase
            .from('form_template_fields')
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

      // Update mapped_count on template.
      // Post-T2: `template_fields` → `form_template_fields`, `templates` → `form_templates`.
      const { count } = await supabase
        .from('form_template_fields')
        .select('id', { count: 'exact', head: true })
        .eq('template_id', templateId)
        .not('question_id', 'is', null)
        .in('mapping_status', ['unreviewed', 'confirmed', 'manual']);

      await supabase
        .from('form_templates')
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
