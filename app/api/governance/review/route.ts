import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthenticatedClient,
  getAuthorisedClient,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { computeNextReviewDate } from '@/lib/governance/cadence-renewal';
import {
  ALLOWED_REVIEW_INPUT_STATUSES,
  type AllowedReviewInputStatus,
} from '@/lib/governance/review-input-statuses';
import { logger } from '@/lib/logger';
import { isOk, tryQuery } from '@/lib/supabase/safe';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  GovernanceReviewBodySchema,
  GovernanceReviewParamsSchema,
} from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// ID-131 {131.19} G-GOV-FACET: content_items is dying — governance status/
// due/reviewer/verified_at live on the record_lifecycle facet (owner_kind=
// 'source_document', governance axis, BI-20); title/suggested_title/
// primary_domain/updated_by/updated_at live on the owning source_documents
// row.
type RecordLifecycleUpdate =
  Database['public']['Tables']['record_lifecycle']['Update'];

export const maxDuration = 30;

// GET has two distinct 2xx shapes:
//  - count_only=true → `{ count: number }` (also the Supabase-error fallback)
//  - otherwise       → `data ?? []`, an array of facet+source_documents rows
//    with the 9 selected columns. `id`/`title`/`primary_domain` are NOT NULL;
//    the rest are nullable. `governance_review_status` is a plain text
//    column → z.string().
const GovernanceReviewItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  suggested_title: z.string().nullable(),
  primary_domain: z.string(),
  governance_review_status: z.string().nullable(),
  governance_review_due: z.string().nullable(),
  governance_reviewer_id: z.string().nullable(),
  updated_by: z.string().nullable(),
  updated_at: z.string().nullable(),
});
const GetGovernanceReviewResponseSchema = z.union([
  z.object({ count: z.number() }),
  z.array(GovernanceReviewItemSchema),
]);

export const GET = defineRoute(
  GetGovernanceReviewResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const parsed = parseSearchParams(
        GovernanceReviewParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const { count_only: countOnly, limit, offset } = parsed.data;

      if (countOnly) {
        const { count, error } = await supabase
          .from('record_lifecycle')
          .select('*', { count: 'exact', head: true })
          .eq('owner_kind', 'source_document')
          .eq('governance_review_status', 'pending');

        if (error) {
          logger.error({ err: error }, 'Failed to count governance reviews');
          return NextResponse.json({ count: 0 });
        }

        return NextResponse.json({ count: count ?? 0 });
      }

      const { data, error } = await supabase
        .from('record_lifecycle')
        .select(
          'source_document_id, governance_review_status, governance_review_due, governance_reviewer_id, source_documents!inner(id, filename, suggested_title, primary_domain, updated_by, updated_at)',
        )
        .eq('owner_kind', 'source_document')
        .eq('governance_review_status', 'pending')
        .order('governance_review_due', { ascending: true, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error({ err: error }, 'Failed to fetch governance reviews');
        return NextResponse.json(
          { error: 'Failed to fetch governance reviews' },
          { status: 500 },
        );
      }

      const items = (data ?? [])
        .filter((row) => row.source_documents !== null)
        .map((row) => ({
          id: row.source_document_id!,
          title: row.source_documents!.filename,
          suggested_title: row.source_documents!.suggested_title,
          primary_domain: row.source_documents!.primary_domain,
          governance_review_status: row.governance_review_status,
          governance_review_due: row.governance_review_due,
          governance_reviewer_id: row.governance_reviewer_id,
          updated_by: row.source_documents!.updated_by,
          updated_at: row.source_documents!.updated_at,
        }));

      return NextResponse.json(items);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch governance reviews') },
        { status: 500 },
      );
    }
  },
);

// POST returns a single 2xx envelope: `{ success: true, action, item_id }`.
// `action` echoes the validated body action enum; `item_id` is the request UUID.
const PostGovernanceReviewResponseSchema = z.object({
  success: z.literal(true),
  action: z.enum(['approve', 'request_changes', 'revert']),
  item_id: z.string(),
});

export const POST = defineRoute(
  PostGovernanceReviewResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const raw = await request.json();
      const parsed = parseBody(GovernanceReviewBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { item_id, action, notes } = parsed.data;

      // Verify the item exists and is pending review.
      // ID-131 {131.19}: content_items is dying — governance_review_status/
      // next_review_date/review_cadence_days/verified_at now live on the
      // record_lifecycle facet (owner_kind='source_document', SD-only
      // cadence axis per D7). §5.5 Phase 2 T2: `next_review_date` +
      // `review_cadence_days` are read by the `approve` branch below to
      // compute auto-renewal. `verified_at` is selected only to keep the
      // SELECT shape stable for future extension.
      const { data: item, error: fetchError } = await supabase
        .from('record_lifecycle')
        .select(
          'source_document_id, governance_review_status, next_review_date, review_cadence_days, verified_at',
        )
        .eq('owner_kind', 'source_document')
        .eq('source_document_id', item_id)
        .single();

      if (fetchError || !item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      if (
        !ALLOWED_REVIEW_INPUT_STATUSES.includes(
          item.governance_review_status as AllowedReviewInputStatus,
        )
      ) {
        return NextResponse.json(
          { error: 'Item is not pending governance review' },
          { status: 400 },
        );
      }

      let updateData: RecordLifecycleUpdate;

      switch (action) {
        case 'approve': {
          // §5.5 Phase 2 T2: when an item with a configured cadence is approved,
          // advance `next_review_date` to GREATEST(current, today) + cadence
          // and stamp `verified_at = NOW()`. Items without a cadence
          // (review_cadence_days IS NULL) leave `next_review_date` untouched.
          // Spec §6.5 + §6.9 AC8.
          const nextReviewDate = computeNextReviewDate(
            item.next_review_date,
            item.review_cadence_days,
          );
          updateData = {
            governance_review_status: 'approved',
            governance_reviewer_id: user.id,
            governance_review_due: null,
            verified_at: new Date().toISOString(),
            ...(nextReviewDate && { next_review_date: nextReviewDate }),
          };
          break;
        }

        case 'request_changes':
          updateData = {
            governance_review_status: 'changes_requested',
            governance_reviewer_id: user.id,
          };
          break;

        case 'revert':
          // Revert to last approved version (latest history entry before the pending change)
          updateData = {
            governance_review_status: 'reverted',
            governance_reviewer_id: user.id,
            governance_review_due: null,
          };
          break;

        default:
          return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 },
          );
      }

      const { data: updated, error: updateError } = await supabase
        .from('record_lifecycle')
        .update(updateData)
        .eq('owner_kind', 'source_document')
        .eq('source_document_id', item_id)
        .select('source_document_id')
        .single();

      if (updateError || !updated) {
        logger.error(
          { err: updateError },
          'Failed to process governance review',
        );
        return NextResponse.json(
          { error: 'Item not found or governance review update failed' },
          { status: updateError ? 500 : 404 },
        );
      }

      // Create notifications for the content owner and/or last editor.
      // Notification dispatch is best-effort: a failure here must not roll
      // back the governance review action that already succeeded above.
      // ID-131 {131.19}: content_owner_id lives on the facet; updated_by
      // lives on the owning source_documents row.
      try {
        const itemDetailResult = await tryQuery(
          supabase
            .from('record_lifecycle')
            .select('content_owner_id, source_documents!inner(updated_by)')
            .eq('owner_kind', 'source_document')
            .eq('source_document_id', item_id)
            .maybeSingle(),
          'governance.review.item_detail',
        );
        if (!isOk(itemDetailResult)) {
          logger.warn(
            { err: itemDetailResult.error },
            'governance.review.item_detail failed — skipping notifications',
          );
        }
        const detail = isOk(itemDetailResult) ? itemDetailResult.data : null;
        const notifyTargets = new Set<string>();

        // Notify content owner first (primary recipient)
        if (detail?.content_owner_id && detail.content_owner_id !== user.id) {
          notifyTargets.add(detail.content_owner_id);
        }
        // Also notify last editor if different from owner and reviewer
        const updatedBy = detail?.source_documents?.updated_by;
        if (updatedBy && updatedBy !== user.id) {
          notifyTargets.add(updatedBy);
        }

        for (const targetUserId of notifyTargets) {
          await supabase.from('notifications').insert({
            user_id: targetUserId,
            type: `governance_${action}`,
            entity_type: 'content_item',
            entity_id: item_id,
            title: `Governance review: ${action.replace('_', ' ')}`,
            message: notes ?? null,
          });
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to create governance notification');
      }

      return NextResponse.json({
        success: true,
        action,
        item_id,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to process governance review') },
        { status: 500 },
      );
    }
  },
);
