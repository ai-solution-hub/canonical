'use client';

import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type {
  ReviewFilters as ReviewFiltersType,
  ReviewStatsResponse,
} from '@/types/review';

interface ReviewFiltersProps {
  filters: ReviewFiltersType;
  onFiltersChange: (filters: ReviewFiltersType) => void;
  stats: ReviewStatsResponse | null;
  className?: string;
}

const STATUS_OPTIONS: Array<{
  value: ReviewFiltersType['status'];
  label: string;
}> = [
  { value: 'unverified', label: 'Unverified' },
  { value: 'verified', label: 'Verified' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'draft', label: 'Drafts' },
  { value: 'all', label: 'All' },
];

export function ReviewFilters({
  filters,
  onFiltersChange,
  stats,
  className = '',
}: ReviewFiltersProps) {
  const [open, setOpen] = useState(false);

  const activeFilterCount = [
    filters.status && filters.status !== 'unverified' ? 1 : 0,
    filters.domain?.length ? 1 : 0,
    filters.content_type?.length ? 1 : 0,
    filters.source_file ? 1 : 0,
    filters.source_document_id ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  // Build domain options from stats
  const domainOptions = stats?.by_domain
    ? Object.entries(stats.by_domain)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, counts]) => ({
          value: domain,
          label: domain,
          count: counts.total,
        }))
    : [];

  // Build content type options from stats
  const contentTypeOptions = stats?.by_content_type
    ? Object.entries(stats.by_content_type)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([type, counts]) => ({
          value: type,
          label: type.replace(/_/g, ' '),
          count: counts.total,
        }))
    : [];

  // Build source file options from stats
  const sourceFileOptions = stats?.by_source_file
    ? Object.entries(stats.by_source_file)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([file, counts]) => ({
          value: file,
          label: file,
          count: counts.total,
        }))
    : [];

  // Build source document options from stats
  const sourceDocumentOptions = stats?.by_source_document
    ? Object.entries(stats.by_source_document)
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([docId, counts]) => ({
          value: docId,
          label: counts.name,
          count: counts.total,
          verified: counts.verified,
        }))
    : [];

  const handleStatusChange = (status: ReviewFiltersType['status']) => {
    onFiltersChange({ ...filters, status });
  };

  const handleDomainToggle = (domain: string) => {
    const current = filters.domain ?? [];
    const updated = current.includes(domain)
      ? current.filter((d) => d !== domain)
      : [...current, domain];
    onFiltersChange({
      ...filters,
      domain: updated.length > 0 ? updated : undefined,
    });
  };

  const handleContentTypeToggle = (contentType: string) => {
    const current = filters.content_type ?? [];
    const updated = current.includes(contentType)
      ? current.filter((ct) => ct !== contentType)
      : [...current, contentType];
    onFiltersChange({
      ...filters,
      content_type: updated.length > 0 ? updated : undefined,
    });
  };

  const handleSourceFileChange = (file: string | undefined) => {
    onFiltersChange({ ...filters, source_file: file });
  };

  const handleSourceDocumentChange = (docId: string | undefined) => {
    onFiltersChange({ ...filters, source_document_id: docId });
  };

  const handleClearAll = () => {
    onFiltersChange({ status: 'unverified' });
  };

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="size-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-0.5 h-5 min-w-5 px-1 text-[10px]"
              >
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex flex-col divide-y divide-border">
            {/* Status filter */}
            <div className="p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <Button
                    key={value}
                    variant={
                      (filters.status ?? 'unverified') === value
                        ? 'default'
                        : 'outline'
                    }
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleStatusChange(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Domain filter */}
            {domainOptions.length > 0 && (
              <div className="max-h-48 overflow-y-auto p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Domain
                </h4>
                <div className="flex flex-col gap-1">
                  {domainOptions.map(({ value, label, count }) => {
                    const isSelected = filters.domain?.includes(value) ?? false;
                    return (
                      <button
                        key={value}
                        onClick={() => handleDomainToggle(value)}
                        aria-pressed={isSelected}
                        className={cn(
                          'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          isSelected && 'bg-accent font-medium',
                        )}
                      >
                        <span className="truncate">{label}</span>
                        <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Content type filter */}
            {contentTypeOptions.length > 0 && (
              <div className="max-h-48 overflow-y-auto p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Content type
                </h4>
                <div className="flex flex-col gap-1">
                  {contentTypeOptions.map(({ value, label, count }) => {
                    const isSelected =
                      filters.content_type?.includes(value) ?? false;
                    return (
                      <button
                        key={value}
                        onClick={() => handleContentTypeToggle(value)}
                        aria-pressed={isSelected}
                        className={cn(
                          'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          isSelected && 'bg-accent font-medium',
                        )}
                      >
                        <span className="truncate">{label}</span>
                        <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Source file filter */}
            {sourceFileOptions.length > 0 && (
              <div className="max-h-48 overflow-y-auto p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Source file
                </h4>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleSourceFileChange(undefined)}
                    className={cn(
                      'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      !filters.source_file && 'bg-accent font-medium',
                    )}
                  >
                    <span>All files</span>
                    <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {stats?.total ?? 0}
                    </span>
                  </button>
                  {sourceFileOptions.map(({ value, label, count }) => (
                    <button
                      key={value}
                      onClick={() => handleSourceFileChange(value)}
                      className={cn(
                        'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        filters.source_file === value &&
                          'bg-accent font-medium',
                      )}
                    >
                      <span className="truncate">{label}</span>
                      <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Source document filter */}
            {sourceDocumentOptions.length > 0 && (
              <div className="max-h-48 overflow-y-auto p-3">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Source document
                </h4>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleSourceDocumentChange(undefined)}
                    className={cn(
                      'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      !filters.source_document_id && 'bg-accent font-medium',
                    )}
                  >
                    <span>All documents</span>
                    <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {stats?.total ?? 0}
                    </span>
                  </button>
                  {sourceDocumentOptions.map(
                    ({ value, label, count, verified }) => (
                      <button
                        key={value}
                        onClick={() => handleSourceDocumentChange(value)}
                        className={cn(
                          'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          filters.source_document_id === value &&
                            'bg-accent font-medium',
                        )}
                      >
                        <span className="truncate">{label}</span>
                        <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {verified}/{count}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <div className="p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={handleClearAll}
                >
                  Clear all filters
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
