import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { QuestionExtractBodySchema } from '@/lib/validation/schemas';
import {
  extractPDFQuestions,
  extractDOCXQuestions,
  extractTenderMetadata,
} from '@/lib/ai/extract-questions';
import mammoth from 'mammoth';
import type { TenderExtractedMetadata } from '@/types/bid-metadata';
import { canTransition, type BidState } from '@/lib/bid/bid-state-machine';

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
}

/** POST /api/bids/:id/questions/extract -- extract questions from tender document */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Verify bid exists
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    // Download file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('tender-documents')
      .download(document_path);

    if (downloadError || !fileData) {
      console.error('Failed to download tender document:', downloadError);
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
          });
        }
      }
    }

    // Deduplicate against existing questions before inserting
    let questionsInserted = 0;
    let duplicatesSkipped = 0;

    if (extractedQuestions.length > 0) {
      const { data: existingQuestions, error: existingError } = await supabase
        .from('bid_questions')
        .select('question_text')
        .eq('project_id', id);

      if (existingError) {
        console.error(
          'Failed to fetch existing bid questions for dedup:',
          existingError,
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

      const inserts = newQuestions.map((q) => ({
        project_id: id,
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
        .from('bid_questions')
        .upsert(inserts, {
          onConflict: 'project_id,question_text',
          ignoreDuplicates: true,
        });

      if (insertError) {
        console.error('Failed to insert extracted questions:', insertError);
        return NextResponse.json(
          { error: 'Questions extracted but failed to save to database' },
          { status: 500 },
        );
      }

      questionsInserted = newQuestions.length;

      // Update bid status to questions_extracted (only if transition is valid)
      const { data: currentBid } = await supabase
        .from('workspaces')
        .select('status')
        .eq('id', id)
        .single();

      const currentStatus = (currentBid?.status ?? 'draft') as BidState;
      if (canTransition(currentStatus, 'questions_extracted')) {
        await supabase
          .from('workspaces')
          .update({
            status: 'questions_extracted',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
      }
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
      }
    } catch (metaErr) {
      console.warn('Metadata extraction failed (non-critical):', metaErr);
    }

    // Fetch the saved questions to return with IDs
    const { data: savedQuestions } = await supabase
      .from('bid_questions')
      .select(
        'id, project_id, section_name, section_sequence, question_text, question_sequence, word_limit, evaluation_weight, confidence_posture, matched_content_ids, assigned_to, created_by, created_at, updated_at',
      )
      .eq('project_id', id)
      .eq('created_by', user.id)
      .order('section_sequence', { ascending: true })
      .order('question_sequence', { ascending: true });

    return NextResponse.json({
      status: 'complete',
      questions_found: extractedQuestions.length,
      sections_found: sectionsFound,
      duplicates_skipped: duplicatesSkipped,
      questions_inserted: questionsInserted,
      questions: savedQuestions ?? [],
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
}
