import { generateEmbedding } from '@/lib/ai/embed';
import { generateSearchQueries } from '@/lib/domains/procurement/ai/extract-questions';
import type { MatchResult } from '@/lib/ai/match';
import { assessConfidence, deduplicateResults } from '@/lib/ai/match';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { QuestionMatchBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QuestionMatchResult {
  question_id: string;
  question_text: string;
  confidence_posture: string;
  matched_record_ids: string[];
  top_matches: MatchResult[];
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

      const rl = checkRateLimit(`match:${user.id}`, 10, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const parsed = parseBody(QuestionMatchBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { question_ids, force } = parsed.data;

      // ID-145 {145.7} — form-first: the route [id] IS the form_instances id
      // directly (BI-1/BI-2). No more workspace lookup/discriminator join —
      // form_instances carries no workspace_id post-{145.6} M3.
      const { data: form, error: formError } = await supabase
        .from('form_instances')
        .select('id')
        .eq('id', id)
        .single();

      if (formError || !form) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Fetch questions to match.
      // ID-145 {145.7}: `form_questions.workspace_id` is dropped ({145.6}
      // M3) — scope on `form_instance_id`.
      let questionsQuery = supabase
        .from('form_questions')
        .select('id, question_text, confidence_posture')
        .eq('form_instance_id', id);

      if (question_ids && question_ids.length > 0) {
        questionsQuery = questionsQuery.in('id', question_ids);
      } else if (!force) {
        // Only match unmatched questions (no existing posture)
        questionsQuery = questionsQuery.is('confidence_posture', null);
      }

      const { data: questions, error: questionsError } = await questionsQuery;

      if (questionsError) {
        logger.error(
          { err: questionsError },
          'Failed to fetch questions for matching',
        );
        return NextResponse.json(
          { error: 'Failed to fetch questions' },
          { status: 500 },
        );
      }

      if (!questions || questions.length === 0) {
        return NextResponse.json({
          matched: 0,
          results: [],
          message: 'No questions to match',
        });
      }

      // Match a single question: generate search queries, embed, search, deduplicate
      async function matchQuestion(question: {
        id: string;
        question_text: string;
        confidence_posture: string | null;
      }): Promise<QuestionMatchResult> {
        // Generate search queries using Claude
        const searchQueries = await generateSearchQueries(
          question.question_text,
        );

        // For each query, generate embedding and search
        const allResults: MatchResult[] = [];

        for (const query of searchQueries.queries) {
          const embedding = await generateEmbedding(query);

          const { data: searchResults, error: searchError } =
            await supabase.rpc('search_for_form_response', {
              query_embedding: JSON.stringify(embedding),
              query_text: query,
              limit_count: 5,
            });

          if (searchError) {
            // Throw so the per-question Promise.allSettled below records the
            // failure as a "no_content" result rather than silently producing
            // a degraded match set.
            throw new Error(
              `search_for_form_response failed for query "${query}": ${searchError.message}`,
            );
          }

          if (searchResults) {
            for (const result of searchResults) {
              allResults.push({
                id: result.id,
                similarity: result.similarity,
                suggested_title: result.title,
                content_type: result.content_type,
              });
            }
          }
        }

        // Deduplicate and take top 5
        const deduplicated = deduplicateResults(allResults);
        const topMatches = deduplicated.slice(0, 5);

        // Assess confidence
        const posture = assessConfidence(topMatches);
        const matchedIds = topMatches.map((m) => m.id);

        // Update the question. ID-145 {145.7}: `matched_record_ids` is
        // dropped from form_questions ({145.6} M3) — only confidence_posture
        // is persisted now; the matched ids still flow through in the
        // response's `top_matches` (below), un-persisted (R7/{145.17}
        // question_matches wiring, a LATER Subtask, is the sanctioned
        // persistence path for match candidates — out of this Subtask's
        // scope). Scope on `form_instance_id` (workspace_id is dropped).
        await supabase
          .from('form_questions')
          .update({
            confidence_posture: posture,
          })
          .eq('id', question.id)
          .eq('form_instance_id', id);

        return {
          question_id: question.id,
          question_text: question.question_text,
          confidence_posture: posture,
          matched_record_ids: matchedIds,
          top_matches: topMatches,
        };
      }

      // Process questions in parallel batches of 5
      const results: QuestionMatchResult[] = [];

      for (let i = 0; i < questions.length; i += 5) {
        const batch = questions.slice(i, i + 5);
        const settled = await Promise.allSettled(
          batch.map((q) => matchQuestion(q)),
        );

        for (let j = 0; j < settled.length; j++) {
          const outcome = settled[j];
          const question = batch[j];

          if (outcome.status === 'fulfilled') {
            results.push(outcome.value);
          } else {
            logger.error(
              { err: outcome.reason },
              `Failed to match question ${question.id}`,
            );
            // Record failure rather than crashing the entire batch
            results.push({
              question_id: question.id,
              question_text: question.question_text,
              confidence_posture: 'no_content',
              matched_record_ids: [],
              top_matches: [],
            });
          }
        }
      }

      // ID-145 {145.7} — BI-6 single state home: the ex-workspaces.status
      // second home ('drafting', previously written here once every question
      // reached a confidence posture) is retired — workflow_state on
      // form_instances is the ONLY state home now, and this route does not
      // write it (no route-level state transition was specified for this
      // Subtask; a form_instances.workflow_state transition on
      // all-questions-matched, if wanted, is a follow-up product decision,
      // not reintroduced here as a same-shape replacement of the retired
      // write).

      return NextResponse.json({
        matched: results.length,
        results,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to run KB matching') },
        { status: 500 },
      );
    }
  },
);
