import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { AutoMapBodySchema } from '@/lib/validation/template-schemas';
import { similarity } from '@/lib/template-auto-map';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/bids/:id/templates/:templateId/auto-map -- auto-map fields to bid questions */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    const { id: bidId, templateId } = await params;
    if (!UUID_RE.test(bidId) || !UUID_RE.test(templateId)) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const { allowed } = checkRateLimit(
      `template-automap:${user.id}`,
      10,
      60_000,
    );
    if (!allowed) return rateLimitResponse();

    const body = await request.json().catch(() => ({}));
    const parsed = AutoMapBodySchema.safeParse(body);
    const threshold = parsed.success ? parsed.data.threshold : 0.7;

    // Verify template exists and is analysed
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id, status')
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
        { error: 'Template must be analysed before auto-mapping' },
        { status: 409 },
      );
    }

    // Fetch unmapped template fields
    const { data: fields, error: fieldsError } = await supabase
      .from('template_fields')
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

    // Fetch bid questions for this workspace
    const { data: questions, error: questionsError } = await supabase
      .from('bid_questions')
      .select('id, question_text')
      .eq('project_id', bidId);

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
        if (score >= threshold && (!bestMatch || score > bestMatch.confidence)) {
          bestMatch = {
            question_id: question.id,
            confidence: score,
            question_text: question.question_text,
          };
        }
      }

      if (bestMatch) {
        // Update field with auto-mapped question
        await supabase
          .from('template_fields')
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

    // Update mapped_count on template
    const { count } = await supabase
      .from('template_fields')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', templateId)
      .not('question_id', 'is', null)
      .in('mapping_status', ['unreviewed', 'confirmed', 'manual']);

    await supabase
      .from('templates')
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
}
