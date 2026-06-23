// app/api/q-a-pairs/dedup-proposals/[proposalId]/reject/route.ts
//
// ID-120 {120.7} P-5 — curator REJECT of a cross-workspace/cross-form Q&A
// dedup proposal.
//
// AUTHENTICATED route. NOT in proxy.ts `publicRoutes`. The in-handler role
// guard (`getAuthorisedClient(['admin','editor'])`) rejects anyone below
// editor with 403 (INV-14/22). The write runs under the curator's own
// role-scoped client (`auth.supabase`, NOT service-role — INV-9).
//
// REJECT (INV-13): sets the proposal `status='rejected'`, `resolved_by`,
// `resolved_at`. It writes NOTHING to q_a_pairs — the corpus is untouched
// (no archive, no superseded_by). A rejected pair is simply not a duplicate
// in the curator's judgement; both members stay published.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { isOk, tryQuery, type PostgrestLike } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

type RouteContext = { params: Promise<{ proposalId: string }> };

type DedupProposalRow =
  Database['public']['Tables']['q_a_pair_dedup_proposals']['Row'];
type DedupProposalUpdate =
  Database['public']['Tables']['q_a_pair_dedup_proposals']['Update'];

export const POST = defineRoute(
  z.unknown(),
  async (_request: NextRequest, context: RouteContext) => {
    try {
      const { proposalId } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      // Flip pending → rejected under a CAS on status='pending' so a
      // concurrent resolve cannot be clobbered. `.select('*').single()`
      // returns the row; a 0-row result (null) means the proposal was already
      // resolved (or absent) — a 409, never a silent success.
      const proposalUpdate: DedupProposalUpdate = {
        status: 'rejected',
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      };
      const updateResult = await tryQuery<DedupProposalRow | null>(
        supabase
          .from('q_a_pair_dedup_proposals')
          .update(proposalUpdate)
          .eq('id', proposalId)
          .eq('status', 'pending')
          .select('*')
          .maybeSingle() as unknown as PostgrestLike<DedupProposalRow | null>,
        'q_a_pair_dedup_proposals.reject.flip',
      );
      if (!isOk(updateResult)) {
        return NextResponse.json(
          { error: 'Failed to reject dedup proposal' },
          { status: 500 },
        );
      }
      if (updateResult.data === null) {
        // No pending row matched: either the proposal does not exist or it was
        // already resolved. Surface a 409 — the reject did not apply.
        return NextResponse.json(
          {
            error:
              'Proposal not found or no longer pending — reject did not apply.',
            code: 'not_pending',
          },
          { status: 409 },
        );
      }

      return NextResponse.json({ proposal: updateResult.data });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to reject dedup proposal') },
        { status: 500 },
      );
    }
  },
);
