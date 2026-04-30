'use client';

import { useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const THRESHOLD_MIN = 0.85;
const THRESHOLD_MAX = 0.99;
const THRESHOLD_STEP = 0.01;
export const THRESHOLD_DEBOUNCE_MS = 300;

const ALL_DOMAINS = '__all__';

interface NearDuplicatesFilterBarProps {
  /** Currently-active threshold (committed) — drives the displayed list. */
  threshold: number;
  /** Currently-active domain filter, or undefined for "all domains". */
  domain: string | undefined;
  /** Total candidate pairs at the active threshold (for aria-live count). */
  totalCount: number;
  /** Optional list of domain values to render in the dropdown. */
  availableDomains?: string[];
  /** Called with the new threshold AFTER the debounce window elapses. */
  onThresholdCommit: (next: number) => void;
  /** Called immediately with the new domain (no debounce). */
  onDomainChange: (next: string | undefined) => void;
}

/**
 * Filter bar for the §1.9 near-duplicate dashboard.
 *
 * Two controls:
 *  - Threshold slider (`<input type="range">`, native — matches the
 *    existing pattern at `components/intelligence/workspace-settings.tsx`).
 *    Bounded `0.85-0.99`, step 0.01, default 0.95. Local state tracks the
 *    pending value while the admin drags; a 300ms debounce commits the
 *    final value via `onThresholdCommit`. WCAG: full ARIA value attrs +
 *    numeric label rendered alongside the bar.
 *  - Domain filter (Radix Select) constrained to `availableDomains` plus
 *    an "All" sentinel. Per CLAUDE.md `feedback_radix_select_jsdom_shims`,
 *    component tests must call `installRadixPointerShims()` in beforeEach.
 *
 * The visible pair count is announced via `aria-live="polite"` so screen
 * readers know when a slider drag has settled and the list refreshed.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.1.
 */
export function NearDuplicatesFilterBar({
  threshold,
  domain,
  totalCount,
  availableDomains = [],
  onThresholdCommit,
  onDomainChange,
}: NearDuplicatesFilterBarProps) {
  // Local pending value — what the slider thumb shows mid-drag. Distinct
  // from `threshold` (the committed value driving the query). The parent
  // remounts this component (`key={threshold}`) on every commit so the
  // initialiser below picks up the new prop without a setState-in-effect
  // (CLAUDE.md "Reset local state via `key` prop, not `setState` in
  // effect" gotcha).
  const [pending, setPending] = useState(threshold);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(event.target.value);
    setPending(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onThresholdCommit(next);
    }, THRESHOLD_DEBOUNCE_MS);
  };

  const handleDomainChange = (value: string) => {
    if (value === ALL_DOMAINS) {
      onDomainChange(undefined);
    } else {
      onDomainChange(value);
    }
  };

  const formattedThreshold = pending.toFixed(2);

  return (
    <div
      role="toolbar"
      aria-label="Near-duplicate filters"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="near-dup-threshold"
            className="text-sm font-medium text-foreground"
          >
            Similarity threshold
          </Label>
          <span
            className="font-mono text-sm font-semibold tabular-nums text-foreground"
            data-testid="near-dup-threshold-value"
          >
            {formattedThreshold}
          </span>
        </div>
        <input
          id="near-dup-threshold"
          type="range"
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          step={THRESHOLD_STEP}
          value={pending}
          onChange={handleSliderChange}
          aria-valuemin={THRESHOLD_MIN}
          aria-valuemax={THRESHOLD_MAX}
          aria-valuenow={pending}
          aria-valuetext={`${formattedThreshold} similarity threshold`}
          aria-describedby="near-dup-threshold-help"
          data-testid="near-dup-threshold-slider"
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>0.85 (noisier)</span>
          <span>0.95 (default)</span>
          <span>0.99 (near-exact)</span>
        </div>
        <p
          id="near-dup-threshold-help"
          className="text-xs text-muted-foreground"
        >
          Pairs with cosine similarity at or above this threshold appear below.
          Lower = more pairs (and more false positives), higher = stricter.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="near-dup-domain-filter"
            className="text-xs font-medium text-muted-foreground"
          >
            Domain
          </Label>
          <Select
            value={domain ?? ALL_DOMAINS}
            onValueChange={handleDomainChange}
          >
            <SelectTrigger
              id="near-dup-domain-filter"
              size="sm"
              className="min-w-40"
              aria-label="Filter by domain"
            >
              <SelectValue placeholder="All domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DOMAINS}>All domains</SelectItem>
              {availableDomains.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p
          aria-live="polite"
          aria-atomic="true"
          className="ml-auto text-xs text-muted-foreground tabular-nums"
          data-testid="near-dup-pair-count"
        >
          {totalCount} candidate pair{totalCount === 1 ? '' : 's'} &ge;{' '}
          {threshold.toFixed(2)}
        </p>
      </div>
    </div>
  );
}
