'use client';

/**
 * STUB — scaffolded by ID-145 {145.42} (145W-2), FILLED by {145.47}.
 *
 * {145.47} wires citation derivation (147-I: text-layer `getClientRects`
 * primary path, Claude-vision-coordinate fallback) into a bidirectional
 * citation overlay (§D1-D5, DR-064): a PDF citation renders as an overlay at
 * the derived location with bidirectional select against
 * `document-citations-panel.tsx`; an unresolvable citation renders as a
 * text-anchored entry there instead, never a misplaced box (§D3); DOCX/XLSX
 * citations stay text-anchored (§D4); no citations -> honest empty state
 * (§D5). This stub renders a minimal placeholder — `formId` is the only prop
 * {145.47} needs to start from, so that subtask never has to re-edit
 * `page.tsx` for its own mount point.
 */
export interface ItemCitationOverlayProps {
  formId: string;
  className?: string;
}

export function ItemCitationOverlay({ className }: ItemCitationOverlayProps) {
  return (
    <div
      data-testid="item-citation-overlay"
      className={className ?? 'rounded-lg border border-dashed p-3 text-sm'}
    >
      <p className="text-muted-foreground">
        Citation overlay — ({'{145.47}'} wires the bounding-box citation overlay
        here.)
      </p>
    </div>
  );
}
