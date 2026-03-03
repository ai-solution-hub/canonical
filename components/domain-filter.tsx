'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/filter-section';
import { getDomainNames } from '@/lib/taxonomy';

interface DomainFilterProps {
  selectedDomains: string[];
  counts: Record<string, number>;
  onToggle: (domain: string) => void;
}

const domainNames = getDomainNames();

export function DomainFilter({
  selectedDomains,
  counts,
  onToggle,
}: DomainFilterProps) {
  return (
    <FilterSection title="Domain">
      <div className="flex flex-col gap-2">
        {domainNames.map((domain) => (
          <label
            key={domain}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={selectedDomains.includes(domain)}
              onCheckedChange={() => onToggle(domain)}
            />
            <span className="flex-1 leading-none">{domain}</span>
            {counts[domain] !== undefined && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {counts[domain]}
              </span>
            )}
          </label>
        ))}
      </div>
    </FilterSection>
  );
}
