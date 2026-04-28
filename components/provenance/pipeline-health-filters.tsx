'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

const TIME_RANGES = ['1h', '24h', '7d', '30d'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

const RANGE_LABELS: Record<TimeRange, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export interface PipelineHealthFiltersProps {
  /** Available pipeline kinds extracted from the rollup. */
  availableKinds: readonly string[];
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export default function PipelineHealthFilters({
  availableKinds,
}: PipelineHealthFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentRange = (searchParams.get('range') as TimeRange) || '24h';
  const currentKinds = useMemo(() => {
    const raw = searchParams.get('kinds');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === null || val === '') {
          params.delete(key);
        } else {
          params.set(key, val);
        }
      }
      // Reset cursor when filters change
      params.delete('cursor_started_at');
      params.delete('cursor_id');
      router.push(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const handleRangeChange = useCallback(
    (range: TimeRange) => {
      updateParams({ range });
    },
    [updateParams],
  );

  const toggleKind = useCallback(
    (kind: string) => {
      const next = currentKinds.includes(kind)
        ? currentKinds.filter((k) => k !== kind)
        : [...currentKinds, kind];
      updateParams({ kinds: next.length > 0 ? next.join(',') : null });
    },
    [currentKinds, updateParams],
  );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      {/* Time range segmented control */}
      <div
        role="group"
        aria-label="Time range"
        className="inline-flex rounded-md border bg-muted p-0.5"
      >
        {TIME_RANGES.map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => handleRangeChange(range)}
            className={cn(
              'rounded-sm px-3 py-1 text-sm font-medium transition-colors',
              range === currentRange
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={range === currentRange}
          >
            {RANGE_LABELS[range]}
          </button>
        ))}
      </div>

      {/* Kind filter pills */}
      {availableKinds.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Pipeline filter"
        >
          {availableKinds.map((kind) => {
            const active = currentKinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                )}
                aria-pressed={active}
              >
                {kind.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
