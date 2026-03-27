'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckSquare, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ExtractedQuestionEntry {
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number | null;
  category: string;
}

interface QuestionReviewProps {
  bidId: string;
  questions: ExtractedQuestionEntry[];
  onConfirmed: () => void;
  onCancelled: () => void;
}

export function QuestionReview({
  bidId,
  questions,
  onConfirmed,
  onCancelled,
}: QuestionReviewProps) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set(questions.map((_, i) => i)),
  );
  const [confirming, setConfirming] = useState(false);

  const selectedCount = selectedIndices.size;
  const allSelected = selectedCount === questions.length;
  const noneSelected = selectedCount === 0;
  const informationalCount = useMemo(
    () => questions.filter((q) => q.category === 'informational').length,
    [questions],
  );

  const toggleIndex = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIndices(new Set(questions.map((_, i) => i)));
  }, [questions]);

  const deselectAll = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  async function handleConfirm() {
    if (noneSelected) {
      toast.error('No questions selected');
      return;
    }

    setConfirming(true);
    try {
      const selectedQuestions = questions.filter((_, i) => selectedIndices.has(i));

      const res = await fetch(`/api/bids/${bidId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: selectedQuestions }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to save questions (${res.status})`);
      }

      toast.success(`${selectedCount} questions confirmed and saved`);
      onConfirmed();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save questions';
      toast.error(message);
    } finally {
      setConfirming(false);
    }
  }

  // Group questions by section for display
  const sections = useMemo(() => {
    const sectionMap = new Map<
      string,
      { sectionName: string; sectionSequence: number; entries: Array<{ question: ExtractedQuestionEntry; originalIndex: number }> }
    >();

    questions.forEach((question, index) => {
      const key = question.section_name;
      const existing = sectionMap.get(key);
      if (existing) {
        existing.entries.push({ question, originalIndex: index });
      } else {
        sectionMap.set(key, {
          sectionName: question.section_name,
          sectionSequence: question.section_sequence,
          entries: [{ question, originalIndex: index }],
        });
      }
    });

    const result = Array.from(sectionMap.values());
    result.sort((a, b) => a.sectionSequence - b.sectionSequence);

    for (const section of result) {
      section.entries.sort((a, b) => a.question.question_sequence - b.question.question_sequence);
    }

    return result;
  }, [questions]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">
            Review Extracted Questions
          </h3>
          <p className="text-xs text-muted-foreground">
            {questions.length} questions found across {sections.length} sections.
            Deselect any that should not be imported.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={selectAll}
            disabled={allSelected || confirming}
          >
            <CheckSquare className="size-3" aria-hidden="true" />
            Select All
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={deselectAll}
            disabled={noneSelected || confirming}
          >
            <Square className="size-3" aria-hidden="true" />
            Deselect All
          </Button>
        </div>
      </div>

      {/* Informational warning */}
      {informationalCount > 0 && (
        <div
          className="flex items-start gap-2 rounded-md border border-status-warning bg-quality-moderate-bg p-3"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden="true" />
          <p className="text-xs text-status-warning">
            {informationalCount} {informationalCount === 1 ? 'question is' : 'questions are'}{' '}
            categorised as informational (administrative). These are marked with a warning
            icon and may not require a bid response.
          </p>
        </div>
      )}

      {/* Questions by section */}
      <div className="space-y-4 rounded-md border p-3">
        {sections.map((section) => (
          <div key={`${section.sectionSequence}-${section.sectionName}`}>
            {/* Section header */}
            <div className="mb-2 flex items-center gap-2 border-b pb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {section.sectionName}
              </span>
              <span className="text-xs text-muted-foreground">
                ({section.entries.length} {section.entries.length === 1 ? 'question' : 'questions'})
              </span>
            </div>

            {/* Question entries */}
            <div className="space-y-1">
              {section.entries.map(({ question, originalIndex }) => {
                const isSelected = selectedIndices.has(originalIndex);
                const isInformational = question.category === 'informational';
                const checkboxId = `question-review-${originalIndex}`;

                return (
                  <label
                    key={originalIndex}
                    htmlFor={checkboxId}
                    className={cn(
                      'flex items-start gap-3 rounded-md px-2 py-2 cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-primary/5 hover:bg-primary/10'
                        : 'opacity-60 hover:opacity-80',
                      confirming && 'pointer-events-none',
                    )}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={isSelected}
                      onCheckedChange={() => toggleIndex(originalIndex)}
                      disabled={confirming}
                      className="mt-0.5"
                      aria-label={`Select question ${question.question_sequence}: ${question.question_text.substring(0, 50)}`}
                    />

                    {/* Sequence number */}
                    <span className="w-5 shrink-0 text-right text-xs font-mono text-muted-foreground mt-0.5">
                      {question.question_sequence}
                    </span>

                    {/* Question content */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm leading-relaxed">
                        {question.question_text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {question.word_limit && (
                          <span className="text-xs text-muted-foreground">
                            Word limit: {question.word_limit}
                          </span>
                        )}
                        {isInformational && (
                          <Badge variant="outline" className="gap-1 text-status-warning border-status-warning">
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            Informational
                          </Badge>
                        )}
                        {question.category !== 'informational' && (
                          <Badge variant="secondary" className="text-xs">
                            {question.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-xs text-muted-foreground">
          {selectedCount} of {questions.length} questions selected
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancelled} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={noneSelected || confirming}>
            {confirming ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Confirming...
              </>
            ) : (
              `Confirm ${selectedCount} ${selectedCount === 1 ? 'Question' : 'Questions'}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
