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
 *
 * **Race-safety (Checker Finding 1 remediation).** This used to be a plain
 * client-side SELECT-then-INSERT: two concurrent calls against the SAME
 * zero-form workspace could both pass the "no existing row" check and both
 * mint (there is no UNIQUE constraint on `form_templates.workspace_id` —
 * multi-form-per-workspace is a live feature, so adding one would be a
 * regression, not a fix). The entire resolve-or-mint decision now runs
 * inside ONE atomic `public.resolve_or_mint_form_template_id` Postgres
 * function (`supabase/migrations/20260708120000_id130_form_template_id_backfill_guard.sql`
 * STEP 3), guarded by a workspace-scoped `pg_advisory_xact_lock` so two
 * racing callers serialize against each other instead of both minting. See
 * that migration's STEP 3 header comment for why this is a SEPARATE function
 * rather than an enhancement to the STEP 2 `form_questions_resolve_form_template_id`
 * trigger (short version: the trigger firing on EVERY insert would silently
 * break `scripts/seed-synthetic-corpus.ts`'s deliberate zero-form-workspace
 * test fixture) and for the RLS-privilege check confirming this introduces
 * no new permission surface (SECURITY INVOKER — same role/RLS exposure the
 * client-side SELECT-then-INSERT already had).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

// TYPE ESCAPE (deliberate, temporary — same precedent as
// lib/corpus/writer-fence.ts's `UntypedRpcClient`): the RPC this file calls
// (`resolve_or_mint_form_template_id`, public + api wrapper) is authored in
// 20260708120000_id130_form_template_id_backfill_guard.sql STEP 3 but NOT YET
// in the generated `database.types.ts` — this Subtask's worktree has no DB
// access to apply the migration or regen types (a types-regen is flagged as
// a follow-up intent). `SupabaseClient<any>` is the standard escape for
// calling a not-yet-generated RPC surface, confined to the single `.rpc()`
// call site below. DELETE this escape (call `.rpc()` directly on the typed
// client) once the coordinated apply + `supabase gen types` regenerates
// `Database['public']['Functions']['resolve_or_mint_form_template_id']`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UntypedRpcClient = SupabaseClient<any>;

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
 * demand (see module doc) when the workspace has none yet. Race-safe: the
 * whole resolve-or-mint decision runs atomically inside the
 * `resolve_or_mint_form_template_id` Postgres function (workspace-scoped
 * `pg_advisory_xact_lock`), so two concurrent calls against a zero-form
 * workspace cannot both mint.
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
  const rpcClient = supabase as unknown as UntypedRpcClient;
  return sb<string>(
    rpcClient.rpc('resolve_or_mint_form_template_id', {
      p_workspace_id: workspaceId,
      p_name: mint.name,
      p_filename: mint.filename,
      p_storage_path: mint.storagePath,
      p_file_size: mint.fileSize,
      p_mime_type: mint.mimeType,
      p_created_by: mint.createdBy,
    }),
    'procurement.formTemplates.resolveOrMintForWorkspace',
  );
}
