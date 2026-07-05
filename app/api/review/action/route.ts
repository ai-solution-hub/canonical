import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
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

      const { item_id, action, flag_details, note } = parsed.data;

      // Validate that the content item exists. ID-131 {131.19}: content_items
      // is dying — each content_item was already 1:1 with its backing
      // source_document (via the old content_items.source_document_id FK),
      // so `item_id` is now the source_documents id directly, and
      // `sourceDocumentId` collapses to the same value. ingestion_quality_log
      // is keyed by source_document_id (ID-131 {131.13} G-GOV-FACET-B
      // rename), so every ingestion_quality_log operation below continues to
      // resolve through this column.
      const { data: item, error: fetchError } = await supabase
        .from('source_documents')
        .select('id')
        .eq('id', item_id)
        .single();

      if (fetchError || !item) {
        return NextResponse.json(
          { error: 'Content item not found' },
          { status: 404 },
        );
      }

      const sourceDocumentId = item.id;

      if (action === 'verify') {
        // verified_at/verified_by live on the record_lifecycle facet
        // (governance axis, BI-20); updated_by stays on the owning
        // source_documents row — two tables, two writes. The facet write is
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
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', item_id)
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

        // Record in verification history. verification_history.source_document_id
        // is NOT NULL post ID-131 {131.29} re-parent — a source-doc-less content
        // item records no audit row (acceptable at 0 rows).
        if (sourceDocumentId) {
          await supabase.from('verification_history').insert({
            source_document_id: sourceDocumentId,
            action_type: 'verify',
            note: note ?? null,
            performed_by: user.id,
          });
        }

        // Resolve any open review_needed flags — verification overrides flags.
        // No-op when the item has no backing source document (nothing to
        // resolve under the new source_document_id-keyed schema).
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
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', item_id)
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
        // source_document_id is NOT NULL post ID-131 {131.29} re-parent — a
        // source-doc-less content item records no audit row (0 rows today).
        if (sourceDocumentId) {
          await supabase.from('verification_history').insert({
            source_document_id: sourceDocumentId,
            action_type: 'flag',
            note: flag_details ?? null,
            performed_by: user.id,
          });
        }

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
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', item_id)
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

        // Record in verification history. source_document_id is NOT NULL
        // post ID-131 {131.29} re-parent — a source-doc-less content item
        // records no audit row (0 rows today).
        if (sourceDocumentId) {
          await supabase.from('verification_history').insert({
            source_document_id: sourceDocumentId,
            action_type: 'unverify',
            note: note ?? null,
            performed_by: user.id,
          });
        }
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
        // explicit 409, never a false {success:true}).
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
          .eq('owner_kind', 'source_document')
          .eq('source_document_id', item_id)
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
      } else if (action === 'unflag') {
        // Resolve the most recent unresolved review_needed flag for this item.
        // Two-step query: Supabase does not support .update().limit(1). No-op
        // when the item has no backing source document (nothing to look up
        // under the new source_document_id-keyed schema).
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
