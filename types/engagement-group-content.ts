/**
 * INTERIM type augmentation for `engagement_group_content` (ID-145.35).
 *
 * The backing migration
 * (`supabase/migrations/20260716130000_id145_35_engagement_group_content.sql`)
 * is authored-only — not yet pushed to staging — so this table has no entry
 * in the generated `supabase/types/database.types.ts` yet. Hand-authored
 * here, following the {145.34}/{145.37} INTERIM-augmentation precedent:
 *   - {145.34}: `lib/q-a-pairs/promotion-candidate-review.ts` hand-authored
 *     `PromotionDispositionRow`/`PromotionDispositionInsert` for the (then
 *     also authored-only) `promotion_dispositions` table, and used
 *     `SupabaseClientLike` (`lib/q-a-pairs/promote-corpus.ts`) — a `.from()
 *     : any` shape — to call it without fighting the generated `Database`
 *     type.
 *   - {145.37}/{152}: `database.types.ts` itself was hand-augmented in place
 *     with `// INTERIM (ID-152): pending migration ... push + regen` column
 *     comments, later replaced wholesale once `supabase gen types` ran
 *     post-push (commit bc1b088c, "replaces INTERIM augmentation").
 *
 * This Subtask follows the {145.34} shape (a small standalone hand-authored
 * module) rather than hand-editing the generated file directly — the new
 * table has no existing entry to annotate in place, only a whole new one to
 * add, so a dedicated module is the smaller, more reviewable diff.
 *
 * DELETE this file (and re-point its importers at
 * `Database['public']['Tables']['engagement_group_content']` /
 * `Tables<'engagement_group_content'>`) once the migration is pushed and
 * `supabase gen types typescript --project-id <ref> --schema public,api`
 * has regenerated `database.types.ts` to include it (per `supabase/CLAUDE.md`).
 */

/** The `engagement_group_content` row shape (mirrors the migration's columns). */
export interface EngagementGroupContentRow {
  id: string;
  engagement_group_id: string;
  q_a_pair_id: string;
  created_at: string;
}

/** Insert payload — `id`/`created_at` are DB-defaulted. */
export interface EngagementGroupContentInsert {
  id?: string;
  engagement_group_id: string;
  q_a_pair_id: string;
  created_at?: string;
}

/**
 * Minimal `.schema().from()`-only client shape for querying a table not yet
 * present in the generated `Database` type — mirrors `SupabaseClientLike`
 * (`lib/q-a-pairs/promote-corpus.ts`), the {145.34} INTERIM-table precedent.
 * A real `SupabaseClient<Database>` (e.g. from `getAuthorisedClient()`)
 * structurally satisfies this interface, so callers pass it straight
 * through with a single `as unknown as InterimTableClient` cast, scoped to
 * the one `.schema('public').from('engagement_group_content')` call site.
 *
 * The `.schema('public')` hop is required at the call site (not just the
 * type seam): `engagement_group_content` is INTERNAL_ONLY — deliberately
 * absent from the `api` Data-API surface
 * (`scripts/check-api-view-coverage.ts` `INTERNAL_ONLY_TABLES`) — so the
 * standard authorised client, which routes `.from()` to `api` at runtime
 * (`lib/supabase/schema.ts` `DB_OPTION`), cannot reach it; PostgREST returns
 * PGRST205 (relation not found) without the override. Per
 * `lib/supabase/schema.ts`'s module doc (INV-12), this is the documented
 * per-call `.schema('public')` escape hatch on the SERVER/SERVICE client —
 * RLS still applies via the caller's JWT, only the schema resolution
 * changes.
 */
export interface InterimTableClient {
  schema: (schemaName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => any;
  };
}
