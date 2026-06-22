import type { TeamChange, RecentWorkItem } from '@/types/reorient';

/**
 * Map a content_history `change_type` to a TeamChange/RecentWorkItem action.
 *
 * Shared by `fetchUnifiedDashboardData` (lib/dashboard.ts) and
 * `fetchReorientData` (lib/reorient.ts) — both previously inlined an identical
 * private copy. A single shared helper guarantees the two paths cannot drift.
 */
export function mapChangeTypeToAction(
  changeType: string,
): TeamChange['action'] | RecentWorkItem['action'] {
  switch (changeType) {
    case 'create':
    case 'import':
      return 'created';
    case 'edit':
    case 'ai_update':
    case 'merge':
      return 'updated';
    case 'rollback':
      return 'reviewed';
    default:
      return 'updated';
  }
}
