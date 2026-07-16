import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import {
  facetOwnerColumn,
  resolveReviewItemOwner,
  verificationHistoryOwnerFields,
} from '@/lib/governance/review-action-owner';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ReviewActionBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const ReviewActionResponseSchema = z.object({ success: z.literal(true) });

export const POST = defineRoute(
  ReviewActionResponseSchema,
  async (request: NextRequest) => {
    try {
      // Auth + role check — editors and admins only
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      // Rate limit: 30 requests per minute
      const { allowed } = checkRateLimit(
        `review-action:${user.id}`,
        30,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(ReviewActionBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { item_id, action, flag_details, note, owner_kind } = parsed.data;

      // ID-152 (owner ruling Option B, OQ oq-dad46242b712f156): the
      // existence lookup is owner-aware across {source_document, q_a_pair}.
      // Previously hardcoded to source_documents in every branch, so
      // /library's Bulk Verify (q_a_pairs-only, hooks/use-library-bulk-
      // actions.ts) 404'd for every pair. `owner_kind` is optional on the
      // request body — that hook is OUT of this Subtask's file-ownership
      // boundary and still omits it, so the resolver's q_a_pairs fallback
      // probe (see lib/governance/review-action-owner.ts) is what un-404s
      // it; an explicit owner_kind (future callers) resolves directly.
      const ownerKind = await resolveReviewItemOwner(
        supabase,
        item_id,
        owner_kind,
      );

      if (!ownerKind) {
        return NextResponse.json(
          { error: 'Content item not found' },
          { status: 404 },
        );
      }

      // ID-131 {131.19}: content_items is dying — for a source_document
      // owner, item_id IS the source_documents id directly (every
      // content_item was already 1:1 with its backing source_document), so
      // `sourceDocumentId` collapses to the same value and
      // ingestion_quality_log (source_document_id-keyed, ID-131 {131.13}
      // G-GOV-FACET-B rename) resolves through it below.
      //
      // ID-152: for a q_a_pair owner, ingestion_quality_log has NO q_a_pair
      // support yet (that needs its own product call on the table's shape —
      // deferred, not invented here), so `sourceDocumentId` is null and
      // every `if (sourceDocumentId)` guard below correctly no-ops that
      // source_document-only side effect for a q_a_pair item.
      const sourceDocumentId = ownerKind === 'source_document' ? item_id : null;

      if (action === 'verify') {
        // verified_at/verified_by live on the record_lifecycle facet
        // (governance axis, BI-20, spans BOTH owner kinds per {131.6} M1a);
        // updated_by stays on the owning source_documents row (q_a_pairs has
        // no equivalent column — ID-152, skipped for that owner kind) — two
        // tables, two writes for a source_document owner. The facet write is
        // the primary governance signal (error 500s the request); the SD
        // updated_by stamp is best-effort (logged, non-blocking) — mirrors
        // the notification-dispatch best-effort pattern used elsewhere in
        // this route.
        //
        // No record_lifecycle facet row is ever minted anywhere in the
        // system yet (a facet-mint migration is proposed at Phase 2) — this
        // is a gap that affects ALL documents, not just pre-existing ones,
        // until that migration ships. An UPDATE matching 0 rows is not a
        // Postgres error, so `.select('id')` + a row-count check is the only
        // way to detect it; without it this route would 200 + write a
        // verification_history audit row for a write that changed nothing.
        const { data: facetRows, error } = await supabase
          .from('record_lifecycle')
          .update({
            verified_at: new Date().toISOString(),
            verified_by: user.id,
          })
          .eq('owner_kind', ownerKind)
          .eq(facetOwnerColumn(ownerKind), item_id)
          .select('id');

        if (error) {
          logger.error({ err: error }, 'Failed to verify content item');
          return NextResponse.json(
            { error: 'Failed to verify item' },
            { status: 500 },
          );
        }

        if (!facetRows || facetRows.length === 0) {
          return NextResponse.json(
            { error: 'No governance record exists for this item yet' },
            { status: 409 },
          );
        }

        if (ownerKind === 'source_document') {
          const { error: sdUpdateError } = await supabase
            .from('source_documents')
            .update({ updated_by: user.id })
            .eq('id', item_id);
          if (sdUpdateError) {
            logger.warn(
              { err: sdUpdateError },
              'Failed to stamp updated_by on source_documents (verify)',
            );
          }
        }

        // Record in verification history. ID-152 generalises this table to
        // {source_document, q_a_pair} (owner ruling Option B) — fires for
        // BOTH owner kinds now (previously gated on sourceDocumentId, which
        // was always truthy pre-ID-152 since the existence check above was
        // source_documents-only).
        await supabase.from('verification_history').insert({
          ...verificationHistoryOwnerFields(ownerKind, item_id),
          action_type: 'verify',
          note: note ?? null,
          performed_by: user.id,
        });

        // Resolve any open review_needed flags — verification overrides
        // flags. source_document-only: ingestion_quality_log has no q_a_pair
        // support yet (ID-152 deferred, needs its own product call).
        if (sourceDocumentId) {
          await supabase
            .from('ingestion_quality_log')
            .update({
              resolved: true,
              resolved_at: new Date().toISOString(),
              resolved_by: user.id,
            })
            .eq('source_document_id', sourceDocumentId)
            .eq('flag_type', 'review_needed')
            .eq('resolved', false);
        }
      } else if (action === 'flag') {
        // ID-152 deferred: ingestion_quality_log (the flag record itself)
        // has NO q_a_pair owner support — extending it needs its own product
        // call on the table's shape (a new owner_kind/q_a_pair_id column
        // pair, mirroring this Subtask's verification_history migration).
        // Rather than silently half-applying "flag" (clearing the facet
        // without ever raising a visible quality-log entry), return an
        // honest, explicit error — consistent with this route's existing
        // 0-row-honesty philosophy (never a false {success:true} for a
        // write that didn't do what the action name promises).
        if (ownerKind === 'q_a_pair') {
          return NextResponse.json(
            {
              error:
                'Flag is not yet supported for q_a_pair items (ingestion_quality_log has no q_a_pair owner support — ID-152 deferred)',
            },
            { status: 400 },
          );
        }

        // Clear verified status — flagging returns item to needs-attention
        // state. This facet write is the primary governance signal for this
        // action (same gating rule as verify/unverify below): no
        // record_lifecycle facet row is ever minted anywhere in the system
        // yet (Phase 2 facet-mint migration proposed), a gap that affects
        // ALL documents — not just pre-existing ones — until it ships. Gate
        // the flag insert + audit write on this write actually matching a
        // row, so a 0-row match returns an explicit error instead of a false
        // {success:true} plus an audit row for writes that changed nothing.
        const { data: facetRows, error: facetError } = await supabase
          .from('record_lifecycle')
          .update({
            verified_at: null,
            verified_by: null,
          })
          .eq('owner_kind', ownerKind)
          .eq(facetOwnerColumn(ownerKind), item_id)
          .select('id');

        if (facetError) {
          logger.error({ err: facetError }, 'Failed to flag content item');
          return NextResponse.json(
            { error: 'Failed to flag item' },
            { status: 500 },
          );
        }

        if (!facetRows || facetRows.length === 0) {
          return NextResponse.json(
            { error: 'No governance record exists for this item yet' },
            { status: 409 },
          );
        }

        if (sourceDocumentId) {
          const insertPayload = {
            source_document_id: sourceDocumentId,
            flag_type: 'review_needed',
            severity: 'warning',
            details: flag_details ? { notes: flag_details } : {},
            created_by: user.id,
          };
          const { error } = await supabase
            .from('ingestion_quality_log')
            .insert(insertPayload);

          if (error) {
            logger.error({ err: error }, 'Failed to flag content item');
            return NextResponse.json(
              { error: 'Failed to flag item' },
              { status: 500 },
            );
          }
        }

        // Record in verification history for unified audit trail.
        // ID-152: guaranteed a source_document owner here (q_a_pair returns
        // early above), so this fires unconditionally, same as before.
        await supabase.from('verification_history').insert({
          ...verificationHistoryOwnerFields(ownerKind, item_id),
          action_type: 'flag',
          note: flag_details ?? null,
          performed_by: user.id,
        });

        await supabase
          .from('source_documents')
          .update({ updated_by: user.id })
          .eq('id', item_id);
      } else if (action === 'unverify') {
        // No record_lifecycle facet row is ever minted anywhere in the
        // system yet (Phase 2 facet-mint migration proposed) — a gap that
        // affects ALL documents, not just pre-existing ones, until it
        // ships. `.select('id')` + a row-count check is the only way to
        // detect a 0-row UPDATE match (not a Postgres error).
        const { data: facetRows, error } = await supabase
          .from('record_lifecycle')
          .update({
            verified_at: null,
            verified_by: null,
          })
          .eq('owner_kind', ownerKind)
          .eq(facetOwnerColumn(ownerKind), item_id)
          .select('id');

        if (error) {
          logger.error({ err: error }, 'Failed to unverify content item');
          return NextResponse.json(
            { error: 'Failed to unverify item' },
            { status: 500 },
          );
        }

        if (!facetRows || facetRows.length === 0) {
          return NextResponse.json(
            { error: 'No governance record exists for this item yet' },
            { status: 409 },
          );
        }

        if (ownerKind === 'source_document') {
          const { error: sdUpdateError } = await supabase
            .from('source_documents')
            .update({ updated_by: user.id })
            .eq('id', item_id);
          if (sdUpdateError) {
            logger.warn(
              { err: sdUpdateError },
              'Failed to stamp updated_by on source_documents (unverify)',
            );
          }
        }

        // Record in verification history. ID-152 generalises this table to
        // {source_document, q_a_pair} (owner ruling Option B) — fires for
        // BOTH owner kinds now, mirroring the verify branch above.
        await supabase.from('verification_history').insert({
          ...verificationHistoryOwnerFields(ownerKind, item_id),
          action_type: 'unverify',
          note: note ?? null,
          performed_by: user.id,
        });
      } else if (action === 'publish') {
        // Linear review-queue "Publish" quick-action — draft-state items
        // only, gated client-side by `governance_review_status === 'draft'`
        // (`hooks/review/use-review-actions.ts` `handlePublish`). Re-pointed
        // here off the doomed `PATCH /api/items/[id]` route (ID-131 endgame,
        // S447 B3-ext — items route stays alive until 17-final).
        //
        // Scope: clears the record_lifecycle governance facet ONLY — same
        // zero-row-honest facet-write pattern as verify/flag/unverify above
        // (no record_lifecycle row is ever minted anywhere in the system yet;
        // Phase 2 facet-mint migration proposed — a 0-row match returns an
        // explicit 409, never a false {success:true}). ID-152: owner-aware
        // like verify/unverify — this facet axis already spans BOTH owner
        // kinds (BI-20), matching the existing publish-promotion upsert in
        // lib/mcp/tools/governance.ts.
        //
        // Deliberately NOT replicated from the old items-route handler:
        // embedding generation + auto-classify-on-first-publish
        // (`app/api/items/[id]/route.ts` ~L550-820, `field ===
        // 'governance_review_status' && value === null`). Those write to
        // `content_items.embedding`, a column already slated for removal by
        // the `record_embeddings` facet migration
        // (`id131_record_embeddings_store.sql` M1b/M5) — replicating a new
        // writer onto a column the target architecture is actively retiring
        // would entrench dead-end behaviour rather than migrate off it. This
        // is a known, flagged gap (search-visibility / auto-classify side
        // effects are not yet re-homed under the facet model) — tracked
        // out-of-scope of this governance-write re-point.
        //
        // No verification_history insert: `action_type` CHECK constraint
        // only allows 'verify' | 'unverify' | 'flag' (same reason 'unflag'
        // below skips it too).
        const { data: facetRows, error } = await supabase
          .from('record_lifecycle')
          .update({
            governance_review_status: null,
          })
          .eq('owner_kind', ownerKind)
          .eq(facetOwnerColumn(ownerKind), item_id)
          .select('id');

        if (error) {
          logger.error({ err: error }, 'Failed to publish content item');
          return NextResponse.json(
            { error: 'Failed to publish item' },
            { status: 500 },
          );
        }

        if (!facetRows || facetRows.length === 0) {
          return NextResponse.json(
            { error: 'No governance record exists for this item yet' },
            { status: 409 },
          );
        }

        if (ownerKind === 'source_document') {
          const { error: sdUpdateError } = await supabase
            .from('source_documents')
            .update({ updated_by: user.id })
            .eq('id', item_id);
          if (sdUpdateError) {
            logger.warn(
              { err: sdUpdateError },
              'Failed to stamp updated_by on source_documents (publish)',
            );
          }
        }
      } else if (action === 'unflag') {
        // ID-152 deferred: ingestion_quality_log has NO q_a_pair owner
        // support yet (same gap as the flag branch above — needs its own
        // product call). Without this guard a q_a_pair unflag would fall
        // through the `if (sourceDocumentId)` guard below and silently
        // return `{success:true}` having done nothing — an honest error is
        // preferable, consistent with this route's 0-row-honesty
        // philosophy.
        if (ownerKind === 'q_a_pair') {
          return NextResponse.json(
            {
              error:
                'Unflag is not yet supported for q_a_pair items (ingestion_quality_log has no q_a_pair owner support — ID-152 deferred)',
            },
            { status: 400 },
          );
        }

        // Resolve the most recent unresolved review_needed flag for this item.
        // Two-step query: Supabase does not support .update().limit(1).
        let flag: { id: string } | null = null;
        if (sourceDocumentId) {
          const { data, error: fetchFlagError } = await supabase
            .from('ingestion_quality_log')
            .select('id')
            .eq('source_document_id', sourceDocumentId)
            .eq('flag_type', 'review_needed')
            .eq('resolved', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fetchFlagError) {
            logger.error(
              { err: fetchFlagError },
              'Failed to find quality flag',
            );
            return NextResponse.json(
              { error: 'Failed to unflag item' },
              { status: 500 },
            );
          }
          flag = data;
        }

        if (flag) {
          const { error: resolveFlagError } = await supabase
            .from('ingestion_quality_log')
            .update({
              resolved: true,
              resolved_by: user.id,
              resolved_at: new Date().toISOString(),
            })
            .eq('id', flag.id);

          if (resolveFlagError) {
            logger.error(
              { err: resolveFlagError },
              'Failed to unflag content item',
            );
            return NextResponse.json(
              { error: 'Failed to unflag item' },
              { status: 500 },
            );
          }
        }
      }
      // action === 'skip': no database operation needed

      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to process review action') },
        { status: 500 },
      );
    }
  },
);
