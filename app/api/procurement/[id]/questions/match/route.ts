import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { QuestionMatchBodySchema } from '@/lib/validation/schemas';
import { generateSearchQueries } from '@/lib/ai/extract-questions';
import { generateEmbedding } from '@/lib/ai/embed';
import { deduplicateResults, assessConfidence } from '@/lib/ai/match';
import type { MatchResult } from '@/lib/ai/match';
import { canTransition } from '@/lib/procurement/procurement-workflow';
import type { BidState } from '@/lib/procurement/procurement-workflow';
import { logger } from '@/lib/logger';

export const maxDuration = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QuestionMatchResult {
  question_id: string;
  question_text: string;
  confidence_posture: string;
  matched_content_ids: string[];
  top_matches: MatchResult[];
}

/** POST /api/bids/:id/questions/match -- run KB matching for bid questions */
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

    const rl = checkRateLimit(`match:${user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(QuestionMatchBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { question_ids, force } = parsed.data;

    // Verify bid exists.
    // Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, status, domain_metadata, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    // Fetch questions to match.
    // Post-T2: `bid_questions.project_id` → `workspace_id`.
    let questionsQuery = supabase
      .from('bid_questions')
      .select('id, question_text, confidence_posture')
      .eq('workspace_id', id);

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
      const searchQueries = await generateSearchQueries(question.question_text);

      // For each query, generate embedding and search
      const allResults: MatchResult[] = [];

      for (const query of searchQueries.queries) {
        const embedding = await generateEmbedding(query);

        const { data: searchResults, error: searchError } = await supabase.rpc(
          'search_for_bid_response',
          {
            query_embedding: JSON.stringify(embedding),
            query_text: query,
            limit_count: 5,
          },
        );

        if (searchError) {
          // Throw so the per-question Promise.allSettled below records the
          // failure as a "no_content" result rather than silently producing
          // a degraded match set.
          throw new Error(
            `search_for_bid_response failed for query "${query}": ${searchError.message}`,
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

      // Update the question.
      // Post-T2: `bid_questions.project_id` → `workspace_id`.
      await supabase
        .from('bid_questions')
        .update({
          confidence_posture: posture,
          matched_content_ids: matchedIds,
        })
        .eq('id', question.id)
        .eq('workspace_id', id);

      return {
        question_id: question.id,
        question_text: question.question_text,
        confidence_posture: posture,
        matched_content_ids: matchedIds,
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
            matched_content_ids: [],
            top_matches: [],
          });
        }
      }
    }

    // Check if bid should transition to 'drafting'
    const currentStatus = (bid.status as BidState) ?? 'draft';

    if (
      currentStatus === 'matching' &&
      canTransition(currentStatus, 'drafting')
    ) {
      // Check if all questions now have a confidence posture.
      // Post-T2: `bid_questions.project_id` → `workspace_id`.
      const { count: unmatchedCount } = await supabase
        .from('bid_questions')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', id)
        .is('confidence_posture', null);

      if (unmatchedCount === null || unmatchedCount === 0) {
        // UPDATE narrows on id only (prior read enforces procurement-type).
        await supabase
          .from('workspaces')
          .update({
            status: 'drafting',
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
      }
    }

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
}
