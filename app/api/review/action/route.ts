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

      // Validate that the content item exists. source_document_id is also
      // fetched here — ingestion_quality_log is now keyed by source_document_id
      // (ID-131 {131.13} G-GOV-FACET-B rename; content_items.id no longer
      // applies), so every ingestion_quality_log operation below resolves
      // through this column instead of item_id directly.
      const { data: item, error: fetchError } = await supabase
        .from('content_items')
        .select('id, source_document_id')
        .eq('id', item_id)
        .single();

      if (fetchError || !item) {
        return NextResponse.json(
          { error: 'Content item not found' },
          { status: 404 },
        );
      }

      const sourceDocumentId = item.source_document_id;

      if (action === 'verify') {
        const { error } = await supabase
          .from('content_items')
          .update({
            verified_at: new Date().toISOString(),
            verified_by: user.id,
            updated_by: user.id,
          })
          .eq('id', item_id);

        if (error) {
          logger.error({ err: error }, 'Failed to verify content item');
          return NextResponse.json(
            { error: 'Failed to verify item' },
            { status: 500 },
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

        // Clear verified status — flagging returns item to needs-attention state
        await supabase
          .from('content_items')
          .update({
            verified_at: null,
            verified_by: null,
            updated_by: user.id,
          })
          .eq('id', item_id);
      } else if (action === 'unverify') {
        const { error } = await supabase
          .from('content_items')
          .update({
            verified_at: null,
            verified_by: null,
            updated_by: user.id,
          })
          .eq('id', item_id);

        if (error) {
          logger.error({ err: error }, 'Failed to unverify content item');
          return NextResponse.json(
            { error: 'Failed to unverify item' },
            { status: 500 },
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
