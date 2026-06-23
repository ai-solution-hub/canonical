import { notFound, redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { QaDedupProposalDetailClient } from '@/components/admin/q-a-pairs/dedup-proposals/proposal-detail';

interface AdminQaDedupProposalDetailPageProps {
  params: Promise<{ proposalId: string }>;
}

/**
 * Cross-Workspace Q&A Dedup — detail / resolve page (ID-120 {120.8}, TECH P-4).
 *
 * Server component that:
 *  1. Validates the `proposalId` route param is a non-empty UUID — a malformed
 *     value 404s before any client render.
 *  2. Gates on the admin/editor roles via `getAuthorisedClient(['admin','editor'])`
 *     and redirects anyone below editor (INV-22) — no leak of proposal existence.
 *  3. Hands the `proposalId` to the client component, which fetches the proposal
 *     plus both hydrated members (Q+A text) via TanStack Query and renders the
 *     side-by-side compare + approve/reject/override surface.
 *
 * Spec: TECH P-4 (INV-10/13/18/22).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminQaDedupProposalDetailPage({
  params,
}: AdminQaDedupProposalDetailPageProps) {
  const { proposalId } = await params;
  if (!UUID_RE.test(proposalId)) notFound();

  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <QaDedupProposalDetailClient proposalId={proposalId} />;
}
