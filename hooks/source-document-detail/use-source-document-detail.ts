'use client';

/**
 * Surface B source_document detail hooks (ID-135 {135.13}, TECH §3
 * BI-25/BI-27/BI-28/BI-30, §4).
 *
 * Three per-section hooks, each an INDEPENDENT TanStack Query under its own
 * `sourceDocuments` key (BI-30 — never combined into one query or a
 * dependent chain): one section erroring/retrying must not abort the
 * others. `{135.14}`–`{135.18}` consume them separately.
 *
 * All three routes are VERIFIED SHIPPED on this branch:
 *   - `useDocumentVersions` → GET `/api/source-documents/[id]/versions`
 *     (the `get_document_version_chain` RPC, id-117).
 *   - `useDocumentCitations` → GET `/api/source-documents/[id]/citations`
 *     ({135.12}) — the id-131 BI-23 CITE-EXT 4-bucket grouped envelope.
 *   - `useDerivedPairs` → GET `/api/source-documents/[id]` (id-131 Path β /
 *     BND-1 `derived_pairs` field — published `q_a_pairs` rows).
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type {
  DocumentVersionRow,
  DocumentVersionsResponse,
} from '@/app/api/source-documents/[id]/versions/route';
import type {
  CitationTargetKind,
  CitationSummary,
  CitationsByKind,
  DocumentCitationsResponse,
} from '@/app/api/source-documents/[id]/citations/route';
import type { SourceDocumentDetailDerivedPairsSlice } from '@/app/api/source-documents/[id]/route';

// Re-exported for existing consumers (`DocumentVersionList`,
// `DocumentCitationsPanel`, their tests) that import these wire types from
// this hook module rather than the route files directly — the route files
// are the canonical declaration site (type-drift-detect conformance
// convention), this hook is a pass-through re-export, never the reverse.
export type {
  DocumentVersionRow,
  DocumentVersionsResponse,
  CitationTargetKind,
  CitationSummary,
  CitationsByKind,
  DocumentCitationsResponse,
};

// ---------------------------------------------------------------------------
// useDocumentVersions (BI-25)
// ---------------------------------------------------------------------------

/** The version chain (BI-25) — `DocumentVersionList`'s data source. */
export function useDocumentVersions(id: string) {
  return useQuery<DocumentVersionsResponse>({
    queryKey: queryKeys.sourceDocuments.versions(id),
    queryFn: () =>
      fetchJson<DocumentVersionsResponse>(
        `/api/source-documents/${id}/versions`,
      ),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// useDocumentCitations (BI-27)
// ---------------------------------------------------------------------------

/** The grouped-by-kind citations envelope (BI-27) — `DocumentCitationsPanel`'s data source. */
export function useDocumentCitations(id: string) {
  return useQuery<DocumentCitationsResponse>({
    queryKey: queryKeys.sourceDocuments.citations(id),
    queryFn: () =>
      fetchJson<DocumentCitationsResponse>(
        `/api/source-documents/${id}/citations`,
      ),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// useDerivedPairs (BI-28)
// ---------------------------------------------------------------------------

/** A published `q_a_pairs` row derived from this source document. */
export interface DerivedPair {
  id: string;
  question_text: string;
  answer_standard: string;
  publication_status: string;
  created_at: string;
}

/** Stable empty default (components/CLAUDE.md — never hand a fresh `[]`). */
const EMPTY_DERIVED_PAIRS: DerivedPair[] = [];

/**
 * Published derived `q_a_pairs` (BI-28) — `DerivedPairsList`'s data source.
 * Reads `derived_pairs` off the `[id]` route (re-pointed by id-131 Path β,
 * BND-1); this is its OWN independent query under `derivedPairs(id)`, kept
 * deliberately separate from the SD core-read (`sourceDocuments.detail(id)`)
 * per BI-30's independent-per-section contract.
 */
export function useDerivedPairs(id: string) {
  return useQuery<DerivedPair[]>({
    queryKey: queryKeys.sourceDocuments.derivedPairs(id),
    queryFn: async () => {
      const data = await fetchJson<SourceDocumentDetailDerivedPairsSlice>(
        `/api/source-documents/${id}`,
      );
      return data.derived_pairs ?? EMPTY_DERIVED_PAIRS;
    },
    enabled: !!id,
  });
}
