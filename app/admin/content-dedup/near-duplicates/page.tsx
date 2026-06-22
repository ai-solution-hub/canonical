import { redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { NearDuplicatesPairListClient } from '@/components/admin/content-dedup/near-duplicates/near-duplicates-pair-list';

/**
 * Admin Near-Duplicate Merge Dashboard — list view (§1.9).
 *
 * Server-component shell that gates on admin role then hands off to the
 * client component that renders the filter bar, similarity-ranked pair
 * list, and TanStack Query plumbing. Non-admins are silently redirected
 * (no leak of dashboard existence).
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §3.1, §6.1.
 */
export default async function AdminNearDuplicatesPage() {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <NearDuplicatesPairListClient />;
}
