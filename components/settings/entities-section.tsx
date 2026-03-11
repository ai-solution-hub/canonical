'use client';

import { EntityList } from '@/components/entity-management/entity-list';

/**
 * Entity management section for the Settings page.
 * Admin-only — renders the full EntityList with merge/split/type-override.
 */
export function EntitiesSection() {
  return <EntityList />;
}
