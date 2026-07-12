'use client';

import { QaDedupProposalListClient } from '@/components/admin/q-a-pairs/dedup-proposals/proposal-list';
import { PromotionCandidatesPanel } from './promotion-candidates-panel';

/**
 * ID-145 {145.22} — thin Governance promotion-gate UI (TECH §5/§7 section I,
 * BI-38/39; DR-025/026, DR-041).
 *
 * COMPOSES two ALREADY-EXISTING surfaces — no new promotion backend:
 *  - {@link PromotionCandidatesPanel} — reads `q_a_extractions_promotion_candidates()`
 *    ({138.17}) and triggers the existing `/api/q-a-pairs/promote-corpus`
 *    route ({59.25}).
 *  - {@link QaDedupProposalListClient} — the existing cross-workspace Q&A
 *    dedup curator queue (ID-120 {120.8}), reused unmodified — approve/reject
 *    still happen on its own existing detail route.
 *
 * `/review` (content-quality) is a SEPARATE, unchanged workflow — it is not
 * folded into this surface.
 */
export function PromotionGateView() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground">
          Promotion gate
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Review and disposition corpus-flywheel promotion candidates and
          duplicate Q&amp;A proposals. This is a separate workflow from{' '}
          <span className="font-medium text-foreground">/review</span>, the
          content-quality lane — that surface is unchanged.
        </p>
      </header>

      <PromotionCandidatesPanel />

      {/* QaDedupProposalListClient (ID-120 {120.8}) renders its own heading +
          page-shell — reused verbatim per "compose, don't rebuild"; no
          wrapping heading duplicated here. */}
      <QaDedupProposalListClient />
    </div>
  );
}
