/**
 * Shared bid query logic — fetches active bid workspaces with question stats.
 *
 * Used by both lib/dashboard.ts and lib/reorient.ts to avoid duplicating the
 * identical pattern of:
 *   1. Fetch workspaces where type='bid' and is_archived=false
 *   2. Call get_bid_question_stats_batch RPC
 *   3. Build a statsMap keyed by workspace ID
 *
 * Each consumer maps the raw data into its own summary type.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcurementQuestionStats {
  total_questions: number;
  drafted_count: number;
  complete_count: number;
  needs_sme_count?: number;
  no_content_count?: number;
}

export interface ProcurementWorkspaceRow {
  id: string;
  name: string | null;
  domain_metadata: Record<string, unknown> | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActiveProcurementWithStats {
  workspaces: ProcurementWorkspaceRow[];
  statsMap: Map<string, ProcurementQuestionStats>;
}

// ---------------------------------------------------------------------------
// Main query function
// ---------------------------------------------------------------------------

/**
 * Fetch all active (non-archived) bid workspaces and their question stats
 * in a single batch RPC call.
 *
 * Returns the raw workspace rows and a statsMap so each consumer can build
 * its own summary type without duplicating the Supabase query logic.
 */
export async function fetchActiveProcurementWithStats(
  supabase: SupabaseClient<Database>,
): Promise<ActiveProcurementWithStats> {
  // Post-T2: discriminator is application_types.key via JOIN, not the dropped
  // workspaces.type col. 'bid' maps to 'procurement'.
  const { data: workspaces, error } = await supabase
    .from('workspaces')
    .select(
      'id, name, domain_metadata, is_archived, created_at, updated_at, application_types!inner(key)',
    )
    .eq('application_types.key', 'procurement')
    .eq('is_archived', false)
    .order('updated_at', { ascending: false });

  if (error || !workspaces || workspaces.length === 0) {
    return {
      workspaces: (workspaces as unknown as ProcurementWorkspaceRow[]) ?? [],
      statsMap: new Map(),
    };
  }

  const procurementIds = workspaces.map((w) => w.id);
  const batchStats = await sb(
    supabase.rpc('get_bid_question_stats_batch', {
      p_project_ids: procurementIds,
    }),
    'rpc.bid_question_stats_batch',
  );

  const statsMap = new Map<string, ProcurementQuestionStats>();
  if (batchStats) {
    for (const row of batchStats) {
      statsMap.set(row.project_id, {
        total_questions: row.total_questions,
        drafted_count: row.drafted_count,
        complete_count: row.complete_count,
        needs_sme_count: row.needs_sme_count,
        no_content_count: row.no_content_count,
      });
    }
  }

  return {
    workspaces: workspaces as unknown as ProcurementWorkspaceRow[],
    statsMap,
  };
}
