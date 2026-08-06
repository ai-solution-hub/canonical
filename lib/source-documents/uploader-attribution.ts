/**
 * `source_documents.uploaded_by` writer (id-407).
 *
 * ── Why this module exists ───────────────────────────────────────────────
 * `uploaded_by` was READ by five surfaces and WRITTEN by nothing, so every
 * consumer silently resolved its null fallback:
 *
 *   - `hybrid_search` / `hybrid_search_scored` project it under an ALIAS,
 *     `sd.uploaded_by AS "created_by"` (migration
 *     `20260716120000_id145_37_repoint_search_rpcs_to_form_instances.sql`
 *     :406 and :467) — the alias is why a `created_by` grep finds no such
 *     column and an `uploaded_by` grep misses the projection;
 *   - `api.get_document_version_chain` projects it;
 *   - `app/documents/[id]/diff/page.tsx` selects it and resolves display
 *     names from it;
 *   - `lib/diff/adapters/source-document-revision.ts` maps it to
 *     `createdByLabel` — non-null → the resolved display name; **NULL →
 *     the literal `'System'`**;
 *   - `components/source-document/source-document-{info,history}.tsx`.
 *
 * NULL is therefore a MEANINGFUL value on this column, not an omission: it
 * is how a genuinely system-minted row says "no human admitted me". The
 * defect was that EVERY row said that. This module is the missing writer.
 *
 * ── The rule this helper encodes ─────────────────────────────────────────
 * Attribution is FILL-ONCE, never overwrite:
 *
 *   - the `.is('uploaded_by', null)` guard means an existing attribution is
 *     never rewritten — the first human to admit a document keeps the
 *     credit, and a re-admission by someone else is a no-op;
 *   - callers additionally gate on "this request actually MINTED the row"
 *     (`was_minted` / `already_existed`), so converging onto a row the
 *     content-addressed resolver already knows about never re-attributes
 *     it. That gate is what keeps a system-walked row labelled `'System'`
 *     when a user later uploads byte-identical content — the walk found it
 *     first, and that is the honest answer.
 *
 * Pre-launch posture (DR-093): this ships correct structure going forward.
 * It is NOT a backfill — nothing here sweeps historical rows, and the
 * fill-once guard is a concurrency/idempotency guard, not a backfill hook.
 *
 * ── Failure policy is the CALLER's ───────────────────────────────────────
 * This function THROWS (`SupabaseError`) on a DB failure and never degrades
 * silently. Callers choose how loud that is, matching their own module's
 * established doctrine:
 *   - `lib/upload/folder-drop.ts` fails the admission (its module header
 *     rejects partial success: "the bytes+row apply together or not at
 *     all").
 *   (The former `app/api/ingest/url/route.ts` caller retired with the
 *   reference_ingest sd-shell mint — id-417 / DR-124: a reference item no
 *   longer creates a source_documents row to attribute.)
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sb } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

/** Rows returned by the fill-once attribution UPDATE. */
interface AttributedRow {
  id: string;
}

/**
 * Stamp the acting user onto a freshly minted `source_documents` row.
 *
 * FILL-ONCE: the UPDATE is guarded by `uploaded_by IS NULL`, so it can only
 * ever fill an empty attribution and can never rewrite an existing one.
 *
 * @param supabase           Client to write with. A route should pass its
 *                           AUTHED client — `source_documents` UPDATE is
 *                           RLS-gated to editor/admin ("Editors and admins
 *                           can update source documents"), which is exactly
 *                           the role set the admission routes already
 *                           require.
 * @param sourceDocumentId   The row this request just minted.
 * @param uploadedBy         The acting user's id. FK →
 *                           `user_profiles(id)`, which mirrors
 *                           `auth.users` — so an authenticated user's
 *                           `user.id` is always a valid target.
 * @returns `true` when this call filled the attribution; `false` when the
 *          row already carried an uploader (or is no longer visible).
 * @throws  `SupabaseError` when the UPDATE itself fails.
 */
export async function attributeUploader(
  supabase: SupabaseClient<Database>,
  sourceDocumentId: string,
  uploadedBy: string,
): Promise<boolean> {
  const rows = await sb<AttributedRow[]>(
    supabase
      .from('source_documents')
      .update({ uploaded_by: uploadedBy })
      .eq('id', sourceDocumentId)
      .is('uploaded_by', null)
      .select('id'),
    'source_documents.attribute-uploader',
  );
  return (rows ?? []).length > 0;
}
