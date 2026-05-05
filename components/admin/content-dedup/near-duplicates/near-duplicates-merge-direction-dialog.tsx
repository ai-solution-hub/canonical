'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { NearDupPairMember } from '@/lib/query/fetchers';

/** @public */
export type MergeDirection = 'left-supersedes-right' | 'right-supersedes-left';

interface NearDuplicatesMergeDirectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  left: NearDupPairMember;
  right: NearDupPairMember;
  /** Optional admin note (forwarded to the API; trimmed beforehand). */
  note?: string;
  /** True while the merge mutation is in flight. */
  isPending: boolean;
  /**
   * Called with the chosen `oldId` (loser) + `newId` (winner). Pulls the
   * direction → ids mapping out of this dialog so the parent component
   * can stay agnostic of the heuristic.
   */
  onConfirm: (params: { oldId: string; newId: string; note?: string }) => void;
}

type DialogBodyProps = Omit<NearDuplicatesMergeDirectionDialogProps, 'open'>;

/**
 * Compute the default merge direction per spec §6.2:
 *  - identical publication_status → newer (most-recent created_at) wins
 *  - different publication_status → published wins over the rest
 *
 * The heuristic is a UI hint only — the admin always confirms before the
 * mutation fires.
 */
export function defaultMergeDirection(
  left: NearDupPairMember,
  right: NearDupPairMember,
): MergeDirection {
  if (left.publication_status === right.publication_status) {
    // Newer wins. ISO timestamps lex-sort correctly.
    return left.created_at >= right.created_at
      ? 'left-supersedes-right'
      : 'right-supersedes-left';
  }
  // Published always beats non-published.
  if (left.publication_status === 'published') return 'left-supersedes-right';
  if (right.publication_status === 'published') return 'right-supersedes-left';
  // Neither is published — fall back to newer wins.
  return left.created_at >= right.created_at
    ? 'left-supersedes-right'
    : 'right-supersedes-left';
}

/**
 * Direction-picker dialog for the §1.9 merge action.
 *
 * Default direction is computed by {@link defaultMergeDirection} from
 * the pair members' `publication_status` + `created_at`. Admin can flip
 * the radio before confirming. On confirm we forward `oldId` (loser) +
 * `newId` (winner) to the parent which dispatches the mutation.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.2.
 */
export function NearDuplicatesMergeDirectionDialog({
  open,
  onOpenChange,
  left,
  right,
  note,
  isPending,
  onConfirm,
}: NearDuplicatesMergeDirectionDialogProps) {
  // Inner body is keyed on `open + left.id + right.id` per CLAUDE.md
  // "Reset local state via `key` prop, not `setState` in effect" gotcha:
  // when the dialog re-opens (or is asked to open against a different
  // pair) the body remounts so its `useState(defaultMergeDirection(...))`
  // initialiser runs again with the current props. No useEffect-driven
  // setState (which the React 19 lint rule flags as cascading-renders).
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <DialogBody
            key={`${left.id}-${right.id}-${open ? 'open' : 'closed'}`}
            onOpenChange={onOpenChange}
            left={left}
            right={right}
            note={note}
            isPending={isPending}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  onOpenChange,
  left,
  right,
  note,
  isPending,
  onConfirm,
}: DialogBodyProps) {
  const [direction, setDirection] = useState<MergeDirection>(() =>
    defaultMergeDirection(left, right),
  );

  const handleConfirm = () => {
    const oldId = direction === 'left-supersedes-right' ? right.id : left.id;
    const newId = direction === 'left-supersedes-right' ? left.id : right.id;
    onConfirm({ oldId, newId, note });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Merge near-duplicate pair</DialogTitle>
        <DialogDescription>
          Choose the merge direction. The &ldquo;old&rdquo; row gets
          <code className="mx-1">superseded_by</code>
          pointed at the &ldquo;new&rdquo; row and its
          <code className="mx-1">dedup_status</code>
          flips to <code>superseded</code>.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Direction</legend>
        <label
          className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm hover:bg-accent"
          data-testid="merge-direction-left-supersedes-right-label"
        >
          <input
            type="radio"
            name="merge-direction"
            value="left-supersedes-right"
            checked={direction === 'left-supersedes-right'}
            onChange={() => setDirection('left-supersedes-right')}
            disabled={isPending}
            className="mt-0.5"
            data-testid="merge-direction-left-supersedes-right"
          />
          <span>
            <span className="block font-medium">Left supersedes right</span>
            <span className="block text-xs text-muted-foreground">
              Right row gets superseded — left becomes the canonical version.
            </span>
          </span>
        </label>
        <label
          className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm hover:bg-accent"
          data-testid="merge-direction-right-supersedes-left-label"
        >
          <input
            type="radio"
            name="merge-direction"
            value="right-supersedes-left"
            checked={direction === 'right-supersedes-left'}
            onChange={() => setDirection('right-supersedes-left')}
            disabled={isPending}
            className="mt-0.5"
            data-testid="merge-direction-right-supersedes-left"
          />
          <span>
            <span className="block font-medium">Right supersedes left</span>
            <span className="block text-xs text-muted-foreground">
              Left row gets superseded — right becomes the canonical version.
            </span>
          </span>
        </label>
      </fieldset>

      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={isPending}
          data-testid="merge-direction-confirm"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Confirm merge
        </Button>
      </DialogFooter>
    </>
  );
}
