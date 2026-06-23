import { redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { QaDedupProposalListClient } from '@/components/admin/q-a-pairs/dedup-proposals/proposal-list';

/**
 * Cross-Workspace Q&A Dedup — curator queue (list) page (ID-120 {120.8},
 * TECH P-4).
 *
 * Server-component shell that gates on the admin/editor roles then hands off
 * to the client component that renders the filter bar, proposal list, and
 * TanStack Query plumbing. A viewer never reaches this surface (INV-22):
 * `getAuthorisedClient(['admin','editor'])` fails for them and they are
 * redirected with no leak of the dashboard's existence.
 *
 * Spec: TECH P-4 (INV-10/11/17/18/19/22/23).
 */
export default async function AdminQaDedupProposalsPage() {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <QaDedupProposalListClient />;
}
