'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/browse/filter-section';
import { useTaxonomy } from '@/contexts/taxonomy-context';

interface SubtopicFilterProps {
  domainName: string;
  subtopics: readonly string[] | string[];
  selectedSubtopic: string;
  onToggle: (subtopic: string) => void;
  /** Whether the section starts expanded (defaults to true) */
  defaultOpen?: boolean;
}

export function SubtopicFilter({
  domainName,
  subtopics,
  selectedSubtopic,
  onToggle,
  defaultOpen = true,
}: SubtopicFilterProps) {
  const { formatSubtopic, formatDomainName } = useTaxonomy();

  return (
    <FilterSection title={`Subtopic (${formatDomainName(domainName)})`} defaultOpen={defaultOpen}>
      <div className="flex flex-col gap-2">
        {subtopics.map((subtopic) => (
          <label
            key={subtopic}
            className="flex items-center gap-2 cursor-pointer text-sm"
          >
            <Checkbox
              checked={selectedSubtopic === subtopic}
              onCheckedChange={() => onToggle(subtopic)}
            />
            <span className="leading-none">{formatSubtopic(subtopic)}</span>
          </label>
        ))}
      </div>
    </FilterSection>
  );
}
