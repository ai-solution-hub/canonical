/**
 * Automation 4: Content Gap Detection
 *
 * Runs weekly (Mondays 05:30 UTC). Analyses template requirements against
 * KB content using the coverage matching engine. Compares against previous
 * week's gap list to identify new, resolved, and persistent gaps.
 *
 * Depends on `template_requirements` table being populated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { tryQuery, isOk } from '@/lib/supabase/safe';
import {
  fetchTemplateRequirements,
  fetchContentForMatching,
  computeTemplateCoverage,
} from '@/lib/templates/template-coverage';
import {
  createBulkNotifications,
  getExistingNotificationIds,
} from '@/lib/notifications';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 30;

const PERSISTENT_GAP_WEEKS = 3;

interface GapSnapshot {
  template: string;
  version: string | null;
  snapshot_date: string;
  gaps: string[];
  coverage_score: number;
  [key: string]: unknown; // JSON index signature
}

interface PreviousRunResult {
  snapshots: GapSnapshot[];
  consecutive_gap_counts?: Record<string, number>;
  [key: string]: unknown; // JSON index signature
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabase = createServiceClient();

    // List current templates
    const { data: templates, error: templateError } = await supabase
      .from('template_requirements')
      .select('template_name, template_version')
      .eq('is_current', true);

    if (templateError) {
      console.error('Failed to query templates:', templateError);
      return NextResponse.json(
        { error: safeErrorMessage(templateError, 'Failed to query templates') },
        { status: 500 },
      );
    }

    // Deduplicate template names
    const uniqueTemplates = new Map<string, string | null>();
    for (const t of templates ?? []) {
      if (!uniqueTemplates.has(t.template_name)) {
        uniqueTemplates.set(t.template_name, t.template_version);
      }
    }

    if (uniqueTemplates.size === 0) {
      return NextResponse.json({
        templates_analysed: 0,
        total_requirements: 0,
        gaps: {},
        notifications_created: 0,
        executed_at: new Date().toISOString(),
      });
    }

    // Fetch content items once (shared across all templates)
    const contentItems = await fetchContentForMatching(supabase);

    // Fetch previous run for comparison. Cron must keep running even if
    // this lookup fails — degrade to "no previous data" so the comparison
    // becomes a first-run snapshot.
    const previousRunResult = await tryQuery(
      supabase
        .from('pipeline_runs')
        .select('result')
        .eq('pipeline_name', 'content_gaps')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'cron.content_gaps.previous_run',
    );
    if (!isOk(previousRunResult)) {
      console.warn(
        'cron.content_gaps.previous_run failed — treating as first run',
        previousRunResult.error,
      );
    }
    const previousRun = isOk(previousRunResult) ? previousRunResult.data : null;

    const previousResult: PreviousRunResult | null =
      (previousRun?.result as PreviousRunResult | null) ?? null;

    const previousGapSets = new Map<string, Set<string>>();
    if (previousResult?.snapshots) {
      for (const snap of previousResult.snapshots) {
        previousGapSets.set(snap.template, new Set(snap.gaps));
      }
    }

    const previousConsecutiveCounts: Record<string, number> =
      previousResult?.consecutive_gap_counts ?? {};

    // Analyse each template
    const gapsResult: Record<
      string,
      {
        total: number;
        strong: number;
        partial: number;
        gap: number;
        new_gaps: number;
        resolved_gaps: number;
        persistent_gaps: number;
      }
    > = {};

    const newSnapshots: GapSnapshot[] = [];
    const newConsecutiveCounts: Record<string, number> = {};
    const allNewGapReqIds: string[] = [];
    const failedTemplates: Array<{ template: string; error: string }> = [];
    const allPersistentGapReqIds: string[] = [];
    let totalRequirements = 0;

    for (const [templateName, templateVersion] of uniqueTemplates) {
      // Timeout check
      if (Date.now() - startTime > 25_000) {
        console.warn(
          'Content gaps: timeout approaching, stopping template processing',
        );
        break;
      }

      try {
        const requirements = await fetchTemplateRequirements(
          supabase,
          templateName,
          templateVersion ?? undefined,
        );

        if (requirements.length === 0) continue;

        const coverage = computeTemplateCoverage(
          templateName,
          templateVersion,
          requirements[0].template_type,
          requirements,
          contentItems,
        );

        totalRequirements += coverage.total_requirements;

        // Collect current gap requirement IDs
        const currentGapIds: string[] = [];
        for (const section of coverage.sections) {
          for (const req of section.requirements) {
            if (req.coverage_status === 'gap') {
              currentGapIds.push(req.requirement_id);
            }
          }
        }

        // Compare with previous week
        const prevGaps = previousGapSets.get(templateName) ?? new Set<string>();

        const newGaps = currentGapIds.filter((id) => !prevGaps.has(id));
        const resolvedGaps = [...prevGaps].filter(
          (id) => !currentGapIds.includes(id),
        );

        // Track consecutive gap counts
        let persistentCount = 0;
        for (const gapId of currentGapIds) {
          const prevCount = previousConsecutiveCounts[gapId] ?? 0;
          const newCount = prevCount + 1;
          newConsecutiveCounts[gapId] = newCount;
          if (newCount >= PERSISTENT_GAP_WEEKS) {
            persistentCount++;
            allPersistentGapReqIds.push(gapId);
          }
        }

        allNewGapReqIds.push(...newGaps);

        gapsResult[templateName] = {
          total: coverage.total_requirements,
          strong: coverage.strong_count,
          partial: coverage.partial_count,
          gap: coverage.gap_count,
          new_gaps: newGaps.length,
          resolved_gaps: resolvedGaps.length,
          persistent_gaps: persistentCount,
        };

        newSnapshots.push({
          template: templateName,
          version: templateVersion,
          snapshot_date: new Date().toISOString().split('T')[0],
          gaps: currentGapIds,
          coverage_score: coverage.score,
        });
      } catch (err) {
        console.error(`Content gap analysis failed for ${templateName}:`, err);
        failedTemplates.push({
          template: templateName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Create notifications
    const adminAndEditorIds = await getUsersByRole(supabase, [
      'admin',
      'editor',
    ]);
    let notificationsCreated = 0;

    if (adminAndEditorIds.length > 0) {
      // Idempotency: check this week
      const now = new Date();
      const dayOfWeek = now.getUTCDay();
      const weekStart = new Date(now);
      weekStart.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
      weekStart.setUTCHours(0, 0, 0, 0);

      const allReqIds = [...allNewGapReqIds, ...allPersistentGapReqIds];
      const existingIds = await getExistingNotificationIds(
        supabase,
        'content_gap',
        allReqIds,
        weekStart.toISOString(),
      );

      const notifications: Array<{
        userId: string;
        type: 'content_gap';
        entityType: string;
        entityId: string;
        title: string;
        message: string;
      }> = [];

      // New gaps notification (per template)
      for (const [templateName, stats] of Object.entries(gapsResult)) {
        if (stats.new_gaps > 0) {
          const firstNewGap = allNewGapReqIds.find(
            (id) => !existingIds.has(id),
          );
          if (firstNewGap) {
            for (const userId of adminAndEditorIds) {
              notifications.push({
                userId,
                type: 'content_gap',
                entityType: 'template_requirement',
                entityId: firstNewGap,
                title: `${templateName}: ${stats.new_gaps} new content gaps detected`,
                message: `${templateName} has ${stats.new_gaps} requirements with no matching KB content. Use the Coverage page to view all gaps and create content.`,
              });
            }
          }
        }

        // Persistent gaps notification
        if (stats.persistent_gaps > 0) {
          const firstPersistent = allPersistentGapReqIds.find(
            (id) => !existingIds.has(id),
          );
          if (firstPersistent) {
            for (const userId of adminAndEditorIds) {
              notifications.push({
                userId,
                type: 'content_gap',
                entityType: 'template_requirement',
                entityId: firstPersistent,
                title: `${templateName}: ${stats.persistent_gaps} gaps unresolved for ${PERSISTENT_GAP_WEEKS}+ weeks`,
                message: `${stats.persistent_gaps} gaps in ${templateName} have been unresolved for ${PERSISTENT_GAP_WEEKS} weeks. Use the Coverage page to view all gaps and create content.`,
              });
            }
          }
        }
      }

      if (notifications.length > 0) {
        const { error: bulkError } = await createBulkNotifications(
          supabase,
          notifications,
        );
        if (!bulkError) notificationsCreated = notifications.length;
      }
    }

    // Store snapshot in pipeline_runs
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'content_gaps',
      status: failedTemplates.length > 0 ? 'completed_with_errors' : 'completed',
      items_processed: totalRequirements,
      completed_at: new Date().toISOString(),
      result: {
        snapshots: newSnapshots,
        consecutive_gap_counts: newConsecutiveCounts,
        notifications_created: notificationsCreated,
        failed_template_count: failedTemplates.length,
        failed_templates: failedTemplates,
      } as unknown as Json,
    });

    return NextResponse.json({
      success: failedTemplates.length === 0,
      templates_analysed: uniqueTemplates.size,
      total_requirements: totalRequirements,
      gaps: gapsResult,
      notifications_created: notificationsCreated,
      failed_template_count: failedTemplates.length,
      failed_templates: failedTemplates,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Content gaps cron failed') },
      { status: 500 },
    );
  }
}
