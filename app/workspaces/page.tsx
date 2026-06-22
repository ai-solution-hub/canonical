import { getAuthenticatedClient } from '@/lib/auth/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { redirect } from 'next/navigation';
import { WorkspacesContent } from './workspaces-content';
import type { ApplicationTypeRowWire } from '@/hooks/workspaces/use-application-types';
import { logger } from '@/lib/logger';

async function getWorkspaceTypeCounts(
  supabase: SupabaseClient<Database>,
): Promise<Record<string, number>> {
  // Post-T2: `workspaces.type` text column is dropped. Discriminator is now
  // the FK `application_type_id` — project `application_types.key` as `type`
  // via an inner JOIN so callers continue to receive the type-string they
  // expect.
  const { data, error } = await supabase
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

/**
 * Pre-fetch the application_types rows server-side so they can seed the
 * client-side useLauncherTypes() query as initialData. This MUST select the
 * same columns, ordered the same way, as GET /api/application-types — otherwise
 * the SSR seed and the eventual client refetch would differ and re-trigger the
 * hydration mismatch this exists to prevent (ID-29.7 fallout).
 */
async function getApplicationTypeRows(
  supabase: SupabaseClient<Database>,
): Promise<ApplicationTypeRowWire[]> {
  const { data, error } = await supabase
    .from('application_types')
    .select(
      'key, label, label_plural, description, default_icon, default_colour',
    )
    .order('label');

  if (error) {
    logger.error(
      { err: error.message },
      'Failed to fetch application types for SSR seed',
    );
    return [];
  }
  return (data ?? []) as ApplicationTypeRowWire[];
}

export default async function WorkspacesPage() {
  const auth = await getAuthenticatedClient();
  if (!auth.success) redirect('/login');

  // Fetch both server-side off the one authenticated client.
  const [counts, applicationTypes] = await Promise.all([
    getWorkspaceTypeCounts(auth.supabase),
    getApplicationTypeRows(auth.supabase),
  ]);

  return (
    <section
      aria-label="Workspaces"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <WorkspacesContent
        counts={counts}
        initialApplicationTypes={applicationTypes}
      />
    </section>
  );
}
