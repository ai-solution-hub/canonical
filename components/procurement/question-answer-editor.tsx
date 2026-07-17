'use client';

import { useState } from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  useQuestionAnswerSlotResponse,
  useUpdateQuestionSlot,
  useUpdateQuestionSlotReviewStatus,
  type ReviewStatus,
} from '@/lib/query/procurement-question-answer-slot';

// ID-147 {147.17} — custom question/answer-slot editor (PRODUCT §H2, TECH
// §7). Exposes `form_questions.{question_text,word_limit,evaluation_weight,
// assigned_to}` + `form_responses.{review_status,version}` for ONE
// answerable slot (ID-145 BI-20 — deliberately spans the two tables per the
// §1 naming-defect note). Kept STRICTLY SEPARATE from the parallel {147.16}
// requirement-catalogue editor (`form_requirement_templates`, BI-24):
// different tables, different owners, no shared file between the two.
//
// Extend Schema Builder is deliberately NOT used or offered anywhere in
// this component (DR-065/§H4 — it carries no domain metadata; reserved for
// a future "extract typed fields from an uploaded RFP" JSON-extraction
// feature only).
//
// Writes are admin/editor-gated (§H3, BI-47) via the `canEdit` prop, which
// the caller derives from `useUserRole()` (matching the sibling
// `question-row.tsx` convention) — reviewer/viewer callers pass
// `canEdit={false}` and see every field read-only, with no edit/save
// controls rendered at all. Server-side, the underlying REST routes this
// component calls already enforce the same gate independently via
// `getAuthorisedClient(['admin', 'editor'])` + `authFailureResponse(auth)`
// (`app/api/procurement/[id]/questions/[qId]/route.ts`,
// `app/api/procurement/[id]/responses/[rId]/route.ts`) — this prop is a UX
// gate on top of that server-side enforcement, not a substitute for it.

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: 'Draft',
  ai_drafted: 'AI Drafted',
  edited: 'Edited',
  approved: 'Approved',
  needs_review: 'Needs Review',
};

const REVIEW_STATUS_OPTIONS = Object.keys(
  REVIEW_STATUS_LABELS,
) as ReviewStatus[];

export interface QuestionAnswerSlotQuestion {
  id: string;
  question_text: string;
  word_limit: number | null;
  evaluation_weight: number | null;
  assigned_to: string | null;
}

export interface QuestionAnswerSlotResponseRef {
  /**
   * `form_responses.id` — only the id is required as a prop; the live
   * `review_status`/`version` are fetched fresh via
   * `useQuestionAnswerSlotResponse` (the questions-list preview enrichment
   * does not carry `version`).
   */
  id: string;
}

export interface QuestionAnswerEditorProps {
  procurementId: string;
  question: QuestionAnswerSlotQuestion;
  /** `null` for an unanswered slot — no `form_responses` row exists yet. */
  response: QuestionAnswerSlotResponseRef | null;
  /** admin/editor === true; reviewer/viewer === false (§H3, BI-47). */
  canEdit: boolean;
  className?: string;
}

interface EditableValues {
  question_text: string;
  word_limit: string;
  evaluation_weight: string;
  assigned_to: string;
}

function valuesFromQuestion(
  question: QuestionAnswerSlotQuestion,
): EditableValues {
  return {
    question_text: question.question_text,
    word_limit: question.word_limit?.toString() ?? '',
    evaluation_weight: question.evaluation_weight?.toString() ?? '',
    assigned_to: question.assigned_to ?? '',
  };
}

export function QuestionAnswerEditor({
  procurementId,
  question,
  response,
  canEdit,
  className,
}: QuestionAnswerEditorProps) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<EditableValues>(() =>
    valuesFromQuestion(question),
  );
  const [reviewStatusDraft, setReviewStatusDraft] =
    useState<ReviewStatus | null>(null);

  const responseId = response?.id ?? null;
  const responseDetail = useQuestionAnswerSlotResponse(
    procurementId,
    responseId,
  );
  const updateQuestion = useUpdateQuestionSlot(procurementId, question.id);
  const updateReviewStatus = useUpdateQuestionSlotReviewStatus(
    procurementId,
    responseId ?? '',
  );

  const currentReviewStatus = responseDetail.data?.review_status ?? null;
  const currentVersion = responseDetail.data?.version ?? null;
  const saving = updateQuestion.isPending || updateReviewStatus.isPending;

  function startEditing() {
    setValues(valuesFromQuestion(question));
    setReviewStatusDraft(currentReviewStatus);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function handleSave() {
    if (!values.question_text.trim()) {
      toast.error('Question text cannot be empty');
      return;
    }

    try {
      await updateQuestion.mutateAsync({
        question_text: values.question_text.trim(),
        word_limit: values.word_limit ? parseInt(values.word_limit, 10) : null,
        evaluation_weight: values.evaluation_weight
          ? parseFloat(values.evaluation_weight)
          : null,
        assigned_to: values.assigned_to.trim() || null,
      });

      if (
        responseId &&
        reviewStatusDraft &&
        reviewStatusDraft !== currentReviewStatus
      ) {
        await updateReviewStatus.mutateAsync(reviewStatusDraft);
      }

      toast.success('Question/answer slot updated');
      setEditing(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save slot';
      toast.error(message);
    }
  }

  return (
    <div className={cn('space-y-3 rounded-md border p-4', className)}>
      {/* Question text */}
      {!editing ? (
        <p className="text-sm whitespace-pre-wrap">{question.question_text}</p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`qa-text-${question.id}`}>Question text</Label>
          <Textarea
            id={`qa-text-${question.id}`}
            rows={3}
            value={values.question_text}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                question_text: e.target.value,
              }))
            }
            disabled={saving}
          />
        </div>
      )}

      {/* Slot metadata — word limit / evaluation weight / assignee / version.
          Every value carries a text label; nothing is colour-only (§J4). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label
            htmlFor={`qa-wordlimit-${question.id}`}
            className="text-xs text-muted-foreground"
          >
            Word limit
          </Label>
          {!editing ? (
            <p className="text-sm">{question.word_limit ?? '—'}</p>
          ) : (
            <Input
              id={`qa-wordlimit-${question.id}`}
              type="number"
              min={0}
              value={values.word_limit}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, word_limit: e.target.value }))
              }
              disabled={saving}
            />
          )}
        </div>

        <div className="space-y-1">
          <Label
            htmlFor={`qa-weight-${question.id}`}
            className="text-xs text-muted-foreground"
          >
            Evaluation weight
          </Label>
          {!editing ? (
            <p className="text-sm">{question.evaluation_weight ?? '—'}</p>
          ) : (
            <Input
              id={`qa-weight-${question.id}`}
              type="number"
              min={0}
              max={100}
              value={values.evaluation_weight}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  evaluation_weight: e.target.value,
                }))
              }
              disabled={saving}
            />
          )}
        </div>

        <div className="space-y-1">
          <Label
            htmlFor={`qa-assignee-${question.id}`}
            className="text-xs text-muted-foreground"
          >
            Assignee
          </Label>
          {!editing ? (
            <p className="text-sm">{question.assigned_to ?? 'Unassigned'}</p>
          ) : (
            <Input
              id={`qa-assignee-${question.id}`}
              value={values.assigned_to}
              placeholder="User ID"
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  assigned_to: e.target.value,
                }))
              }
              disabled={saving}
            />
          )}
        </div>

        <div className="space-y-1">
          {/* Version is server-managed (bid_response_auto_version trigger)
              — always read-only, never an input, even in edit mode. */}
          <span className="block text-xs text-muted-foreground">Version</span>
          <p className="text-sm">
            {currentVersion !== null ? `v${currentVersion}` : '—'}
          </p>
        </div>
      </div>

      {/* Review status */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Review status</Label>
        {!responseId ? (
          <p className="text-sm text-muted-foreground">Not yet answered</p>
        ) : !editing ? (
          <Badge variant="outline">
            {currentReviewStatus
              ? REVIEW_STATUS_LABELS[currentReviewStatus]
              : 'Loading…'}
          </Badge>
        ) : (
          <Select
            value={reviewStatusDraft ?? undefined}
            onValueChange={(value) =>
              setReviewStatusDraft(value as ReviewStatus)
            }
            disabled={saving}
          >
            <SelectTrigger aria-label="Review status">
              <SelectValue placeholder="Select review status" />
            </SelectTrigger>
            <SelectContent>
              {REVIEW_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {REVIEW_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Admin/editor-gated write controls (§H3, BI-47) — reviewer/viewer
          (canEdit=false) sees every field above read-only with no controls
          rendered at all, matching the sibling question-row.tsx convention. */}
      {canEdit && (
        <div className="flex gap-2">
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="size-4" aria-hidden="true" />
                    Save
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelEditing}
                disabled={saving}
              >
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
