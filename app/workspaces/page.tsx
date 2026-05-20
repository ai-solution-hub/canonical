import { getAuthenticatedClient } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { WorkspacesContent } from './workspaces-content';
import { logger } from '@/lib/logger';

async function getWorkspaceTypeCounts(): Promise<Record<string, number>> {
  const auth = await getAuthenticatedClient();
  if (!auth.success) redirect('/login');

  // Post-T2: `workspaces.type` text column is dropped. Discriminator is now
  // the FK `application_type_id` — project `application_types.key` as `type`
  // via an inner JOIN so callers continue to receive the type-string they
  // expect.
  const { data, error } = await auth.supabase
    .from('workspaces')
    .select('application_types!inner(key)')
    .eq('is_archived', false);

  if (error) {
    logger.error(
      { err: error.message },
      'Failed to fetch workspace type counts',
    );
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const appTypes = row.application_types as
      | { key: string }
      | { key: string }[]
      | null;
    const type = Array.isArray(appTypes)
      ? (appTypes[0]?.key ?? 'unknown')
      : (appTypes?.key ?? 'unknown');
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export default async function WorkspacesPage() {
  const counts = await getWorkspaceTypeCounts();

  return (
    <section
      aria-label="Workspaces"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <WorkspacesContent counts={counts} />
    </section>
  );
}
