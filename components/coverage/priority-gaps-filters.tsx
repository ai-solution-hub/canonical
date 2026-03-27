'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { cn } from '@/lib/utils';
import type { PriorityTier } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceFilter = 'all' | 'taxonomy' | 'template' | 'guide';
export type PriorityFilter = 'all' | PriorityTier;

interface PriorityGapsFiltersProps {
  source: SourceFilter;
  priority: PriorityFilter;
  domain: string;
  onSourceChange: (value: SourceFilter) => void;
  onPriorityChange: (value: PriorityFilter) => void;
  onDomainChange: (value: string) => void;
}

// ---------------------------------------------------------------------------
// Toggle button helper
// ---------------------------------------------------------------------------

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn('min-h-[44px] min-w-[44px]')}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Main filter bar
// ---------------------------------------------------------------------------

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'taxonomy', label: 'Taxonomy' },
  { value: 'template', label: 'Templates' },
  { value: 'guide', label: 'Guides' },
];

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function PriorityGapsFilters({
  source,
  priority,
  domain,
  onSourceChange,
  onPriorityChange,
  onDomainChange,
}: PriorityGapsFiltersProps) {
  const { getDomainNames, formatDomainName } = useTaxonomy();
  const domainNames = getDomainNames();

  return (
    <div
      className="flex flex-wrap items-center gap-4"
      role="toolbar"
      aria-label="Gap filters"
    >
      {/* Source filter */}
      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">Filter by source</legend>
        <span className="text-xs font-medium text-muted-foreground">
          Source:
        </span>
        <div className="flex gap-1" role="group" aria-label="Source filter">
          {SOURCE_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              active={source === opt.value}
              onClick={() => onSourceChange(opt.value)}
            >
              {opt.label}
            </ToggleButton>
          ))}
        </div>
      </fieldset>

      {/* Priority filter */}
      <fieldset className="flex items-center gap-1.5">
        <legend className="sr-only">Filter by priority</legend>
        <span className="text-xs font-medium text-muted-foreground">
          Priority:
        </span>
        <div className="flex gap-1" role="group" aria-label="Priority filter">
          {PRIORITY_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.value}
              active={priority === opt.value}
              onClick={() => onPriorityChange(opt.value)}
            >
              {opt.label}
            </ToggleButton>
          ))}
        </div>
      </fieldset>

      {/* Domain dropdown */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Domain:
        </span>
        <Select value={domain} onValueChange={onDomainChange}>
          <SelectTrigger
            className="min-h-[44px] w-[180px]"
            aria-label="Filter by domain"
          >
            <SelectValue placeholder="All domains" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All domains</SelectItem>
            {domainNames.map((name) => (
              <SelectItem key={name} value={name}>
                {formatDomainName(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
