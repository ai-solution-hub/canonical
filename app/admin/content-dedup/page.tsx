import { redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth/client';
import { ContentDedupQueueClient } from '@/components/admin/content-dedup/content-dedup-queue';

/**
 * Admin Cross-System Dedup Review — list view.
 *
 * Server component shell that gates on admin role then hands off to the
 * client component that does the actual queue rendering and TanStack
 * Query work. Non-admins are silently redirected (no leak of queue
 * existence).
 *
 * Spec: `docs/specs/§1.7-admin-dedup-review-spec.md` §3.1, §6.1.
 */
export default async function AdminContentDedupPage() {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <ContentDedupQueueClient />;
}
