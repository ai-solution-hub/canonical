'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  HumanReviewHighlight,
  type HighlightArea,
} from '@/components/procurement/extend/bounding-box-citations';

/**
 * Reusable spatial-overlay primitive — renders Extend `HighlightArea` boxes
 * over a rendered PDF page (`components/reader/pdf-document.tsx:PdfDocument`,
 * PRODUCT §C1-C4/§D1). Both the §C fill-slot list and the §D citations panel
 * consume this component; it takes geometry/`HighlightArea` as props and is
 * decoupled from the geometry pipeline landing (ID-147 TECH §3/§4) and from
 * `PdfDocument`'s internals — the host page supplies `currentPage`/
 * `goToPage` (mirroring `PdfDocument.goToPage`'s `(page: number) => void`
 * signature) and owns the shared selection id.
 *
 * The vendored `HumanReviewHighlight` (ID-147.6) supplies the highlighted
 * rectangle; this component layers an accessible, clickable, text/icon
 * labelled affordance on top so slot/box correspondence is never
 * colour-only (§C2/§C3/§J4, WCAG 2.1 AA).
 */
export interface SpatialOverlayBox {
  /** Shared selection id — the same id the consuming slot/citation list uses. */
  id: string;
  /** 1-based page number this box belongs to. */
  page: number;
  /** Percentage-space rectangle (0–100, top-left origin, no y-flip). */
  area: HighlightArea;
  /**
   * Visible text label for the box (e.g. a field name or fill status).
   * Always required — this is what keeps the correspondence non-colour-only.
   */
  label: string;
  /** Optional additive icon rendered alongside the label. */
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SpatialOverlayProps {
  /** All known boxes; only those matching `currentPage` are rendered. */
  boxes: SpatialOverlayBox[];
  /** The page `PdfDocument` currently has rendered. */
  currentPage: number;
  /** `PdfDocument.goToPage` (or an equivalent) — navigates the host viewer. */
  goToPage: (page: number) => void;
  /** The shared selection id — `null` when nothing is selected. */
  selectedId: string | null;
  /** Called when a box is clicked/activated (select box -> select item). */
  onSelect: (id: string) => void;
  className?: string;
}

/**
 * Renders the overlay layer for `currentPage` and keeps the host viewer in
 * sync with the shared selection id: selecting an item whose box lives on a
 * different page navigates there (select item -> scroll/highlight box).
 * Clicking a rendered box reports its id back up (select box -> select
 * item); the caller owns updating `selectedId`.
 */
export function SpatialOverlay({
  boxes,
  currentPage,
  goToPage,
  selectedId,
  onSelect,
  className,
}: SpatialOverlayProps) {
  React.useEffect(() => {
    if (!selectedId) return;

    const selectedBox = boxes.find((box) => box.id === selectedId);
    if (selectedBox && selectedBox.page !== currentPage) {
      goToPage(selectedBox.page);
    }
  }, [selectedId, boxes, currentPage, goToPage]);

  const pageBoxes = boxes.filter((box) => box.page === currentPage);

  if (pageBoxes.length === 0) return null;

  return (
    <div
      className={cn('pointer-events-none absolute inset-0', className)}
      data-slot="spatial-overlay"
    >
      {pageBoxes.map((box) => {
        const isSelected = box.id === selectedId;
        const Icon = box.icon;

        return (
          <div
            key={box.id}
            className="pointer-events-none absolute"
            style={{
              left: `${box.area.left}%`,
              top: `${box.area.top}%`,
              width: `${box.area.width}%`,
              height: `${box.area.height}%`,
            }}
          >
            <HumanReviewHighlight
              location={{ page: box.page, area: box.area }}
            />
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={box.label}
              onClick={() => onSelect(box.id)}
              className={cn(
                'pointer-events-auto absolute inset-0 size-full cursor-pointer rounded-sm border-2 bg-transparent p-0',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-none',
                isSelected ? 'border-ring' : 'border-transparent',
              )}
            />
            <Badge
              variant={isSelected ? 'default' : 'secondary'}
              className="pointer-events-none absolute -top-2 left-0 -translate-y-full gap-1 whitespace-nowrap"
            >
              {Icon ? <Icon className="size-3" /> : null}
              {isSelected ? `Selected: ${box.label}` : box.label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
