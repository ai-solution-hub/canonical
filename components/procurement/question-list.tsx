'use client';

import { useMemo, useState } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { QuestionRow } from '@/components/procurement/question-row';
import type { ProcurementQuestion } from '@/types/procurement';

interface QuestionListProps {
  procurementId: string;
  questions: ProcurementQuestion[];
  canEdit: boolean;
  onQuestionsChanged: () => void;
}

interface GroupedSection {
  sectionName: string | null;
  sectionSequence: number;
  questions: ProcurementQuestion[];
}

function groupBySections(questions: ProcurementQuestion[]): GroupedSection[] {
  const sectionMap = new Map<string, GroupedSection>();

  for (const question of questions) {
    const key = question.section_name ?? '__ungrouped__';
    const existing = sectionMap.get(key);
    if (existing) {
      existing.questions.push(question);
    } else {
      sectionMap.set(key, {
        sectionName: question.section_name,
        sectionSequence: question.section_sequence,
        questions: [question],
      });
    }
  }

  const sections = Array.from(sectionMap.values());
  sections.sort((a, b) => a.sectionSequence - b.sectionSequence);

  for (const section of sections) {
    section.questions.sort((a, b) => a.question_sequence - b.question_sequence);
  }

  return sections;
}

export function QuestionList({
  procurementId,
  questions,
  canEdit,
  onQuestionsChanged,
}: QuestionListProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newQuestion, setNewQuestion] = useState({
    section_name: '',
    question_text: '',
    word_limit: '',
  });

  const sections = useMemo(() => groupBySections(questions), [questions]);

  function toggleSection(sectionKey: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }

  async function handleAddQuestion() {
    if (!newQuestion.question_text.trim()) {
      toast.error('Question text is required');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch(`/api/procurement/${procurementId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section_name: newQuestion.section_name.trim() || null,
          question_text: newQuestion.question_text.trim(),
          word_limit: newQuestion.word_limit
            ? parseInt(newQuestion.word_limit, 10)
            : null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? `Failed to add question (${res.status})`,
        );
      }

      toast.success('Question added');
      setNewQuestion({ section_name: '', question_text: '', word_limit: '' });
      setAddDialogOpen(false);
      onQuestionsChanged();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to add question';
      toast.error(message);
    } finally {
      setAdding(false);
    }
  }

  if (questions.length === 0 && !canEdit) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <HelpCircle
          className="size-8 text-muted-foreground/50"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          No questions have been added yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">
            {questions.length}{' '}
            {questions.length === 1 ? 'Question' : 'Questions'}
          </h3>
          {sections.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Across {sections.length} sections
            </p>
          )}
        </div>
        {canEdit && (
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" aria-hidden="true" />
                Add Question
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Question</DialogTitle>
                <DialogDescription>
                  Manually add a tender question to this bid.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="add-section-name">Section Name</Label>
                  <Input
                    id="add-section-name"
                    placeholder="e.g. Technical Approach"
                    value={newQuestion.section_name}
                    onChange={(e) =>
                      setNewQuestion((prev) => ({
                        ...prev,
                        section_name: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-question-text">
                    Question Text <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="add-question-text"
                    placeholder="Enter the tender question..."
                    rows={4}
                    value={newQuestion.question_text}
                    onChange={(e) =>
                      setNewQuestion((prev) => ({
                        ...prev,
                        question_text: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-word-limit">Word Limit</Label>
                  <Input
                    id="add-word-limit"
                    type="number"
                    placeholder="e.g. 500"
                    min={0}
                    value={newQuestion.word_limit}
                    onChange={(e) =>
                      setNewQuestion((prev) => ({
                        ...prev,
                        word_limit: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddDialogOpen(false)}
                  disabled={adding}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddQuestion} disabled={adding}>
                  {adding ? (
                    <>
                      <span className="sr-only">Adding question</span>
                      Adding...
                    </>
                  ) : (
                    'Add Question'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Empty state for editors */}
      {questions.length === 0 && canEdit && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Upload
            className="size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-muted-foreground">
            No questions yet. Upload a tender document or add questions
            manually.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add Question
            </Button>
          </div>
        </div>
      )}

      {/* Section groups */}
      {sections.map((section) => {
        const sectionKey = section.sectionName ?? '__ungrouped__';
        const isCollapsed = collapsedSections.has(sectionKey);

        return (
          <div key={sectionKey} className="space-y-1">
            {/* Section header */}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => toggleSection(sectionKey)}
              aria-expanded={!isCollapsed}
              aria-controls={`section-${sectionKey}`}
            >
              {isCollapsed ? (
                <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
              )}
              <span
                className={cn(
                  !section.sectionName && 'italic text-muted-foreground',
                )}
              >
                {section.sectionName ?? 'Ungrouped'}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {section.questions.length}{' '}
                {section.questions.length === 1 ? 'question' : 'questions'}
              </span>
            </button>

            {/* Question rows */}
            {!isCollapsed && (
              <div
                id={`section-${sectionKey}`}
                role="list"
                className="space-y-px"
              >
                {section.questions.map((question, index) => (
                  <QuestionRow
                    key={question.id}
                    question={question}
                    index={index + 1}
                    canEdit={canEdit}
                    procurementId={procurementId}
                    onUpdated={onQuestionsChanged}
                    onDeleted={onQuestionsChanged}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
