'use client';

/**
 * STUB — scaffolded by ID-145 {145.42} (145W-2), FILLED by {145.47}.
 *
 * {145.47} wires the reusable spatial-overlay primitive (147-H) + geometry
 * pipeline output (147-E/F) into a PDF-only fill-slot review surface (§C1-C4,
 * DR-064): detected `form_instance_fields` box-overlaid page-accurately on
 * the rendered PDF (via `HighlightArea` over `PdfDocument`); slot-list <->
 * overlay linkage is bidirectional and never colour-only; a DOCX/XLSX form
 * (or an unresolvable/NULL geometry) degrades to a plain list, never a
 * misaligned box (§C4). This stub renders a minimal placeholder — `formId`
 * is the only prop {145.47} needs to start from, so that subtask never has
 * to re-edit `page.tsx` for its own mount point.
 */
export interface ItemFillSlotReviewProps {
  formId: string;
  className?: string;
}

export function ItemFillSlotReview({ className }: ItemFillSlotReviewProps) {
  return (
    <div
      data-testid="item-fill-slot-review"
      className={className ?? 'rounded-lg border border-dashed p-3 text-sm'}
    >
      <p className="text-muted-foreground">
        Fill-slot review — ({'{145.47}'} wires the PDF spatial overlay here.)
      </p>
    </div>
  );
}
