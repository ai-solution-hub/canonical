'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * SectionErrorState — the ONE shared BI-30 per-section error/retry chrome
 * (id-135 {135.18} convergence pass, S456 session steer).
 *
 * `DocumentVersionList` ({135.15}), `DocumentCitationsPanel` ({135.16}), and
 * `DerivedPairsList` ({135.17}) each own an INDEPENDENT TanStack query
 * (BI-30 — one section erroring/retrying must never fail the others or the
 * wider Surface-B detail page). Before this convergence pass each of those
 * three hand-rolled its own error/retry markup — two were near-identical
 * copies and the third (`DerivedPairsList`) was a visually divergent
 * bespoke block. This component is the single markup implementation all
 * three now render; `heading`/`message`/`retryLabel` stay caller-supplied so
 * each section keeps its own wording — this converges the MARKUP, not the
 * copy.
 */
export interface SectionErrorStateProps {
  /** e.g. "Couldn't load version history". */
  heading: string;
  /** e.g. "Something went wrong while loading version history. This is usually temporary." */
  message: string;
  /** Button label — sections' existing copy differs ("Try again" vs "Retry"). */
  retryLabel?: string;
  onRetry: () => void;
}

export function SectionErrorState({
  heading,
  message,
  retryLabel = 'Try again',
  onRetry,
}: SectionErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center"
    >
      <AlertCircle className="size-8 text-destructive/70" aria-hidden="true" />
      <h3 className="mt-3 text-sm font-medium text-foreground">{heading}</h3>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
        {retryLabel}
      </Button>
    </div>
  );
}
