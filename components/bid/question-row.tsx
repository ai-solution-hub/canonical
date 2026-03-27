'use client';

import { useCallback, useState } from 'react';
import {
  Circle,
  CircleDot,
  CheckCircle2,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ConfidenceBadge } from '@/components/shared/confidence-badge';
import { cn } from '@/lib/utils';
import type { BidQuestion, QuestionStatus } from '@/types/bid';

interface QuestionRowProps {
  question: BidQuestion;
  index: number;
  canEdit: boolean;
  bidId: string;
  onUpdated: () => void;
  onDeleted: () => void;
}

interface StatusConfig {
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className: string;
}

const STATUS_CONFIG: Record<QuestionStatus, StatusConfig> = {
  not_started: {
    label: 'Not Started',
    icon: Circle,
    className: 'text-confidence-none',
  },
  ai_drafted: {
    label: 'AI Drafted',
    icon: CircleDot,
    className: 'text-confidence-needs-sme',
  },
  in_progress: {
    label: 'In Progress',
    icon: CircleDot,
    className: 'text-status-warning',
  },
  needs_review: {
    label: 'Needs Review',
    icon: AlertCircle,
    className: 'text-status-warning',
  },
  complete: {
    label: 'Complete',
    icon: CheckCircle2,
    className: 'text-status-success',
  },
};

function StatusIndicator({ status }: { status: QuestionStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', config.className)}>
      <Icon className="size-3.5" aria-hidden={true} />
      <span>{config.label}</span>
    </span>
  );
}

export function QuestionRow({
  question,
  index,
  canEdit,
  bidId,
  onUpdated,
  onDeleted,
}: QuestionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editValues, setEditValues] = useState({
    question_text: question.question_text,
    section_name: question.section_name ?? '',
    word_limit: question.word_limit?.toString() ?? '',
  });

  const startEditing = useCallback(() => {
    setEditValues({
      question_text: question.question_text,
      section_name: question.section_name ?? '',
      word_limit: question.word_limit?.toString() ?? '',
    });
    setEditing(true);
    setExpanded(true);
  }, [question]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditValues({
      question_text: question.question_text,
      section_name: question.section_name ?? '',
      word_limit: question.word_limit?.toString() ?? '',
    });
  }, [question]);

  async function handleSave() {
    if (!editValues.question_text.trim()) {
      toast.error('Question text cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text: editValues.question_text.trim(),
          section_name: editValues.section_name.trim() || null,
          word_limit: editValues.word_limit ? parseInt(editValues.word_limit, 10) : null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to save (${res.status})`);
      }

      toast.success('Question updated');
      setEditing(false);
      onUpdated();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save question';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/bids/${bidId}/questions/${question.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to delete (${res.status})`);
      }

      toast.success('Question deleted');
      onDeleted();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete question';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  function handleRowClick() {
    if (!editing) {
      setExpanded((prev) => !prev);
    }
  }

  function handleRowKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick();
    }
  }

  return (
    <div
      role="listitem"
      className={cn(
        'rounded-md border transition-colors',
        expanded ? 'border-border bg-muted/30' : 'border-transparent hover:bg-muted/20',
      )}
    >
      {/* Compact row */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-3 px-3 py-2 cursor-pointer"
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        aria-expanded={expanded}
      >
        {/* Sequence number */}
        <span className="w-6 shrink-0 text-right text-xs font-mono text-muted-foreground">
          {index}
        </span>

        {/* Question text (truncated) */}
        <span className="min-w-0 flex-1 text-sm line-clamp-2">
          {question.question_text}
        </span>

        {/* Word limit */}
        {question.word_limit && (
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title={`Word limit: ${question.word_limit}`}
          >
            {question.word_limit}w
          </span>
        )}

        {/* Confidence badge */}
        {question.confidence_posture && (
          <ConfidenceBadge posture={question.confidence_posture} compact={true} />
        )}

        {/* Status indicator */}
        <div className="shrink-0">
          <StatusIndicator status={question.status} />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-3 py-3 space-y-3">
          {/* Full question text (read-only view) */}
          {!editing && (
            <div className="space-y-2">
              <p className="text-sm whitespace-pre-wrap pl-9">
                {question.question_text}
              </p>

              {question.section_name && (
                <p className="text-xs text-muted-foreground pl-9">
                  Section: {question.section_name}
                </p>
              )}

              {question.word_limit && (
                <p className="text-xs text-muted-foreground pl-9">
                  Word limit: {question.word_limit}
                </p>
              )}

              {canEdit && (
                <div className="flex gap-2 pl-9 pt-1">
                  <Button variant="outline" size="xs" onClick={startEditing}>
                    <Pencil className="size-3" aria-hidden="true" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="xs" className="text-destructive hover:text-destructive">
                        <Trash2 className="size-3" aria-hidden="true" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Question</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this question? This action cannot be undone.
                          Any associated responses will also be removed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          disabled={deleting}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleting ? (
                            <>
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              Deleting...
                            </>
                          ) : (
                            'Delete Question'
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          )}

          {/* Inline edit form */}
          {editing && (
            <div className="space-y-3 pl-9">
              <div className="space-y-2">
                <Label htmlFor={`edit-text-${question.id}`}>Question Text</Label>
                <Textarea
                  id={`edit-text-${question.id}`}
                  rows={4}
                  value={editValues.question_text}
                  onChange={(e) =>
                    setEditValues((prev) => ({ ...prev, question_text: e.target.value }))
                  }
                  disabled={saving}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor={`edit-section-${question.id}`}>Section Name</Label>
                  <Input
                    id={`edit-section-${question.id}`}
                    value={editValues.section_name}
                    onChange={(e) =>
                      setEditValues((prev) => ({ ...prev, section_name: e.target.value }))
                    }
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`edit-wordlimit-${question.id}`}>Word Limit</Label>
                  <Input
                    id={`edit-wordlimit-${question.id}`}
                    type="number"
                    min={0}
                    value={editValues.word_limit}
                    onChange={(e) =>
                      setEditValues((prev) => ({ ...prev, word_limit: e.target.value }))
                    }
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="size-4" aria-hidden="true" />
                      Save
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                  <X className="size-4" aria-hidden="true" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
