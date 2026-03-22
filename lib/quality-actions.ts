/**
 * Content Quality Actions Engine
 *
 * Analyses content items and surfaces prioritised, actionable quality
 * improvement suggestions. Works alongside the content-suggestions engine
 * (which focuses on coverage gaps) by focusing on improving existing items.
 *
 * Two exported functions:
 *   - suggestQualityActions() — pure function, no DB calls
 *   - getTopQualityActions() — async, queries Supabase for items below threshold
 *
 * Action categories map to the 5 quality score components
 * from lib/quality-score.ts:
 *   freshness (30%), classification (20%), completeness (20%),
 *   summary (15%), citations (15%).
 *
 * Spec: docs/plans/quality-manager-enhancement-spec.md Phase 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal input shape for the pure suggestion function. */
export interface QualityActionInput {
  id: string;
  title: string | null;
  suggested_title?: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  freshness: string | null;
  classification_confidence: number | null;
  ai_summary: string | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  content_owner_id: string | null;
  source_url: string | null;
  quality_score: number | null;
  previous_quality_score: number | null;
  metadata: Record<string, unknown> | null;
}

export type QualityActionCategory =
  | 'freshness'
  | 'classification'
  | 'completeness'
  | 'summary'
  | 'citations';

export type QualityActionPriority = 'critical' | 'high' | 'medium' | 'low';

export interface QualityAction {
  itemId: string;
  itemTitle: string;
  action: string;
  category: QualityActionCategory;
  priority: QualityActionPriority;
  estimatedScoreImpact: number;
  currentScore: number | null;
  domain: string | null;
}

/** Result shape returned by getTopQualityActions(). */
export interface QualityActionsResult {
  total_actions: number;
  by_priority: Record<string, number>;
  actions: QualityAction[];
}

// ---------------------------------------------------------------------------
// Priority ordering for sorting
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<QualityActionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Pure function: analyse items and suggest actions
// ---------------------------------------------------------------------------

/**
 * Analyse content items and return prioritised quality improvement actions.
 *
 * This is a pure function with no database calls — it operates solely on the
 * provided input array. The caller is responsible for fetching items.
 */
export function suggestQualityActions(
  items: QualityActionInput[],
): QualityAction[] {
  const actions: QualityAction[] = [];

  for (const item of items) {
    const itemTitle =
      item.suggested_title || item.title || 'Untitled';
    const citationCount = extractCitationCount(item.metadata);

    // a. Freshness — weight 30%, so fixing this can gain up to 30 points
    if (
      item.freshness === 'stale' ||
      item.freshness === 'expired'
    ) {
      const isExpired = item.freshness === 'expired';
      actions.push({
        itemId: item.id,
        itemTitle,
        action: isExpired
          ? 'Update content — freshness expired, contributing 0 to quality score'
          : 'Review content — freshness is stale, only contributing 9 of 30 possible freshness points',
        category: 'freshness',
        priority: isExpired ? 'high' : 'medium',
        estimatedScoreImpact: isExpired ? 30 : 21,
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    // b. Classification confidence — weight 20%
    if (
      item.classification_confidence !== null &&
      item.classification_confidence < 0.5
    ) {
      const confidencePercent = Math.round(
        item.classification_confidence * 100,
      );
      actions.push({
        itemId: item.id,
        itemTitle,
        action: `Reclassify — low confidence classification (${confidencePercent}%)`,
        category: 'classification',
        priority: 'high',
        estimatedScoreImpact: Math.round(
          (1 - item.classification_confidence) * 20,
        ),
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    // c. Completeness — weight 20% for depth, plus source URL and owner
    if (!item.ai_summary) {
      actions.push({
        itemId: item.id,
        itemTitle,
        action: 'Generate AI summary — missing summary reduces quality score by ~15 points',
        category: 'summary',
        priority: 'high',
        estimatedScoreImpact: 15,
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    if (!item.source_url) {
      actions.push({
        itemId: item.id,
        itemTitle,
        action: 'Add source URL — improves provenance and traceability',
        category: 'completeness',
        priority: 'low',
        estimatedScoreImpact: 0, // source_url is not in the scoring formula
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    if (!item.content_owner_id) {
      actions.push({
        itemId: item.id,
        itemTitle,
        action: 'Assign content owner — unowned items cannot receive governance notifications',
        category: 'completeness',
        priority: 'medium',
        estimatedScoreImpact: 0, // owner is not in the scoring formula but is governance-critical
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    // d. Summary quality — short summaries
    if (
      item.ai_summary &&
      item.ai_summary.trim().length > 0 &&
      item.ai_summary.trim().length < 50
    ) {
      actions.push({
        itemId: item.id,
        itemTitle,
        action: `Improve summary — current summary is very short (${item.ai_summary.trim().length} chars)`,
        category: 'summary',
        priority: 'low',
        estimatedScoreImpact: 5,
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    // e. Citations/evidence — weight 15%
    if (citationCount === 0 && item.content_type !== 'qa_pair') {
      actions.push({
        itemId: item.id,
        itemTitle,
        action: 'Add citations or source references — zero citations reduces quality score by up to 15 points',
        category: 'citations',
        priority: 'low',
        estimatedScoreImpact: 15,
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }

    // Incomplete depth layers (brief/detail/reference) — weight 20%
    const depthCount = countDepthLayers(item.brief, item.detail, item.reference);
    if (depthCount < 3 && depthCount > 0) {
      const missingLayers = getMissingLayers(item.brief, item.detail, item.reference);
      const pointsPerLayer = Math.round(20 / 3);
      const potentialGain = (3 - depthCount) * pointsPerLayer;
      actions.push({
        itemId: item.id,
        itemTitle,
        action: `Add ${missingLayers.join(', ')} depth ${missingLayers.length === 1 ? 'layer' : 'layers'} — only ${depthCount} of 3 populated`,
        category: 'completeness',
        priority: 'medium',
        estimatedScoreImpact: potentialGain,
        currentScore: item.quality_score,
        domain: item.primary_domain,
      });
    }
  }

  // Sort by priority (critical first), then by score impact (highest first)
  actions.sort((a, b) => {
    const priorityDiff =
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.estimatedScoreImpact - a.estimatedScoreImpact;
  });

  return actions;
}

// ---------------------------------------------------------------------------
// Async function: query DB and return top quality actions
// ---------------------------------------------------------------------------

/**
 * Fetch items below the quality threshold and return prioritised actions.
 *
 * Queries governance_config for per-domain thresholds, falling back to
 * the provided default (40). Fetches qualifying items, runs the pure
 * suggestQualityActions(), and returns the top N results.
 */
export async function getTopQualityActions(
  supabase: SupabaseClient<Database>,
  options?: {
    domain?: string;
    limit?: number;
    scoreThreshold?: number;
  },
): Promise<QualityActionsResult> {
  const limit = options?.limit ?? 20;
  const defaultThreshold = options?.scoreThreshold ?? 40;

  // 1. Fetch governance_config for per-domain thresholds
  // Note: quality_score_threshold was added in Phase 1 migration but may not
  // yet be reflected in the generated database.types.ts. The cast handles this.
  const { data: govConfigRows } = await supabase
    .from('governance_config')
    .select('domain, quality_score_threshold') as {
      data: Array<{ domain: string | null; quality_score_threshold: number | null }> | null;
    };

  const domainThresholdMap = new Map<string, number>();
  for (const row of govConfigRows ?? []) {
    if (row.domain && row.quality_score_threshold != null) {
      domainThresholdMap.set(
        row.domain,
        row.quality_score_threshold,
      );
    }
  }

  // 2. Determine the max threshold to use in the query (we filter precisely later)
  const allThresholds = [
    defaultThreshold,
    ...Array.from(domainThresholdMap.values()),
  ];
  const maxThreshold = Math.max(...allThresholds);

  // 3. Query items below the maximum threshold (over-fetch, then filter)
  // Note: quality_score and previous_quality_score were added in Phase 1
  // migration but may not yet be in database.types.ts. The result is cast
  // to ContentItemQualityRow below.
  interface ContentItemQualityRow {
    id: string;
    title: string | null;
    suggested_title: string | null;
    content_type: string | null;
    primary_domain: string | null;
    primary_subtopic: string | null;
    freshness: string | null;
    classification_confidence: number | null;
    ai_summary: string | null;
    brief: string | null;
    detail: string | null;
    reference: string | null;
    content_owner_id: string | null;
    source_url: string | null;
    quality_score: number | null;
    previous_quality_score: number | null;
    metadata: Record<string, unknown> | null;
  }

  let query = supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, content_type, primary_domain, primary_subtopic, freshness, classification_confidence, ai_summary, brief, detail, reference, content_owner_id, source_url, quality_score, previous_quality_score, metadata',
    )
    .is('archived_at', null)
    .not('quality_score', 'is', null)
    .lte('quality_score', maxThreshold)
    .order('quality_score', { ascending: true })
    .limit(200); // over-fetch to allow for domain filtering

  if (options?.domain) {
    query = query.eq('primary_domain', options.domain);
  }

  const { data: rawItems, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch quality items: ${error.message}`);
  }

  const items = (rawItems ?? []) as unknown as ContentItemQualityRow[];

  // 4. Filter items to those actually below their domain's threshold
  const qualifyingItems: QualityActionInput[] = [];
  for (const item of items) {
    const domainThreshold =
      options?.scoreThreshold ??
      (item.primary_domain
        ? domainThresholdMap.get(item.primary_domain) ?? defaultThreshold
        : defaultThreshold);

    if ((item.quality_score ?? 0) <= domainThreshold) {
      qualifyingItems.push({
        id: item.id,
        title: item.title,
        suggested_title: item.suggested_title,
        content_type: item.content_type,
        primary_domain: item.primary_domain,
        primary_subtopic: item.primary_subtopic,
        freshness: item.freshness,
        classification_confidence: item.classification_confidence,
        ai_summary: item.ai_summary,
        brief: item.brief ?? null,
        detail: item.detail ?? null,
        reference: item.reference ?? null,
        content_owner_id: item.content_owner_id ?? null,
        source_url: item.source_url ?? null,
        quality_score: item.quality_score ?? null,
        previous_quality_score: item.previous_quality_score ?? null,
        metadata: item.metadata,
      });
    }
  }

  // 5. Generate actions from qualifying items
  const allActions = suggestQualityActions(qualifyingItems);

  // 6. Limit results
  const limited = allActions.slice(0, limit);

  // 7. Build priority breakdown
  const byPriority: Record<string, number> = {};
  for (const action of limited) {
    byPriority[action.priority] = (byPriority[action.priority] ?? 0) + 1;
  }

  return {
    total_actions: limited.length,
    by_priority: byPriority,
    actions: limited,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract citation_count from metadata JSONB. */
function extractCitationCount(
  metadata: Record<string, unknown> | null,
): number {
  if (!metadata) return 0;
  const count = metadata.citation_count;
  if (typeof count === 'number') return count;
  if (typeof count === 'string') {
    const parsed = parseInt(count, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** Count how many of brief/detail/reference are populated. */
function countDepthLayers(
  brief: string | null | undefined,
  detail: string | null | undefined,
  reference: string | null | undefined,
): number {
  let count = 0;
  if (brief && brief.trim().length > 0) count++;
  if (detail && detail.trim().length > 0) count++;
  if (reference && reference.trim().length > 0) count++;
  return count;
}

/** Return names of missing depth layers. */
function getMissingLayers(
  brief: string | null | undefined,
  detail: string | null | undefined,
  reference: string | null | undefined,
): string[] {
  const missing: string[] = [];
  if (!brief || brief.trim().length === 0) missing.push('brief');
  if (!detail || detail.trim().length === 0) missing.push('detail');
  if (!reference || reference.trim().length === 0) missing.push('reference');
  return missing;
}
