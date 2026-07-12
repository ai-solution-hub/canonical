import {
  extractDOCXQuestions,
  extractPDFQuestions,
  extractTenderMetadata,
  extractXLSXQuestions,
  xlsxWorkbookToHtml,
} from '@/lib/domains/procurement/ai/extract-questions';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { sb } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import { QuestionExtractBodySchema } from '@/lib/validation/schemas';
import type { TenderExtractedMetadata } from '@/types/procurement-metadata';
import mammoth from 'mammoth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ExtractedQuestion {
  section_name: string;
  section_sequence: number;
  question_text: string;
  question_sequence: number;
  word_limit: number | null;
  evaluation_weight: number | null;
  // ID-145 {145.12} — metadata parity with q_a_extractions
  // (expected_response_kind). Not a form_questions column (no W1 DDL added
  // one) — carried through extraction only, and attached to the API
  // response by text-match, not persisted to the DB row.
  expected_response_kind: 'mandatory' | 'optional';
}

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const rl = checkRateLimit(`questions-extract:${user.id}`, 5, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(QuestionExtractBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { document_path, format } = parsed.data;

      // ID-145 {145.7} — form-first: the route [id] IS the form_instances id
      // directly (BI-1/BI-2). No more workspace lookup/discriminator join —
      // form_instances carries no workspace_id post-{145.6} M3.
      const { data: form, error: formError } = await supabase
        .from('form_instances')
        .select('id, name')
        .eq('id', id)
        .single();

      if (formError || !form) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Download file from Supabase Storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('tender-documents')
        .download(document_path);

      if (downloadError || !fileData) {
        logger.error(
          { err: downloadError },
          'Failed to download tender document',
        );
        return NextResponse.json(
          { error: 'Failed to download tender document from storage' },
          { status: 404 },
        );
      }

      const extractedQuestions: ExtractedQuestion[] = [];
      let sectionsFound = 0;

      if (format === 'docx') {
        // Convert DOCX to HTML via mammoth, then extract with Claude
        const arrayBuffer = await fileData.arrayBuffer();
        const result = await extractDOCXQuestions(Buffer.from(arrayBuffer));

        for (const section of result.sections ?? []) {
          sectionsFound++;
          for (const question of section.questions ?? []) {
            extractedQuestions.push({
              section_name: section.section_name,
              section_sequence: section.section_sequence,
              question_text: question.question_text,
              question_sequence: question.question_sequence,
              word_limit: question.word_limit ?? null,
              evaluation_weight: question.evaluation_weight ?? null,
              expected_response_kind: question.expected_response_kind,
            });
          }
        }
      } else if (format === 'pdf') {
        // Convert to base64 and use Claude extraction
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        const result = await extractPDFQuestions(base64);

        for (const section of result.sections ?? []) {
          sectionsFound++;
          for (const question of section.questions ?? []) {
            extractedQuestions.push({
              section_name: section.section_name,
              section_sequence: section.section_sequence,
              question_text: question.question_text,
              question_sequence: question.question_sequence,
              word_limit: question.word_limit ?? null,
              evaluation_weight: question.evaluation_weight ?? null,
              expected_response_kind: question.expected_response_kind,
            });
          }
        }
      } else if (format === 'xlsx') {
        // ID-145 {145.12}: workbook -> structured HTML text via the `xlsx`
        // reader, then the same Claude extraction path as PDF/DOCX.
        const arrayBuffer = await fileData.arrayBuffer();
        const result = await extractXLSXQuestions(Buffer.from(arrayBuffer));

        for (const section of result.sections ?? []) {
          sectionsFound++;
          for (const question of section.questions ?? []) {
            extractedQuestions.push({
              section_name: section.section_name,
              section_sequence: section.section_sequence,
              question_text: question.question_text,
              question_sequence: question.question_sequence,
              word_limit: question.word_limit ?? null,
              evaluation_weight: question.evaluation_weight ?? null,
              expected_response_kind: question.expected_response_kind,
            });
          }
        }
      }

      // Deduplicate against existing questions before inserting
      let questionsInserted = 0;
      let duplicatesSkipped = 0;

      if (extractedQuestions.length > 0) {
        // ID-145 {145.7}: `form_questions.workspace_id` is dropped ({145.6}
        // M3) — scope on `form_instance_id`.
        const { data: existingQuestions, error: existingError } = await supabase
          .from('form_questions')
          .select('question_text')
          .eq('form_instance_id', id);

        if (existingError) {
          logger.error(
            { err: existingError },
            'Failed to fetch existing bid questions for dedup',
          );
          return NextResponse.json(
            {
              error: safeErrorMessage(
                existingError,
                'Failed to fetch existing bid questions',
              ),
            },
            { status: 500 },
          );
        }

        const existingTexts = new Set(
          (existingQuestions ?? []).map((q) =>
            q.question_text.toLowerCase().trim(),
          ),
        );

        const newQuestions = extractedQuestions.filter(
          (q) => !existingTexts.has(q.question_text.toLowerCase().trim()),
        );

        duplicatesSkipped = extractedQuestions.length - newQuestions.length;

        if (newQuestions.length === 0) {
          return NextResponse.json({
            status: 'complete',
            questions_found: extractedQuestions.length,
            sections_found: sectionsFound,
            duplicates_skipped: duplicatesSkipped,
            questions_inserted: 0,
            message: 'All extracted questions already exist for this bid',
            questions: [],
          });
        }

        // ID-145 {145.7}: every inserted row is stamped with the form's own
        // id directly (`id`, the route param) — no resolve-or-mint (the
        // {130.27} RPC + its TS resolver are retired, {145.6} M3/{145.7}).
        // form_questions.form_instance_id is NOT NULL post-migration, so
        // every insert MUST carry a real form id — it always does here.
        //
        // ID-145 {145.7}: `form_questions.workspace_id` is dropped ({145.6}
        // M3) — scope on `form_instance_id`. The UNIQUE index backing this
        // onConflict is renamed too (form_questions_workspace_question_unique
        // -> form_questions_form_instance_question_unique) but PostgREST
        // resolves `onConflict` by column list, not constraint name.
        const inserts = newQuestions.map((q) => ({
          form_instance_id: id,
          section_name: q.section_name,
          section_sequence: q.section_sequence,
          question_text: q.question_text,
          question_sequence: q.question_sequence,
          word_limit: q.word_limit,
          evaluation_weight: q.evaluation_weight,
          created_by: user.id,
        }));

        // Use upsert with ignoreDuplicates to handle re-extraction idempotently.
        // Claude may produce slightly different question sets on re-extraction,
        // and partial inserts from a timed-out first attempt may already exist.
        const { error: insertError } = await supabase
          .from('form_questions')
          .upsert(inserts, {
            onConflict: 'form_instance_id,question_text',
            ignoreDuplicates: true,
          });

        if (insertError) {
          logger.error(
            { err: insertError },
            'Failed to insert extracted questions',
          );
          return NextResponse.json(
            { error: 'Questions extracted but failed to save to database' },
            { status: 500 },
          );
        }

        questionsInserted = newQuestions.length;

        // ID-145 {145.7} — BI-6 single state home: the ex-workspaces.status
        // second home ('questions_extracted') is retired here — workflow_state
        // on form_instances is the ONLY state home now, and this route does
        // not write it (no route-level state transition was specified for
        // this Subtask; a form_instances.workflow_state transition on
        // extraction success, if wanted, is a follow-up product decision, not
        // reintroduced here as a same-shape replacement of the retired write).
      }

      // Best-effort tender metadata extraction (non-critical)
      let extracted_metadata: TenderExtractedMetadata | undefined;
      try {
        if (format === 'docx') {
          const docxBuffer = Buffer.from(await fileData.arrayBuffer());
          const { value: html } = await mammoth.convertToHtml({
            buffer: docxBuffer,
          });
          if (html && html.trim().length > 0) {
            const result = await extractTenderMetadata(html, 'html');
            if (result) extracted_metadata = result;
          }
        } else if (format === 'pdf') {
          const pdfArrayBuffer = await fileData.arrayBuffer();
          const pdfBase64 = Buffer.from(pdfArrayBuffer).toString('base64');
          const result = await extractTenderMetadata(pdfBase64, 'pdf_base64');
          if (result) extracted_metadata = result;
        } else if (format === 'xlsx') {
          const xlsxBuffer = Buffer.from(await fileData.arrayBuffer());
          const html = xlsxWorkbookToHtml(xlsxBuffer);
          if (html && html.trim().length > 0) {
            const result = await extractTenderMetadata(html, 'html');
            if (result) extracted_metadata = result;
          }
        }
      } catch (metaErr) {
        logger.warn(
          { err: metaErr },
          'Metadata extraction failed (non-critical)',
        );
      }

      // Fetch the saved questions to return with IDs.
      // ID-145 {145.7}: `form_questions.workspace_id` is dropped ({145.6}
      // M3) — scope on `form_instance_id`. `matched_record_ids` is also
      // dropped — no longer selected.
      const savedQuestions = await sb(
        supabase
          .from('form_questions')
          .select(
            'id, form_instance_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, assigned_to, created_by, created_at, updated_at',
          )
          .eq('form_instance_id', id)
          .eq('created_by', user.id)
          .order('section_sequence', { ascending: true })
          .order('question_sequence', { ascending: true }),
        'bids.questions.extract.savedQuestions.read',
      );

      // ID-145 {145.12} — metadata parity with q_a_extractions
      // (expected_response_kind): form_questions has no such column (no W1
      // DDL added one, and this Subtask authors no new migration), so the
      // per-question classification from THIS extraction pass is attached to
      // the response by question_text match rather than persisted. Rows
      // pre-existing before this call (skipped as duplicates) carry no
      // expected_response_kind — they were not part of this extraction pass.
      const expectedResponseKindByText = new Map(
        extractedQuestions.map((q) => [
          q.question_text.toLowerCase().trim(),
          q.expected_response_kind,
        ]),
      );
      const questionsWithMetadata = (savedQuestions ?? []).map((q) => ({
        ...q,
        expected_response_kind:
          expectedResponseKindByText.get(
            q.question_text?.toLowerCase().trim() ?? '',
          ) ?? null,
      }));

      return NextResponse.json({
        status: 'complete',
        questions_found: extractedQuestions.length,
        sections_found: sectionsFound,
        duplicates_skipped: duplicatesSkipped,
        questions_inserted: questionsInserted,
        questions: questionsWithMetadata,
        ...(extracted_metadata ? { extracted_metadata } : {}),
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            err,
            'Failed to extract questions from tender document',
          ),
        },
        { status: 500 },
      );
    }
  },
);
