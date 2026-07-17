'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  FileQuestion,
  HelpCircle,
  Loader2,
  PenLine,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ConfidenceBadge } from '@/components/shared/confidence-badge';
import { cn } from '@/lib/utils';
import type { ProcurementQuestion } from '@/types/procurement';

/**
 * ID-145 {145.44} (BI-40 — UI-vs-Claude split). Renders the question surfaces
 * consuming the {145.18} question shape: mixed per-question states
 * (drafted/approved/matched/empty) shown HONESTLY — no all-or-nothing
 * framing. A zero-candidate question (no usable match — `confidence_posture`
 * is `null`/`no_content`, i.e. no `question_matches` candidate cleared even
 * the minimal similarity bar, {145.17}) surfaces a manual-answer affordance
 * with TWO acts (fix dispatch on the {145.44} Checker FAIL — BI-40's literal
 * contract): (1) the PRIMARY, deterministic act — save the answer directly
 * against this question via `POST /api/procurement/[id]/responses/manual`,
 * so the question leaves the "empty" state immediately, never contingent on
 * a later re-match clearing `MATCH_THRESHOLDS`; (2) an OPTIONAL, SEPARATE
 * secondary act — also add the same answer to the knowledge base as a
 * `manually_authored` `q_a_pairs` row via the existing `/api/q-a-pairs/batch`
 * route (ID-131 {131.21}), closing the BI-22 gap loop / feeding BI-24
 * cataloguing. This is deliberately NOT primary drafting/authoring UI (that
 * stays with the secondary drafting stack, {145.45}) — it is a narrow
 * fallback for questions the corpus cannot currently answer at all.
 */
export interface ItemQuestionsPanelProps {
  procurementId: string;
  questions: ProcurementQuestion[];
  canEdit: boolean;
  totalQuestions: number;
  unmatchedCount?: number;
  onMatchQuestions?: () => void;
  onDraftAll?: () => void;
  draftingAll?: boolean;
  onQuestionsChanged?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Honest per-question state derivation (BI-40)
// ---------------------------------------------------------------------------

type QuestionRenderState = 'approved' | 'drafted' | 'matched' | 'empty';

const QUESTION_STATE_CONFIG: Record<
  QuestionRenderState,
  {
    label: string;
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    className: string;
  }
> = {
  approved: {
    label: 'Approved',
    icon: CheckCircle2,
    className: 'text-status-success',
  },
  drafted: {
    label: 'Drafted',
    icon: CircleDot,
    className: 'text-status-warning',
  },
  matched: {
    label: 'Matched',
    icon: Search,
    className: 'text-primary',
  },
  empty: {
    label: 'No match found',
    icon: FileQuestion,
    className: 'text-confidence-none',
  },
};

/**
 * Derives the honest per-question render state from the {145.18} question
 * shape. Priority: an approved response outranks a merely-drafted one; a
 * drafted response (any review_status short of approved) outranks a bare
 * match candidate; a real match candidate (`confidence_posture` other than
 * `no_content`/`null` — `needs_sme` still means at least one candidate
 * cleared the minimal similarity bar, see `assessConfidence`) outranks
 * nothing at all.
 */
function deriveQuestionState(
  question: ProcurementQuestion,
): QuestionRenderState {
  if (question.response) {
    return question.response.review_status === 'approved'
      ? 'approved'
      : 'drafted';
  }
  if (
    question.confidence_posture &&
    question.confidence_posture !== 'no_content'
  ) {
    return 'matched';
  }
  return 'empty';
}

function QuestionStateBadge({ state }: { state: QuestionRenderState }) {
  const config = QUESTION_STATE_CONFIG[state];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        config.className,
      )}
    >
      <Icon className="size-3.5" aria-hidden={true} />
      <span>{config.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Section grouping (display only — deliberately no collapse/edit affordances
// here; the legacy QuestionList/QuestionRow components that owned those were
// removed as dead code in the {145.23} close-gate sweep)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Manual-answer affordance (zero-candidate questions only)
// ---------------------------------------------------------------------------

function ManualAnswerAffordance({
  question,
  procurementId,
  onAnswered,
}: {
  question: ProcurementQuestion;
  procurementId: string;
  onAnswered?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [alsoPromote, setAlsoPromote] = useState(false);
  const [saving, setSaving] = useState(false);
  const promoteCheckboxId = `manual-answer-promote-${question.id}`;

  async function handleSave() {
    const trimmed = answerText.trim();
    if (!trimmed) {
      toast.error('Enter an answer before saving');
      return;
    }

    setSaving(true);
    try {
      // PRIMARY act (deterministic): answer this question directly. The
      // question leaves the "empty" state as soon as this succeeds -- never
      // contingent on a later "Find answers" re-match.
      const res = await fetch(
        `/api/procurement/${procurementId}/responses/manual`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: question.id,
            response_text: trimmed,
          }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.id) {
        throw new Error(body?.error ?? 'Failed to save answer');
      }

      // SECONDARY act (optional, separate): only when explicitly requested,
      // also add the same answer to the knowledge base. A failure here never
      // undoes the primary save -- it is surfaced as its own honest warning.
      if (alsoPromote) {
        try {
          const promoteRes = await fetch('/api/q-a-pairs/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: [
                {
                  question_text: question.question_text,
                  answer_standard: trimmed,
                },
              ],
            }),
          });
          const promoteBody = await promoteRes.json().catch(() => null);
          if (!promoteRes.ok || !promoteBody || promoteBody.created < 1) {
            throw new Error(
              promoteBody?.items?.[0]?.error ??
                promoteBody?.error ??
                'Failed to add to the knowledge base',
            );
          }
          toast.success('Answer saved and added to your knowledge base.');
        } catch (promoteErr) {
          toast.success('Answer saved.');
          toast.error(
            promoteErr instanceof Error
              ? promoteErr.message
              : 'Failed to add to the knowledge base',
          );
        }
      } else {
        toast.success('Answer saved.');
      }

      setAnswerText('');
      setAlsoPromote(false);
      setExpanded(false);
      onAnswered?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save answer';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <div className="mt-2 pl-9">
        <Button
          variant="outline"
          size="xs"
          onClick={() => setExpanded(true)}
          className="gap-1.5"
        >
          <PenLine className="size-3" aria-hidden="true" />
          Answer this question directly
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 pl-9">
      <Textarea
        aria-label={`Manual answer for: ${question.question_text}`}
        rows={4}
        value={answerText}
        onChange={(e) => setAnswerText(e.target.value)}
        placeholder="Type your answer. This answers the question directly."
        disabled={saving}
      />
      <div className="flex items-center gap-2">
        <Checkbox
          id={promoteCheckboxId}
          checked={alsoPromote}
          onCheckedChange={(checked) => setAlsoPromote(checked === true)}
          disabled={saving}
        />
        <Label
          htmlFor={promoteCheckboxId}
          className="text-xs font-normal text-muted-foreground"
        >
          Also add this answer to your knowledge base
        </Label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          Save answer
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setExpanded(false);
            setAnswerText('');
            setAlsoPromote(false);
          }}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-question row
// ---------------------------------------------------------------------------

function QuestionStateRow({
  question,
  index,
  canEdit,
  procurementId,
  onAnswered,
}: {
  question: ProcurementQuestion;
  index: number;
  canEdit: boolean;
  procurementId: string;
  onAnswered?: () => void;
}) {
  const state = deriveQuestionState(question);

  return (
    <div
      role="listitem"
      data-testid={`question-row-${question.id}`}
      className="rounded-md border border-transparent px-3 py-2 hover:bg-muted/20"
    >
      <div className="flex items-start gap-3">
        <span className="w-6 shrink-0 text-right text-xs font-mono text-muted-foreground">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{question.question_text}</p>
          {question.word_limit && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Word limit: {question.word_limit}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state === 'matched' && question.confidence_posture && (
            <ConfidenceBadge posture={question.confidence_posture} compact />
          )}
          <QuestionStateBadge state={state} />
        </div>
      </div>

      {state === 'empty' && canEdit && (
        <ManualAnswerAffordance
          question={question}
          procurementId={procurementId}
          onAnswered={onAnswered}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state (no questions extracted at all)
// ---------------------------------------------------------------------------

function NoQuestionsState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <HelpCircle
        className="size-8 text-muted-foreground/50"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">No questions yet.</p>
      <p className="text-xs text-muted-foreground/70">
        Upload a tender document in the Documents tab to extract questions.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ItemQuestionsPanel({
  procurementId,
  questions,
  canEdit,
  totalQuestions,
  unmatchedCount,
  onMatchQuestions,
  onDraftAll,
  draftingAll,
  onQuestionsChanged,
  className,
}: ItemQuestionsPanelProps) {
  const sections = useMemo(() => groupBySections(questions), [questions]);
  const indexByQuestionId = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const section of sections) {
      for (const question of section.questions) {
        i += 1;
        map.set(question.id, i);
      }
    }
    return map;
  }, [sections]);

  return (
    <div
      data-testid="item-questions-panel"
      className={className ?? 'space-y-4'}
    >
      <p className="text-sm font-medium text-foreground">
        {totalQuestions} question{totalQuestions === 1 ? '' : 's'}
      </p>

      {canEdit && totalQuestions > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {!!unmatchedCount && unmatchedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={onMatchQuestions}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Find answers for {unmatchedCount} question
              {unmatchedCount === 1 ? '' : 's'}
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            className="gap-1.5"
            disabled={draftingAll}
            onClick={onDraftAll}
          >
            {draftingAll ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PenLine className="size-3.5" aria-hidden="true" />
            )}
            {draftingAll ? 'Drafting...' : 'Draft All'}
          </Button>
        </div>
      )}

      {totalQuestions === 0 ? (
        <NoQuestionsState />
      ) : (
        <div className="space-y-4">
          {sections.map((section) => {
            const sectionKey = section.sectionName ?? '__ungrouped__';
            return (
              <div key={sectionKey} className="space-y-1">
                {section.sectionName && (
                  <h3 className="px-2 text-xs font-medium text-muted-foreground">
                    {section.sectionName}
                  </h3>
                )}
                <div role="list" className="space-y-1">
                  {section.questions.map((question) => (
                    <QuestionStateRow
                      key={question.id}
                      question={question}
                      index={indexByQuestionId.get(question.id) ?? 0}
                      canEdit={canEdit}
                      procurementId={procurementId}
                      onAnswered={onQuestionsChanged}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
