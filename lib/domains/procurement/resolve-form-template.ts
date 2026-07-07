/**
 * ID-130 {130.27} — resolve (or mint) the workspace's canonical `form_templates`
 * row id for stamping `form_questions.form_template_id` at creation time.
 *
 * **The bug this exists to fix.** `form_questions` rows created via the live
 * question-creation paths (tender-upload extraction, manual add, batch add)
 * were written with `workspace_id` only — `form_template_id` was populated
 * ONCE by the {130.8} backfill migration and drifted NULL on every insert
 * since. `outcome/route.ts`'s KB-integration query and the win-rate RPCs
 * (`get_content_win_rate` / `get_aggregate_win_rate_stats`) INNER JOIN
 * `form_questions.form_template_id -> form_templates.id`, so a NULL-drifted
 * row is silently DROPPED from both. This module is the single write-time
 * resolution point every `form_questions` insert/upsert site calls so the
 * column is populated going forward (the reads stay unchanged by design).
 *
 * **Resolution (v1: 1:1 form-per-workspace).** Mirrors the resolution
 * `app/api/procurement/[id]/outcome/route.ts` already uses for "the
 * workspace's single v1 form": the EARLIEST-created `form_templates` row for
 * the workspace. A `workspaces` row CAN carry more than one `form_templates`
 * row (the explicit "add a form" action in `forms/route.ts`, or an uploaded
 * fill-in template via `templates/route.ts`), but v1 outcome/win-rate logic
 * only ever reasons about the first-created one — this resolver stays
 * consistent with that so a question's stamped `form_template_id` always
 * matches what the outcome/win-rate reads treat as "the form".
 *
 * **The no-form-template case (mint-on-demand).** The live tender-upload UI
 * flow (`TenderUpload` -> `POST /tender` -> `POST /questions/extract`) never
 * creates a `form_templates` row itself (`tender/route.ts` only uploads to
 * storage and updates `workspaces.domain_metadata`) — only the explicit
 * "add a form" action or a cocoindex-pipeline ingest does. So a workspace
 * commonly has ZERO `form_templates` rows when its questions are first
 * created. Rejecting the insert (or leaving `form_template_id` NULL) would
 * either break the primary UX flow or reproduce the exact NULL-drift bug
 * this module exists to fix. Instead, mint one on demand — mirroring the
 * {130.8} migration's own T-B22 mint precedent — with
 * `ingest_source='app_upload'` (the column's documented provenance value for
 * non-pipeline, UI-originated rows; matches `forms/route.ts`'s docless
 * add-a-form convention) and `form_type='bid'` (the same default the {130.8}
 * mint used, so a later won/lost outcome record passes the
 * `form_templates_outcome_form_type_check` trigger without requiring a
 * separate type-picker step).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

/** Fields needed to mint a `form_templates` row when a workspace has none. */
export interface FormTemplateMintDefaults {
  /** `form_templates.name` (NOT NULL). */
  name: string;
  /** `form_templates.filename` (NOT NULL). */
  filename: string;
  /** `form_templates.storage_path` (NOT NULL). */
  storagePath: string;
  /** `form_templates.file_size` (NOT NULL, bytes). */
  fileSize: number;
  /** `form_templates.mime_type` (NOT NULL, CHECK-constrained). */
  mimeType: string;
  /** `form_templates.created_by` (nullable — `null` for script/system mints with no user). */
  createdBy: string | null;
}

/**
 * Resolve the workspace's canonical `form_templates` id, minting one on
 * demand (see module doc) when the workspace has none yet.
 *
 * Throws `SupabaseError` (via `sb()`) on any read/write failure — callers are
 * expected to be Next.js route handlers with a top-level try/catch that
 * already converts a thrown error into a 500 response.
 */
export async function resolveOrMintFormTemplateId(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  mint: FormTemplateMintDefaults,
): Promise<string> {
  const existing = await sb<Array<{ id: string }>>(
    supabase
      .from('form_templates')
      .select('id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(1),
    'procurement.formTemplates.resolveForWorkspace',
  );
  const first = existing[0];
  if (first) return first.id;

  const minted = await sb<{ id: string }>(
    supabase
      .from('form_templates')
      .insert({
        workspace_id: workspaceId,
        name: mint.name,
        filename: mint.filename,
        storage_path: mint.storagePath,
        file_size: mint.fileSize,
        mime_type: mint.mimeType,
        form_type: 'bid',
        ingest_source: 'app_upload',
        created_by: mint.createdBy,
      })
      .select('id')
      .single(),
    'procurement.formTemplates.mintForWorkspace',
  );
  return minted.id;
}
