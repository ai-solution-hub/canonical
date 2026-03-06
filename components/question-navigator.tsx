'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ConfidencePosture =
  | 'strong_match'
  | 'partial_match'
  | 'needs_sme'
  | 'no_content';

interface NavigatorQuestion {
  id: string;
  question_text: string;
  section_name: string | null;
  confidence_posture: ConfidencePosture | string | null;
  status: string | null;
}

interface QuestionNavigatorProps {
  questions: NavigatorQuestion[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  className?: string;
}

const POSTURE_CONFIG: Record<
  ConfidencePosture,
  { label: string; colour: string; bgColour: string; sortOrder: number }
> = {
  strong_match: {
    label: 'Strong match',
    colour: 'text-confidence-strong',
    bgColour: 'bg-confidence-strong-bg',
    sortOrder: 0,
  },
  partial_match: {
    label: 'Partial match',
    colour: 'text-confidence-partial',
    bgColour: 'bg-confidence-partial-bg',
    sortOrder: 1,
  },
  needs_sme: {
    label: 'Needs SME',
    colour: 'text-confidence-needs-sme',
    bgColour: 'bg-confidence-needs-sme-bg',
    sortOrder: 2,
  },
  no_content: {
    label: 'No content',
    colour: 'text-muted-foreground',
    bgColour: 'bg-muted',
    sortOrder: 3,
  },
};

function getPostureConfig(posture: string | null) {
  return POSTURE_CONFIG[posture as ConfidencePosture] ?? POSTURE_CONFIG.no_content;
}

export function QuestionNavigator({
  questions,
  currentIndex,
  onNavigate,
  className,
}: QuestionNavigatorProps) {
  const prev = currentIndex > 0 ? questions[currentIndex - 1] : null;
  const next = currentIndex < questions.length - 1 ? questions[currentIndex + 1] : null;

  // Count by posture for the jump-to section
  const postureCounts = questions.reduce<Record<string, number>>((acc, q) => {
    const posture = q.confidence_posture ?? 'no_content';
    acc[posture] = (acc[posture] ?? 0) + 1;
    return acc;
  }, {});

  // Count completed
  const completedCount = questions.filter(
    (q) => q.status === 'complete' || q.status === 'approved',
  ).length;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Progress */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">
          Q{currentIndex + 1} of {questions.length}
        </span>
        <span className="text-muted-foreground">
          ({completedCount} complete)
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${(completedCount / questions.length) * 100}%` }}
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-label={`${completedCount} of ${questions.length} questions complete`}
        />
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate(currentIndex - 1)}
          disabled={!prev}
          className="flex-1"
          type="button"
        >
          <ChevronLeft className="size-4" />
          <span className="truncate text-xs">
            {prev ? `Q${currentIndex}: ${prev.section_name ?? prev.question_text.slice(0, 30)}` : 'Previous'}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate(currentIndex + 1)}
          disabled={!next}
          className="flex-1"
          type="button"
        >
          <span className="truncate text-xs">
            {next ? `Q${currentIndex + 2}: ${next.section_name ?? next.question_text.slice(0, 30)}` : 'Next'}
          </span>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Jump-to by posture */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Jump to
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(POSTURE_CONFIG) as [ConfidencePosture, typeof POSTURE_CONFIG[ConfidencePosture]][])
            .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
            .map(([posture, config]) => {
              const count = postureCounts[posture] ?? 0;
              if (count === 0) return null;

              // Find the first question with this posture
              const firstIndex = questions.findIndex(
                (q) => (q.confidence_posture ?? 'no_content') === posture,
              );

              return (
                <Button
                  key={posture}
                  variant="outline"
                  size="xs"
                  onClick={() => firstIndex >= 0 && onNavigate(firstIndex)}
                  className={cn(
                    'gap-1',
                    currentIndex === firstIndex && 'ring-1 ring-ring',
                  )}
                  type="button"
                >
                  <span className={cn('size-2 rounded-full', config.bgColour)} />
                  <span className={config.colour}>{config.label}</span>
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                    {count}
                  </Badge>
                </Button>
              );
            })}
        </div>
      </div>

      {/* Question dot navigator */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Question navigator">
        {questions.map((q, i) => {
          const config = getPostureConfig(q.confidence_posture);
          const isComplete = q.status === 'complete' || q.status === 'approved';
          const isCurrent = i === currentIndex;

          return (
            <button
              key={q.id}
              onClick={() => onNavigate(i)}
              className={cn(
                'size-3 rounded-full border transition-all',
                isCurrent && 'ring-2 ring-ring ring-offset-1',
                isComplete ? 'bg-confidence-strong border-confidence-strong-border' : config.bgColour + ' border-border',
              )}
              role="tab"
              aria-selected={isCurrent}
              aria-label={`Question ${i + 1}: ${q.section_name ?? q.question_text.slice(0, 50)}${isComplete ? ' (complete)' : ''}`}
              type="button"
            />
          );
        })}
      </div>
    </div>
  );
}
