import { redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { PromotionGateView } from '@/components/governance/promotion-gate/promotion-gate-view';

/**
 * Governance promotion-gate page (ID-145 {145.22}, TECH §5/§7 section I,
 * BI-38/39; DR-025/026, DR-041).
 *
 * Server-component shell that gates on the admin/editor roles then hands off
 * to the client composition. A viewer never reaches this surface: it mirrors
 * every other Governance-zone mutation surface (e.g.
 * `/admin/q-a-pairs/dedup-proposals`, ID-120 {120.8}) — `getAuthorisedClient
 * (['admin','editor'])` fails for a viewer and they are redirected with no
 * leak of the surface's existence.
 */
export default async function PromotionGatePage() {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <PromotionGateView />;
}
