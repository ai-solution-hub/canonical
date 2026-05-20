/**
 * Server-side helper for per-item provenance data.
 *
 * Assembles classification, embedding, and bid-drafting provenance for a
 * single content item. Used by the provenance API route.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb } from '@/lib/supabase/safe';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import { estimateClassifyCost, estimateEmbedCost } from './pricing';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface DraftAttribution {
  kind: 'claude' | 'human';
  label: string;
  userId: string | null;
}

export interface ProcurementDraftInfo {
  responseId: string;
  procurementId: string;
  procurementName: string | null;
  questionText: string | null;
  draftedAt: string | null;
  attribution: DraftAttribution;
}

export interface ItemProvenanceResponse {
  itemId: string;

  // Classification provenance
  classification: {
    confidence: number | null;
    primaryDomain: string | null;
    primarySubtopic: string | null;
    secondaryDomain: string | null;
    secondarySubtopic: string | null;
    reasoning: string | null;
    classifiedAt: string | null;
  };

  // Processing provenance
  processing: {
    classificationModel: string | null;
    classificationModelSource: 'recorded' | 'env_default';
    embeddingModel: string | null;
    embeddingModelSource: 'recorded' | 'env_default';
    classificationTokensIn: number | null;
    classificationTokensOut: number | null;
    classificationCacheCreation: number | null;
    classificationCacheRead: number | null;
    embeddingTokens: number | null;
    estimatedClassifyCost: number | null;
    estimatedEmbedCost: number | null;
  };

  // Review schedule provenance (P0 Document Control §5.5 Phase 3 T4)
  reviewSchedule: {
    /** ISO date string (DATE column) — next scheduled review, or null if not scheduled. */
    nextReviewDate: string | null;
    /** Cadence in days (1–1095), or null when no recurring review is configured. */
    reviewCadenceDays: number | null;
    /** ISO timestamp of last SME verification, or null if never reviewed. */
    lastReviewedAt: string | null;
  };

  // Drafting provenance
  drafting: {
    recentDrafts: ProcurementDraftInfo[];
    totalDraftCount: number;
  };
}

// ---------------------------------------------------------------------------
// Helper: resolve draft attribution
// ---------------------------------------------------------------------------

function resolveAttribution(
  draftedBy: string | null,
  displayNames: Map<string, { display_name: string }>,
): DraftAttribution {
  // null or pipeline system user = AI-drafted
  if (!draftedBy || draftedBy === PIPELINE_SYSTEM_USER_ID) {
    return { kind: 'claude', label: 'Knowledge Hub', userId: draftedBy };
  }

  // Human user
  const info = displayNames.get(draftedBy);
  return {
    kind: 'human',
    label: info?.display_name ?? 'A team member',
    userId: draftedBy,
  };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Fetch provenance data for a single content item.
 *
 * @returns The provenance response, or `null` if the item does not exist.
 */
export async function getItemProvenance(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<ItemProvenanceResponse | null> {
  // 1. Fetch classification + cost columns from content_items
  const item = await sb(
    supabase
      .from('content_items')
      .select(
        `id,
        classification_confidence,
        primary_domain,
        primary_subtopic,
        secondary_domain,
        secondary_subtopic,
        classification_reasoning,
        classified_at,
        classification_model,
        classification_tokens_in,
        classification_tokens_out,
        classification_cache_creation_tokens,
        classification_cache_read_tokens,
        embedding_model,
        embedding_tokens,
        next_review_date,
        review_cadence_days,
        verified_at`,
      )
      .eq('id', itemId)
      .maybeSingle(),
    'provenance.item.contentItem',
  );

  if (!item) return null;

  // 2. Resolve classification model (recorded or env default)
  const classificationModel =
    item.classification_model ??
    process.env.AI_CLASSIFICATION_MODEL ??
    'claude-opus-4-6';
  const classificationModelSource: 'recorded' | 'env_default' =
    item.classification_model ? 'recorded' : 'env_default';

  // 3. Resolve embedding model (recorded or env default)
  const embeddingModel =
    item.embedding_model ??
    process.env.AI_EMBEDDING_MODEL ??
    'text-embedding-3-large';
  const embeddingModelSource: 'recorded' | 'env_default' = item.embedding_model
    ? 'recorded'
    : 'env_default';

  // 4. Estimate costs
  const estimatedClassifyCostValue =
    item.classification_tokens_in != null &&
    item.classification_tokens_out != null
      ? estimateClassifyCost(
          item.classification_tokens_in,
          item.classification_tokens_out,
          item.classification_cache_creation_tokens ?? 0,
          item.classification_cache_read_tokens ?? 0,
          classificationModel,
        )
      : null;

  const estimatedEmbedCostValue =
    item.embedding_tokens != null
      ? estimateEmbedCost(item.embedding_tokens, embeddingModel)
      : null;

  // 5. Fetch bid responses that reference this content item (newest 3 + total count)
  // source_content_ids is a text[] column — use @> (contains) operator
  const [recentDraftsResult, countResponse] = await Promise.all([
    sb(
      supabase
        .from('bid_responses')
        .select(
          `id,
          question_id,
          drafted_by,
          updated_at,
          bid_questions!inner(workspace_id, question_text)`,
        )
        .contains('source_content_ids', [itemId])
        .order('updated_at', { ascending: false })
        .limit(3),
      'provenance.item.recentDrafts',
    ),
    // Count query — use raw response to access .count (sb() returns data, which is null for head:true)
    supabase
      .from('bid_responses')
      .select('id', { count: 'exact', head: true })
      .contains('source_content_ids', [itemId]),
  ]);

  const totalDraftCount = countResponse.count ?? 0;

  // 6. Resolve display names for drafted_by users
  const draftUserIds = recentDraftsResult
    .map((r) => r.drafted_by)
    .filter((id): id is string => id != null);

  const displayNames =
    draftUserIds.length > 0
      ? await resolveUserDisplayNames(supabase, draftUserIds)
      : new Map<string, { display_name: string }>();

  // 7. Resolve bid workspace names (post-T2: bid_questions.project_id renamed
  // to workspace_id).
  const workspaceIds = recentDraftsResult
    .map((r) => {
      const bq = r.bid_questions;
      // bid_questions is a joined object (inner join, so always present)
      if (Array.isArray(bq)) return bq[0]?.workspace_id as string | undefined;
      return (bq as { workspace_id: string } | null)?.workspace_id;
    })
    .filter((id): id is string => id != null);

  const uniqueWorkspaceIds = [...new Set(workspaceIds)];
  let procurementNameMap = new Map<string, string | null>();

  if (uniqueWorkspaceIds.length > 0) {
    const workspaces = await sb(
      supabase
        .from('workspaces')
        .select('id, name')
        .in('id', uniqueWorkspaceIds),
      'provenance.item.procurementNames',
    );
    procurementNameMap = new Map(workspaces.map((w) => [w.id, w.name]));
  }

  // 8. Assemble recent drafts
  const recentDrafts: ProcurementDraftInfo[] = recentDraftsResult.map((r) => {
    const bq = Array.isArray(r.bid_questions)
      ? r.bid_questions[0]
      : (r.bid_questions as {
          workspace_id: string;
          question_text: string;
        } | null);

    const procurementId = bq?.workspace_id ?? '';

    return {
      responseId: r.id,
      procurementId,
      procurementName: procurementNameMap.get(procurementId) ?? null,
      questionText: bq?.question_text ?? null,
      draftedAt: r.updated_at,
      attribution: resolveAttribution(r.drafted_by, displayNames),
    };
  });

  return {
    itemId,
    classification: {
      confidence: item.classification_confidence,
      primaryDomain: item.primary_domain,
      primarySubtopic: item.primary_subtopic,
      secondaryDomain: item.secondary_domain,
      secondarySubtopic: item.secondary_subtopic,
      reasoning: item.classification_reasoning,
      classifiedAt: item.classified_at,
    },
    processing: {
      classificationModel,
      classificationModelSource,
      embeddingModel,
      embeddingModelSource,
      classificationTokensIn: item.classification_tokens_in,
      classificationTokensOut: item.classification_tokens_out,
      classificationCacheCreation: item.classification_cache_creation_tokens,
      classificationCacheRead: item.classification_cache_read_tokens,
      embeddingTokens: item.embedding_tokens,
      estimatedClassifyCost: estimatedClassifyCostValue,
      estimatedEmbedCost: estimatedEmbedCostValue,
    },
    reviewSchedule: {
      nextReviewDate: item.next_review_date,
      reviewCadenceDays: item.review_cadence_days,
      lastReviewedAt: item.verified_at,
    },
    drafting: {
      recentDrafts,
      totalDraftCount,
    },
  };
}
