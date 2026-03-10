'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/filter-section';
import { ContentTypeIcon } from '@/components/content-type-icon';
import { CONTENT_TYPES } from '@/lib/taxonomy';
import { formatContentType } from '@/lib/format';

interface ContentTypeFilterProps {
  selectedTypes: string[];
  counts: Record<string, number>;
  onToggle: (type: string) => void;
  /** Whether the section starts expanded (defaults to true) */
  defaultOpen?: boolean;
}

export function ContentTypeFilter({
  selectedTypes,
  counts,
  onToggle,
  defaultOpen = true,
}: ContentTypeFilterProps) {
  return (
    <FilterSection title="Content Type" defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-2">
        {CONTENT_TYPES.map((type) => (
          <label
            key={type}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={selectedTypes.includes(type)}
              onCheckedChange={() => onToggle(type)}
            />
            <ContentTypeIcon contentType={type} size="size-3.5" />
            <span className="flex-1 leading-none">
              {formatContentType(type)}
            </span>
            {counts[type] !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {counts[type]}
              </span>
            )}
          </label>
        ))}
      </div>
    </FilterSection>
  );
}
