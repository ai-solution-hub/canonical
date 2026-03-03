'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/filter-section';
import { formatSubtopic } from '@/lib/taxonomy';

interface SubtopicFilterProps {
  domainName: string;
  subtopics: readonly string[];
  selectedSubtopic: string;
  onToggle: (subtopic: string) => void;
}

export function SubtopicFilter({
  domainName,
  subtopics,
  selectedSubtopic,
  onToggle,
}: SubtopicFilterProps) {
  return (
    <FilterSection title={`Subtopic (${domainName})`}>
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
