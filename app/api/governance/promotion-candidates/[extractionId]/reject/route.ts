// app/api/governance/promotion-candidates/[extractionId]/reject/route.ts
//
// ID-145 {145.30} — per-candidate promotion REJECT over the `awaiting_review`
// bucket of q_a_extractions_promotion_candidates() ({138.17}, DR-026
// propose-surfacing half). BI-38 amendment (DR-062, S470) — see the sibling
// accept/route.ts header for the full scope + auth rationale (shared here).
//
// REJECT: the reviewer judged the PUBLISHED pair's current text correct.
// Writes NOTHING to q_a_pairs — instead, the extraction's carried fields
// (question_text/answer_standard/alternate_question_phrasings) are
// reconciled DOWN to the pair's current values, so the extraction record
// stops disagreeing with it. Self-cleaning: the candidate naturally drops
// out of the 'awaiting_review' set on the next fetch (see
// lib/q-a-pairs/promotion-candidate-review.ts's module header).
//
// {145.34}: threads the reviewer's `auth.user.id` through as `actor` so
// rejectAwaitingReviewCandidate can record an append-only disposition row
// (or suppress a re-fired identical rejected proposal — Gap 2).

import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { rejectAwaitingReviewCandidate } from '@/lib/q-a-pairs/promotion-candidate-review';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

type RouteContext = { params: Promise<{ extractionId: string }> };

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  not_found: 404,
  not_awaiting_review: 409,
  write_failed: 500,
};

export const POST = defineRoute(
  z.unknown(),
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { extractionId } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);

      const result = await rejectAwaitingReviewCandidate(
        auth.supabase,
        extractionId,
        auth.user.id,
      );

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error.message, code: result.error.code },
          { status: STATUS_BY_ERROR_CODE[result.error.code] ?? 500 },
        );
      }

      return NextResponse.json({
        disposition: 'rejected',
        pair: result.pair,
        extraction: result.extraction,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to reject promotion candidate'),
        },
        { status: 500 },
      );
    }
  },
);
