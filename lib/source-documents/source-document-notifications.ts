/**
 * Notification helpers for source document updates.
 *
 * When a source document is re-uploaded and the diff engine detects changes
 * that affect existing KB items, this module sends notifications to the
 * content owners of those items (or admins as a fallback).
 *
 * Phase 4.6 of Content Lifecycle spec.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { ImpactAnalysis } from './source-document-impact';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

/**
 * Send notifications to content owners when their items are affected
 * by a source document update.
 *
 * - Groups affected items by owner to avoid notification spam.
 * - One notification per owner summarising how many items may need review.
 * - Falls back to admin notifications if no specific owners are found.
 */
export async function sendSourceDocumentUpdateNotifications(
  supabase: SupabaseClient<Database>,
  impact: ImpactAnalysis,
  newDocumentId: string,
): Promise<void> {
  const { createNotification } = await import('@/lib/notifications');

  // Get content owners for affected items. ID-131 {131.17} G-IMS-DELETE
  // KEEP-list: `impact.items[].content_item_id` is now a q_a_pairs id (see
  // source-document-impact.ts's module header — q_a_pairs is the re-point
  // target, not source_documents, since this concern needs a
  // `source_document_id`-filterable typed record). `content_owner_id` has no
  // q_a_pairs column — it lives on the `record_lifecycle` governance facet
  // (owner_kind='q_a_pair', owner_id), matching the established
  // bulk_assign_content_owner re-point precedent (ID-131.13 G-GOV-FACET-B).
  const itemIds = impact.items.map((i) => i.content_item_id);
  if (itemIds.length === 0) return;

  const itemsResult = await tryQuery(
    supabase
      .from('record_lifecycle')
      .select('owner_id, content_owner_id')
      .eq('owner_kind', 'q_a_pair')
      .in('owner_id', itemIds),
    'source-docs.notifications.fetchItems',
  );
  if (!itemsResult.ok) {
    logBestEffortWarn('source-docs.notifications.fanout', 'skipped on error', {
      err: itemsResult.error.message,
      code: itemsResult.error.code,
    });
    return;
  }
  const items = itemsResult.data;

  // Group by owner
  const ownerItems = new Map<string, string[]>();
  for (const item of items ?? []) {
    const ownerId = item.content_owner_id;
    if (!ownerId || !item.owner_id) continue;
    if (!ownerItems.has(ownerId)) ownerItems.set(ownerId, []);
    ownerItems.get(ownerId)!.push(item.owner_id);
  }

  // Send one notification per owner
  for (const [ownerId, affectedIds] of ownerItems) {
    const count = affectedIds.length;
    await createNotification({
      supabase,
      userId: ownerId,
      type: 'source_document_updated',
      entityType: 'source_document',
      entityId: newDocumentId,
      title: 'Source document updated \u2014 diff available',
      message: `${impact.document_filename} was updated. ${count} of your KB ${count === 1 ? 'item' : 'items'} may need reviewing. Click to review changes.`,
    });
  }

  // Also notify admins if no specific owners were found
  if (ownerItems.size === 0 && impact.total_affected_items > 0) {
    const adminsResult = await tryQuery(
      supabase.from('user_roles').select('user_id').eq('role', 'admin'),
      'source-docs.notifications.fetchAdmins',
    );
    if (!adminsResult.ok) {
      logBestEffortWarn(
        'source-docs.notifications.fanout',
        'skipped on error',
        { err: adminsResult.error.message, code: adminsResult.error.code },
      );
      return;
    }
    const admins = adminsResult.data;

    for (const admin of admins ?? []) {
      await createNotification({
        supabase,
        userId: admin.user_id,
        type: 'source_document_updated',
        entityType: 'source_document',
        entityId: newDocumentId,
        title: 'Source document updated \u2014 diff available',
        message: `${impact.document_filename} was updated. ${impact.total_affected_items} KB ${impact.total_affected_items === 1 ? 'item' : 'items'} may need reviewing. Click to review changes.`,
      });
    }
  }
}
