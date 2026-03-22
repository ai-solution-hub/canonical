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

export const maxDuration = 30;

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
  content_owner_id: string | null;
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
      .select('id, title, previous_freshness, freshness, primary_domain, updated_at, lifecycle_type, content_owner_id')
      .not('previous_freshness', 'is', null)
      .neq('freshness', 'fresh'); // Skip transitions TO fresh (positive = silent)
    // Note: PostgREST cannot compare two columns directly, so we filter
    // previous_freshness !== freshness in-app below (line ~93).

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
      // Still check date-based expiry reminders even when no freshness transitions
      const expiryNotificationsCreated = await checkDateExpiryReminders(supabase);

      // Clean up old notifications even when no transitions
      await cleanupExpiredNotifications(supabase);

      return NextResponse.json({
        transitions: counts,
        notifications_created: expiryNotificationsCreated,
        expiry_reminders_created: expiryNotificationsCreated,
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
    // Check both freshness_transition and owner_content_stale types
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [existingFreshnessIds, existingOwnerIds] = await Promise.all([
      getExistingNotificationIds(
        supabase,
        'freshness_transition',
        changed.map((item) => item.id),
        todayStart.toISOString(),
      ),
      getExistingNotificationIds(
        supabase,
        'owner_content_stale',
        changed.map((item) => item.id),
        todayStart.toISOString(),
      ),
    ]);

    // Merge both sets for dedup
    const existingIds = new Set([...existingFreshnessIds, ...existingOwnerIds]);

    const newTransitions = changed.filter((item) => !existingIds.has(item.id));

    if (newTransitions.length === 0) {
      await cleanupExpiredNotifications(supabase);
      return NextResponse.json({
        transitions: counts,
        notifications_created: 0,
        executed_at: new Date().toISOString(),
      });
    }

    // Split into owned and unowned items
    const ownedTransitions = newTransitions.filter((item) => item.content_owner_id);
    const unownedTransitions = newTransitions.filter((item) => !item.content_owner_id);

    // For unowned items, notify all admins + editors (existing behaviour)
    // For owned items, notify the owner with owner_content_stale + admins with freshness_transition
    const adminIds = await getUsersByRole(supabase, ['admin']);

    let notificationsCreated = 0;

    // --- Owned items: targeted owner_content_stale + admin freshness_transition ---
    if (ownedTransitions.length > 0) {
      const ownerNotifications: Array<Omit<import('@/lib/notifications').CreateNotificationParams, 'supabase'>> = [];

      if (ownedTransitions.length > BATCH_THRESHOLD) {
        // Summary notifications for owners (grouped by owner)
        const ownerGroups = new Map<string, TransitionItem[]>();
        for (const item of ownedTransitions) {
          const ownerId = item.content_owner_id!;
          if (!ownerGroups.has(ownerId)) ownerGroups.set(ownerId, []);
          ownerGroups.get(ownerId)!.push(item);
        }

        for (const [ownerId, items] of ownerGroups) {
          const agingCount = items.filter((i) => i.freshness === 'aging').length;
          const staleCount = items.filter((i) => i.freshness === 'stale').length;
          const expiredCount = items.filter((i) => i.freshness === 'expired').length;
          const summaryTitle = `${items.length} of your owned items changed freshness status`;
          const summaryMessage = `${items.length} items you own changed freshness status: ${agingCount} ageing, ${staleCount} stale, ${expiredCount} expired. Review the freshness report for details.`;

          ownerNotifications.push({
            userId: ownerId,
            type: 'owner_content_stale' as const,
            entityType: 'content_item',
            entityId: items[0].id,
            title: summaryTitle,
            message: summaryMessage,
          });
        }

        // Summary for admins
        const agingCount = ownedTransitions.filter((i) => i.freshness === 'aging').length;
        const staleCount = ownedTransitions.filter((i) => i.freshness === 'stale').length;
        const expiredCount = ownedTransitions.filter((i) => i.freshness === 'expired').length;
        const adminSummaryTitle = `${ownedTransitions.length} owned items changed freshness status`;
        const adminSummaryMessage = `${ownedTransitions.length} owned items changed freshness status: ${agingCount} ageing, ${staleCount} stale, ${expiredCount} expired. Owners have been notified.`;

        for (const adminId of adminIds) {
          ownerNotifications.push({
            userId: adminId,
            type: 'freshness_transition' as const,
            entityType: 'content_item',
            entityId: ownedTransitions[0].id,
            title: adminSummaryTitle,
            message: adminSummaryMessage,
          });
        }
      } else {
        // Individual notifications for each owned item
        for (const item of ownedTransitions) {
          // Notify the owner
          ownerNotifications.push({
            userId: item.content_owner_id!,
            type: 'owner_content_stale' as const,
            entityType: 'content_item',
            entityId: item.id,
            title: transitionTitle(item.title, item.previous_freshness, item.freshness),
            message: transitionMessage(
              item.title, item.primary_domain, item.previous_freshness,
              item.freshness, item.updated_at, item.lifecycle_type,
            ),
          });

          // Notify admins only (not all editors)
          for (const adminId of adminIds) {
            ownerNotifications.push({
              userId: adminId,
              type: 'freshness_transition' as const,
              entityType: 'content_item',
              entityId: item.id,
              title: transitionTitle(item.title, item.previous_freshness, item.freshness),
              message: transitionMessage(
                item.title, item.primary_domain, item.previous_freshness,
                item.freshness, item.updated_at, item.lifecycle_type,
              ),
            });
          }
        }
      }

      if (ownerNotifications.length > 0) {
        const { error: bulkError } = await createBulkNotifications(supabase, ownerNotifications);
        if (!bulkError) notificationsCreated += ownerNotifications.length;
      }
    }

    // --- Unowned items: broadcast to all admins + editors (existing behaviour) ---
    if (unownedTransitions.length > 0) {
      if (unownedTransitions.length > BATCH_THRESHOLD) {
        // Summary notification
        const agingCount = unownedTransitions.filter((i) => i.freshness === 'aging').length;
        const staleCount = unownedTransitions.filter((i) => i.freshness === 'stale').length;
        const expiredCount = unownedTransitions.filter((i) => i.freshness === 'expired').length;

        const summaryTitle = `${unownedTransitions.length} items changed freshness status`;
        const summaryMessage = `${unownedTransitions.length} items changed freshness status: ${agingCount} ageing, ${staleCount} stale, ${expiredCount} expired. Review the freshness report for details.`;

        const notifications = userIds.map((userId) => ({
          userId,
          type: 'freshness_transition' as const,
          entityType: 'content_item',
          entityId: unownedTransitions[0].id,
          title: summaryTitle,
          message: summaryMessage,
        }));

        const { error: bulkError } = await createBulkNotifications(supabase, notifications);
        if (!bulkError) notificationsCreated += notifications.length;
      } else {
        // Individual notifications
        const notifications = unownedTransitions.flatMap((item) =>
          userIds.map((userId) => ({
            userId,
            type: 'freshness_transition' as const,
            entityType: 'content_item',
            entityId: item.id,
            title: transitionTitle(item.title, item.previous_freshness, item.freshness),
            message: transitionMessage(
              item.title, item.primary_domain, item.previous_freshness,
              item.freshness, item.updated_at, item.lifecycle_type,
            ),
          })),
        );

        const { error: bulkError } = await createBulkNotifications(supabase, notifications);
        if (!bulkError) notificationsCreated += notifications.length;
      }
    }

    // Log to pipeline_runs
    await supabase.from('pipeline_runs').insert({
      pipeline_name: 'freshness_transitions',
      status: 'completed',
      items_processed: changed.length,
      completed_at: new Date().toISOString(),
      result: { transitions: counts, new_transitions: newTransitions.length, notifications_created: notificationsCreated } as unknown as Json,
    });

    // ── Date-based expiry reminders ──────────────────────────────────────────
    // After freshness transitions, check for items and entities approaching
    // their expiry_date within the next 30 days. Sends date_expiry_approaching
    // notifications with idempotency (one per item/entity per day).
    const expiryNotificationsCreated = await checkDateExpiryReminders(supabase);
    notificationsCreated += expiryNotificationsCreated;

    // Clean up expired+dismissed notifications (§10b.7)
    await cleanupExpiredNotifications(supabase);

    return NextResponse.json({
      transitions: counts,
      notifications_created: notificationsCreated,
      expiry_reminders_created: expiryNotificationsCreated,
      executed_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Freshness transition cron failed') },
      { status: 500 },
    );
  }
}

/**
 * Check for content items and entity mentions with expiry dates within
 * the next 30 days. Creates date_expiry_approaching notifications with
 * idempotency (one per item/entity per day).
 *
 * Returns the number of notifications created.
 */
async function checkDateExpiryReminders(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<number> {
  let notificationsCreated = 0;

  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // ── 1. Content items with expiry_date within 30 days ──────────────────
    const { data: expiringItems, error: expiringError } = await supabase
      .from('content_items')
      .select('id, title, expiry_date, content_owner_id, primary_domain')
      .not('expiry_date', 'is', null)
      .lte('expiry_date', thirtyDaysFromNow.toISOString())
      .is('archived_at', null);

    if (expiringError) {
      console.error('Failed to query expiring content items:', expiringError);
      return 0;
    }

    // Filter to items whose expiry_date is in the future or today
    // (items already past their date should still get a notification)
    const qualifying = (expiringItems ?? []).filter((item) => {
      if (!item.expiry_date) return false;
      return true;
    });

    if (qualifying.length > 0) {
      // Idempotency: check for existing date_expiry_approaching notifications today
      const existingExpiryIds = await getExistingNotificationIds(
        supabase,
        'date_expiry_approaching',
        qualifying.map((item) => item.id),
        todayStart.toISOString(),
      );

      const newExpiring = qualifying.filter((item) => !existingExpiryIds.has(item.id));

      if (newExpiring.length > 0) {
        // Fetch admins for fallback recipients
        const adminIds = await getUsersByRole(supabase, ['admin']);

        const expiryNotifications: Array<Omit<import('@/lib/notifications').CreateNotificationParams, 'supabase'>> = [];

        for (const item of newExpiring) {
          const expiryDateObj = new Date(item.expiry_date!);
          const daysRemaining = Math.ceil(
            (expiryDateObj.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
          );
          const formattedDate = expiryDateObj.toLocaleDateString('en-GB');
          const daysText = daysRemaining <= 0
            ? 'has expired'
            : daysRemaining === 1
              ? '1 day remaining'
              : `${daysRemaining} days remaining`;

          const notifTitle = `"${item.title}" expires on ${formattedDate}`;
          const notifMessage = `Content item "${item.title}" has an expiry date of ${formattedDate} (${daysText}). Review and update if needed.`;

          if (item.content_owner_id) {
            // Notify owner
            expiryNotifications.push({
              userId: item.content_owner_id,
              type: 'date_expiry_approaching' as const,
              entityType: 'content_item',
              entityId: item.id,
              title: notifTitle,
              message: notifMessage,
            });
          } else {
            // Notify all admins
            for (const adminId of adminIds) {
              expiryNotifications.push({
                userId: adminId,
                type: 'date_expiry_approaching' as const,
                entityType: 'content_item',
                entityId: item.id,
                title: notifTitle,
                message: notifMessage,
              });
            }
          }
        }

        if (expiryNotifications.length > 0) {
          const { error: bulkError } = await createBulkNotifications(
            supabase,
            expiryNotifications,
          );
          if (!bulkError) notificationsCreated += expiryNotifications.length;
        }
      }
    }

    // ── 2. Entity mentions with metadata expiry_date within 30 days ───────
    // Query entity_mentions where metadata->>'expiry_date' is within 30 days
    const { data: expiringEntities, error: entityError } = await supabase
      .from('entity_mentions')
      .select('id, canonical_name, entity_type, metadata')
      .not('metadata', 'is', null);

    if (entityError) {
      console.error('Failed to query entity mentions for expiry:', entityError);
      return notificationsCreated;
    }

    // Filter to entities with expiry_date in metadata within 30 days
    interface EntityWithExpiry {
      id: string;
      canonical_name: string;
      entity_type: string;
      expiry_date: Date;
    }

    const entitiesWithExpiry: EntityWithExpiry[] = [];
    for (const entity of expiringEntities ?? []) {
      const meta = entity.metadata as Record<string, unknown> | null;
      if (!meta?.expiry_date) continue;

      const expiryDate = new Date(meta.expiry_date as string);
      if (isNaN(expiryDate.getTime())) continue;

      // Within 30 days from now (future or past)
      if (expiryDate <= thirtyDaysFromNow) {
        entitiesWithExpiry.push({
          id: entity.id,
          canonical_name: entity.canonical_name,
          entity_type: entity.entity_type,
          expiry_date: expiryDate,
        });
      }
    }

    if (entitiesWithExpiry.length > 0) {
      // Deduplicate by canonical_name — one notification per entity, not per mention
      // For each canonical_name, select the mention with the nearest expiry date
      const entityMap = new Map<string, EntityWithExpiry>();
      for (const entity of entitiesWithExpiry) {
        const existing = entityMap.get(entity.canonical_name);
        if (!existing || entity.expiry_date < existing.expiry_date) {
          entityMap.set(entity.canonical_name, entity);
        }
      }

      const uniqueEntities = Array.from(entityMap.values());

      // Idempotency: check for existing notifications today
      const existingEntityIds = await getExistingNotificationIds(
        supabase,
        'date_expiry_approaching',
        uniqueEntities.map((e) => e.id),
        todayStart.toISOString(),
      );

      const newEntityExpiring = uniqueEntities.filter(
        (e) => !existingEntityIds.has(e.id),
      );

      if (newEntityExpiring.length > 0) {
        const adminIds = await getUsersByRole(supabase, ['admin']);
        const entityNotifications: Array<Omit<import('@/lib/notifications').CreateNotificationParams, 'supabase'>> = [];

        for (const entity of newEntityExpiring) {
          const daysRemaining = Math.ceil(
            (entity.expiry_date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
          );
          const formattedDate = entity.expiry_date.toLocaleDateString('en-GB');
          const daysText = daysRemaining <= 0
            ? 'has expired'
            : daysRemaining === 1
              ? '1 day remaining'
              : `${daysRemaining} days remaining`;

          const notifTitle = `"${entity.canonical_name}" expires on ${formattedDate}`;
          const notifMessage = `The ${entity.entity_type} "${entity.canonical_name}" has an expiry date of ${formattedDate} (${daysText}). Consider uploading the renewed document.`;

          for (const adminId of adminIds) {
            entityNotifications.push({
              userId: adminId,
              type: 'date_expiry_approaching' as const,
              entityType: 'entity_mention',
              entityId: entity.id,
              title: notifTitle,
              message: notifMessage,
            });
          }
        }

        if (entityNotifications.length > 0) {
          const { error: bulkError } = await createBulkNotifications(
            supabase,
            entityNotifications,
          );
          if (!bulkError) notificationsCreated += entityNotifications.length;
        }
      }
    }
  } catch (err) {
    console.error('Date expiry reminder check failed:', err);
  }

  return notificationsCreated;
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
