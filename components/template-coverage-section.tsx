'use client';

import { useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TemplateCoverageRequirement } from '@/components/template-coverage-requirement';
import type { RequirementCoverage } from '@/lib/template-coverage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateCoverageSectionProps {
  sectionRef: string;
  sectionName: string;
  requirements: RequirementCoverage[];
  defaultExpanded?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateCoverageSection({
  sectionRef,
  sectionName,
  requirements,
  defaultExpanded = false,
}: TemplateCoverageSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const counts = useMemo(() => {
    let strong = 0;
    let partial = 0;
    let gap = 0;
    let na = 0;
    for (const req of requirements) {
      switch (req.coverage_status) {
        case 'strong': strong++; break;
        case 'partial': partial++; break;
        case 'gap': gap++; break;
        case 'na': na++; break;
      }
    }
    return { strong, partial, gap, na };
  }, [requirements]);

  return (
    <section
      className="rounded-lg border border-border bg-card"
      aria-label={`${sectionRef} — ${sectionName}`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left',
          'transition-colors hover:bg-accent/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          expanded && 'border-b border-border',
        )}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium text-muted-foreground">{sectionRef}</span>
          <span className="ml-2 font-medium text-foreground">{sectionName}</span>
        </div>

        {/* Status counts */}
        <div className="flex shrink-0 items-center gap-1.5">
          {counts.strong > 0 && (
            <Badge variant="outline" className="border-confidence-strong-border bg-confidence-strong-bg text-confidence-strong text-[10px] px-1.5 py-0">
              {counts.strong} strong
            </Badge>
          )}
          {counts.partial > 0 && (
            <Badge variant="outline" className="border-confidence-partial-border bg-confidence-partial-bg text-confidence-partial text-[10px] px-1.5 py-0">
              {counts.partial} partial
            </Badge>
          )}
          {counts.gap > 0 && (
            <Badge variant="outline" className="border-confidence-none-border bg-confidence-none-bg text-confidence-none text-[10px] px-1.5 py-0">
              {counts.gap} {counts.gap === 1 ? 'gap' : 'gaps'}
            </Badge>
          )}
          {counts.na > 0 && (
            <span className="text-[10px] text-muted-foreground">{counts.na} n/a</span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-2 p-4">
          {requirements.map((req) => (
            <TemplateCoverageRequirement
              key={req.requirement_id}
              requirementId={req.requirement_id}
              requirementText={req.requirement_text}
              description={req.description}
              requirementType={req.requirement_type}
              coverageStatus={req.coverage_status}
              bestSimilarityScore={req.best_similarity_score}
              contentLengthMet={req.content_length_met}
              matchingContentIds={req.matching_content_ids}
            />
          ))}
        </div>
      )}
    </section>
  );
}
