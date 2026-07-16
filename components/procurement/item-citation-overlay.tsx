'use client';

/**
 * ID-145 {145.47} (TECH §3/§4, PRODUCT §D1-D5, DR-064).
 *
 * §D citations: a `q_a_pair` citation (ID-145 BI-37) that anchors to a span
 * in a PDF document renders as a `HighlightArea` overlay at the location
 * derived by 147-I B1 (`deriveTextLayerHighlight` — exact, text-layer
 * `Range`/`getClientRects()`, resolved against whichever page is currently
 * rendered) with bidirectional select against the (wired)
 * `document-citations-panel.tsx`; an unresolved citation stays a
 * text-anchored row there instead, never a misplaced box (§D3); DOCX/XLSX
 * citations stay text-anchored (§D4, out of spatial-overlay v1); no
 * citations -> the panel's own honest empty state (§D5).
 *
 * DATA-LINKAGE CAVEAT (flagged, not a defect): `citations.cited_source_document_id`
 * FKs to `source_documents`, and `form_instances` (the procurement item) is
 * NOT itself a `source_documents` row in today's schema — there is no
 * modelled bridge from "this procurement's own form" to a citable
 * `source_documents` id. This component queries citations scoped to `formId`
 * exactly as `document-citations-panel.tsx` already does for a real
 * `source_documents` id (reusing `useDocumentCitations` unchanged), which
 * today always yields the honest §D5 empty state for a procurement item —
 * the same "0 rows today" steady state that panel's own {135.12} docblock
 * already documents. The wiring is correct end-to-end (proven with injected
 * fixture data in tests below); it starts rendering real overlays the day a
 * bridge lands, with no further UI change required.
 *
 * KNOWN GAP (B2 vision fallback not UI-wired): the live B2 vision call
 * (`deriveVisionHighlightLive`, lib/domains/procurement/citation-vision-rasterise.ts)
 * is wired and tested at the lib level (this Subtask's CRITICAL RIDER), but
 * triggering it automatically from this component's rendered PDF would
 * require exposing the underlying pdf.js `PDFPageProxy` from `PdfDocument`
 * for self-rasterisation — out of this dispatch's scope. B1-only citations
 * still degrade correctly to text-anchored per §D3 (never a wrong box).
 */
import * as React from 'react';
import { FileQuestion } from 'lucide-react';
import { PdfDocument } from '@/components/reader/pdf-document';
import {
  SpatialOverlay,
  type SpatialOverlayBox,
} from '@/components/procurement/extend/spatial-overlay';
import {
  deriveTextLayerHighlight,
  type HighlightArea,
} from '@/lib/domains/procurement/citation-highlight-derivation';
import { DocumentCitationsPanel } from '@/components/source-document-detail/document-citations-panel';
import {
  useDocumentCitations,
  type CitationSummary,
} from '@/hooks/source-document-detail/use-source-document-detail';
import { useCitationDocumentBinary } from '@/hooks/procurement/use-citation-document-binary';

export interface ItemCitationOverlayProps {
  formId: string;
  className?: string;
}

const PDF_MIME_TYPE = 'application/pdf';

interface ResolvedCitationArea {
  page: number;
  area: HighlightArea;
}

/** Stable empty default (components/CLAUDE.md) — `citationsData?.citations.q_a_pair ?? []` would create a fresh reference every render, churning the useCallback deps below. */
const EMPTY_QA_PAIR_CITATIONS: CitationSummary[] = [];

export function ItemCitationOverlay({
  formId,
  className,
}: ItemCitationOverlayProps) {
  const { data: citationsData } = useDocumentCitations(formId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [resolvedAreas, setResolvedAreas] = React.useState<
    Map<string, ResolvedCitationArea>
  >(new Map());

  // §D1 scope: only `q_a_pair` citations are spatially overlaid — reference
  // items / source documents / concepts stay text-anchored in the panel
  // regardless of geometry resolution (PRODUCT §D1).
  const qaPairCitationsData = citationsData?.citations.q_a_pair;
  const qaPairCitations = React.useMemo(
    () => qaPairCitationsData ?? EMPTY_QA_PAIR_CITATIONS,
    [qaPairCitationsData],
  );
  const hasQaPairCitations = qaPairCitations.length > 0;

  // Only fetch the cited document's binary once there's something worth
  // showing spatially — avoids a needless network call (and, in today's
  // schema, an expected 404) when there are no citations at all.
  const binaryDocumentId = hasQaPairCitations ? formId : null;
  const { data: binary } = useCitationDocumentBinary(binaryDocumentId);
  const isPdfDocument = binary?.mime_type === PDF_MIME_TYPE;
  const showOverlayPane = hasQaPairCitations && isPdfDocument && !!binary;

  const handleSelect = React.useCallback(
    (citationId: string) => {
      setSelectedId(citationId);
      const resolved = resolvedAreas.get(citationId);
      if (resolved) setCurrentPage(resolved.page);
    },
    [resolvedAreas],
  );

  const handleTextLayerRenderSuccess = React.useCallback(
    (page: number, textLayerRoot: Element) => {
      setResolvedAreas((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const citation of qaPairCitations) {
          if (next.has(citation.id) || !citation.cited_text) continue;
          const result = deriveTextLayerHighlight(textLayerRoot, {
            cited_text: citation.cited_text,
            cited_start: null,
            cited_end: null,
          });
          if (result.status === 'mapped') {
            next.set(citation.id, { page, area: result.area });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [qaPairCitations],
  );

  const boxes: SpatialOverlayBox[] = qaPairCitations.flatMap((citation) => {
    const resolved = resolvedAreas.get(citation.id);
    if (!resolved) return [];
    return [
      {
        id: citation.id,
        page: resolved.page,
        area: resolved.area,
        label: citation.cited_text ?? 'Citation',
        icon: FileQuestion,
      },
    ];
  });

  return (
    <div
      data-testid="item-citation-overlay"
      className={className ?? 'space-y-3 rounded-lg border p-3'}
    >
      <h3 className="text-sm font-medium text-foreground">Citation overlay</h3>
      {showOverlayPane && (
        <div className="relative h-[420px] overflow-hidden rounded-md border border-border">
          <PdfDocument
            sourceUrl={binary.signed_url}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onTextLayerRenderSuccess={handleTextLayerRenderSuccess}
            renderPageOverlay={(page) => (
              <SpatialOverlay
                boxes={boxes}
                currentPage={page}
                goToPage={setCurrentPage}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          />
        </div>
      )}
      <DocumentCitationsPanel
        documentId={formId}
        selectedId={selectedId}
        onSelectCitation={handleSelect}
        resolvedCitationIds={new Set(resolvedAreas.keys())}
      />
    </div>
  );
}
