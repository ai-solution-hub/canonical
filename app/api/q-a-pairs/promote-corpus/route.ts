// app/api/q-a-pairs/promote-corpus/route.ts
//
// ID-59 {59.25} — UC-corpus HTTP operator route: POST /api/q-a-pairs/promote-corpus
//
// AUTHENTICATED route — NOT in proxy.ts `publicRoutes`. It sits behind the
// auth middleware; the in-handler role guard (admin/editor, INV-15) rejects
// viewers with a 403 via `authFailureResponse`. PUBLIC_ROUTES is
// ['/login','/auth/callback','/oauth/consent'] — this path is not in it.
//
// INV-3 (single implementation, multiple callers):
//   Caller A — this HTTP route (RLS-scoped admin/editor client).
//   Caller B — ID-45 pipeline (service-role client, escalated to parent per
//              {59.25} §2 — the pipeline webhook is a 10s slot incompatible
//              with a full corpus embed batch; wired separately post-escalation).
//   Both callers satisfy SupabaseClientLike without modifying the function.
//
// INV-14 (auth guard): getAuthorisedClient(['admin','editor']); viewer → 403.
// INV-15 (RLS-scoped): auth.supabase is the cookie-based client — no service-
//         role escalation; the route operator can only act on accessible data.
//
// The batch takes NO per-request parameters — it processes the full eligible
// set as returned by the q_a_extractions_promotion_candidates() RPC. No body
// parsing is required.
//
// Direct import — no barrel (CLAUDE.md "No barrel re-exports").

// Vercel Pro ceiling: 120 s. This route is RE-RUNNABLE — a corpus too large to
// drain in one 120 s window converges over repeated invocations. The CAS link
// (extraction → pair) and the self-heal eligibility query (linked-but-unembedded
// rows re-selected each run) make repeated calls safe and idempotent. The ID-45
// cutover operator re-invokes until embed_failed + pass-through reach 0.
export const maxDuration = 120;

import { NextResponse, type NextRequest } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { promoteCorpusExtractions } from '@/lib/q-a-pairs/promote-corpus';

/**
 * POST /api/q-a-pairs/promote-corpus
 *
 * Triggers a full corpus promotion run: for every eligible extraction
 * (unlinked or linked-but-unembedded), inserts a q_a_pairs row (draft),
 * CAS-links the extraction, embeds the question, and publishes together
 * (INV-12). Returns the structured PromotionSummary.
 *
 * Role guard: admin/editor only (viewer → 403 via authFailureResponse).
 * RLS-scoped: uses the authorised cookie-based client (no service-role
 * escalation — INV-15).
 */
export async function POST(_request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);

    const summary = await promoteCorpusExtractions(auth.supabase);

    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to promote corpus extractions') },
      { status: 500 },
    );
  }
}
