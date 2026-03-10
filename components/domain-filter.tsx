'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/filter-section';
import { useTaxonomy } from '@/contexts/taxonomy-context';

interface DomainFilterProps {
  selectedDomains: string[];
  counts: Record<string, number>;
  onToggle: (domain: string) => void;
  /** Whether the section starts expanded (defaults to true) */
  defaultOpen?: boolean;
}

export function DomainFilter({
  selectedDomains,
  counts,
  onToggle,
  defaultOpen = true,
}: DomainFilterProps) {
  const { getDomainNames, formatDomainName } = useTaxonomy();
  const domainNames = getDomainNames();

  return (
    <FilterSection title="Domain" defaultOpen={defaultOpen}>
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
            <span className="flex-1 leading-none">{formatDomainName(domain)}</span>
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
