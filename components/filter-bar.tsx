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

export type ViewMode = 'grid' | 'list';

export type SortOption = 'date-desc' | 'date-asc' | 'domain' | 'confidence';

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date-desc', label: 'Date (newest)' },
  { value: 'date-asc', label: 'Date (oldest)' },
  { value: 'domain', label: 'Domain' },
  { value: 'confidence', label: 'Confidence' },
];

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
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Unread only toggle */}
      <Button
        variant={showUnreadOnly ? 'secondary' : 'ghost'}
        size="sm"
        onClick={onToggleUnreadOnly}
        className="gap-1.5"
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

      {/* Multi-select toggle (hidden on mobile) */}
      <Button
        variant={multiSelectMode ? 'secondary' : 'ghost'}
        size="sm"
        onClick={onToggleMultiSelect}
        className="hidden gap-1.5 sm:inline-flex"
        aria-label={multiSelectMode ? 'Cancel selection' : 'Select items'}
        aria-pressed={multiSelectMode}
      >
        {multiSelectMode ? (
          <CheckSquare className="size-3.5" />
        ) : (
          <Square className="size-3.5" />
        )}
        Select
      </Button>

      {/* Sort */}
      <Select value={sortOption} onValueChange={onSortChange}>
        <SelectTrigger size="sm" className="w-auto gap-1.5">
          <ArrowUpDown className="size-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* View toggle */}
      <div className="flex rounded-md border border-border" role="group" aria-label="View mode">
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

      {/* Thumbnail toggle (grid only, hidden on mobile) */}
      {viewMode === 'grid' && (
        <Button
          variant={hideThumbnails ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={onToggleThumbnails}
          aria-label={hideThumbnails ? 'Show thumbnails' : 'Hide thumbnails'}
          title={hideThumbnails ? 'Show thumbnails' : 'Hide thumbnails'}
          className="hidden sm:inline-flex"
        >
          {hideThumbnails ? (
            <ImageOff className="size-4" />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </Button>
      )}

      {/* Filter button */}
      <Button
        variant="outline"
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
