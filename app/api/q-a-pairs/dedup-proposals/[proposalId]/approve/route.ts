// app/api/q-a-pairs/dedup-proposals/[proposalId]/approve/route.ts
//
// ID-120 {120.7} P-5 — curator APPROVE of a cross-workspace/cross-form Q&A
// dedup proposal.
//
// AUTHENTICATED route. NOT in proxy.ts `publicRoutes` — unauthenticated
// callers are redirected by the middleware before reaching the handler; the
// in-handler role guard (`getAuthorisedClient(['admin','editor'])`) rejects
// anyone below editor with 403 (INV-14/22). The write runs under the
// curator's own role-scoped client (`auth.supabase`, NOT service-role —
// INV-9), so it is RLS-gated.
//
// ORDER (INV-15 — no half-fire): archive the NON-survivor FIRST via
// `mergeDedupPair` (CAS + affected-row=1); ONLY THEN flip the proposal
// `status='approved'`, `resolved_survivor_id`, `resolved_by`, `resolved_at`.
// If the archive fails or the CAS matches 0 rows, the proposal is left
// `pending` and the corpus unchanged — NEVER approved-without-archive, NEVER
// archive-without-superseded_by. The q_a_pair_history snapshot is the EXISTING
// AFTER-UPDATE trigger's job (INV-16) — the route performs NO history insert.
//
// Override (INV-13): the curator may pass `survivor_id` to choose the survivor;
// it defaults to the proposer's `proposed_survivor_id`. Whichever pair member
// is NOT the resolved survivor is the one archived.
import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { mergeDedupPair } from '@/lib/q-a-pairs/dedup-merge';
import { isOk, tryQuery, type PostgrestLike } from '@/lib/supabase/safe';
import { parseBody } from '@/lib/validation';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

type RouteContext = { params: Promise<{ proposalId: string }> };

type DedupProposalRow =
  Database['public']['Tables']['q_a_pair_dedup_proposals']['Row'];
type DedupProposalUpdate =
  Database['public']['Tables']['q_a_pair_dedup_proposals']['Update'];

/**
 * Approve body. `survivor_id` is the OPTIONAL curator override (INV-13); when
 * omitted the proposal's `proposed_survivor_id` is used. `.strict()` rejects
 * stray keys so a typo never silently no-ops the override.
 */
const ApproveBodySchema = z
  .object({
    survivor_id: z.string().uuid().optional(),
  })
  .strict();

/** The proposal fields the approve flow reads before resolving the survivor. */
const PROPOSAL_READ_COLUMNS =
  'id, pair_a_id, pair_b_id, proposed_survivor_id, status' as const;

export const POST = defineRoute(
  z.unknown(),
  async (request: NextRequest, context: RouteContext) => {
    try {
      const { proposalId } = await context.params;

      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      // Malformed/empty JSON → fall back to an empty object; the schema
      // accepts `{}` (no override), so a body-less approve is valid. The parse
      // failure is intentionally non-fatal here (override is optional), hence
      // the explicit `(_err)` swallow.
      const raw = await request.json().catch((_err) => ({}));
      const parsed = parseBody(ApproveBodySchema, raw ?? {});
      if (!parsed.success) return parsed.response;
      const overrideSurvivorId = parsed.data.survivor_id;

      // ── Load the proposal ────────────────────────────────────────────────
      const proposalResult = await tryQuery<DedupProposalRow | null>(
        supabase
          .from('q_a_pair_dedup_proposals')
          .select(PROPOSAL_READ_COLUMNS)
          .eq('id', proposalId)
          .maybeSingle() as unknown as PostgrestLike<DedupProposalRow | null>,
        'q_a_pair_dedup_proposals.approve.read',
      );
      if (!isOk(proposalResult)) {
        return NextResponse.json(
          { error: 'Failed to load dedup proposal' },
          { status: 500 },
        );
      }
      if (proposalResult.data === null) {
        return NextResponse.json(
          { error: 'Dedup proposal not found' },
          { status: 404 },
        );
      }
      const proposal = proposalResult.data;

      // Only a PENDING proposal can be approved — re-approving an already
      // resolved proposal is a 409 (idempotency / no double-archive).
      if (proposal.status !== 'pending') {
        return NextResponse.json(
          {
            error: `Proposal is already ${proposal.status}`,
            status: proposal.status,
          },
          { status: 409 },
        );
      }

      // ── Resolve survivor + non-survivor ──────────────────────────────────
      // Default to the proposer's nomination; the curator may override
      // (INV-13). The resolved survivor MUST be one of the two pair members
      // (the DB CHECK also enforces this, but reject early with a clear 400).
      const survivorId = overrideSurvivorId ?? proposal.proposed_survivor_id;
      const pairMembers = new Set([proposal.pair_a_id, proposal.pair_b_id]);
      if (!pairMembers.has(survivorId)) {
        return NextResponse.json(
          { error: 'survivor_id must be one of the two pair members' },
          { status: 400 },
        );
      }
      const nonSurvivorId =
        survivorId === proposal.pair_a_id
          ? proposal.pair_b_id
          : proposal.pair_a_id;

      // ── Archive the NON-survivor FIRST (INV-15 — no half-fire) ────────────
      const merge = await mergeDedupPair(supabase, {
        survivorId,
        nonSurvivorId,
      });
      if (!merge.ok) {
        // CAS-0-row or DB error: leave the proposal PENDING + corpus
        // unchanged. Never approved-without-archive.
        if (merge.reason === 'cas_no_match') {
          return NextResponse.json(
            {
              error:
                'Archive did not apply — the non-survivor is no longer published (concurrent change). Proposal left pending.',
              code: 'archive_cas_no_match',
            },
            { status: 409 },
          );
        }
        return NextResponse.json(
          {
            error: 'Failed to archive the non-survivor. Proposal left pending.',
          },
          { status: 500 },
        );
      }

      // ── ONLY NOW flip the proposal to approved ────────────────────────────
      const proposalUpdate: DedupProposalUpdate = {
        status: 'approved',
        resolved_survivor_id: survivorId,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      };
      const updateResult = await tryQuery<DedupProposalRow>(
        supabase
          .from('q_a_pair_dedup_proposals')
          .update(proposalUpdate)
          .eq('id', proposalId)
          .eq('status', 'pending')
          .select('*')
          .single() as unknown as PostgrestLike<DedupProposalRow>,
        'q_a_pair_dedup_proposals.approve.flip',
      );
      // The archive already landed; if the proposal flip fails, surface a 500.
      // The corpus archive is real (the trigger recorded history) — the
      // proposal-status drift is recoverable and visible (still 'pending'),
      // so a loud 500 is correct over a silent success.
      if (!isOk(updateResult) || updateResult.data === null) {
        return NextResponse.json(
          {
            error:
              'Non-survivor archived but the proposal status flip failed. Retry to reconcile.',
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        proposal: updateResult.data,
        survivor_id: survivorId,
        archived_id: nonSurvivorId,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to approve dedup proposal') },
        { status: 500 },
      );
    }
  },
);
