/**
 * Notification creation helpers for cron-generated alerts.
 *
 * All background automations funnel through these helpers to create
 * notifications with 7-day expiry and idempotency checks.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

export type NotificationType =
  | 'governance_review_needed'
  | 'governance_approve'
  | 'governance_request_changes'
  | 'governance_revert'
  | 'quality_flag'
  | 'digest_ready'
  | 'freshness_transition'
  | 'coverage_alert'
  | 'content_gap'
  | 'owner_content_stale'
  | 'owner_content_updated'
  | 'owner_assignment'
  | 'source_document_updated'
  | 'date_expiry_approaching'
  | 'review_overdue';

export interface CreateNotificationParams {
  supabase: SupabaseClient<Database>;
  userId: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  title: string;
  message?: string;
  expiresAt?: string;
}

/**
 * Create a single notification row.
 * Defaults to 7-day expiry for cron-generated notifications.
 */
export async function createNotification(params: CreateNotificationParams) {
  const {
    supabase,
    userId,
    type,
    entityType,
    entityId,
    title,
    message,
    expiresAt,
  } = params;

  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    type,
    entity_type: entityType,
    entity_id: entityId,
    title,
    message: message ?? null,
    expires_at:
      expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (error) {
    console.error(`Failed to create notification (${type}):`, error);
  }

  return { error };
}

/**
 * Insert multiple notification rows in a single batch.
 * Returns the count of rows inserted.
 */
export async function createBulkNotifications(
  supabase: SupabaseClient<Database>,
  notifications: Omit<CreateNotificationParams, 'supabase'>[],
) {
  if (notifications.length === 0) return { count: 0, error: null };

  const rows = notifications.map((n) => ({
    user_id: n.userId,
    type: n.type,
    entity_type: n.entityType,
    entity_id: n.entityId,
    title: n.title,
    message: n.message ?? null,
    expires_at:
      n.expiresAt ??
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }));

  const { data, error } = await supabase
    .from('notifications')
    .insert(rows)
    .select('id');

  return { count: error ? 0 : (data?.length ?? rows.length), error };
}

/**
 * Check which entity IDs already have a notification of the given type
 * created since `since` (ISO string). Used for idempotency.
 *
 * @returns Set of entity_id strings that already have notifications.
 */
export async function getExistingNotificationIds(
  supabase: SupabaseClient<Database>,
  type: NotificationType,
  entityIds: string[],
  since: string,
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('notifications')
    .select('entity_id')
    .eq('type', type)
    .gte('created_at', since)
    .in('entity_id', entityIds);

  if (error) {
    console.error(`Failed to check existing notifications (${type}):`, error);
    return new Set();
  }

  return new Set((data ?? []).map((r) => r.entity_id));
}
