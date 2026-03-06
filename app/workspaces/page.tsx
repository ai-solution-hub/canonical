import { createClient } from '@/lib/supabase/server';
import { ProjectsContent } from './projects-content';
import type { Project } from '@/types/content';

interface ProjectItemCount {
  project_id: string;
  item_count: number;
  last_activity: string | null;
}

async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('is_archived')
    .order('name');

  if (error) {
    console.error('Failed to fetch projects:', error.message);
    return [];
  }
  return (data ?? []) as Project[];
}

async function getProjectItemCounts(): Promise<
  Record<string, { item_count: number; last_activity: string | null }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_project_item_counts');

  if (error) {
    console.error('Failed to fetch project item counts:', error.message);
    return {};
  }

  const counts: Record<
    string,
    { item_count: number; last_activity: string | null }
  > = {};
  for (const row of (data ?? []) as ProjectItemCount[]) {
    counts[row.project_id] = {
      item_count: Number(row.item_count),
      last_activity: row.last_activity,
    };
  }
  return counts;
}

export default async function ProjectsPage() {
  const [projects, counts] = await Promise.all([
    getProjects(),
    getProjectItemCounts(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <ProjectsContent initialProjects={projects} initialCounts={counts} />
    </div>
  );
}
