/**
 * Quality Score Recalculation Cron
 *
 * Runs weekly (Sundays 05:00 UTC — after classification-quality at 04:00).
 * Recalculates quality scores for all non-archived content items and creates
 * quality_flag notifications when scores drop below per-domain thresholds.
 *
 * Phase 1 of the Quality Manager Enhancement spec.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { calculateAndRoundQualityScore } from '@/lib/quality-score';
import { createBulkNotifications } from '@/lib/notifications';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 50;

/** Process items in batches to avoid memory pressure */
const BATCH_SIZE = 100;

/** Stop processing if approaching timeout (45s safety buffer) */
const TIMEOUT_BUFFER_MS = 45_000;

/** Default quality threshold when no governance_config row exists for a domain */
const DEFAULT_THRESHOLD = 40;

interface ContentItemRow {
  id: string;
  title: string;
  primary_domain: string | null;
  freshness: string | null;
  classification_confidence: number | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  ai_summary: string | null;
  metadata: Record<string, unknown> | null;
  quality_score: number | null;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabase = createServiceClient();

    // 1. Fetch governance_config to build domain → threshold map
    const { data: govConfigs } = await supabase
      .from('governance_config')
      .select('domain, quality_score_threshold');

    const thresholdMap = new Map<string, number>();
    if (govConfigs) {
      for (const config of govConfigs) {
        thresholdMap.set(
          config.domain,
          config.quality_score_threshold ?? DEFAULT_THRESHOLD,
        );
      }
    }

    // 2. Fetch all non-archived items in batches
    let offset = 0;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalDroppedBelowThreshold = 0;
    const flaggedItems: Array<{
      itemId: string;
      title: string;
      domain: string | null;
      oldScore: number;
      newScore: number;
    }> = [];

    let timedOut = false;

    while (true) {
      // Check timeout before fetching next batch
      if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
        timedOut = true;
        break;
      }

      const { data: items, error: fetchError } = await supabase
        .from('content_items')
        .select('id, title, primary_domain, freshness, classification_confidence, brief, detail, reference, ai_summary, metadata, quality_score')
        .is('archived_at', null)
        .order('id', { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1);

      if (fetchError) {
        console.error('Failed to fetch content items batch:', fetchError);
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
        const meta = item.metadata;
        const newScore = calculateAndRoundQualityScore({
          freshness: item.freshness,
          classification_confidence: item.classification_confidence,
          brief: item.brief,
          detail: item.detail,
          reference: item.reference,
          ai_summary: item.ai_summary,
          citation_count: typeof meta?.citation_count === 'number' ? meta.citation_count : 0,
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
          const threshold = thresholdMap.get(item.primary_domain ?? '') ?? DEFAULT_THRESHOLD;
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
          }
        }

        totalProcessed++;
      }

      // 4. Write updates in batch (individual updates to preserve previous_quality_score)
      for (const update of updates) {
        await supabase
          .from('content_items')
          .update({
            quality_score: update.quality_score,
            previous_quality_score: update.previous_quality_score,
            quality_score_updated_at: update.quality_score_updated_at,
          })
          .eq('id', update.id);
      }

      totalUpdated += updates.length;
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

        const { error: notifError } = await createBulkNotifications(supabase, notifications);
        if (!notifError) notificationsCreated = notifications.length;
      }
    }

    // 6. Log to pipeline_runs
    const durationMs = Date.now() - startTime;
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'quality_score',
      status: 'completed',
      items_processed: totalProcessed,
      items_updated: totalUpdated,
      completed_at: new Date().toISOString(),
      result: {
        total_processed: totalProcessed,
        total_updated: totalUpdated,
        dropped_below_threshold: totalDroppedBelowThreshold,
        notifications_created: notificationsCreated,
        timed_out: timedOut,
        duration_ms: durationMs,
      } as unknown as Json,
    });

    return NextResponse.json({
      total_processed: totalProcessed,
      total_updated: totalUpdated,
      dropped_below_threshold: totalDroppedBelowThreshold,
      notifications_created: notificationsCreated,
      timed_out: timedOut,
      duration_ms: durationMs,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Quality score cron failed') },
      { status: 500 },
    );
  }
}
