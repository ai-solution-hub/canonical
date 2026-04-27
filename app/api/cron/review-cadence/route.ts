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
 * Spec: docs/specs/p0-document-control-lifecycle-spec.md §6
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

    const candidatesResult = await tryQuery<ReviewCandidate[]>(
      supabase
        .from('content_items')
        .select(
          'id, title, next_review_date, review_cadence_days, content_owner_id, governance_review_status, primary_domain',
        )
        .lt('next_review_date', todayDateString)
        .is('superseded_by', null)
        .is('archived_at', null)
        .or(
          'governance_review_status.is.null,governance_review_status.eq.approved',
        ),
      'review_cadence.candidates',
    );

    if (!candidatesResult.ok) {
      console.error(
        'review-cadence: failed to query candidates',
        candidatesResult.error,
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

    const candidates = candidatesResult.data;

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
            .from('content_items')
            .update({
              governance_review_status: 'review_overdue',
              governance_review_due: flaggedAt,
            })
            .eq('id', item.id),
          'review_cadence.update',
        );
        flagged.push(item);
      } catch (err) {
        hadFailures = true;
        const msg = err instanceof Error ? err.message : String(err);
        failureMessages.push(`update ${item.id}: ${msg}`);
        console.error(
          `review-cadence: failed to flag item ${item.id}`,
          err,
        );
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
        failureMessages.push(
          `createBulkNotifications: ${bulkError.message}`,
        );
        console.error(
          'review-cadence: createBulkNotifications failed',
          bulkError,
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
    console.error('review-cadence: unhandled error', err);
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
