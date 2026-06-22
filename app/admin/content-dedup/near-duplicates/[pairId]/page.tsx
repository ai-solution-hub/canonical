import { notFound, redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { NearDuplicatesPairDetailClient } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-pair-detail';
import { parsePairId } from '@/lib/dedup/pair-id';

interface AdminNearDuplicatesDetailPageProps {
  params: Promise<{ pairId: string }>;
}

/**
 * Admin Near-Duplicate Merge Dashboard — detail / resolve view (§1.9).
 *
 * Server component that:
 *  1. Validates the route param via {@link parsePairId} — invalid 404s
 *     before any DB call (the parser rejects malformed UUIDs, wrong
 *     order, malformed segment).
 *  2. Gates on admin role via `getAuthorisedClient(['admin'])` and
 *     redirects non-admins (no leak of pair existence).
 *  3. Hands the unparsed `pairId` to the client component which fetches
 *     both rows + recomputed similarity via TanStack Query and renders
 *     the side-by-side compare + three-action surface.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §3.1, §3.5,
 * §6.2.
 */
export default async function AdminNearDuplicatesDetailPage({
  params,
}: AdminNearDuplicatesDetailPageProps) {
  const { pairId } = await params;
  if (!parsePairId(pairId)) notFound();

  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <NearDuplicatesPairDetailClient pairId={pairId} />;
}
