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
import type { QaDedupPairMember } from '@/lib/query/fetchers';

interface SurvivorOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairA: QaDedupPairMember;
  pairB: QaDedupPairMember;
  /** The proposer's nominated survivor id — the dialog's initial selection. */
  proposedSurvivorId: string;
  /** True while the approve mutation is in flight. */
  isPending: boolean;
  /**
   * Called with the curator's chosen survivor id on confirm. The parent
   * dispatches the approve mutation with this id (INV-13 override).
   */
  onConfirm: (survivorId: string) => void;
}

type DialogBodyProps = Omit<SurvivorOverrideDialogProps, 'open'>;

/**
 * Survivor-override dialog for the ID-120 {120.8} dedup approve action
 * (TECH P-4 / INV-13/18). Mirrors the §1.9
 * `near-duplicates-merge-direction-dialog`: the curator picks WHICH member
 * survives (the other is archived on approve). The dialog opens pre-selected
 * to the proposer's nomination, but the curator may override before confirming
 * — confirm is a deliberate action, NEVER pre-fired (INV-17).
 */
export function SurvivorOverrideDialog({
  open,
  onOpenChange,
  pairA,
  pairB,
  proposedSurvivorId,
  isPending,
  onConfirm,
}: SurvivorOverrideDialogProps) {
  // Inner body keyed on `open + member ids` per CLAUDE.md "Reset local state
  // via `key` prop, not `setState` in effect": re-opening (or opening against
  // a different pair) remounts the body so its `useState(proposedSurvivorId)`
  // initialiser re-runs with current props.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <DialogBody
            key={`${pairA.id}-${pairB.id}-open`}
            onOpenChange={onOpenChange}
            pairA={pairA}
            pairB={pairB}
            proposedSurvivorId={proposedSurvivorId}
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
  pairA,
  pairB,
  proposedSurvivorId,
  isPending,
  onConfirm,
}: DialogBodyProps) {
  const [survivorId, setSurvivorId] = useState<string>(proposedSurvivorId);

  const renderOption = (member: QaDedupPairMember, label: string) => (
    <label
      className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm hover:bg-accent"
      data-testid={`survivor-option-${member.id}-label`}
    >
      <input
        type="radio"
        name="survivor"
        value={member.id}
        checked={survivorId === member.id}
        onChange={() => setSurvivorId(member.id)}
        disabled={isPending}
        className="mt-0.5"
        data-testid={`survivor-option-${member.id}`}
      />
      <span>
        <span className="block font-medium">{label} survives</span>
        <span className="block text-xs text-muted-foreground">
          The other pair is archived and pointed at {label.toLowerCase()} via
          superseded_by.
        </span>
        <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
          {member.questionText?.trim()
            ? member.questionText
            : '(no question text)'}
        </span>
      </span>
    </label>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose survivor and approve</DialogTitle>
        <DialogDescription>
          Approving archives the non-survivor pair and points its
          <code className="mx-1">superseded_by</code>
          at the survivor. The proposer&rsquo;s nomination is pre-selected; you
          may override it before confirming.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Survivor</legend>
        {renderOption(pairA, 'Pair A')}
        {renderOption(pairB, 'Pair B')}
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
          onClick={() => onConfirm(survivorId)}
          disabled={isPending}
          data-testid="survivor-override-confirm"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Approve merge
        </Button>
      </DialogFooter>
    </>
  );
}
