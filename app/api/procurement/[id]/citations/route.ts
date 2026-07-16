import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────
// GET /api/procurement/:id/citations -- ID-145 {145.47} FIX (Checker F1).
//
// The item-page §D citation overlay needs THIS form's own citations, but
// `citations` has no `form_instance_id` column and is NEVER populated with
// `cited_source_document_id` for a form's own drafted responses --
// `draft-stream/route.ts` (~320-428) always writes
// `citing_kind='form_response'` + `citing_form_response_id=<response id>`,
// targeting `cited_q_a_pair_id`/`cited_reference_item_id` (never
// `cited_source_document_id`). The (wrong) axis the item-page previously
// read -- `GET /api/source-documents/[id]/citations`, filtering
// `cited_source_document_id = id` -- structurally never matches a
// procurement item's own citations.
//
// The CORRECT, live-today join is on the CITING side:
//   form_questions (form_instance_id = :id)
//     -> form_responses (question_id = form_questions.id)
//       -> citations (citing_kind='form_response', citing_form_response_id IN responses)
//
// Each `cited_kind='q_a_pair'` row is then enriched with
// `resolved_source_document_id`, resolved from `q_a_pairs.source_document_id`
// -- THAT (not `citations.cited_source_document_id`, always null on this
// axis) is the real spatial-overlay target for 147-I B1/B2 derivation, per
// PRODUCT §D1. A q_a_pair with no backing document (or a citation with no
// matched q_a_pair) resolves to `null` and stays text-anchored (§D3).
//
// Bare `.from()` throughout (api-schema discipline, supabase/CLAUDE.md) --
// `form_questions`/`form_responses`/`citations`/`q_a_pairs` are all already
// read this way elsewhere (draft-stream/route.ts, source-documents/[id]/
// citations/route.ts, q-a-pairs/[id]/route.ts) -- confirmed exposed via the
// `api` schema views; no `.schema('public')` override needed.
// ──────────────────────────────────────────

const CITATION_TARGET_KINDS = [
  'q_a_pair',
  'reference_item',
  'source_document',
  'concept',
] as const;

export type ProcurementCitationTargetKind =
  (typeof CITATION_TARGET_KINDS)[number];

export interface ProcurementCitationRow {
  id: string;
  cited_kind: Database['public']['Enums']['cited_target_kind'];
  citing_kind: Database['public']['Enums']['citing_entity_kind'];
  citation_type: string;
  cited_text: string | null;
  cited_start: number | null;
  cited_end: number | null;
  cited_location_kind: string | null;
  cited_q_a_pair_id: string | null;
  cited_reference_item_id: string | null;
  cited_source_document_id: string | null;
  cited_concept_path: string | null;
  created_at: string;
  /**
   * Resolved server-side from `q_a_pairs.source_document_id` for
   * `cited_kind='q_a_pair'` rows -- the ACTUAL backing document for B1/B2
   * spatial derivation (Checker F1 fix). `null` for every other kind, and
   * for a q_a_pair with no backing document.
   */
  resolved_source_document_id: string | null;
}

export type ProcurementCitationsByKind = Record<
  ProcurementCitationTargetKind,
  ProcurementCitationRow[]
>;

/**
 * Response envelope from this route -- declared here (the route handler)
 * and imported by `hooks/procurement/use-procurement-form-citations.ts`,
 * per the type-drift-detect conformance convention (response types live at
 * the route, hooks import from the route -- never the reverse).
 */
export interface ProcurementCitationsResponse {
  form_instance_id: string;
  citations: ProcurementCitationsByKind;
}

function emptyCitationsByKind(): ProcurementCitationsByKind {
  return {
    q_a_pair: [],
    reference_item: [],
    source_document: [],
    concept: [],
  };
}

function isTargetKind(value: string): value is ProcurementCitationTargetKind {
  return (CITATION_TARGET_KINDS as readonly string[]).includes(value);
}

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse<ProcurementCitationsResponse> | NextResponse> => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid ID format -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // This form's questions.
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select('id')
        .eq('form_instance_id', id);

      if (questionsError) {
        logger.error(
          { err: questionsError },
          'Failed to fetch form questions for citations read',
        );
        return NextResponse.json(
          { error: 'Failed to fetch citations' },
          { status: 500 },
        );
      }

      const questionIds = (questions ?? [])
        .map((q) => q.id)
        .filter((qid): qid is string => qid !== null);

      if (questionIds.length === 0) {
        return NextResponse.json({
          form_instance_id: id,
          citations: emptyCitationsByKind(),
        });
      }

      // This form's drafted responses (one per question, upserted by
      // draft-stream/route.ts on `onConflict: 'question_id'`).
      const { data: responses, error: responsesError } = await supabase
        .from('form_responses')
        .select('id')
        .in('question_id', questionIds);

      if (responsesError) {
        logger.error(
          { err: responsesError },
          'Failed to fetch form responses for citations read',
        );
        return NextResponse.json(
          { error: 'Failed to fetch citations' },
          { status: 500 },
        );
      }

      const responseIds = (responses ?? [])
        .map((r) => r.id)
        .filter((rid): rid is string => rid !== null);

      if (responseIds.length === 0) {
        return NextResponse.json({
          form_instance_id: id,
          citations: emptyCitationsByKind(),
        });
      }

      // The citing-side axis (the ONLY axis a form's own citations are ever
      // written on). Selects `cited_start`/`cited_end`/`cited_location_kind`
      // (absent from the source-documents citations route) so B1 derivation
      // gets its best-effort disambiguation hint.
      const { data: citations, error: citationsError } = await supabase
        .from('citations')
        .select(
          'id, cited_kind, citing_kind, citation_type, cited_text, cited_start, cited_end, cited_location_kind, cited_q_a_pair_id, cited_reference_item_id, cited_source_document_id, cited_concept_path, created_at',
        )
        .eq('citing_kind', 'form_response')
        .in('citing_form_response_id', responseIds)
        .order('created_at', { ascending: false });

      if (citationsError) {
        logger.error(
          { err: citationsError },
          'Failed to fetch citations for form',
        );
        return NextResponse.json(
          { error: 'Failed to fetch citations' },
          { status: 500 },
        );
      }

      // Cast: the interface above declares `cited_kind`/`citing_kind`
      // non-null (matching the source-documents citations route's own
      // `CitationSummary` cast precedent) -- the DB columns are nullable in
      // the generated types, but every row this app writes populates both.
      type RawCitationRow = Omit<
        ProcurementCitationRow,
        'resolved_source_document_id'
      >;
      const rows = (citations ?? []) as RawCitationRow[];

      // Resolve each q_a_pair citation's OWN backing document.
      const qaPairIds = [
        ...new Set(
          rows
            .map((r) => r.cited_q_a_pair_id)
            .filter((qid): qid is string => qid !== null),
        ),
      ];
      const sourceDocumentByQaPairId = new Map<string, string | null>();
      if (qaPairIds.length > 0) {
        const { data: qaPairs, error: qaPairsError } = await supabase
          .from('q_a_pairs')
          .select('id, source_document_id')
          .in('id', qaPairIds);

        if (qaPairsError) {
          // Non-fatal -- every citation just degrades to unresolved
          // (text-anchored, never a guessed box, §D3) rather than failing
          // the whole read.
          logger.error(
            { err: qaPairsError },
            'Failed to resolve q_a_pair backing documents for citations',
          );
        } else {
          for (const qaPair of qaPairs ?? []) {
            if (qaPair.id) {
              sourceDocumentByQaPairId.set(
                qaPair.id,
                qaPair.source_document_id,
              );
            }
          }
        }
      }

      const grouped = emptyCitationsByKind();
      for (const row of rows) {
        if (!isTargetKind(row.cited_kind)) continue;
        const enriched: ProcurementCitationRow = {
          ...row,
          resolved_source_document_id: row.cited_q_a_pair_id
            ? (sourceDocumentByQaPairId.get(row.cited_q_a_pair_id) ?? null)
            : null,
        };
        grouped[row.cited_kind].push(enriched);
      }

      return NextResponse.json({ form_instance_id: id, citations: grouped });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch citations') },
        { status: 500 },
      );
    }
  },
);
