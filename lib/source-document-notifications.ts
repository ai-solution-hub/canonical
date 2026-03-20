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

  // Get content owners for affected items
  const itemIds = impact.items.map((i) => i.content_item_id);
  if (itemIds.length === 0) return;

  const { data: items } = await supabase
    .from('content_items')
    .select('id, content_owner_id')
    .in('id', itemIds);

  // Group by owner
  const ownerItems = new Map<string, string[]>();
  for (const item of items ?? []) {
    const ownerId = item.content_owner_id;
    if (!ownerId) continue;
    if (!ownerItems.has(ownerId)) ownerItems.set(ownerId, []);
    ownerItems.get(ownerId)!.push(item.id);
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
      title: 'Source document updated',
      message: `${impact.document_filename} was updated. ${count} of your KB ${count === 1 ? 'item' : 'items'} may need reviewing.`,
    });
  }

  // Also notify admins if no specific owners were found
  if (ownerItems.size === 0 && impact.total_affected_items > 0) {
    const { data: admins } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    for (const admin of admins ?? []) {
      await createNotification({
        supabase,
        userId: admin.user_id,
        type: 'source_document_updated',
        entityType: 'source_document',
        entityId: newDocumentId,
        title: 'Source document updated',
        message: `${impact.document_filename} was updated. ${impact.total_affected_items} KB ${impact.total_affected_items === 1 ? 'item' : 'items'} may need reviewing.`,
      });
    }
  }
}
