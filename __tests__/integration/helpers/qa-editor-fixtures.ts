/**
 * Shared fixtures for Q&A editor (§1.5) integration tests.
 *
 * Provides:
 *   - `seedQaPairItem()` — INSERT a `q_a_pair` content item directly via
 *     the service client (bypasses the auth + dedup boilerplate of POST
 *     /api/items, which the AC4b test exercises explicitly).
 *   - `cleanupItem()` — best-effort FK-safe teardown for items + their
 *     content_chunks + content_history rows.
 *
 * Spec: docs/specs/qa-contenteditor-upgrade-spec.md §4.1 (canonical
 * `Q: {question}\n\n{standard}\n\n{advanced}` shape).
 */

import type { Database } from '@/supabase/types/database.types';
import { serviceClient } from './service-client';

type ContentItemInsert =
  Database['public']['Tables']['content_items']['Insert'];

export interface SeedQaPairOptions {
  /** Title (also returned via `currentItem.title` in the PATCH path). */
  title: string;
  /** Pre-built `content_items.content` value (canonical Q-prefix shape). */
  content: string;
  /** Standard answer body (canonical markdown). */
  answer_standard: string;
  /** Advanced answer body (optional — pass `null` to leave unset). */
  answer_advanced?: string | null;
  /** Author/owner UUID — usually a seeded test user. */
  created_by: string;
  /** Optional priority override (default: 'medium'). */
  priority?: 'high' | 'medium' | 'low';
}

export interface SeedQaPairResult {
  id: string;
  title: string;
  content: string;
  answer_standard: string | null;
  answer_advanced: string | null;
  priority: string | null;
}

/**
 * Insert a q_a_pair content item via the service-role client. Throws on
 * insert error so the calling test fails fast (rather than relying on a
 * silent `data: null` returned through an unchecked error).
 *
 * IMPORTANT (CLAUDE.md): `content_items.content_text_hash` is
 * GENERATED ALWAYS — do not include it in the insert payload.
 */
export async function seedQaPairItem(
  options: SeedQaPairOptions,
): Promise<SeedQaPairResult> {
  const insertPayload: ContentItemInsert = {
    title: options.title,
    content: options.content,
    answer_standard: options.answer_standard,
    answer_advanced: options.answer_advanced ?? null,
    content_type: 'q_a_pair',
    platform: 'manual',
    created_by: options.created_by,
    priority: options.priority ?? 'medium',
  };

  const { data, error } = await serviceClient
    .from('content_items')
    .insert(insertPayload)
    .select('id, title, content, answer_standard, answer_advanced, priority')
    .single();

  if (error || !data) {
    throw new Error(
      `seedQaPairItem failed: ${error?.message ?? 'no data returned'}`,
    );
  }
  return data as SeedQaPairResult;
}

/**
 * Best-effort teardown: deletes `content_chunks`, `content_history`,
 * `entity_mentions`, and the `content_items` row itself. Safe to call
 * even when only some children exist. Errors are swallowed (logged) so
 * `afterAll` continues with the remaining items.
 */
export async function cleanupItem(itemId: string | null): Promise<void> {
  if (!itemId) return;
  try {
    await serviceClient
      .from('content_chunks')
      .delete()
      .eq('content_item_id', itemId);
    await serviceClient
      .from('content_history')
      .delete()
      .eq('content_item_id', itemId);
    await serviceClient
      .from('entity_mentions')
      .delete()
      .eq('content_item_id', itemId);
    await serviceClient.from('content_items').delete().eq('id', itemId);
  } catch (err) {
    // Surface for triage but don't re-throw — cleanup runs best-effort
    // so a single failure does not leak across the rest of the suite.
    console.warn(
      `[qa-editor-fixtures] cleanupItem(${itemId}) failed:`,
      (err as Error)?.message ?? err,
    );
  }
}
