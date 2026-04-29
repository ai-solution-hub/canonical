import { notFound, redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth';
import { ContentDedupDetailClient } from '@/components/admin/content-dedup/content-dedup-detail';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AdminContentDedupDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Admin Cross-System Dedup Review — detail/resolve view.
 *
 * Server component that validates the route param as a UUID, gates on
 * admin role, and hands off to the client component that fetches the
 * subject + canonical pair and renders the resolution UI. Invalid UUIDs
 * 404 (no DB call); non-admins are silently redirected.
 *
 * Spec: `docs/specs/§1.7-admin-dedup-review-spec.md` §3.1, §6.2.
 */
export default async function AdminContentDedupDetailPage({
  params,
}: AdminContentDedupDetailPageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }

  return <ContentDedupDetailClient id={id} />;
}
