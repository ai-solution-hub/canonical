'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/filter-section';
import { PLATFORMS } from '@/lib/taxonomy';
import { formatPlatform } from '@/lib/format';

interface PlatformFilterProps {
  selectedPlatforms: string[];
  counts: Record<string, number>;
  onToggle: (platform: string) => void;
}

export function PlatformFilter({
  selectedPlatforms,
  counts,
  onToggle,
}: PlatformFilterProps) {
  return (
    <FilterSection title="Platform">
      <div className="flex flex-col gap-2">
        {PLATFORMS.map((platform) => (
          <label
            key={platform}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={selectedPlatforms.includes(platform)}
              onCheckedChange={() => onToggle(platform)}
            />
            <span className="flex-1 leading-none">
              {formatPlatform(platform)}
            </span>
            {counts[platform] !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {counts[platform]}
              </span>
            )}
          </label>
        ))}
      </div>
    </FilterSection>
  );
}
