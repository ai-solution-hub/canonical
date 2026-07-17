'use client';

/**
 * §D citation-overlay read (ID-145 {145.47} Checker F1 fix, TECH §3/§4,
 * PRODUCT §D1-D5). Wraps the NEW `GET /api/procurement/[id]/citations`
 * route — the form's own citing-side citations (form_questions ->
 * form_responses -> citations), each `q_a_pair` row enriched server-side
 * with `resolved_source_document_id` (from `q_a_pairs.source_document_id`,
 * the real B1/B2 spatial-overlay target). Response types are declared at
 * the route and re-exported here per the type-drift-detect conformance
 * convention (route is the canonical declaration site).
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type {
  ProcurementCitationRow,
  ProcurementCitationsByKind,
  ProcurementCitationsResponse,
  ProcurementCitationTargetKind,
} from '@/app/api/procurement/[id]/citations/route';

export type {
  ProcurementCitationRow,
  ProcurementCitationsByKind,
  ProcurementCitationsResponse,
  ProcurementCitationTargetKind,
};

/** The §D citation-overlay surface's data source (`ItemCitationOverlay`). */
export function useProcurementFormCitations(formId: string) {
  return useQuery<ProcurementCitationsResponse>({
    queryKey: queryKeys.procurement.citations(formId),
    queryFn: () =>
      fetchJson<ProcurementCitationsResponse>(
        `/api/procurement/${formId}/citations`,
      ),
    enabled: !!formId,
  });
}
