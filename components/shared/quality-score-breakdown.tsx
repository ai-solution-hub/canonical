'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  calculateQualityScore,
  type QualityScoreInput,
  type QualityScoreResult,
} from '@/lib/quality/quality-score';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityScoreBreakdownProps {
  item: QualityScoreInput;
}

// ---------------------------------------------------------------------------
// Component configuration
// ---------------------------------------------------------------------------

const COMPONENT_CONFIG: Array<{
  key: keyof QualityScoreResult['components'];
  label: string;
  max: number;
}> = [
  { key: 'freshness', label: 'Freshness', max: 30 },
  { key: 'confidence', label: 'Classification', max: 20 },
  { key: 'completeness', label: 'Completeness', max: 20 },
  { key: 'summary', label: 'AI Summary', max: 15 },
  { key: 'citations', label: 'Citations', max: 15 },
];

// ---------------------------------------------------------------------------
// Colour mapping — reuses the same semantic tokens as QualityBadge
// ---------------------------------------------------------------------------

function getLabelClasses(label: QualityScoreResult['label']): {
  text: string;
  bg: string;
} {
  switch (label) {
    case 'Excellent':
      return { text: 'text-quality-good', bg: 'bg-quality-good-bg' };
    case 'Good':
      return { text: 'text-primary', bg: 'bg-primary/10' };
    case 'Fair':
      return { text: 'text-quality-moderate', bg: 'bg-quality-moderate-bg' };
    case 'Needs Work':
      return { text: 'text-freshness-stale', bg: 'bg-freshness-stale-bg' };
    case 'Poor':
      return { text: 'text-destructive', bg: 'bg-destructive/10' };
  }
}

function getBarFillClass(label: QualityScoreResult['label']): string {
  switch (label) {
    case 'Excellent':
      return 'bg-quality-good';
    case 'Good':
      return 'bg-primary';
    case 'Fair':
      return 'bg-quality-moderate';
    case 'Needs Work':
      return 'bg-freshness-stale';
    case 'Poor':
      return 'bg-destructive';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Expandable quality score breakdown for the metadata sidebar.
 *
 * Shows a compact badge with the overall score and label, with a click-to-expand
 * section revealing the 5 weighted component scores as labelled progress bars.
 *
 * WCAG 2.1 AA: pairs colour with numeric values and text labels -- never colour
 * alone for meaning. Uses semantic tokens only.
 */
export function QualityScoreBreakdown({ item }: QualityScoreBreakdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const result = calculateQualityScore(item);
  const { text, bg } = getLabelClasses(result.label);
  const barFill = getBarFillClass(result.label);

  return (
    <div>
      <dt className="text-xs text-muted-foreground">Quality Score</dt>
      <dd>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="mt-0.5 flex w-full items-center gap-2 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-expanded={isOpen}
          aria-controls="quality-score-breakdown"
        >
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
              text,
              bg,
            )}
          >
            <span className="font-semibold">{result.score}</span>
            <span className="text-[11px]">{result.label}</span>
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>

        {isOpen && (
          <div
            id="quality-score-breakdown"
            className="mt-2 flex flex-col gap-2"
            role="region"
            aria-label="Quality score component breakdown"
          >
            {COMPONENT_CONFIG.map(({ key, label, max }) => {
              const value = result.components[key];
              const percentage = max > 0 ? (value / max) * 100 : 0;

              return (
                <div key={key} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                    <span className="text-xs tabular-nums text-foreground">
                      {value}/{max}
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={value}
                    aria-valuemin={0}
                    aria-valuemax={max}
                    aria-label={`${label}: ${value} out of ${max}`}
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        barFill,
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </dd>
    </div>
  );
}
