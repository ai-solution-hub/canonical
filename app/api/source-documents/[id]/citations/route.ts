import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { tryQuery } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/**
 * ID-135.12 (TECH §3 BI-27, §4, AAT-4) — citations read for the
 * source-document detail page ({135.16} `DocumentCitationsPanel`).
 *
 * Reads the id-131 BI-23 CITE-EXT `cited_target_kind` enum. The migration
 * retiring the legacy `content_item` branch (`cited_kind` CHECK constraint —
 * see supabase/migrations/20260706110000_id131_drops.sql) leaves 4 surviving
 * target kinds: `q_a_pair | reference_item | source_document | concept`.
 * This route groups citation rows into those 4 buckets, always present, so
 * {135.16} never has to guard against a missing key.
 *
 * `citations` is 0 rows in production today (the extended CITE-EXT read
 * consumers land with the id-131 {131.11} G-cluster — a Task-level
 * dependency, not a subtask dependency of this route). Absence of rows is
 * the expected steady state and MUST return HTTP 200 with every bucket
 * empty, never an error — the panel renders a clear empty state.
 *
 * Query scope (today's schema): `citations.cited_source_document_id = id`
 * — rows where something (currently only `citing_kind = 'form_response'`)
 * cites this document. The reverse direction ("what this document cites")
 * has no representable column yet — `citing_entity_kind` does not include
 * `source_document` — so it naturally yields zero rows until the id-131
 * G-cluster extends the schema; the grouping logic itself is kind-agnostic
 * and already designed against the 4-kind extended contract (AAT-4).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CITATION_TARGET_KINDS = [
  'q_a_pair',
  'reference_item',
  'source_document',
  'concept',
] as const;

export type CitationTargetKind = (typeof CITATION_TARGET_KINDS)[number];

export interface CitationSummary {
  id: string;
  cited_kind: Database['public']['Enums']['cited_target_kind'];
  citing_kind: Database['public']['Enums']['citing_entity_kind'];
  citation_type: string;
  cited_text: string | null;
  cited_q_a_pair_id: string | null;
  cited_reference_item_id: string | null;
  cited_source_document_id: string | null;
  cited_concept_path: string | null;
  created_at: string;
}

export type CitationsByKind = Record<CitationTargetKind, CitationSummary[]>;

/**
 * Response envelope from this route (id-135 {135.12}/{135.13} BI-27) —
 * declared here (the route handler) and imported by
 * `hooks/source-document-detail/use-source-document-detail.ts`'s
 * `useDocumentCitations`, per the type-drift-detect conformance convention
 * (response types live at the route, hooks import from the route — never the
 * reverse; see `app/api/review/history/route.ts` / `ReviewHistoryEntry` for
 * the precedent pair).
 */
export interface DocumentCitationsResponse {
  document_id: string;
  citations: CitationsByKind;
}

function emptyCitationsByKind(): CitationsByKind {
  return {
    q_a_pair: [],
    reference_item: [],
    source_document: [],
    concept: [],
  };
}

function isTargetKind(value: string): value is CitationTargetKind {
  return (CITATION_TARGET_KINDS as readonly string[]).includes(value);
}

function groupByCitedKind(rows: CitationSummary[]): CitationsByKind {
  const grouped = emptyCitationsByKind();
  for (const row of rows) {
    // Defensive: the legacy `content_item` branch is mid-retirement (id-131
    // {131.19} M6) — a lingering pre-drop row must not crash the grouping.
    if (isTargetKind(row.cited_kind)) {
      grouped[row.cited_kind].push(row);
    }
  }
  return grouped;
}

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse<DocumentCitationsResponse> | NextResponse> => {
    try {
      const authResult = await getAuthenticatedClient();
      if (!authResult.success) return authFailureResponse(authResult);

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid document ID format' },
          { status: 400 },
        );
      }

      const serviceClient = createServiceClient();

      const result = await tryQuery(
        serviceClient
          .from('citations')
          .select(
            'id, cited_kind, citing_kind, citation_type, cited_text, cited_q_a_pair_id, cited_reference_item_id, cited_source_document_id, cited_concept_path, created_at',
          )
          .eq('cited_source_document_id', id)
          .order('created_at', { ascending: false }),
        'citations.bySourceDocument',
      );

      if (!result.ok) {
        return NextResponse.json(
          {
            error: safeErrorMessage(result.error, 'Failed to fetch citations'),
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        document_id: id,
        citations: groupByCitedKind((result.data ?? []) as CitationSummary[]),
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch citations') },
        { status: 500 },
      );
    }
  },
);
