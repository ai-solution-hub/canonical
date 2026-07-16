'use client';

/**
 * §D citation-target document binary read (ID-145 {145.47}, TECH §3/§4,
 * PRODUCT §D1/§D4). `ItemCitationOverlay` needs the CITED document's own
 * signed URL + mime_type to know whether to render a PDF spatial overlay
 * (§D1) or leave citations text-anchored (§D4, DOCX/XLSX). Wraps the
 * existing `GET /api/source-documents/[id]/binary-url` route (id-117
 * {117.6}) — no new backend.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

export interface CitationDocumentBinary {
  signed_url: string;
  expires_in: number;
  mime_type: string;
}

/**
 * `documentId` is nullable — pass `null` to skip the fetch (e.g. before it's
 * known there are any citations worth resolving spatially, per §D1's
 * q_a_pair-only scope).
 */
export function useCitationDocumentBinary(documentId: string | null) {
  return useQuery<CitationDocumentBinary>({
    queryKey: queryKeys.sourceDocuments.binaryUrl(documentId ?? ''),
    queryFn: () =>
      fetchJson<CitationDocumentBinary>(
        `/api/source-documents/${documentId}/binary-url`,
      ),
    enabled: !!documentId,
  });
}
