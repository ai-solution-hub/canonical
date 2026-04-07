/**
 * Automation 2: Classification Quality Monitor
 *
 * Runs weekly (Sundays 04:00 UTC). Reclassifies items with low confidence,
 * outdated classification, or never classified. Auto-updates if same
 * domain+subtopic with improved confidence; flags for human review if
 * domain/subtopic changed.
 *
 * Batch size: 20 items (configurable via CLASSIFICATION_BATCH_SIZE).
 * Sequential processing to avoid Claude API rate limits.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sb } from '@/lib/supabase/safe';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { classifyContent } from '@/lib/ai/classify';
import { createBulkNotifications } from '@/lib/notifications';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 120;

const DEFAULT_BATCH_SIZE = 20;
const CONFIDENCE_THRESHOLD = 0.7;
const STALE_DAYS = 90;
const TIMEOUT_BUFFER_MS = 50_000; // Stop processing if >50s elapsed

interface ReclassifyResult {
  itemId: string;
  title: string;
  action: 'auto_updated' | 'flagged_for_review' | 'unchanged' | 'error';
  oldDomain?: string;
  oldSubtopic?: string;
  newDomain?: string;
  newSubtopic?: string;
  oldConfidence?: number;
  newConfidence?: number;
  error?: string;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabase = createServiceClient();
    const batchSize =
      parseInt(process.env.CLASSIFICATION_BATCH_SIZE ?? '', 10) ||
      DEFAULT_BATCH_SIZE;

    // Calculate the date threshold for stale classifications
    const staleDate = new Date(
      Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Also consider taxonomy changes (spec §10b.5)
    // Use .maybeSingle() so an empty taxonomy table → taxonomyDate = null
    // (intentional: skip the taxonomy-staleness branch). A real DB failure
    // throws SupabaseError and 500s via the outer try/catch.
    const latestTaxonomy = await sb(
      supabase
        .from('taxonomy_subtopics')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'cron.classification_quality.latest_taxonomy',
    );

    const taxonomyDate = latestTaxonomy?.created_at ?? null;

    // Query candidates: confidence < 0.7 OR classified_at > 90 days OR null
    // Also include items classified before the latest taxonomy change
    const { data: candidates, error: queryError } = await supabase
      .from('content_items')
      .select(
        'id, title, primary_domain, primary_subtopic, classification_confidence, classified_at',
      )
      .is('archived_at', null)
      .or(
        `classification_confidence.lt.${CONFIDENCE_THRESHOLD},classified_at.is.null,classified_at.lt.${staleDate}${taxonomyDate ? `,classified_at.lt.${taxonomyDate}` : ''}`,
      )
      .order('classification_confidence', { ascending: true, nullsFirst: true })
      .limit(batchSize);

    if (queryError) {
      console.error('Failed to query classification candidates:', queryError);
      return NextResponse.json(
        { error: safeErrorMessage(queryError, 'Failed to query candidates') },
        { status: 500 },
      );
    }

    const items = candidates ?? [];

    if (items.length === 0) {
      return NextResponse.json({
        candidates_found: 0,
        reclassified: 0,
        auto_updated: 0,
        flagged_for_review: 0,
        unchanged: 0,
        notifications_created: 0,
        executed_at: new Date().toISOString(),
      });
    }

    // Fetch admin user IDs for review notifications
    const adminIds = await getUsersByRole(supabase, ['admin']);

    // We need a userId for classifyContent — skip if no admin exists
    if (adminIds.length === 0) {
      console.warn('Classification quality: no admin user found, skipping run');
      return NextResponse.json({
        success: true,
        skipped_reason: 'no_admin_user',
      });
    }
    const systemUserId = adminIds[0];

    const results: ReclassifyResult[] = [];

    // Sequential processing to avoid rate limits
    for (const item of items) {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT_BUFFER_MS) {
        console.warn(
          `Classification quality: timeout approaching after ${results.length} items`,
        );
        break;
      }

      try {
        const oldDomain = item.primary_domain;
        const oldSubtopic = item.primary_subtopic;
        const oldConfidence = item.classification_confidence ?? 0;

        // Reclassify with force=true
        const classification = await classifyContent({
          supabase,
          itemId: item.id,
          force: true,
          userId: systemUserId,
        });

        const newDomain = classification.primary_domain;
        const newSubtopic = classification.primary_subtopic;
        const newConfidence = classification.classification_confidence;

        const sameTaxonomy =
          oldDomain?.toLowerCase() === newDomain.toLowerCase() &&
          oldSubtopic?.toLowerCase() === newSubtopic.toLowerCase();

        if (!oldDomain || !oldSubtopic) {
          // Previously unclassified — auto-update already happened in classifyContent
          results.push({
            itemId: item.id,
            title: item.title,
            action: 'auto_updated',
            oldDomain: oldDomain ?? undefined,
            oldSubtopic: oldSubtopic ?? undefined,
            newDomain,
            newSubtopic,
            oldConfidence,
            newConfidence,
          });
        } else if (sameTaxonomy && newConfidence > oldConfidence) {
          // Same taxonomy, improved confidence — classifyContent already updated
          results.push({
            itemId: item.id,
            title: item.title,
            action: 'auto_updated',
            oldDomain,
            oldSubtopic,
            newDomain,
            newSubtopic,
            oldConfidence,
            newConfidence,
          });
        } else if (sameTaxonomy) {
          // Same taxonomy, same or lower confidence — revert to old values
          await supabase
            .from('content_items')
            .update({
              primary_domain: oldDomain,
              primary_subtopic: oldSubtopic,
              classification_confidence: oldConfidence,
            })
            .eq('id', item.id);

          results.push({
            itemId: item.id,
            title: item.title,
            action: 'unchanged',
            oldDomain,
            oldSubtopic,
            newDomain,
            newSubtopic,
            oldConfidence,
            newConfidence,
          });
        } else {
          // Different taxonomy — revert and flag for human review
          await supabase
            .from('content_items')
            .update({
              primary_domain: oldDomain,
              primary_subtopic: oldSubtopic,
              classification_confidence: oldConfidence,
            })
            .eq('id', item.id);

          results.push({
            itemId: item.id,
            title: item.title,
            action: 'flagged_for_review',
            oldDomain,
            oldSubtopic,
            newDomain,
            newSubtopic,
            oldConfidence,
            newConfidence,
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Classification failed for ${item.id}:`, errMsg);

        // Stop on rate limit
        if (
          errMsg.includes('429') ||
          errMsg.toLowerCase().includes('rate limit')
        ) {
          console.warn('Claude API rate limited — stopping batch');
          results.push({
            itemId: item.id,
            title: item.title,
            action: 'error',
            error: 'Rate limited',
          });
          break;
        }

        results.push({
          itemId: item.id,
          title: item.title,
          action: 'error',
          error: errMsg,
        });
      }
    }

    // Create notifications for flagged items
    const flagged = results.filter((r) => r.action === 'flagged_for_review');
    let notificationsCreated = 0;

    if (flagged.length > 0 && adminIds.length > 0) {
      const notifications = flagged.flatMap((r) =>
        adminIds.map((userId) => ({
          userId,
          type: 'quality_flag' as const,
          entityType: 'content_item',
          entityId: r.itemId,
          title: `Classification review needed: "${r.title}"`,
          message: `Reclassification suggests "${r.title}" should be ${r.newDomain}/${r.newSubtopic} (currently ${r.oldDomain}/${r.oldSubtopic}). Confidence: ${r.newConfidence?.toFixed(2)}. Review and confirm or reject.`,
        })),
      );

      const { error: bulkError } = await createBulkNotifications(
        supabase,
        notifications,
      );
      if (!bulkError) notificationsCreated = notifications.length;
    }

    // Log to pipeline_runs via the S152B WP4 helper (Sentry + Q-36 fix).
    const autoUpdated = results.filter(
      (r) => r.action === 'auto_updated',
    ).length;
    const unchanged = results.filter((r) => r.action === 'unchanged').length;
    const errors = results.filter((r) => r.action === 'error').length;
    const allErrored = errors === results.length && results.length > 0;
    const someErrored = errors > 0 && !allErrored;
    const runStatus = allErrored
      ? 'failed'
      : someErrored
        ? 'completed_with_errors'
        : 'completed';

    await recordPipelineRun({
      supabase,
      pipelineName: 'classification_quality',
      status: runStatus,
      itemsProcessed: results.length,
      errorMessage:
        errors > 0 ? `${errors} of ${results.length} items errored` : null,
      result: {
        candidates_found: items.length,
        auto_updated: autoUpdated,
        flagged_for_review: flagged.length,
        unchanged,
        errors,
        duration_ms: Date.now() - startTime,
      } as unknown as Json,
    });

    return NextResponse.json({
      candidates_found: items.length,
      reclassified: results.length,
      auto_updated: autoUpdated,
      flagged_for_review: flagged.length,
      unchanged,
      notifications_created: notificationsCreated,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Classification quality cron failed') },
      { status: 500 },
    );
  }
}
