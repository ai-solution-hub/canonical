'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavigatorQuestion {
  id: string;
  question_text: string;
  section_name: string | null;
  status: string | null;
}

interface QuestionNavigatorProps {
  questions: NavigatorQuestion[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  className?: string;
}

export function QuestionNavigator({
  questions,
  currentIndex,
  onNavigate,
  className,
}: QuestionNavigatorProps) {
  const prev = currentIndex > 0 ? questions[currentIndex - 1] : null;
  const next =
    currentIndex < questions.length - 1 ? questions[currentIndex + 1] : null;

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
          style={{
            width: `${questions.length > 0 ? (completedCount / questions.length) * 100 : 0}%`,
          }}
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
            {prev
              ? `Q${currentIndex}: ${prev.section_name ?? prev.question_text.slice(0, 30)}`
              : 'Previous'}
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
            {next
              ? `Q${currentIndex + 2}: ${next.section_name ?? next.question_text.slice(0, 30)}`
              : 'Next'}
          </span>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Question dot navigator */}
      <div
        className="flex flex-wrap gap-1"
        role="toolbar"
        aria-label="Question navigator"
      >
        {questions.map((q, i) => {
          const isComplete = q.status === 'complete' || q.status === 'approved';
          const isCurrent = i === currentIndex;
          const statusText = isComplete ? 'Complete' : 'Incomplete';
          const tooltipText = `Q${i + 1}: ${statusText}`;

          return (
            <button
              key={q.id}
              onClick={() => onNavigate(i)}
              className={cn(
                'size-3 rounded-full border transition-all',
                isCurrent && 'ring-2 ring-ring ring-offset-1',
                isComplete
                  ? 'bg-confidence-strong border-confidence-strong-border'
                  : 'bg-muted border-border',
              )}
              role="button"
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={`Question ${i + 1}: ${q.section_name ?? q.question_text.slice(0, 50)} — ${statusText}`}
              title={tooltipText}
              type="button"
            />
          );
        })}
      </div>
    </div>
  );
}
