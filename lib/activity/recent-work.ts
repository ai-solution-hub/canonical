import type { RecentWorkItem } from '@/types/reorient';

/**
 * Collapse repeated audit rows for the same entity, first-write-wins on the
 * `entity_type:entity_id` key.
 *
 * The caller MUST pre-sort the input newest-first so the surviving row per
 * entity is the newest one (first-write-wins preserves the already-sorted
 * order). Load-bearing — see reorient.test.ts "deduplicates… keeping the
 * newest row".
 */
export function dedupeRecentWorkByEntity(
  items: RecentWorkItem[],
): RecentWorkItem[] {
  const seen = new Set<string>();
  const deduped: RecentWorkItem[] = [];
  for (const item of items) {
    const key = `${item.entity_type}:${item.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}
