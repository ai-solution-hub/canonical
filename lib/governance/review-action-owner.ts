/**
 * ID-152 — owner-aware existence resolution + verification_history payload
 * helpers for `POST /api/review/action`.
 *
 * Owner ruling (OQ oq-dad46242b712f156, Option B): verification_history
 * generalises to the polymorphic {source_document, q_a_pair} owner shape
 * already established by record_lifecycle ({131.6} M1a,
 * `supabase/migrations/20260628190000_id131_record_lifecycle_facet.sql`) and
 * record_embeddings. Migration (authored, NOT pushed):
 * `supabase/migrations/20260716120000_id152_verification_history_polymorphic.sql`.
 *
 * Existence-check strategy: `owner_kind` is OPTIONAL on the request body
 * (`ReviewActionBodySchema`, `lib/validation/schemas.ts`) — the only current
 * caller that omits it is /library's Bulk Verify
 * (`hooks/use-library-bulk-actions.ts`, OUT of ID-152's file-ownership
 * boundary). To un-404 that caller without touching the hook, an omitted
 * `owner_kind` auto-detects: try `source_documents` first (byte-for-byte the
 * pre-ID-152 lookup order, so every existing explicit /review-page caller is
 * unaffected), and ONLY on a miss, try `q_a_pairs`. An explicit `owner_kind`
 * (future callers) skips the probe and resolves directly — no guessing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { FacetOwnerKind } from '@/lib/validation/owner-kind';

// ID-151: alias onto the shared record_lifecycle/verification_history
// 2-value domain (this file's own name kept — it is the established,
// meaningful name at this call site's "review item" domain).
export type ReviewItemOwnerKind = FacetOwnerKind;

const OWNER_TABLE: Record<
  ReviewItemOwnerKind,
  'source_documents' | 'q_a_pairs'
> = {
  source_document: 'source_documents',
  q_a_pair: 'q_a_pairs',
};

const OWNER_FK_COLUMN: Record<
  ReviewItemOwnerKind,
  'source_document_id' | 'q_a_pair_id'
> = {
  source_document: 'source_document_id',
  q_a_pair: 'q_a_pair_id',
};

async function existsAsOwner(
  supabase: SupabaseClient<Database>,
  ownerKind: ReviewItemOwnerKind,
  itemId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(OWNER_TABLE[ownerKind])
    .select('id')
    .eq('id', itemId)
    .single();
  return !error && !!data;
}

/**
 * Resolve which typed record `itemId` refers to. Returns `null` when neither
 * table has a matching row — the caller should 404 (unchanged error shape).
 */
export async function resolveReviewItemOwner(
  supabase: SupabaseClient<Database>,
  itemId: string,
  requestedOwnerKind: ReviewItemOwnerKind | undefined,
): Promise<ReviewItemOwnerKind | null> {
  if (requestedOwnerKind) {
    return (await existsAsOwner(supabase, requestedOwnerKind, itemId))
      ? requestedOwnerKind
      : null;
  }

  // Back-compat default path: source_documents first (unchanged behaviour
  // for every existing explicit caller), q_a_pairs fallback second (the
  // ID-152 404 fix for /library's Bulk Verify, which sends no owner_kind).
  if (await existsAsOwner(supabase, 'source_document', itemId)) {
    return 'source_document';
  }
  if (await existsAsOwner(supabase, 'q_a_pair', itemId)) {
    return 'q_a_pair';
  }
  return null;
}

/** The record_lifecycle facet FK column matching a resolved owner kind. */
export function facetOwnerColumn(
  ownerKind: ReviewItemOwnerKind,
): 'source_document_id' | 'q_a_pair_id' {
  return OWNER_FK_COLUMN[ownerKind];
}

/**
 * verification_history insert fields for a resolved owner — `owner_kind` +
 * the single matching per-kind FK column
 * (`verification_history_owner_one_of_chk` CHECK, ID-152 migration); the
 * other FK column is left unset (defaults NULL), mirroring the existing
 * `record_lifecycle` upsert pattern in `lib/mcp/tools/governance.ts`.
 */
export function verificationHistoryOwnerFields(
  ownerKind: ReviewItemOwnerKind,
  itemId: string,
):
  | { owner_kind: 'source_document'; source_document_id: string }
  | { owner_kind: 'q_a_pair'; q_a_pair_id: string } {
  return ownerKind === 'source_document'
    ? { owner_kind: 'source_document', source_document_id: itemId }
    : { owner_kind: 'q_a_pair', q_a_pair_id: itemId };
}
