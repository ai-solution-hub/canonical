/**
 * Quality Score Recalculation Cron
 *
 * Runs weekly (Sundays 05:00 UTC -- after classification-quality at 04:00).
 * Recalculates quality scores for all non-archived content items and creates
 * quality_flag notifications when scores drop below per-domain thresholds.
 *
 * Phase 1 governance bridge: when auto_flag_on_quality_drop is enabled for a
 * domain, items that drop below threshold are also set to governance review
 * status 'pending' with a governance_review_needed notification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { calculateAndRoundQualityScore } from '@/lib/quality/quality-score';
import { createBulkNotifications } from '@/lib/notifications';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 50;

/** Process items in batches to avoid memory pressure */
const BATCH_SIZE = 100;

/** Stop processing if approaching timeout (40s cutoff -> 10s buffer for writes) */
const TIMEOUT_BUFFER_MS = 40_000;

/** Default quality threshold when no governance_config row exists for a domain */
const DEFAULT_THRESHOLD = 40;

/** When more than this many items are flagged, use summary notifications */
const BATCH_SUMMARY_THRESHOLD = 20;

interface ContentItemRow {
  id: string;
  title: string;
  primary_domain: string | null;
  freshness: string | null;
  classification_confidence: number | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  quality_score: number | null;
  governance_review_status: string | null;
  verified_at: string | null;
  citation_count: number | null;
}

interface GovConfig {
  domain: string;
  id: string;
  quality_score_threshold: number | null;
  auto_flag_on_quality_drop: boolean | null;
  auto_flag_cooldown_days: number | null;
  reviewer_id: string | null;
  timeout_days: number | null;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabase = createServiceClient();

    // 1. Fetch governance_config to build domain maps
    const { data: govConfigs, error: govConfigsError } = await supabase
      .from('governance_config')
      .select(
        'id, domain, quality_score_threshold, auto_flag_on_quality_drop, auto_flag_cooldown_days, reviewer_id, timeout_days',
      );

    if (govConfigsError) {
      // Without governance_config the cron silently uses DEFAULT_THRESHOLD
      // for every domain, which can mass-flag items. Fail loudly.
      console.error('Failed to fetch governance_config:', govConfigsError);
      return NextResponse.json(
        {
          error: 'Failed to fetch governance_config',
          details: govConfigsError.message,
        },
        { status: 500 },
      );
    }

    const thresholdMap = new Map<string, number>();
    const govConfigMap = new Map<string, GovConfig>();
    if (govConfigs) {
      for (const config of govConfigs) {
        thresholdMap.set(
          config.domain,
          config.quality_score_threshold ?? DEFAULT_THRESHOLD,
        );
        govConfigMap.set(config.domain, config as GovConfig);
      }
    }

    // 2. Fetch all non-archived items in batches
    let offset = 0;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalDroppedBelowThreshold = 0;
    let autoGovernanceTriggered = 0;
    const flaggedItems: Array<{
      itemId: string;
      title: string;
      domain: string | null;
      oldScore: number;
      newScore: number;
    }> = [];

    // Items eligible for governance auto-flagging (subset of flaggedItems)
    const governanceFlagItems: Array<{
      itemId: string;
      title: string;
      domain: string | null;
      oldScore: number;
      newScore: number;
      reviewerId: string | null;
      timeoutDays: number;
      govConfigId: string | null;
    }> = [];

    let timedOut = false;
    const failedFetches: Array<{ offset: number; error: string }> = [];
    const failedUpdates: Array<{ id: string; error: string }> = [];

    while (true) {
      // Check timeout before fetching next batch
      if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
        timedOut = true;
        break;
      }

      const { data: items, error: fetchError } = await supabase
        .from('content_items')
        .select(
          'id, title, primary_domain, freshness, classification_confidence, brief, detail, reference, summary, metadata, quality_score, governance_review_status, verified_at, citation_count',
        )
        .is('archived_at', null)
        .order('id', { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1);

      if (fetchError) {
        console.error('Failed to fetch content items batch:', fetchError);
        failedFetches.push({ offset, error: fetchError.message });
        break;
      }

      const batch = (items ?? []) as ContentItemRow[];
      if (batch.length === 0) break;

      // 3. Calculate scores for batch
      const updates: Array<{
        id: string;
        quality_score: number;
        previous_quality_score: number | null;
        quality_score_updated_at: string;
      }> = [];

      for (const item of batch) {
        const newScore = calculateAndRoundQualityScore({
          freshness: item.freshness,
          classification_confidence: item.classification_confidence,
          brief: item.brief,
          detail: item.detail,
          reference: item.reference,
          summary: item.summary,
          citation_count: item.citation_count ?? 0,
        });

        const oldScore = item.quality_score;

        // Only update if score changed
        if (newScore !== oldScore) {
          updates.push({
            id: item.id,
            quality_score: newScore,
            previous_quality_score: oldScore,
            quality_score_updated_at: new Date().toISOString(),
          });

          // Check for threshold crossing (transition from above to below)
          const threshold =
            thresholdMap.get(item.primary_domain ?? '') ?? DEFAULT_THRESHOLD;
          const wasAboveThreshold = oldScore === null || oldScore >= threshold;
          const isNowBelowThreshold = newScore < threshold;

          if (wasAboveThreshold && isNowBelowThreshold) {
            flaggedItems.push({
              itemId: item.id,
              title: item.title,
              domain: item.primary_domain,
              oldScore: oldScore ?? 0,
              newScore,
            });

            // Check if eligible for governance auto-flagging
            const domainConfig = govConfigMap.get(item.primary_domain ?? '');
            const autoFlagEnabled =
              domainConfig?.auto_flag_on_quality_drop ?? true;

            if (autoFlagEnabled) {
              // Guard: only flag items with null or 'approved' governance_review_status
              // Skip items in 'pending', 'changes_requested', or 'draft' state
              const status = item.governance_review_status;
              const eligibleForGovernance =
                status === null || status === 'approved';

              if (eligibleForGovernance) {
                // Cooldown check: skip if verified_at is within cooldown period
                // (don't re-flag items recently reviewed by a human)
                const cooldownDays = domainConfig?.auto_flag_cooldown_days ?? 7;
                const cooldownCutoff = new Date(
                  Date.now() - cooldownDays * 24 * 60 * 60 * 1000,
                );
                const lastVerified = item.verified_at
                  ? new Date(item.verified_at)
                  : null;
                const withinCooldown =
                  lastVerified && lastVerified > cooldownCutoff;

                if (!withinCooldown) {
                  governanceFlagItems.push({
                    itemId: item.id,
                    title: item.title,
                    domain: item.primary_domain,
                    oldScore: oldScore ?? 0,
                    newScore,
                    reviewerId: domainConfig?.reviewer_id ?? null,
                    timeoutDays: domainConfig?.timeout_days ?? 7,
                    govConfigId: domainConfig?.id ?? null,
                  });
                }
              }
            }
          }
        }

        totalProcessed++;
      }

      // 4. Write updates in batch (individual updates to preserve previous_quality_score)
      let batchUpdated = 0;
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('content_items')
          .update({
            quality_score: update.quality_score,
            previous_quality_score: update.previous_quality_score,
            quality_score_updated_at: update.quality_score_updated_at,
          })
          .eq('id', update.id);
        if (updateError) {
          console.error(
            'Quality score update failed for item',
            update.id,
            updateError,
          );
          failedUpdates.push({ id: update.id, error: updateError.message });
        } else {
          batchUpdated++;
        }
      }

      totalUpdated += batchUpdated;
      offset += BATCH_SIZE;

      // If we got fewer items than BATCH_SIZE, we've reached the end
      if (batch.length < BATCH_SIZE) break;
    }

    // 5. Create quality_flag notifications for items that dropped below threshold
    let notificationsCreated = 0;
    if (flaggedItems.length > 0) {
      const adminIds = await getUsersByRole(supabase, ['admin']);

      if (adminIds.length > 0) {
        totalDroppedBelowThreshold = flaggedItems.length;

        const notifications = flaggedItems.flatMap((item) =>
          adminIds.map((userId) => ({
            userId,
            type: 'quality_flag' as const,
            entityType: 'content_item',
            entityId: item.itemId,
            title: `Quality score dropped below threshold: "${item.title}"`,
            message: `"${item.title}" quality score dropped from ${item.oldScore} to ${item.newScore} (threshold: ${thresholdMap.get(item.domain ?? '') ?? DEFAULT_THRESHOLD}). Domain: ${item.domain ?? 'unclassified'}.`,
          })),
        );

        const { error: notifError } = await createBulkNotifications(
          supabase,
          notifications,
        );
        if (!notifError) notificationsCreated = notifications.length;
      }
    }

    // 6. Governance bridge: set pending status and create governance notifications
    let batchSummaryNotification = false;
    if (governanceFlagItems.length > 0) {
      autoGovernanceTriggered = governanceFlagItems.length;

      // Update each item's governance status
      for (const item of governanceFlagItems) {
        const reviewDue = new Date(
          Date.now() + item.timeoutDays * 24 * 60 * 60 * 1000,
        ).toISOString();
        await supabase
          .from('content_items')
          .update({
            governance_review_status: 'pending',
            governance_review_due: reviewDue,
            governance_reviewer_id: item.reviewerId,
          })
          .eq('id', item.itemId);
      }

      // Determine notification recipients per item
      const adminIds = await getUsersByRole(supabase, ['admin']);

      if (governanceFlagItems.length > BATCH_SUMMARY_THRESHOLD) {
        // Batch summary path: single notification per reviewer/admin
        batchSummaryNotification = true;

        // Find the most-affected domain's governance_config ID for entity_id
        const domainCounts = new Map<string, number>();
        for (const item of governanceFlagItems) {
          const d = item.domain ?? 'unclassified';
          domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
        }
        let maxDomain = '';
        let maxCount = 0;
        domainCounts.forEach((count, domain) => {
          if (count > maxCount) {
            maxDomain = domain;
            maxCount = count;
          }
        });
        const summaryEntityId =
          govConfigMap.get(maxDomain)?.id ?? governanceFlagItems[0].itemId;

        // Collect unique recipients (reviewers + admins)
        const recipientIds = new Set<string>(adminIds);
        for (const item of governanceFlagItems) {
          if (item.reviewerId) recipientIds.add(item.reviewerId);
        }

        const summaryNotifications = Array.from(recipientIds).map((userId) => ({
          userId,
          type: 'governance_review_needed' as const,
          entityType: 'domain',
          entityId: summaryEntityId,
          title: `${governanceFlagItems.length} items flagged for quality review`,
          message: `The weekly quality scan flagged ${governanceFlagItems.length} items below threshold. Review them in the review queue.`,
        }));

        const { error: govNotifError } = await createBulkNotifications(
          supabase,
          summaryNotifications,
        );
        if (!govNotifError) notificationsCreated += summaryNotifications.length;
      } else {
        // Individual notification path
        const notifications = governanceFlagItems.flatMap((item) => {
          // Notify the assigned reviewer, or all admins if no reviewer
          const recipients = item.reviewerId ? [item.reviewerId] : adminIds;
          return recipients.map((userId) => ({
            userId,
            type: 'governance_review_needed' as const,
            entityType: 'content_item',
            entityId: item.itemId,
            title: `Quality review needed: "${item.title}"`,
            message: `"${item.title}" quality score dropped from ${item.oldScore} to ${item.newScore}. Auto-flagged for governance review.`,
          }));
        });

        const { error: govNotifError } = await createBulkNotifications(
          supabase,
          notifications,
        );
        if (!govNotifError) notificationsCreated += notifications.length;
      }
    }

    // 7. Log to pipeline_runs via the S152B WP4 helper (Sentry + Q-36 fix).
    // Note: `items_updated` is stored inside `result` because the
    // pipeline_runs table does not have an `items_updated` column —
    // the previous code was passing a non-existent field that Supabase
    // silently dropped.
    const durationMs = Date.now() - startTime;
    const hadFailures = failedFetches.length > 0 || failedUpdates.length > 0;
    const errorSummary = hadFailures
      ? `quality-score: ${failedFetches.length} fetch failure(s), ${failedUpdates.length} update failure(s)`
      : null;
    await recordPipelineRun({
      supabase,
      pipelineName: 'quality_score',
      status: hadFailures ? 'completed_with_errors' : 'completed',
      itemsProcessed: totalProcessed,
      errorMessage: errorSummary,
      result: {
        total_processed: totalProcessed,
        total_updated: totalUpdated,
        dropped_below_threshold: totalDroppedBelowThreshold,
        auto_governance_triggered: autoGovernanceTriggered,
        batch_summary_notification: batchSummaryNotification,
        notifications_created: notificationsCreated,
        timed_out: timedOut,
        duration_ms: durationMs,
        failed_fetch_count: failedFetches.length,
        failed_update_count: failedUpdates.length,
        failed_fetches: failedFetches,
        // Truncate failed_updates list to keep the row reasonable
        failed_updates: failedUpdates.slice(0, 50),
      } as unknown as Json,
    });

    return NextResponse.json({
      success: !hadFailures,
      total_processed: totalProcessed,
      total_updated: totalUpdated,
      dropped_below_threshold: totalDroppedBelowThreshold,
      auto_governance_triggered: autoGovernanceTriggered,
      batch_summary_notification: batchSummaryNotification,
      notifications_created: notificationsCreated,
      timed_out: timedOut,
      duration_ms: durationMs,
      failed_fetch_count: failedFetches.length,
      failed_update_count: failedUpdates.length,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Quality score cron failed') },
      { status: 500 },
    );
  }
}
