import type { CoverageCellData } from '@/components/coverage-cell';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessLevel =
  | 'fresh'
  | 'mostly-fresh'
  | 'mixed'
  | 'mostly-stale'
  | 'stale'
  | 'empty';

export interface FreshnessCounts {
  fresh_count: number;
  aging_count: number;
  stale_count: number;
  expired_count: number;
}

// ---------------------------------------------------------------------------
// Colour mapping
// ---------------------------------------------------------------------------

/**
 * CSS class mapping for each heatmap freshness level.
 * All values use semantic tokens from globals.css — no raw Tailwind colours.
 */
export const HEATMAP_LEVEL_CLASSES: Record<
  FreshnessLevel,
  { cell: string; border: string }
> = {
  fresh: {
    cell: 'bg-freshness-fresh-bg',
    border: 'border-freshness-fresh/30',
  },
  'mostly-fresh': {
    cell: 'bg-freshness-aging-bg',
    border: 'border-freshness-aging/30',
  },
  mixed: {
    cell: 'bg-freshness-aging-bg',
    border: 'border-freshness-aging',
  },
  'mostly-stale': {
    cell: 'bg-freshness-stale-bg',
    border: 'border-freshness-stale/30',
  },
  stale: {
    cell: 'bg-freshness-expired-bg',
    border: 'border-freshness-expired',
  },
  empty: {
    cell: 'bg-transparent',
    border: 'border-border border-dashed',
  },
};

// ---------------------------------------------------------------------------
// Scoring algorithm
// ---------------------------------------------------------------------------

/**
 * Computes a heatmap freshness level from item freshness counts.
 *
 * Uses a weighted health score from 0 (worst) to 1 (best):
 *   score = (fresh * 1.0 + aging * 0.5 + stale * 0.15 + expired * 0.0) / total
 *
 * Score-to-level thresholds:
 *   0.85-1.0  = fresh
 *   0.65-0.84 = mostly-fresh
 *   0.45-0.64 = mixed
 *   0.25-0.44 = mostly-stale
 *   0.0-0.24  = stale
 *   total=0   = empty
 */
export function computeHeatmapLevel(counts: FreshnessCounts): FreshnessLevel {
  const total =
    counts.fresh_count +
    counts.aging_count +
    counts.stale_count +
    counts.expired_count;

  if (total === 0) return 'empty';

  const score =
    (counts.fresh_count * 1.0 +
      counts.aging_count * 0.5 +
      counts.stale_count * 0.15 +
      counts.expired_count * 0.0) /
    total;

  if (score >= 0.85) return 'fresh';
  if (score >= 0.65) return 'mostly-fresh';
  if (score >= 0.45) return 'mixed';
  if (score >= 0.25) return 'mostly-stale';
  return 'stale';
}

// ---------------------------------------------------------------------------
// Column assembly
// ---------------------------------------------------------------------------

/**
 * Builds the union of all subtopic columns across all domains, ordered by
 * domain-first appearance. Each domain's subtopics are added in taxonomy order,
 * skipping any already seen.
 */
export function buildHeatmapColumns(
  orderedDomains: string[],
  getSubtopics: (domain: string) => string[],
): string[] {
  const allColumns: string[] = [];
  const seen = new Set<string>();

  for (const domain of orderedDomains) {
    for (const subtopic of getSubtopics(domain)) {
      if (!seen.has(subtopic)) {
        seen.add(subtopic);
        allColumns.push(subtopic);
      }
    }
  }

  return allColumns;
}

// ---------------------------------------------------------------------------
// Cell lookup map
// ---------------------------------------------------------------------------

/**
 * Builds an O(1) lookup map from the coverage matrix.
 * Key format: `${domain_name}::${subtopic_name}`
 */
export function buildCellMap(
  matrix: CoverageCellData[],
): Map<string, CoverageCellData> {
  const map = new Map<string, CoverageCellData>();
  for (const cell of matrix) {
    map.set(`${cell.domain_name}::${cell.subtopic_name}`, cell);
  }
  return map;
}
