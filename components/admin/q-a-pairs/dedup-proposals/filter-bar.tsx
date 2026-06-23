'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { QaDedupStatusFilter } from '@/lib/query/fetchers';

interface QaDedupFilterBarProps {
  /** Currently-active status filter — drives the displayed queue. */
  status: QaDedupStatusFilter;
  /** Total proposals at the active filter (announced via aria-live). */
  totalCount: number;
  /** Called immediately with the new status filter. */
  onStatusChange: (next: QaDedupStatusFilter) => void;
}

const STATUS_OPTIONS: { value: QaDedupStatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

/**
 * Filter bar for the ID-120 {120.8} dedup-proposal queue (TECH P-4 / INV-19).
 *
 * A single Radix Select over the proposal status. Per CLAUDE.md
 * `feedback_radix_select_jsdom_shims`, component tests must call
 * `installRadixPointerShims()` in `beforeEach`. The visible count is announced
 * via `aria-live="polite"` so screen readers know when the queue refreshed.
 */
export function QaDedupFilterBar({
  status,
  totalCount,
  onStatusChange,
}: QaDedupFilterBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Dedup proposal filters"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <Label
          htmlFor="qa-dedup-status-filter"
          className="text-xs font-medium text-muted-foreground"
        >
          Status
        </Label>
        <Select
          value={status}
          onValueChange={(value) =>
            onStatusChange(value as QaDedupStatusFilter)
          }
        >
          <SelectTrigger
            id="qa-dedup-status-filter"
            size="sm"
            className="min-w-40"
            aria-label="Filter by proposal status"
          >
            <SelectValue placeholder="Pending" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p
        aria-live="polite"
        aria-atomic="true"
        className="ml-auto text-xs text-muted-foreground tabular-nums"
        data-testid="qa-dedup-proposal-count"
      >
        {totalCount} proposal{totalCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
