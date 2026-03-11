/**
 * Automation 1: Freshness Transition Notifications
 *
 * Runs daily at 03:15 UTC (15 min after pg_cron freshness recalculation).
 * Detects items whose freshness changed and notifies admins + editors.
 * If >10 items transitioned, creates a summary notification instead.
 *
 * Also cleans up expired+dismissed notifications older than 30 days
 * (spec §10b.7).
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

const BATCH_THRESHOLD = 10;

type FreshnessState = 'fresh' | 'aging' | 'stale' | 'expired';

interface TransitionItem {
  id: string;
  title: string;
  previous_freshness: FreshnessState;
  freshness: FreshnessState;
  primary_domain: string | null;
  updated_at: string | null;
  lifecycle_type: string | null;
}

function transitionTitle(title: string, from: FreshnessState, to: FreshnessState): string {
  switch (to) {
    case 'aging':
      return `"${title}" is ageing — review recommended`;
    case 'stale':
      return `"${title}" is now stale — update needed`;
    case 'expired':
      return `"${title}" has expired — requires attention`;
    default:
      return `"${title}" freshness changed to ${to}`;
  }
}

function transitionMessage(
  title: string,
  domain: string | null,
  from: FreshnessState,
  to: FreshnessState,
  updatedAt: string | null,
  lifecycleType: string | null,
): string {
  const domainStr = domain ?? 'unclassified';
  const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString('en-GB') : 'unknown';
  const lcStr = lifecycleType ?? 'unspecified';
  return `Content item "${title}" in ${domainStr} transitioned from ${from} to ${to}. Last updated: ${dateStr}. Lifecycle type: ${lcStr}.`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Find items where freshness changed (skip positive transitions to fresh)
    const { data: transitions, error: queryError } = await supabase
      .from('content_items')
      .select('id, title, previous_freshness, freshness, primary_domain, updated_at, lifecycle_type')
      .not('previous_freshness', 'is', null)
      .neq('freshness', 'fresh') // Skip transitions TO fresh (positive = silent)
      .filter('previous_freshness', 'neq', 'freshness' as never);

    if (queryError) {
      console.error('Failed to query freshness transitions:', queryError);
      return NextResponse.json(
        { error: safeErrorMessage(queryError, 'Failed to query transitions') },
        { status: 500 },
      );
    }

    // Filter in-app: Supabase REST can't compare two columns directly
    const changed = (transitions ?? []).filter(
      (item) => item.freshness !== item.previous_freshness,
    ) as TransitionItem[];

    // Count by transition type
    const counts = {
      fresh_to_aging: 0,
      aging_to_stale: 0,
      stale_to_expired: 0,
      other: 0,
    };

    for (const item of changed) {
      const key = `${item.previous_freshness}_to_${item.freshness}`;
      if (key === 'fresh_to_aging') counts.fresh_to_aging++;
      else if (key === 'aging_to_stale') counts.aging_to_stale++;
      else if (key === 'stale_to_expired') counts.stale_to_expired++;
      else counts.other++;
    }

    if (changed.length === 0) {
      // Clean up old notifications even when no transitions
      await cleanupExpiredNotifications(supabase);

      return NextResponse.json({
        transitions: counts,
        notifications_created: 0,
        executed_at: new Date().toISOString(),
      });
    }

    // Fetch recipients: admins + editors
    const userIds = await getUsersByRole(supabase, ['admin', 'editor']);
    if (userIds.length === 0) {
      console.warn('No admin/editor users found for freshness notifications');
      return NextResponse.json({
        transitions: counts,
        notifications_created: 0,
        executed_at: new Date().toISOString(),
      });
    }

    // Idempotency: check for existing notifications created today
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const existingIds = await getExistingNotificationIds(
      supabase,
      'freshness_transition',
      changed.map((item) => item.id),
      todayStart.toISOString(),
    );

    const newTransitions = changed.filter((item) => !existingIds.has(item.id));

    if (newTransitions.length === 0) {
      await cleanupExpiredNotifications(supabase);
      return NextResponse.json({
        transitions: counts,
        notifications_created: 0,
        executed_at: new Date().toISOString(),
      });
    }

    let notificationsCreated = 0;

    if (newTransitions.length > BATCH_THRESHOLD) {
      // Summary notification
      const agingCount = newTransitions.filter((i) => i.freshness === 'aging').length;
      const staleCount = newTransitions.filter((i) => i.freshness === 'stale').length;
      const expiredCount = newTransitions.filter((i) => i.freshness === 'expired').length;

      const summaryTitle = `${newTransitions.length} items changed freshness status`;
      const summaryMessage = `${newTransitions.length} items changed freshness status: ${agingCount} ageing, ${staleCount} stale, ${expiredCount} expired. Review the freshness report for details.`;

      const notifications = userIds.map((userId) => ({
        userId,
        type: 'freshness_transition' as const,
        entityType: 'content_item',
        entityId: newTransitions[0].id, // Representative item
        title: summaryTitle,
        message: summaryMessage,
      }));

      const { error: bulkError } = await createBulkNotifications(supabase, notifications);
      if (!bulkError) notificationsCreated = notifications.length;
    } else {
      // Individual notifications
      const notifications = newTransitions.flatMap((item) =>
        userIds.map((userId) => ({
          userId,
          type: 'freshness_transition' as const,
          entityType: 'content_item',
          entityId: item.id,
          title: transitionTitle(item.title, item.previous_freshness, item.freshness),
          message: transitionMessage(
            item.title,
            item.primary_domain,
            item.previous_freshness,
            item.freshness,
            item.updated_at,
            item.lifecycle_type,
          ),
        })),
      );

      const { error: bulkError } = await createBulkNotifications(supabase, notifications);
      if (!bulkError) notificationsCreated = notifications.length;
    }

    // Log to pipeline_runs
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'freshness_transitions',
      status: 'completed',
      items_processed: changed.length,
      items_created: notificationsCreated,
      completed_at: new Date().toISOString(),
      result: { transitions: counts, new_transitions: newTransitions.length } as unknown as Json,
    });

    // Clean up expired+dismissed notifications (§10b.7)
    await cleanupExpiredNotifications(supabase);

    return NextResponse.json({
      transitions: counts,
      notifications_created: notificationsCreated,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Freshness transition cron failed') },
      { status: 500 },
    );
  }
}

async function cleanupExpiredNotifications(supabase: ReturnType<typeof createServiceClient>) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('notifications')
      .delete()
      .lt('expires_at', thirtyDaysAgo)
      .not('dismissed_at', 'is', null);
  } catch (err) {
    console.error('Failed to clean up expired notifications:', err);
  }
}
