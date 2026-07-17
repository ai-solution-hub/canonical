/**
 * Shared procurement query logic — fetches active form instances with
 * question stats.
 *
 * Used by both lib/dashboard.ts and lib/reorient.ts to avoid duplicating the
 * identical pattern of:
 *   1. Fetch `form_instances` rows (the item IS the form post-W1, DR-056)
 *   2. Call get_form_question_stats_batch RPC
 *   3. Build a statsMap keyed by form id, and adapt the flat columns back
 *      onto the legacy `ProcurementWorkspaceRow` shape consumers still read
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
  // ID-145 {145.23} round-2 runtime grep sweep (mandatory extra #2, DR-056):
  // workspaces/procurement_workspaces are wholesale-deleted for procurement
  // (W1e, {145.6}). This function's PRIMARY caller (dashboard.ts active_forms)
  // was already re-pointed onto fetchActiveFormInstanceSummaries at {145.20}
  // BI-30 — this helper is kept ONLY for the forms_summary reorient
  // derivation (lib/activity/bid-summary.ts's buildProcurementSummary, which
  // reads workspace.domain_metadata.{deadline,buyer,status}), a consumer
  // {145.20} deliberately left on this pre-existing shape as out-of-scope —
  // but that consumer is itself broken by the same tsc-invisible W1e miss
  // (this function still queried a table with zero procurement rows).
  // [id] IS the form_instances PK now; the flat columns are adapted BACK onto
  // the domain_metadata-bag-shaped ProcurementWorkspaceRow contract so
  // buildProcurementSummary (out of this Subtask's file-ownership boundary)
  // keeps working unchanged.
  const { data: forms, error } = await supabase
    .from('form_instances')
    .select(
      'id, name, workflow_state, deadline, issuing_organisation, created_at, updated_at',
    )
    .order('updated_at', { ascending: false });

  if (error || !forms || forms.length === 0) {
    return {
      workspaces: [],
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

  const workspaces: ProcurementWorkspaceRow[] = forms.map((form) => ({
    id: form.id,
    name: form.name,
    domain_metadata: {
      deadline: form.deadline,
      buyer: form.issuing_organisation,
      status: form.workflow_state,
    },
    is_archived: false,
    created_at: form.created_at ?? '',
    updated_at: form.updated_at ?? '',
  }));

  return { workspaces, statsMap };
}
