'use client';

import {
  LayoutGrid,
  List,
  SlidersHorizontal,
  ArrowUpDown,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
  Image as ImageIcon,
  ImageOff,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ViewMode = 'grid' | 'list';

export type SortOption =
  | 'relevance'
  | 'date-desc'
  | 'date-asc'
  | 'domain'
  | 'confidence'
  | 'freshness-stale'
  | 'quality-lowest';

/** Base sort options always available */
const BASE_SORT_OPTIONS: {
  value: SortOption;
  label: string;
  shortLabel: string;
}[] = [
  { value: 'date-desc', label: 'Date (newest)', shortLabel: 'Newest' },
  { value: 'date-asc', label: 'Date (oldest)', shortLabel: 'Oldest' },
  { value: 'domain', label: 'Domain', shortLabel: 'Domain' },
  { value: 'confidence', label: 'Confidence', shortLabel: 'Conf.' },
  {
    value: 'freshness-stale',
    label: 'Freshness (most stale)',
    shortLabel: 'Stale',
  },
  { value: 'quality-lowest', label: 'Quality (lowest)', shortLabel: 'Quality' },
];

/** Relevance sort option — only shown when a search query is active */
const RELEVANCE_SORT_OPTION: {
  value: SortOption;
  label: string;
  shortLabel: string;
} = {
  value: 'relevance',
  label: 'Relevance',
  shortLabel: 'Relevance',
};

/** Returns sort options including Relevance when a search query is active */
export function getSortOptions(hasSearchQuery: boolean) {
  return hasSearchQuery
    ? [RELEVANCE_SORT_OPTION, ...BASE_SORT_OPTIONS]
    : BASE_SORT_OPTIONS;
}

interface FilterBarProps {
  showUnreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  multiSelectMode: boolean;
  onToggleMultiSelect: () => void;
  sortOption: SortOption;
  onSortChange: (value: SortOption) => void;
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  hideThumbnails: boolean;
  onToggleThumbnails: () => void;
  activeFilterCount: number;
  onOpenFilters: () => void;
  /** When true, includes "Relevance" in the sort options */
  hasSearchQuery?: boolean;
}

export function FilterBar({
  showUnreadOnly,
  onToggleUnreadOnly,
  multiSelectMode,
  onToggleMultiSelect,
  sortOption,
  onSortChange,
  viewMode,
  onViewChange,
  hideThumbnails,
  onToggleThumbnails,
  activeFilterCount,
  onOpenFilters,
  hasSearchQuery = false,
}: FilterBarProps) {
  const sortOptions = getSortOptions(hasSearchQuery);
  return (
    <div className="flex items-center justify-between gap-2">
      {/* Left group: view controls */}
      <div className="flex items-center gap-2">
        {/* View toggle */}
        <div
          className="flex rounded-md border"
          role="group"
          aria-label="View mode"
        >
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => onViewChange('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            className="rounded-r-none border-r border-border"
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => onViewChange('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            className="rounded-l-none"
          >
            <List className="size-4" />
          </Button>
        </div>

        {/* Sort */}
        <Select value={sortOption} onValueChange={onSortChange}>
          <SelectTrigger
            size="sm"
            className="w-auto gap-1.5"
            aria-label="Sort by"
          >
            <ArrowUpDown className="size-3.5" />
            <span className="hidden sm:inline">
              <SelectValue />
            </span>
            <span className="sm:hidden">
              {sortOptions.find((o) => o.value === sortOption)?.shortLabel}
            </span>
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {sortOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Divider */}
      <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

      {/* Right group: content controls */}
      <div className="flex items-center gap-2">
        {/* Unread only toggle (visible on desktop, in overflow on mobile) */}
        <Button
          variant={showUnreadOnly ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onToggleUnreadOnly}
          className="hidden gap-1.5 sm:inline-flex"
          aria-label={showUnreadOnly ? 'Show all items' : 'Show unread only'}
          aria-pressed={showUnreadOnly}
        >
          {showUnreadOnly ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
          {showUnreadOnly ? 'Unread' : 'All'}
        </Button>

        {/* Filter button */}
        <Button
          variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
          size="sm"
          onClick={onOpenFilters}
          className="relative gap-1.5"
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <Badge
              variant="default"
              className="ml-0.5 size-5 justify-center p-0 text-[10px] tabular-nums"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More options">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Unread toggle (mobile only — hidden on desktop where it's inline) */}
            <DropdownMenuItem
              className="sm:hidden"
              onClick={onToggleUnreadOnly}
            >
              {showUnreadOnly ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )}
              {showUnreadOnly ? 'Show all items' : 'Show unread only'}
            </DropdownMenuItem>

            {/* Select items */}
            <DropdownMenuItem onClick={onToggleMultiSelect}>
              {multiSelectMode ? (
                <CheckSquare className="size-4" />
              ) : (
                <Square className="size-4" />
              )}
              {multiSelectMode ? 'Cancel selection' : 'Select items'}
            </DropdownMenuItem>

            {/* Toggle thumbnails (grid only) */}
            {viewMode === 'grid' && (
              <DropdownMenuItem onClick={onToggleThumbnails}>
                {hideThumbnails ? (
                  <ImageIcon className="size-4" />
                ) : (
                  <ImageOff className="size-4" />
                )}
                {hideThumbnails ? 'Show thumbnails' : 'Hide thumbnails'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
