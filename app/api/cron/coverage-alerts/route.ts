/**
 * Automation 3: Coverage Alerts
 *
 * Runs weekly (Mondays 05:00 UTC). Analyses taxonomy coverage using
 * the get_coverage_summary RPC, compares against last week's snapshot,
 * and alerts admins on:
 *   - Zero fresh content in a domain (critical gap)
 *   - >20% drop in fresh percentage
 *   - Subtopics with zero content items
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth, getUsersByRole } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  createBulkNotifications,
  getExistingNotificationIds,
} from '@/lib/notifications';
import { safeErrorMessage } from '@/lib/error';
import type { Json } from '@/supabase/types/database.types';

const DEGRADATION_THRESHOLD = 20; // percentage points

interface CoverageSummaryRow {
  domain_name: string;
  domain_colour: string | null;
  total_items: number;
  fresh_pct: number;
  gap_count: number;
  expired_count: number;
}

interface CoverageSnapshot {
  [domainName: string]: {
    total_items: number;
    fresh_pct: number;
    gap_count: number;
    expired_count: number;
  };
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Fetch current coverage via RPC
    const { data: coverageData, error: rpcError } = await supabase.rpc('get_coverage_summary');

    if (rpcError) {
      console.error('get_coverage_summary RPC failed:', rpcError);
      return NextResponse.json(
        { error: safeErrorMessage(rpcError, 'Coverage summary RPC failed') },
        { status: 500 },
      );
    }

    const currentCoverage = (coverageData ?? []) as CoverageSummaryRow[];

    // Build snapshot object
    const currentSnapshot: CoverageSnapshot = {};
    for (const row of currentCoverage) {
      currentSnapshot[row.domain_name] = {
        total_items: Number(row.total_items),
        fresh_pct: Number(row.fresh_pct),
        gap_count: Number(row.gap_count),
        expired_count: Number(row.expired_count),
      };
    }

    // Fetch last week's snapshot from pipeline_runs
    const { data: previousRun } = await supabase
      .from('pipeline_runs')
      .select('result')
      .eq('pipeline_name', 'coverage_alert')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    const previousSnapshot: CoverageSnapshot =
      (previousRun?.result as CoverageSnapshot | null) ?? {};

    // Determine idempotency window (start of current ISO week)
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7)); // Monday
    weekStart.setUTCHours(0, 0, 0, 0);

    // Analyse coverage
    const alerts: {
      entityId: string;
      entityType: string;
      title: string;
      message: string;
    }[] = [];

    let criticalGaps = 0;
    let degradedDomains = 0;
    let emptySubtopics = 0;

    for (const row of currentCoverage) {
      const domain = row.domain_name;
      const freshPct = Number(row.fresh_pct);
      const totalItems = Number(row.total_items);
      const gapCount = Number(row.gap_count);
      const expiredCount = Number(row.expired_count);
      const prev = previousSnapshot[domain];

      // Critical: zero fresh content
      if (totalItems > 0 && freshPct === 0) {
        criticalGaps++;
        alerts.push({
          entityId: '00000000-0000-0000-0000-000000000000', // Domain-level, no single item
          entityType: 'domain',
          title: `Critical: No fresh content in ${domain}`,
          message: `Weekly coverage analysis for ${now.toLocaleDateString('en-GB')}. ${domain} has 0 fresh items out of ${totalItems} total (${expiredCount} expired). All content needs updating.`,
        });
      }

      // Degradation: >20% drop in fresh percentage
      if (prev && prev.fresh_pct > 0) {
        const drop = prev.fresh_pct - freshPct;
        if (drop > DEGRADATION_THRESHOLD) {
          degradedDomains++;
          alerts.push({
            entityId: '00000000-0000-0000-0000-000000000000',
            entityType: 'domain',
            title: `${domain} coverage degraded — ${prev.fresh_pct}% to ${freshPct}% fresh`,
            message: `Weekly coverage analysis for ${now.toLocaleDateString('en-GB')}. ${domain} fresh content dropped from ${prev.fresh_pct}% to ${freshPct}% (${totalItems} total items, ${expiredCount} expired).`,
          });
        }
      }

      // Empty subtopics
      if (gapCount > 0) {
        emptySubtopics += gapCount;
      }
    }

    // Fetch admin recipients
    const adminIds = await getUsersByRole(supabase, ['admin']);
    let notificationsCreated = 0;

    if (alerts.length > 0 && adminIds.length > 0) {
      // Idempotency check
      const alertEntityIds = alerts.map((a) => a.entityId);
      const existingIds = await getExistingNotificationIds(
        supabase,
        'coverage_alert',
        alertEntityIds,
        weekStart.toISOString(),
      );

      // For domain-level alerts we use a synthetic UUID, so also check existing
      // notification titles within this week's window to avoid duplicates
      const existingTitles = new Set<string>();
      if (alerts.some((a) => a.entityType === 'domain')) {
        const { data: existingDomainAlerts } = await supabase
          .from('notifications')
          .select('title')
          .eq('type', 'coverage_alert')
          .gte('created_at', weekStart.toISOString());
        for (const row of existingDomainAlerts ?? []) {
          existingTitles.add(row.title);
        }
      }

      const newAlerts = Object.keys(previousSnapshot).length === 0
        ? alerts // First run — no previous snapshot, create all
        : alerts.filter((a) => {
            if (a.entityType === 'domain') {
              return !existingTitles.has(a.title);
            }
            return !existingIds.has(a.entityId);
          });

      if (newAlerts.length > 0) {
        const notifications = newAlerts.flatMap((alert) =>
          adminIds.map((userId) => ({
            userId,
            type: 'coverage_alert' as const,
            entityType: alert.entityType,
            entityId: alert.entityId,
            title: alert.title,
            message: alert.message,
          })),
        );

        const { error: bulkError } = await createBulkNotifications(supabase, notifications);
        if (!bulkError) notificationsCreated = notifications.length;
      }
    }

    // Store snapshot in pipeline_runs for next week's comparison
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'coverage_alert',
      status: 'completed',
      items_processed: currentCoverage.length,
      items_created: notificationsCreated,
      completed_at: new Date().toISOString(),
      result: currentSnapshot as unknown as Json,
    });

    return NextResponse.json({
      domains_analysed: currentCoverage.length,
      critical_gaps: criticalGaps,
      degraded_domains: degradedDomains,
      empty_subtopics: emptySubtopics,
      notifications_created: notificationsCreated,
      snapshot_stored: true,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Coverage alerts cron failed') },
      { status: 500 },
    );
  }
}
