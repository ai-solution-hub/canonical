'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowUpFromLine,
  Database,
  Loader2,
  Plus,
  SkipForward,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { htmlToPlainText } from '@/lib/editor-utils';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

type IntegrationAction = 'new_entry' | 'update_existing' | 'skip';

interface KBCandidate {
  question_id: string;
  question_text: string;
  response_text: string | null;
  source_content_ids: string[] | null;
  recommendation: IntegrationAction;
}

interface KBIntegrationReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bidId: string;
  bidName: string;
  candidates: KBCandidate[];
  onIntegrationComplete: (result: {
    created: number;
    updated: number;
    skipped: number;
  }) => void;
}

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

const ACTION_LABELS: Record<IntegrationAction, string> = {
  new_entry: 'Create new',
  update_existing: 'Update existing',
  skip: 'Skip',
};

const ACTION_ICONS: Record<IntegrationAction, typeof Plus> = {
  new_entry: Plus,
  update_existing: ArrowUpFromLine,
  skip: SkipForward,
};

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export function KBIntegrationReview({
  open,
  onOpenChange,
  bidId,
  bidName,
  candidates,
  onIntegrationComplete,
}: KBIntegrationReviewProps) {
  // Initialise actions from recommendations
  const [actions, setActions] = useState<Map<string, IntegrationAction>>(() => {
    const initial = new Map<string, IntegrationAction>();
    for (const candidate of candidates) {
      // Only allow update_existing when source_content_ids are available
      const canUpdate =
        candidate.source_content_ids && candidate.source_content_ids.length > 0;
      const action =
        candidate.recommendation === 'update_existing' && !canUpdate
          ? 'new_entry'
          : candidate.recommendation;
      initial.set(candidate.question_id, action);
    }
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);

  // Reset actions when candidates change
  const candidateKey = candidates.map((c) => c.question_id).join(',');
  const [lastCandidateKey, setLastCandidateKey] = useState(candidateKey);
  if (candidateKey !== lastCandidateKey) {
    setLastCandidateKey(candidateKey);
    const initial = new Map<string, IntegrationAction>();
    for (const candidate of candidates) {
      const canUpdate =
        candidate.source_content_ids && candidate.source_content_ids.length > 0;
      const action =
        candidate.recommendation === 'update_existing' && !canUpdate
          ? 'new_entry'
          : candidate.recommendation;
      initial.set(candidate.question_id, action);
    }
    setActions(initial);
  }

  const setAction = useCallback(
    (questionId: string, action: IntegrationAction) => {
      setActions((prev) => {
        const next = new Map(prev);
        next.set(questionId, action);
        return next;
      });
    },
    [],
  );

  const nonSkipCount = useMemo(() => {
    let count = 0;
    for (const action of actions.values()) {
      if (action !== 'skip') count++;
    }
    return count;
  }, [actions]);

  const integrateAll = useCallback(() => {
    setActions((prev) => {
      const next = new Map(prev);
      for (const candidate of candidates) {
        const canUpdate =
          candidate.source_content_ids &&
          candidate.source_content_ids.length > 0;
        // Default to new_entry for integrate all
        next.set(candidate.question_id, canUpdate ? 'update_existing' : 'new_entry');
      }
      return next;
    });
  }, [candidates]);

  const skipAll = useCallback(() => {
    setActions((prev) => {
      const next = new Map(prev);
      for (const candidate of candidates) {
        next.set(candidate.question_id, 'skip');
      }
      return next;
    });
  }, [candidates]);

  async function handleSubmit() {
    if (nonSkipCount === 0 && candidates.length > 0) {
      // All skipped is a valid action -- confirm with user
    }

    setSubmitting(true);
    try {
      const integrations = candidates.map((candidate) => {
        const action = actions.get(candidate.question_id) ?? 'skip';
        return {
          question_id: candidate.question_id,
          action,
          target_content_id:
            action === 'update_existing' &&
            candidate.source_content_ids?.length
              ? candidate.source_content_ids[0]
              : undefined,
        };
      });

      const res = await fetch(`/api/bids/${bidId}/outcome/integrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrations }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? `Integration failed (${res.status})`,
        );
      }

      const result = await res.json();
      const { created, updated, skipped } = result;

      const parts: string[] = [];
      if (created > 0)
        parts.push(`${created} ${created === 1 ? 'entry' : 'entries'} created`);
      if (updated > 0)
        parts.push(
          `${updated} ${updated === 1 ? 'entry' : 'entries'} updated`,
        );
      if (skipped > 0)
        parts.push(`${skipped} skipped`);

      toast.success(
        parts.length > 0
          ? `KB integration complete: ${parts.join(', ')}`
          : 'KB integration complete',
      );

      onIntegrationComplete({ created, updated, skipped });
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to integrate responses';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="size-5" aria-hidden="true" />
            Knowledge Base Integration
          </DialogTitle>
          <DialogDescription>
            Review winning responses from{' '}
            <span className="font-medium text-foreground">{bidName}</span> and
            choose how to integrate them into the knowledge base.
          </DialogDescription>
        </DialogHeader>

        {/* Summary bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {candidates.length}{' '}
            {candidates.length === 1 ? 'response' : 'responses'} available
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={integrateAll}
              disabled={submitting}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Integrate All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={skipAll}
              disabled={submitting}
            >
              <SkipForward className="size-3.5" aria-hidden="true" />
              Skip All
            </Button>
          </div>
        </div>

        {/* Candidate list */}
        <div
          className="max-h-[400px] space-y-1 overflow-y-auto rounded-md border p-2"
          role="list"
          aria-label="Integration candidates"
        >
          {candidates.map((candidate) => {
            const action = actions.get(candidate.question_id) ?? 'skip';
            const canUpdate =
              candidate.source_content_ids &&
              candidate.source_content_ids.length > 0;
            const ActionIcon = ACTION_ICONS[action];
            const previewText = candidate.response_text
              ? truncateText(htmlToPlainText(candidate.response_text), 150)
              : null;

            return (
              <div
                key={candidate.question_id}
                role="listitem"
                className={cn(
                  'flex flex-col gap-2 rounded-md px-3 py-3 transition-colors',
                  action === 'skip'
                    ? 'opacity-60'
                    : 'bg-primary/5',
                )}
              >
                {/* Question text and action selector row */}
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <ActionIcon
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      action === 'new_entry' && 'text-status-success',
                      action === 'update_existing' && 'text-confidence-needs-sme',
                      action === 'skip' && 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />

                  {/* Content */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium leading-snug">
                      {candidate.question_text}
                    </p>

                    {/* Response preview */}
                    {previewText && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {previewText}
                      </p>
                    )}

                    {/* Metadata badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {canUpdate && (
                        <Badge
                          variant="outline"
                          className="text-xs text-confidence-needs-sme border-confidence-needs-sme-border"
                        >
                          Has KB source
                        </Badge>
                      )}
                      {!candidate.response_text && (
                        <Badge
                          variant="outline"
                          className="text-xs text-status-warning border-status-warning"
                        >
                          No response
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Action selector */}
                  <div className="shrink-0">
                    <Select
                      value={action}
                      onValueChange={(value: string) =>
                        setAction(
                          candidate.question_id,
                          value as IntegrationAction,
                        )
                      }
                      disabled={submitting}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-[140px]"
                        aria-label={`Action for question: ${candidate.question_text.substring(0, 40)}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="new_entry">
                          {ACTION_LABELS.new_entry}
                        </SelectItem>
                        <SelectItem
                          value="update_existing"
                          disabled={!canUpdate}
                        >
                          {ACTION_LABELS.update_existing}
                        </SelectItem>
                        <SelectItem value="skip">
                          {ACTION_LABELS.skip}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}

          {candidates.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No responses available for integration. Draft responses first to integrate them into the knowledge base.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="sm:justify-between">
          <p className="text-xs text-muted-foreground self-center">
            {nonSkipCount} of {candidates.length} will be integrated
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || candidates.length === 0}
            >
              {submitting ? (
                <>
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Integrating...
                </>
              ) : nonSkipCount > 0 ? (
                `Integrate ${nonSkipCount} ${nonSkipCount === 1 ? 'Response' : 'Responses'}`
              ) : (
                'Skip All Responses'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
