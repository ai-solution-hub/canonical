'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, mutationFetchJson } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import type { SuspectedDuplicateRow } from '@/lib/query/fetchers';

interface ContentDedupActionButtonsProps {
  subject: SuspectedDuplicateRow;
  canonical: SuspectedDuplicateRow | null;
}

const NOTE_MAX_LENGTH = 500;

type SupersedeDirection =
  | 'canonical-supersedes-subject'
  | 'subject-supersedes-canonical';

/**
 * Three terminal-action buttons for the dedup detail view.
 *
 * Per spec §6.2:
 *  - Confirm duplicate → archive subject, flip status to confirmed_duplicate.
 *  - Confirm unique → flip status to confirmed_unique, leave both rows live.
 *  - Mark superseded → call setSupersession(); dialog asks direction
 *    (default: canonical supersedes subject, matching the typical
 *    re-upload-of-canonical pattern).
 *
 * No optimistic updates (per spec §6.4) — mutations run, invalidate, and
 * route back to the list. 409 responses are handled gracefully (toast +
 * route back; the row was resolved by another admin or already advanced
 * past `suspected_duplicate`).
 *
 * The disabled state covers in-flight mutations of any of the three
 * actions, so the admin cannot fire two simultaneously.
 */
export function ContentDedupActionButtons({
  subject,
  canonical,
}: ContentDedupActionButtonsProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [note, setNote] = useState('');
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  const [direction, setDirection] = useState<SupersedeDirection>(
    'canonical-supersedes-subject',
  );

  const invalidateAndRoute = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDedup.all });
    router.push('/admin/content-dedup');
  };

  const handleApiError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 409) {
      toast.error('Row already resolved');
      invalidateAndRoute();
      return;
    }
    toast.error(err instanceof Error ? err.message : fallback);
  };

  const confirmDuplicate = useMutation({
    mutationFn: (n: string | undefined) =>
      mutationFetchJson(
        `/api/admin/content-dedup/${subject.id}/confirm-duplicate`,
        n ? { note: n } : {},
      ),
    onSuccess: () => {
      toast.success('Confirmed as duplicate — subject row archived');
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to confirm duplicate'),
  });

  const confirmUnique = useMutation({
    mutationFn: (n: string | undefined) =>
      mutationFetchJson(
        `/api/admin/content-dedup/${subject.id}/confirm-unique`,
        n ? { note: n } : {},
      ),
    onSuccess: () => {
      toast.success('Confirmed as unique — both rows kept live');
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to confirm unique'),
  });

  const supersede = useMutation({
    mutationFn: ({
      canonicalId,
      direction: dir,
      n,
    }: {
      canonicalId: string;
      direction: SupersedeDirection;
      n: string | undefined;
    }) =>
      mutationFetchJson(
        `/api/admin/content-dedup/${subject.id}/supersede`,
        n
          ? { canonicalId, direction: dir, note: n }
          : { canonicalId, direction: dir },
      ),
    onSuccess: () => {
      toast.success('Marked superseded');
      setSupersedeOpen(false);
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to mark superseded'),
  });

  const isMutating =
    confirmDuplicate.isPending ||
    confirmUnique.isPending ||
    supersede.isPending;

  const trimmedNote = note.trim().length > 0 ? note.trim() : undefined;

  const handleSupersedeConfirm = () => {
    if (!canonical) return;
    // The route's [id] path-param is ALWAYS the subject (queue row). The
    // direction body field selects which side gets retired. The route
    // handler derives oldId/newId from direction internally.
    supersede.mutate({
      canonicalId: canonical.id,
      direction,
      n: trimmedNote,
    });
  };

  return (
    <section
      aria-labelledby="resolution-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="resolution-heading" className="text-sm font-semibold">
        Resolution
      </h2>

      <div className="mt-3">
        <label
          htmlFor="dedup-note"
          className="text-xs font-medium text-muted-foreground"
        >
          Note (optional, max {NOTE_MAX_LENGTH} chars)
        </label>
        <textarea
          id="dedup-note"
          value={note}
          onChange={(event) => {
            const next = event.target.value;
            if (next.length <= NOTE_MAX_LENGTH) setNote(next);
          }}
          maxLength={NOTE_MAX_LENGTH}
          rows={2}
          disabled={isMutating}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Optional context for the audit trail."
          data-testid="dedup-note-input"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
          {note.length} / {NOTE_MAX_LENGTH}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => confirmDuplicate.mutate(trimmedNote)}
          disabled={isMutating}
          data-testid="dedup-confirm-duplicate"
        >
          {confirmDuplicate.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Archive className="size-4" aria-hidden="true" />
          )}
          Confirm duplicate (archive subject)
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => confirmUnique.mutate(trimmedNote)}
          disabled={isMutating}
          data-testid="dedup-confirm-unique"
        >
          {confirmUnique.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          Confirm unique (keep both)
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSupersedeOpen(true)}
          disabled={isMutating || !canonical}
          aria-disabled={!canonical}
          data-testid="dedup-supersede-trigger"
          title={
            !canonical
              ? 'No canonical match — cannot mark superseded'
              : undefined
          }
        >
          <ShieldAlert className="size-4" aria-hidden="true" />
          Mark superseded…
        </Button>
      </div>

      <Dialog open={supersedeOpen} onOpenChange={setSupersedeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark superseded</DialogTitle>
            <DialogDescription>
              Choose the supersession direction. The &ldquo;old&rdquo; row
              gets `superseded_by` pointed at the &ldquo;new&rdquo; row and
              its `dedup_status` flips to `superseded`.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Direction</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm hover:bg-accent">
              <input
                type="radio"
                name="supersede-direction"
                value="canonical-supersedes-subject"
                checked={direction === 'canonical-supersedes-subject'}
                onChange={() =>
                  setDirection('canonical-supersedes-subject')
                }
                disabled={supersede.isPending}
                className="mt-0.5"
                data-testid="supersede-direction-canonical-supersedes-subject"
              />
              <span>
                <span className="block font-medium">
                  Canonical supersedes subject (default)
                </span>
                <span className="block text-xs text-muted-foreground">
                  Subject row gets superseded — typical re-upload pattern.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm hover:bg-accent">
              <input
                type="radio"
                name="supersede-direction"
                value="subject-supersedes-canonical"
                checked={direction === 'subject-supersedes-canonical'}
                onChange={() =>
                  setDirection('subject-supersedes-canonical')
                }
                disabled={supersede.isPending}
                className="mt-0.5"
                data-testid="supersede-direction-subject-supersedes-canonical"
              />
              <span>
                <span className="block font-medium">
                  Subject supersedes canonical
                </span>
                <span className="block text-xs text-muted-foreground">
                  Canonical row gets superseded — subject is the newer
                  authoritative version.
                </span>
              </span>
            </label>
          </fieldset>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSupersedeOpen(false)}
              disabled={supersede.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSupersedeConfirm}
              disabled={supersede.isPending || !canonical}
              data-testid="supersede-confirm"
            >
              {supersede.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Confirm supersession
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
