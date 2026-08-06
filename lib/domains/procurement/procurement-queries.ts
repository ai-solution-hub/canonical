/**
 * Shared procurement query logic — fetches active form instances with
 * question stats.
 *
 * Used by both lib/dashboard.ts and lib/reorient.ts to avoid duplicating the
 * identical pattern of:
 *   1. Fetch `form_instances` rows (the item IS the form post-W1, DR-056)
 *   2. Call get_form_question_stats_batch RPC
 *   3. Build a statsMap keyed by form id
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

/**
 * An active procurement, projected FLAT off `form_instances`.
 *
 * id-417 (S538): this was `ProcurementWorkspaceRow` — a workspace-era shape
 * carrying a `domain_metadata` bag and an `is_archived` flag. {145.6} W1e
 * deleted procurement workspaces and moved `deadline` / `issuing_organisation`
 * / `workflow_state` to first-class columns on `form_instances`, but this
 * helper kept SELECTing the flat columns and then packing them BACK into a
 * synthetic bag (with `is_archived` hardcoded false) so its one consumer would
 * keep compiling. {145.20} recorded that as deliberate out-of-scope debt. The
 * bag is gone: consumers read the columns.
 */
export interface ActiveProcurementRow {
  id: string;
  name: string | null;
  /** `form_instances.deadline` */
  deadline: string | null;
  /** `form_instances.issuing_organisation` */
  buyer: string | null;
  /** `form_instances.workflow_state` */
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveProcurementWithStats {
  forms: ActiveProcurementRow[];
  statsMap: Map<string, ProcurementQuestionStats>;
}

// ---------------------------------------------------------------------------
// Main query function
// ---------------------------------------------------------------------------

/**
 * Fetch all active procurements and their question stats in a single batch
 * RPC call.
 *
 * Returns the flat `form_instances` rows and a statsMap so each consumer can
 * build its own summary type without duplicating the Supabase query logic.
 */
export async function fetchActiveProcurementWithStats(
  supabase: SupabaseClient<Database>,
): Promise<ActiveProcurementWithStats> {
  // Kept only for the `forms_summary` reorient derivation
  // (`buildProcurementSummary`); the dashboard's own active-items list went
  // straight to `fetchActiveFormInstanceSummaries` at {145.20} BI-30.
  const { data: forms, error } = await supabase
    .from('form_instances')
    .select(
      'id, name, workflow_state, deadline, issuing_organisation, created_at, updated_at',
    )
    .order('updated_at', { ascending: false });

  if (error || !forms || forms.length === 0) {
    return {
      forms: [],
      statsMap: new Map(),
    };
  }

  const procurementIds = forms.map((w) => w.id);
  const batchStats = await sb(
    supabase.rpc('get_form_question_stats_batch', {
      p_project_ids: procurementIds,
    }),
    'rpc.bid_question_stats_batch',
  );

  const statsMap = new Map<string, ProcurementQuestionStats>();
  if (batchStats) {
    for (const row of batchStats) {
      statsMap.set(row.workspace_id, {
        total_questions: row.total_questions,
        drafted_count: row.drafted_count,
        complete_count: row.complete_count,
        needs_sme_count: row.needs_sme_count,
        no_content_count: row.no_content_count,
      });
    }
  }

  const rows: ActiveProcurementRow[] = forms.map((form) => ({
    id: form.id,
    name: form.name,
    deadline: form.deadline,
    buyer: form.issuing_organisation,
    status: form.workflow_state,
    created_at: form.created_at ?? '',
    updated_at: form.updated_at ?? '',
  }));

  return { forms: rows, statsMap };
}
