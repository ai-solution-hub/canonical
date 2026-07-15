/**
 * Server-side helper for per-item provenance data.
 *
 * Assembles classification, embedding, and bid-drafting provenance for a
 * single content item. Used by the provenance API route.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { sb, SupabaseError } from '@/lib/supabase/safe';
import { BRANDING } from '@/lib/client-config';
import { PIPELINE_SYSTEM_USER_ID } from '@/lib/intelligence/types';
import { resolveUserDisplayNames } from '@/lib/users/display-names';

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
    return { kind: 'claude', label: BRANDING.productName, userId: draftedBy };
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
  // 1. Fetch classification columns from source_documents. ID-131 {131.17}
  // G-IMS-DELETE KEEP-list: re-pointed off content_items (M3 gave SD the
  // classification family). `classification_model`/`embedding_model` are
  // NOT ported to source_documents (M3 D1: classification_model dropped as
  // dead — 0 stored consumers; embedding_model has no SD analog either) —
  // both now always resolve to their env-default. `next_review_date` /
  // `review_cadence_days` / `verified_at` moved to the `record_lifecycle`
  // governance facet (G-GOV-FACET, already landed under ID-131.12/.13) —
  // fetched separately below by (owner_kind='source_document', owner_id).
  const item = await sb(
    supabase
      .from('source_documents')
      .select(
        `id,
        classification_confidence,
        primary_domain,
        primary_subtopic,
        secondary_domain,
        secondary_subtopic,
        classification_reasoning,
        classified_at`,
      )
      .eq('id', itemId)
      .maybeSingle(),
    'provenance.item.contentItem',
  );

  if (!item) return null;

  // 2. classification_model is deliberately not re-homed onto
  // source_documents (0 stored consumers) — always env-default going forward.
  const classificationModel =
    process.env.AI_CLASSIFICATION_MODEL ?? 'claude-opus-4-6';
  const classificationModelSource: 'recorded' | 'env_default' = 'env_default';

  // 3. embedding_model has no source_documents analog — always env-default.
  const embeddingModel =
    process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-large';
  const embeddingModelSource: 'recorded' | 'env_default' = 'env_default';

  // 3a. Governance/review-schedule fields live on the record_lifecycle facet
  // (owner_kind='source_document', owner_id=itemId) since G-GOV-FACET.
  const lifecycle = await sb(
    supabase
      .from('record_lifecycle')
      .select('next_review_date, review_cadence_days, verified_at')
      .eq('owner_kind', 'source_document')
      .eq('owner_id', itemId)
      .maybeSingle(),
    'provenance.item.recordLifecycle',
  );

  // 4. Fetch bid responses that reference this content item (newest 3 + total count)
  // source_record_ids is a text[] column — use @> (contains) operator
  const [recentDraftsResult, countResponse] = await Promise.all([
    sb(
      supabase
        .from('form_responses')
        .select(
          `id,
          question_id,
          drafted_by,
          updated_at,
          form_questions!inner(form_instance_id, question_text)`,
        )
        .contains('source_record_ids', [itemId])
        .order('updated_at', { ascending: false })
        .limit(3),
      'provenance.item.recentDrafts',
    ),
    // Count query — use raw response to access .count (sb() returns data, which is null for head:true)
    supabase
      .from('form_responses')
      .select('id', { count: 'exact', head: true })
      .contains('source_record_ids', [itemId]),
  ]);

  // The count query is a raw response (not wrapped by sb(), which discards
  // .count for head:true). Surface its error the SAME way sb() does — throw a
  // SupabaseError — so a DB failure is loud, not silently coerced to 0.
  if (countResponse.error) {
    throw new SupabaseError(
      countResponse.error,
      'provenance.item.totalDraftCount',
    );
  }
  const totalDraftCount = countResponse.count ?? 0;

  // 5. Resolve display names for drafted_by users
  const draftUserIds = recentDraftsResult
    .map((r) => r.drafted_by)
    .filter((id): id is string => id != null);

  const displayNames =
    draftUserIds.length > 0
      ? await resolveUserDisplayNames(supabase, draftUserIds)
      : new Map<string, { display_name: string }>();

  // 6. Resolve procurement (form) names. ID-145 {145.23}: form_questions.
  // workspace_id was DROPPED (W1c, {145.6}); the owning-form scope is now
  // form_instance_id, and (DR-056 "the item IS the form") the display name
  // lookup moves from `workspaces` to `form_instances.name`.
  const formInstanceIds = recentDraftsResult
    .map((r) => {
      const bq = r.form_questions;
      // form_questions is a joined object (inner join, so always present)
      if (Array.isArray(bq))
        return bq[0]?.form_instance_id as string | undefined;
      return (bq as { form_instance_id: string } | null)?.form_instance_id;
    })
    .filter((id): id is string => id != null);

  const uniqueFormInstanceIds = [...new Set(formInstanceIds)];
  let procurementNameMap = new Map<string, string | null>();

  if (uniqueFormInstanceIds.length > 0) {
    const formInstances = await sb(
      supabase
        .from('form_instances')
        .select('id, name')
        .in('id', uniqueFormInstanceIds),
      'provenance.item.procurementNames',
    );
    procurementNameMap = new Map(formInstances.map((f) => [f.id, f.name]));
  }

  // 7. Assemble recent drafts
  const recentDrafts: ProcurementDraftInfo[] = recentDraftsResult.map((r) => {
    const bq = Array.isArray(r.form_questions)
      ? r.form_questions[0]
      : (r.form_questions as {
          form_instance_id: string;
          question_text: string;
        } | null);

    const procurementId = bq?.form_instance_id ?? '';

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
    },
    reviewSchedule: {
      nextReviewDate: lifecycle?.next_review_date ?? null,
      reviewCadenceDays: lifecycle?.review_cadence_days ?? null,
      lastReviewedAt: lifecycle?.verified_at ?? null,
    },
    drafting: {
      recentDrafts,
      totalDraftCount,
    },
  };
}
