// lib/intelligence/workspace-context.ts
//
// Single-source helper for the 3 typed workspace-context fields:
//   - companyProfileId
//   - guideId
//   - relevanceThreshold
//
// Lands per S244 Wave 0.5 ratification ("helper-first hybrid") — codifies the
// read-path so consumers stop reading `workspaces.domain_metadata` JSONB
// directly. Behaviour-preserving at this stage: this implementation still
// reads JSONB; the WP2b T2 combined-PR migration adds the
// `intelligence_workspaces` satellite + 3 typed columns, at which point the
// internals of this helper swap to a JOIN against the satellite — callers do
// not change.
//
// See docs/specs/intelligence-workspaces/TECH.md T-5 for the canonical
// signature + migration sequencing strategy.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';

export interface IntelligenceWorkspaceContext {
  /** FK to `company_profiles.id`; null when no profile is bound. */
  companyProfileId: string | null;
  /** FK to `guides.id`; null when no guide is bound. */
  guideId: string | null;
  /**
   * SI-L5 admin-only relevance cutoff (0.1–1.0); null when unset.
   * Callers needing the pipeline behaviour gate apply
   * `DEFAULT_RELEVANCE_THRESHOLD` from `@/lib/intelligence/types` as the
   * fallback — the helper does NOT apply the fallback itself, so the
   * "unset" state is observable.
   */
  relevanceThreshold: number | null;
}

/**
 * Returns workspace context (FK ids + admin threshold) for one workspace.
 *
 * **WP2a (current, pre-T2):** reads `workspaces.domain_metadata` JSONB.
 *
 * **WP2b (T2 PR, behaviour-preserving):** swaps internals to read the 3
 * typed columns on `intelligence_workspaces` via JOIN through
 * `workspace_id`. Signature + return shape do NOT change.
 *
 * Returns `null` on every field when the workspace row does not exist or
 * carries no JSONB-encoded context — same shape as the satellite-NULL
 * case post-T2.
 */
export async function getIntelligenceWorkspaceContext(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<IntelligenceWorkspaceContext> {
  const workspace = await sb(
    supabase
      .from('workspaces')
      .select('domain_metadata')
      .eq('id', workspaceId)
      .maybeSingle(),
    'intelligence.workspace-context.load',
  );

  return extractContextFromDomainMetadata(workspace?.domain_metadata);
}

/**
 * Pure projection of `workspaces.domain_metadata` JSONB onto
 * `IntelligenceWorkspaceContext`. Exported for callers that already hold
 * the row (avoids a duplicate SELECT). Same shape contract as
 * `getIntelligenceWorkspaceContext` — including the [0.1, 1.0] range check
 * on `relevanceThreshold` (out-of-range values surface as `null` so the
 * pipeline falls back to its default rather than honouring a corrupted
 * setting).
 *
 * **WP2b note:** when the helper internals swap to the satellite JOIN, this
 * function's signature stays the same but its input type becomes the
 * satellite row shape rather than the JSONB blob. Callers can keep using
 * it via the public {@link getIntelligenceWorkspaceContext} entry point.
 */
export function extractContextFromDomainMetadata(
  domainMetadata: unknown,
): IntelligenceWorkspaceContext {
  const meta = (domainMetadata ?? {}) as Record<string, unknown>;

  const rawCompanyProfileId = meta.company_profile_id;
  const companyProfileId =
    typeof rawCompanyProfileId === 'string' && rawCompanyProfileId.length > 0
      ? rawCompanyProfileId
      : null;

  const rawGuideId = meta.guide_id;
  const guideId =
    typeof rawGuideId === 'string' && rawGuideId.length > 0
      ? rawGuideId
      : null;

  const rawThreshold = meta.relevance_threshold;
  const relevanceThreshold =
    typeof rawThreshold === 'number' &&
    rawThreshold >= 0.1 &&
    rawThreshold <= 1.0
      ? rawThreshold
      : null;

  return { companyProfileId, guideId, relevanceThreshold };
}
