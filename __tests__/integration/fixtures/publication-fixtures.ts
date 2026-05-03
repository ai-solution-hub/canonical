/**
 * WP-CI.RES.7 §4.4 — Publication-status fixture helpers.
 *
 * The publication_status distribution (20 published + 5 archived + 2 draft)
 * is built into content-fixtures.ts. This module exports constants and
 * query helpers for tests that assert publication-status invariants
 * against fixture data.
 *
 * Spec: wp-ci-res7-staging-data-strategy-spec.md §4.4.
 */

import { FIXTURE_PREFIX } from './content-fixtures';

/** Expected fixture counts by publication_status. */
export const FIXTURE_COUNTS = {
  published: 20,
  archived: 5,
  draft: 2,
  total: 27,
} as const;

/** Title-prefix filter for fixture rows in queries. */
export const FIXTURE_TITLE_FILTER = FIXTURE_PREFIX;

/**
 * Valid publication_status enum values per spec §4.1 CHECK constraint.
 * Matches the production `content_items_publication_status_check`.
 */
export const VALID_PUBLICATION_STATUSES = [
  'draft',
  'in_review',
  'published',
  'archived',
] as const;

export type PublicationStatus = (typeof VALID_PUBLICATION_STATUSES)[number];
