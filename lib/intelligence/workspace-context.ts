// lib/intelligence/workspace-context.ts
//
// Single-source helper for the 3 typed workspace-context fields:
//   - companyProfileId
//   - guideId
//   - relevanceThreshold
//
// Post-T2 (S246 WP2b): reads the `intelligence_workspaces` satellite via JOIN
// through `workspace_id`. The pre-T2 `extractContextFromDomainMetadata` helper
// that projected from `workspaces.domain_metadata` JSONB was renamed to
// `extractContextFromSatellite` and now accepts the satellite row shape —
// callers that already SELECT the satellite via a JOIN pass the row directly to
// avoid the extra round-trip.
//
// See docs/specs/intelligence-workspaces/TECH.md T-1..T-5 for the canonical
// signature, the migration sequencing strategy, and the [0.1, 1.0] range
// guard discipline.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';

export interface IntelligenceWorkspaceContext {
  /** FK to `company_profiles.id`; null when no profile is bound. */
  companyProfileId: string | null;
  /** FK to `guides.id`; null when no guide is bound. */
  guideId: string | null;
  /**
   * SI-L5 admin-only relevance cutoff (0.1–1.0); null when unset OR when an
   * out-of-range value is supplied (defensive — the typed CHECK constraint
   * and the Zod validator both enforce the range upstream).
   * Callers needing the pipeline behaviour gate apply
   * `DEFAULT_RELEVANCE_THRESHOLD` from `@/lib/intelligence/types` as the
   * fallback — the helper does NOT apply the fallback itself, so the
   * "unset" state is observable.
   */
  relevanceThreshold: number | null;
}

/**
 * Subset of `intelligence_workspaces` Row that carries the 3 typed context
 * columns. Accepted in either flat (`{ company_profile_id, ... }`) or nested
 * (Supabase JOIN result either `{ intelligence_workspaces: row }` or
 * `{ intelligence_workspaces: [row] }`) shape via {@link extractContextFromSatellite}.
 */
export interface IntelligenceWorkspaceSatelliteRow {
  company_profile_id: string | null;
  guide_id: string | null;
  relevance_threshold: number | null;
}

/**
 * Composable SELECT clause that returns a workspaces row enriched with:
 * - `application_types!inner(key)` — INNER JOIN forces intelligence-only rows
 *   via `eq('application_types.key', 'intelligence')` on the query.
 * - `intelligence_workspaces(company_profile_id, guide_id, relevance_threshold)`
 *   — projects the 3 typed satellite columns. Supabase-js returns this as a
 *   single object (the FK is 1:1 via UNIQUE workspace_id) — pass directly to
 *   {@link extractContextFromSatellite}.
 *
 * Usage:
 * ```ts
 * supabase
 *   .from('workspaces')
 *   .select(INTELLIGENCE_WORKSPACE_SELECT)
 *   .eq('application_types.key', 'intelligence')
 *   .eq('is_archived', false)
 * ```
 */
export const INTELLIGENCE_WORKSPACE_SELECT = `
  *,
  application_types!inner(key),
  intelligence_workspaces(company_profile_id, guide_id, relevance_threshold)
` as const;

/**
 * Returns workspace context (FK ids + admin threshold) for one workspace by
 * reading the `intelligence_workspaces` satellite via `workspace_id`.
 *
 * Returns `null` on every field when no satellite row exists (defensive —
 * should not occur for any `application_type='intelligence'` workspace
 * post-T2; the migration's INSERT … SELECT creates a satellite row per
 * intelligence workspace).
 *
 * **No fallback read of `workspaces.domain_metadata` JSONB** — that JSONB
 * carries no context post-T2 strip (see intel TECH T-3).
 */
export async function getIntelligenceWorkspaceContext(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<IntelligenceWorkspaceContext> {
  const satellite = await sb(
    supabase
      .from('intelligence_workspaces')
      .select('company_profile_id, guide_id, relevance_threshold')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    'intelligence.workspace-context.load',
  );

  return extractContextFromSatellite(satellite);
}

/**
 * Pure projection of an `intelligence_workspaces` satellite row onto
 * `IntelligenceWorkspaceContext`. Accepts:
 * - The flat row shape (`{ company_profile_id, guide_id, relevance_threshold }`).
 * - The Supabase JOIN result shape (either a single nested object or a
 *   single-element array — supabase-js's view depends on relationship
 *   metadata which can vary by SELECT hint).
 * - `null` / `undefined` — every field becomes `null`.
 *
 * The [0.1, 1.0] range check on `relevanceThreshold` is preserved from the
 * pre-T2 helper: out-of-range values surface as `null` so the pipeline falls
 * back to its default rather than honouring a corrupted setting.
 */
export function extractContextFromSatellite(
  satellite:
    | IntelligenceWorkspaceSatelliteRow
    | IntelligenceWorkspaceSatelliteRow[]
    | null
    | undefined,
): IntelligenceWorkspaceContext {
  const row = Array.isArray(satellite) ? (satellite[0] ?? null) : (satellite ?? null);

  if (!row) {
    return { companyProfileId: null, guideId: null, relevanceThreshold: null };
  }

  const companyProfileId =
    typeof row.company_profile_id === 'string' && row.company_profile_id.length > 0
      ? row.company_profile_id
      : null;

  const guideId =
    typeof row.guide_id === 'string' && row.guide_id.length > 0 ? row.guide_id : null;

  const relevanceThreshold =
    typeof row.relevance_threshold === 'number' &&
    row.relevance_threshold >= 0.1 &&
    row.relevance_threshold <= 1.0
      ? row.relevance_threshold
      : null;

  return { companyProfileId, guideId, relevanceThreshold };
}
