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
  Monitor,
  ChevronDown,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

      {/* Display dropdown — consolidates view toggle, unread filter, thumbnails, multi-select */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            data-testid="display-menu"
          >
            <Monitor className="size-3.5" />
            <span className="hidden sm:inline">Display</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>View mode</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onViewChange('grid')}>
            <LayoutGrid className="size-4" />
            Grid view
            {viewMode === 'grid' && (
              <span className="ml-auto text-xs text-primary" aria-label="Active">
                &#10003;
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onViewChange('list')}>
            <List className="size-4" />
            List view
            {viewMode === 'list' && (
              <span className="ml-auto text-xs text-primary" aria-label="Active">
                &#10003;
              </span>
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Unread toggle */}
          <DropdownMenuItem onClick={onToggleUnreadOnly}>
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
    </div>
  );
}
