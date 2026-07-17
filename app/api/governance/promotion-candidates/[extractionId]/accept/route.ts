// app/api/governance/promotion-candidates/[extractionId]/accept/route.ts
//
// ID-145 {145.30} — per-candidate promotion ACCEPT over the `awaiting_review`
// bucket of q_a_extractions_promotion_candidates() ({138.17}, DR-026
// propose-surfacing half). BI-38 amendment (DR-062, S470): the "no new
// promotion backend" constraint on BI-38 is LIFTED — this is the new write
// path `gate-145-22`'s Checker escalated as missing (per-item accept/edit/
// reject was unmet by the {145.22} thin base).
//
// AUTHENTICATED route. NOT in proxy.ts `publicRoutes` — unauthenticated
// callers are redirected by the middleware before reaching the handler; the
// in-handler role guard (`getAuthorisedClient(['admin','editor'])`) rejects
// anyone below editor with 403. The write runs under the reviewer's own
// role-scoped client (`auth.supabase`, NOT service-role — INV-9/14/15
// posture, mirrors promote-corpus/route.ts).
//
// Scope: acts ONLY on an 'awaiting_review' candidate (an extraction linked
// to an ALREADY-PUBLISHED pair whose carried fields differ). A 'new'
// (unlinked) or 'self_healing' (linked-but-draft) extraction id returns 409
// — see lib/q-a-pairs/promotion-candidate-review.ts's module header for the
// full scoping rationale; those kinds are promoted wholesale via the
// existing "Run promotion pass" (`POST /api/q-a-pairs/promote-corpus`).
//
// ACCEPT applies the extraction's OWN carried fields (question_text,
// answer_standard, alternate_question_phrasings) onto the published pair —
// the "apply the diff" action DR-026 blocks from auto-firing; a human now
// confirms it per-item. Self-cleaning: after the write the extraction and
// pair carry IDENTICAL text, so the candidate naturally drops out of the
// 'awaiting_review' set on the next fetch (no new dismissal column needed).
//
// {145.34}: threads the reviewer's `auth.user.id` through as `actor` so
// acceptAwaitingReviewCandidate can record an append-only disposition row.

import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { acceptAwaitingReviewCandidate } from '@/lib/q-a-pairs/promotion-candidate-review';
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

      const result = await acceptAwaitingReviewCandidate(
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
        disposition: 'accepted',
        pair: result.pair,
        extraction: result.extraction,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to accept promotion candidate'),
        },
        { status: 500 },
      );
    }
  },
);
