import { createClient } from '@/lib/supabase/server';
import { WorkspacesContent } from './workspaces-content';
import type { Workspace } from '@/types/content';

interface WorkspaceItemCount {
  workspace_id: string;
  item_count: number;
  last_activity: string | null;
}

async function getWorkspaces(): Promise<{ workspaces: Workspace[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, description, type, status, icon, color, is_archived, domain_metadata, created_at, created_by, updated_at, updated_by')
    .order('is_archived')
    .order('name');

  if (error) {
    console.error('Failed to fetch workspaces:', error.message);
    return { workspaces: [], error: 'Failed to load workspaces. Please try refreshing the page.' };
  }
  return { workspaces: (data ?? []) as Workspace[] };
}

async function getWorkspaceItemCounts(): Promise<
  Record<string, { item_count: number; last_activity: string | null }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_workspace_item_counts');

  if (error) {
    console.error('Failed to fetch workspace item counts:', error.message);
    return {};
  }

  const counts: Record<
    string,
    { item_count: number; last_activity: string | null }
  > = {};
  for (const row of (data ?? []) as WorkspaceItemCount[]) {
    counts[row.workspace_id] = {
      item_count: Number(row.item_count),
      last_activity: row.last_activity,
    };
  }
  return counts;
}

export default async function WorkspacesPage() {
  const [result, counts] = await Promise.all([
    getWorkspaces(),
    getWorkspaceItemCounts(),
  ]);

  return (
    <section aria-label="Workspaces" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <WorkspacesContent initialWorkspaces={result.workspaces} initialCounts={counts} loadError={result.error} />
    </section>
  );
}
