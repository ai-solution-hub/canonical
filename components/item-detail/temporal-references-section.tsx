'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TemporalReference, DateContextType, ConfidenceLevel } from '@/lib/date-extraction';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemporalReferencesSectionProps {
  /** Array of temporal references extracted from the content */
  temporalReferences: TemporalReference[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date as DD/MM/YYYY for UK display.
 */
function formatDateUK(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('en-GB');
  } catch {
    return isoDate;
  }
}

/**
 * Human-readable label for context types.
 */
const CONTEXT_TYPE_LABELS: Record<DateContextType, string> = {
  expiry: 'Expiry',
  effective: 'Effective',
  review: 'Review',
  publication: 'Publication',
  historical: 'Historical',
  unknown: 'Unknown',
};

/**
 * Styling for context type badges.
 * Uses semantic tokens — never raw Tailwind colours.
 */
const CONTEXT_TYPE_STYLES: Record<DateContextType, string> = {
  expiry: 'bg-freshness-stale-bg text-freshness-stale',
  effective: 'bg-freshness-fresh-bg text-freshness-fresh',
  review: 'bg-freshness-aging-bg text-freshness-aging',
  publication: 'bg-muted text-muted-foreground',
  historical: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

/**
 * Styling for confidence levels.
 */
const CONFIDENCE_STYLES: Record<ConfidenceLevel, string> = {
  high: 'text-freshness-fresh',
  medium: 'text-freshness-aging',
  low: 'text-muted-foreground',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Collapsible section showing temporal references extracted from content.
 *
 * Displays dates with their context types and confidence levels, giving
 * users visibility into what dates were auto-extracted by the date
 * extraction engine.
 *
 * Hidden when there are no temporal references.
 */
export function TemporalReferencesSection({
  temporalReferences,
}: TemporalReferencesSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!temporalReferences || temporalReferences.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        aria-controls="temporal-references-list"
      >
        <Calendar className="size-3.5" aria-hidden="true" />
        {expanded ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
        Extracted Dates ({temporalReferences.length})
      </button>

      {expanded && (
        <ul
          id="temporal-references-list"
          className="mt-2 space-y-2"
          role="list"
          aria-label="Temporal references extracted from content"
        >
          {temporalReferences.map((ref, index) => (
            <li
              key={`${ref.date}-${index}`}
              className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {formatDateUK(ref.date)}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    CONTEXT_TYPE_STYLES[ref.type] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {CONTEXT_TYPE_LABELS[ref.type] ?? ref.type}
                </span>
                <span
                  className={cn(
                    'text-[10px]',
                    CONFIDENCE_STYLES[ref.confidence] ?? 'text-muted-foreground',
                  )}
                  aria-label={`Confidence: ${ref.confidence}`}
                >
                  {ref.confidence}
                </span>
              </div>
              {ref.context && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {ref.context}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
