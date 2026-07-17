/**
 * Automation: Review Cadence Flagging
 *
 * Runs daily at 03:45 UTC (30 min after freshness-transitions at 03:15 UTC,
 * ensuring freshness state is up-to-date before cadence checks run).
 *
 * Flags content_items past their next_review_date as 'review_overdue':
 *   - WHERE next_review_date < CURRENT_DATE
 *   - AND superseded_by IS NULL
 *   - AND archived_at IS NULL
 *   - AND publication_status != 'archived' (S216 §5.2 Phase 5 / §6.4)
 *   - AND (governance_review_status IS NULL OR = 'approved')
 *
 * For each candidate:
 *   1. Set governance_review_status = 'review_overdue'.
 *   2. Set governance_review_due = NOW().
 *   3. Create a notifications row (type='review_overdue') for the content
 *      owner (or all admins as fallback if owner is null).
 *
 * Idempotent: items already in 'review_overdue' are excluded by the SQL
 * filter; notification dedup uses getExistingNotificationIds keyed on the
 * candidate IDs + today's UTC midnight.
 *
 * S216 §5.2 Phase 5 / §6.4 (lines 999-1011): the
 * `publication_status != 'archived'` filter excludes archived items from
 * cadence flagging. The §6.6 BIDIRECTIONAL trigger keeps `archived_at`
 * and `publication_status` in lockstep, so the legacy `archived_at IS NULL`
 * filter is logically equivalent — but defence-in-depth (per spec §6.4)
 * pairs both filters in case of any future drift in the trigger.
 *
 * Spec: docs/specs/p0-document-control-lifecycle-spec.md §6
 *       docs/specs/publication-lifecycle-state-machine-spec.md §6.4
 * Plan: docs/plans/§5.5-phase-2-cron-plan.md T1
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import {
  createBulkNotifications,
  getExistingNotificationIds,
  type CreateNotificationParams,
} from '@/lib/notifications';
import { sb, tryQuery } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';
import { logger } from '@/lib/logger';
import type { FacetOwnerKind } from '@/lib/validation/owner-kind';

export const maxDuration = 30;

/**
 * Threshold above which the cron switches from per-item notifications to a
 * single batch-summary notification per recipient. Mirrors the
 * `GOVERNANCE_BATCH_SUMMARY_THRESHOLD = 20` constant in
 * `freshness-transitions/route.ts:32` so the two crons stay symmetric.
 */
const REVIEW_CADENCE_BATCH_SUMMARY_THRESHOLD = 20;

interface ReviewCandidate {
  id: string;
  title: string;
  next_review_date: string | null;
  review_cadence_days: number | null;
  content_owner_id: string | null;
  governance_review_status: string | null;
  primary_domain: string | null;
}

// ID-131 {131.19} G-GOV-FACET: content_items is dying — next_review_date/
// review_cadence_days/content_owner_id/governance_review_status live on the
// record_lifecycle facet (owner_kind='source_document', SD-only cadence axis
// per D7); title/domain/publication_status/archived_at on source_documents.
interface ReviewCadenceFacetRow {
  source_document_id: string | null;
  next_review_date: string | null;
  review_cadence_days: number | null;
  content_owner_id: string | null;
  governance_review_status: string | null;
  source_documents: {
    id: string;
    filename: string;
    suggested_title: string | null;
    primary_domain: string;
    publication_status: string;
    archived_at: string | null;
  } | null;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const executedAt = new Date().toISOString();
  const supabase = createServiceClient();

  try {
    // ── 1. Find candidate items ────────────────────────────────────────────
    // next_review_date is a `date` column — use YYYY-MM-DD only (a full ISO
    // timestamp can silently return zero rows in some PostgREST versions).
    const todayDateString = new Date().toISOString().slice(0, 10);

    // ID-131 {131.19}: content_items is dying — re-pointed onto the
    // record_lifecycle facet joined to source_documents. NOTE (documented
    // gap): the old `.is('superseded_by', null)` guard has no direct
    // source_documents equivalent — supersession there is the existing
    // `parent_id` version chain (TECH.md §"Supersession stays INLINE"), not
    // a `superseded_by` column, and "is this the latest version" cannot be
    // expressed as a single PostgREST column filter. Dropped rather than
    // guessed; `archived_at IS NULL` + `publication_status != 'archived'`
    // still exclude the common lifecycle-end states.
    const candidatesResult = await tryQuery<ReviewCadenceFacetRow[]>(
      supabase
        .from('record_lifecycle')
        .select(
          'source_document_id, next_review_date, review_cadence_days, content_owner_id, governance_review_status, source_documents!inner(id, filename, suggested_title, primary_domain, publication_status, archived_at)',
        )
        .eq('owner_kind', 'source_document' satisfies FacetOwnerKind)
        .lt('next_review_date', todayDateString)
        .is('source_documents.archived_at', null)
        // S216 §5.2 Phase 5 / §6.4 — exclude archived items from cadence
        // flagging. Belt-and-braces alongside `archived_at IS NULL`: the
        // §6.6 BIDIRECTIONAL trigger normally keeps the two columns in
        // lockstep, but pairing the filters defends against any future
        // direct `publication_status` write that bypasses the trigger.
        .neq('source_documents.publication_status', 'archived')
        .or(
          'governance_review_status.is.null,governance_review_status.eq.approved',
        ),
      'review_cadence.candidates',
    );

    if (!candidatesResult.ok) {
      logger.error(
        { err: candidatesResult.error },
        'review-cadence: failed to query candidates',
      );
      await recordPipelineRun({
        supabase,
        pipelineName: 'review_cadence',
        status: 'failed',
        itemsProcessed: 0,
        errorMessage: candidatesResult.error.message,
      });
      return NextResponse.json(
        {
          error: 'Failed to query review candidates',
          details: candidatesResult.error.message,
        },
        { status: 500 },
      );
    }

    const candidates: ReviewCandidate[] = candidatesResult.data
      .filter(
        (row) =>
          row.source_document_id !== null && row.source_documents !== null,
      )
      .map((row) => ({
        id: row.source_document_id!,
        title:
          row.source_documents!.suggested_title ??
          row.source_documents!.filename,
        next_review_date: row.next_review_date,
        review_cadence_days: row.review_cadence_days,
        content_owner_id: row.content_owner_id,
        governance_review_status: row.governance_review_status,
        primary_domain: row.source_documents!.primary_domain,
      }));

    if (candidates.length === 0) {
      await recordPipelineRun({
        supabase,
        pipelineName: 'review_cadence',
        status: 'completed',
        itemsProcessed: 0,
        result: {
          items_flagged: 0,
          notifications_created: 0,
          batch_summary_notification: false,
          executed_at: executedAt,
        } as unknown as Json,
      });
      return NextResponse.json({
        success: true,
        items_flagged: 0,
        notifications_created: 0,
        batch_summary_notification: false,
        executed_at: executedAt,
      });
    }

    // ── 2. Flip each candidate's governance status ────────────────────────
    // sb() throws SupabaseError on any update failure; we count those into
    // hadFailures so the pipeline_runs row records 'completed_with_errors'
    // (Sentry warning) — a deliberate departure from freshness-transitions
    // which silently swallows update errors.
    const flaggedAt = new Date().toISOString();
    const flagged: ReviewCandidate[] = [];
    let hadFailures = false;
    const failureMessages: string[] = [];

    for (const item of candidates) {
      try {
        await sb(
          supabase
            .from('record_lifecycle')
            .update({
              governance_review_status: 'review_overdue',
              governance_review_due: flaggedAt,
            })
            .eq('owner_kind', 'source_document' satisfies FacetOwnerKind)
            .eq('source_document_id', item.id),
          'review_cadence.update',
        );
        flagged.push(item);
      } catch (err) {
        hadFailures = true;
        const msg = err instanceof Error ? err.message : String(err);
        failureMessages.push(`update ${item.id}: ${msg}`);
        logger.error({ err }, `review-cadence: failed to flag item ${item.id}`);
      }
    }

    // ── 3. Notification idempotency: skip items already notified today ────
    const todayStartUtc = new Date();
    todayStartUtc.setUTCHours(0, 0, 0, 0);

    const existingNotificationIds =
      flagged.length > 0
        ? await getExistingNotificationIds(
            supabase,
            'review_overdue',
            flagged.map((item) => item.id),
            todayStartUtc.toISOString(),
          )
        : new Set<string>();

    const newlyFlagged = flagged.filter(
      (item) => !existingNotificationIds.has(item.id),
    );

    // ── 4. Build notification payloads ────────────────────────────────────
    type NotificationPayload = Omit<CreateNotificationParams, 'supabase'>;
    const notifications: NotificationPayload[] = [];
    let batchSummaryNotification = false;
    let adminIds: string[] | null = null;

    async function getAdminIds(): Promise<string[]> {
      if (adminIds === null) {
        adminIds = await getUsersByRole(supabase, ['admin']);
      }
      return adminIds;
    }

    if (newlyFlagged.length > REVIEW_CADENCE_BATCH_SUMMARY_THRESHOLD) {
      // Batch summary path: one summary notification per recipient.
      batchSummaryNotification = true;

      // Group items by recipient (owner-id, or "*admins" sentinel for unowned).
      const recipientGroups = new Map<string, ReviewCandidate[]>();
      const ADMIN_SENTINEL = '__admins__';

      for (const item of newlyFlagged) {
        const key = item.content_owner_id ?? ADMIN_SENTINEL;
        if (!recipientGroups.has(key)) recipientGroups.set(key, []);
        recipientGroups.get(key)!.push(item);
      }

      for (const [recipientKey, items] of recipientGroups) {
        const summaryTitle = `${items.length} items overdue for review`;
        const summaryMessage = `${items.length} items you own are overdue for review. Visit the review queue to triage.`;
        const adminSummaryMessage = `${items.length} items are overdue for review with no owner assigned. Visit the review queue to triage.`;

        if (recipientKey === ADMIN_SENTINEL) {
          const admins = await getAdminIds();
          for (const adminId of admins) {
            notifications.push({
              userId: adminId,
              type: 'review_overdue' as const,
              entityType: 'content_item',
              entityId: items[0].id,
              title: summaryTitle,
              message: adminSummaryMessage,
            });
          }
        } else {
          notifications.push({
            userId: recipientKey,
            type: 'review_overdue' as const,
            entityType: 'content_item',
            entityId: items[0].id,
            title: summaryTitle,
            message: summaryMessage,
          });
        }
      }
    } else {
      // Individual notification path
      for (const item of newlyFlagged) {
        const dueDate = item.next_review_date ?? 'unknown';
        const title = `Review overdue: "${item.title}"`;
        const message = `Content item "${item.title}" was due for review on ${dueDate}. Please review and verify.`;

        if (item.content_owner_id) {
          notifications.push({
            userId: item.content_owner_id,
            type: 'review_overdue' as const,
            entityType: 'content_item',
            entityId: item.id,
            title,
            message,
          });
        } else {
          const admins = await getAdminIds();
          for (const adminId of admins) {
            notifications.push({
              userId: adminId,
              type: 'review_overdue' as const,
              entityType: 'content_item',
              entityId: item.id,
              title,
              message,
            });
          }
        }
      }
    }

    // ── 5. Create notifications ───────────────────────────────────────────
    let notificationsCreated = 0;
    if (notifications.length > 0) {
      const { error: bulkError } = await createBulkNotifications(
        supabase,
        notifications,
      );
      if (bulkError) {
        hadFailures = true;
        failureMessages.push(`createBulkNotifications: ${bulkError.message}`);
        logger.error(
          { err: bulkError },
          'review-cadence: createBulkNotifications failed',
        );
      } else {
        notificationsCreated = notifications.length;
      }
    }

    // ── 6. Record pipeline run ────────────────────────────────────────────
    await recordPipelineRun({
      supabase,
      pipelineName: 'review_cadence',
      status: hadFailures ? 'completed_with_errors' : 'completed',
      itemsProcessed: candidates.length,
      errorMessage: hadFailures ? failureMessages.join('; ') : null,
      result: {
        items_flagged: flagged.length,
        notifications_created: notificationsCreated,
        batch_summary_notification: batchSummaryNotification,
        executed_at: executedAt,
      } as unknown as Json,
    });

    return NextResponse.json({
      success: !hadFailures,
      items_flagged: flagged.length,
      notifications_created: notificationsCreated,
      batch_summary_notification: batchSummaryNotification,
      executed_at: executedAt,
    });
  } catch (err) {
    logger.error({ err }, 'review-cadence: unhandled error');
    await recordPipelineRun({
      supabase,
      pipelineName: 'review_cadence',
      status: 'failed',
      errorMessage: safeErrorMessage(err, 'review-cadence cron threw'),
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, 'review-cadence cron failed') },
      { status: 500 },
    );
  }
}
