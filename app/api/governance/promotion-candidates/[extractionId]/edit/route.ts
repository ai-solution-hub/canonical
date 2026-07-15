// app/api/governance/promotion-candidates/[extractionId]/edit/route.ts
//
// ID-145 {145.30} — per-candidate promotion EDIT over the `awaiting_review`
// bucket of q_a_extractions_promotion_candidates() ({138.17}, DR-026
// propose-surfacing half). BI-38 amendment (DR-062, S470) — see the sibling
// accept/route.ts header for the full scope + auth rationale (shared here).
//
// EDIT: the reviewer supplies an ADMIN-EDITED carried-field set (may differ
// from both the extraction's raw re-walked text and the pair's prior text).
// The published pair adopts the edited values, THEN the extraction is
// reconciled to the SAME final values so it does not immediately re-propose
// the diff it was just resolved from (self-cleaning — see
// lib/q-a-pairs/promotion-candidate-review.ts's module header).
//
// Body: question_text + answer_standard REQUIRED (both NOT NULL columns on
// q_a_pairs — squash_baseline.sql:7132-7133); alternate_question_phrasings
// OPTIONAL (defaults to []). `.strict()` rejects stray keys so a typo never
// silently no-ops part of the edit.

import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { editAwaitingReviewCandidate } from '@/lib/q-a-pairs/promotion-candidate-review';
import { parseBody } from '@/lib/validation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

type RouteContext = { params: Promise<{ extractionId: string }> };

const EditBodySchema = z
  .object({
    question_text: z.string().min(1, 'question_text must not be empty'),
    answer_standard: z.string().min(1, 'answer_standard must not be empty'),
    alternate_question_phrasings: z.array(z.string()).optional(),
  })
  .strict();

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  not_found: 404,
  not_awaiting_review: 409,
  write_failed: 500,
};

export const POST = defineRoute(
  z.unknown(),
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { extractionId } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);

      const raw = await request.json().catch((_err) => null);
      const parsed = parseBody(EditBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const result = await editAwaitingReviewCandidate(
        auth.supabase,
        extractionId,
        parsed.data,
      );

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error.message, code: result.error.code },
          { status: STATUS_BY_ERROR_CODE[result.error.code] ?? 500 },
        );
      }

      return NextResponse.json({
        disposition: 'edited',
        pair: result.pair,
        extraction: result.extraction,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to edit promotion candidate'),
        },
        { status: 500 },
      );
    }
  },
);
