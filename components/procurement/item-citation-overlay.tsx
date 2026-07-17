'use client';

/**
 * ID-145 {145.47} (TECH §3/§4, PRODUCT §D1-D5, DR-064).
 *
 * §D citations: a `q_a_pair` citation (ID-145 BI-37) that anchors to a span
 * in a PDF document renders as a `HighlightArea` overlay at the location
 * derived by 147-I B1 (`deriveTextLayerHighlight` — exact, text-layer
 * `Range`/`getClientRects()`, resolved against whichever page is currently
 * rendered) with bidirectional select against the (wired)
 * `CitationsPanelView`; an unresolved citation stays a text-anchored row
 * there instead, never a misplaced box (§D3); DOCX/XLSX citations stay
 * text-anchored (§D4, out of spatial-overlay v1); no citations -> the
 * panel's own honest empty state (§D5).
 *
 * CHECKER F1 FIX (correct citation-read axis, replacing an earlier wrong
 * assumption): `citations` has NO `form_instance_id` column, and a
 * procurement item's own drafted-response citations are written by
 * `draft-stream/route.ts` with `citing_kind='form_response'` +
 * `citing_form_response_id=<response id>` — `cited_source_document_id` is
 * NEVER populated on that axis. Reading `useDocumentCitations(formId)`
 * (the `cited_source_document_id = id` axis) was structurally wrong and
 * would never render in production, regardless of any future schema
 * bridge. The correct, LIVE-TODAY join is on the CITING side:
 *   form_questions (form_instance_id = formId)
 *     -> form_responses (question_id = form_questions.id)
 *       -> citations (citing_kind='form_response', citing_form_response_id IN responses)
 * — `useProcurementFormCitations` (GET /api/procurement/[id]/citations)
 * performs exactly this join, server-side, and additionally resolves each
 * `q_a_pair` citation's OWN backing document
 * (`q_a_pairs.source_document_id`) as `resolved_source_document_id` — THAT,
 * not `citations.cited_source_document_id`, is the real B1/B2 spatial
 * target. Different citations may resolve to DIFFERENT backing documents
 * (each answer can draw on different evidence), so this component groups
 * citations by their resolved document and renders one overlay pane per
 * distinct document (`CitationDocumentOverlayPane`) — 0, 1, or many.
 *
 * KNOWN GAP (B2 vision fallback not UI-wired): the live B2 vision call
 * (`deriveVisionHighlightLive`, lib/domains/procurement/citation-vision-rasterise.ts)
 * is wired and tested at the lib level (this Subtask's CRITICAL RIDER), but
 * triggering it automatically from a rendered PDF would require exposing
 * the underlying pdf.js `PDFPageProxy` from `PdfDocument` for
 * self-rasterisation — out of this dispatch's scope. B1-only citations
 * still degrade correctly to text-anchored per §D3 (never a wrong box).
 */
import * as React from 'react';
import { FileQuestion } from 'lucide-react';
// ssr:false wrapper — react-pdf needs DOMMatrix, absent in Node SSR ({145.49}).
import { PdfDocumentLazy as PdfDocument } from '@/components/reader/pdf-document-lazy';
import {
  SpatialOverlay,
  type SpatialOverlayBox,
} from '@/components/procurement/extend/spatial-overlay';
import {
  deriveTextLayerHighlight,
  type HighlightArea,
} from '@/lib/domains/procurement/citation-highlight-derivation';
import { CitationsPanelView } from '@/components/source-document-detail/document-citations-panel';
import {
  useProcurementFormCitations,
  type ProcurementCitationRow,
} from '@/hooks/procurement/use-procurement-form-citations';
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

/** Stable empty default (components/CLAUDE.md) — `citationsData?.q_a_pair ?? []` would create a fresh reference every render, churning the useMemo/useCallback deps below. */
const EMPTY_QA_PAIR_CITATIONS: ProcurementCitationRow[] = [];

export function ItemCitationOverlay({
  formId,
  className,
}: ItemCitationOverlayProps) {
  const { data, isLoading, isError, refetch } =
    useProcurementFormCitations(formId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [resolvedAreas, setResolvedAreas] = React.useState<
    Map<string, ResolvedCitationArea>
  >(new Map());

  // §D1 scope: only `q_a_pair` citations are spatially overlaid — reference
  // items / source documents / concepts stay text-anchored in the panel
  // regardless of geometry resolution (PRODUCT §D1).
  const qaPairCitationsData = data?.citations.q_a_pair;
  const qaPairCitations = React.useMemo(
    () => qaPairCitationsData ?? EMPTY_QA_PAIR_CITATIONS,
    [qaPairCitationsData],
  );

  // Group by RESOLVED backing document — different q_a_pair citations may
  // cite different evidence documents, so §D1 overlay is per-citation, not
  // per-form. Citations with no resolved document stay text-anchored only.
  const citationsByDocument = React.useMemo(() => {
    const map = new Map<string, ProcurementCitationRow[]>();
    for (const citation of qaPairCitations) {
      if (!citation.resolved_source_document_id) continue;
      const existing = map.get(citation.resolved_source_document_id);
      if (existing) {
        existing.push(citation);
      } else {
        map.set(citation.resolved_source_document_id, [citation]);
      }
    }
    return map;
  }, [qaPairCitations]);

  const handleSelect = React.useCallback((citationId: string) => {
    setSelectedId(citationId);
  }, []);

  const markResolved = React.useCallback(
    (citationId: string, resolved: ResolvedCitationArea) => {
      setResolvedAreas((prev) => {
        const next = new Map(prev);
        next.set(citationId, resolved);
        return next;
      });
    },
    [],
  );

  const resolvedCitationIds = React.useMemo(
    () => new Set(resolvedAreas.keys()),
    [resolvedAreas],
  );

  return (
    <div
      data-testid="item-citation-overlay"
      className={className ?? 'space-y-3 rounded-lg border p-3'}
    >
      <h3 className="text-sm font-medium text-foreground">Citation overlay</h3>
      {[...citationsByDocument.entries()].map(([documentId, citations]) => (
        <CitationDocumentOverlayPane
          key={documentId}
          documentId={documentId}
          citations={citations}
          selectedId={selectedId}
          resolvedAreas={resolvedAreas}
          onSelect={handleSelect}
          onResolve={markResolved}
        />
      ))}
      <CitationsPanelView
        citations={data?.citations}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        selectedId={selectedId}
        onSelectCitation={handleSelect}
        resolvedCitationIds={resolvedCitationIds}
      />
    </div>
  );
}

/**
 * One PDF spatial-overlay pane for a single resolved backing document —
 * §D4: if the document isn't a PDF (or its binary hasn't resolved yet),
 * renders nothing; its citations simply stay text-anchored in the panel
 * below, never a misplaced/guessed box.
 */
function CitationDocumentOverlayPane({
  documentId,
  citations,
  selectedId,
  resolvedAreas,
  onSelect,
  onResolve,
}: {
  documentId: string;
  citations: ProcurementCitationRow[];
  selectedId: string | null;
  resolvedAreas: Map<string, ResolvedCitationArea>;
  onSelect: (citationId: string) => void;
  onResolve: (citationId: string, resolved: ResolvedCitationArea) => void;
}) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const { data: binary } = useCitationDocumentBinary(documentId);
  const isPdfDocument = binary?.mime_type === PDF_MIME_TYPE;

  const handleTextLayerRenderSuccess = React.useCallback(
    (page: number, textLayerRoot: Element) => {
      for (const citation of citations) {
        if (resolvedAreas.has(citation.id) || !citation.cited_text) continue;
        const result = deriveTextLayerHighlight(textLayerRoot, {
          cited_text: citation.cited_text,
          cited_start: citation.cited_start,
          cited_end: citation.cited_end,
        });
        if (result.status === 'mapped') {
          onResolve(citation.id, { page, area: result.area });
        }
      }
    },
    [citations, resolvedAreas, onResolve],
  );

  if (!binary || !isPdfDocument) return null;

  const boxes: SpatialOverlayBox[] = citations.flatMap((citation) => {
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
            onSelect={onSelect}
          />
        )}
      />
    </div>
  );
}
