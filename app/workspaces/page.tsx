import { getAuthenticatedClient } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { WorkspacesContent } from './workspaces-content';

async function getWorkspaceTypeCounts(): Promise<Record<string, number>> {
  const auth = await getAuthenticatedClient();
  if (!auth) redirect('/login');

  const { data, error } = await auth.supabase
    .from('workspaces')
    .select('type')
    .eq('is_archived', false);

  if (error) {
    console.error('Failed to fetch workspace type counts:', error.message);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const type = row.type ?? 'unknown';
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export default async function WorkspacesPage() {
  const counts = await getWorkspaceTypeCounts();

  return (
    <section aria-label="Workspaces" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <WorkspacesContent counts={counts} />
    </section>
  );
}
