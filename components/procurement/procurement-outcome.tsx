'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Trophy, XCircle, MinusCircle, Loader2, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { KBCandidate } from '@/types/procurement';

// ---- Outcome configuration ----

type ProcurementOutcome = 'won' | 'lost' | 'withdrawn';

const OUTCOME_OPTIONS: {
  value: ProcurementOutcome;
  label: string;
  description: string;
  icon: typeof Trophy;
  colourClass: string;
}[] = [
  {
    value: 'won',
    label: 'Won',
    description: 'Procurement was successful',
    icon: Trophy,
    colourClass: 'text-bid-won',
  },
  {
    value: 'lost',
    label: 'Lost',
    description: 'Procurement was unsuccessful',
    icon: XCircle,
    colourClass: 'text-bid-lost',
  },
  {
    value: 'withdrawn',
    label: 'Withdrawn',
    description: 'Procurement was withdrawn before decision',
    icon: MinusCircle,
    colourClass: 'text-bid-withdrawn',
  },
];

// ---- Props ----

interface ProcurementOutcomeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  procurementId: string;
  procurementName: string;
  onOutcomeRecorded: (outcome: string, kbCandidates: KBCandidate[]) => void;
}

// ---- Component ----

export function ProcurementOutcomeDialog({
  open,
  onOpenChange,
  procurementId,
  procurementName,
  onOutcomeRecorded,
}: ProcurementOutcomeProps) {
  const [outcome, setOutcome] = useState<ProcurementOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [integrateToKb, setIntegrateToKb] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setOutcome('');
    setNotes('');
    setIntegrateToKb(false);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!outcome) {
      setError('Please select an outcome.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { outcome };
      if (notes.trim()) {
        body.notes = notes.trim();
      }
      if (outcome === 'won' && integrateToKb) {
        body.integrate_to_kb = true;
      }

      const response = await fetch(`/api/procurement/${procurementId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error || `Failed to record outcome (${response.status})`,
        );
      }

      const data = await response.json();
      const kbCandidates: KBCandidate[] = data.kb_candidates ?? [];

      const outcomeLabel =
        OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome;
      toast.success(`Procurement outcome recorded: ${outcomeLabel}`, {
        duration: 3000,
      });

      resetForm();
      onOpenChange(false);
      onOutcomeRecorded(outcome, kbCandidates);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to record outcome';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) resetForm();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Record Procurement Outcome</DialogTitle>
          <DialogDescription>
            Record the final outcome for{' '}
            <span className="font-medium">{procurementName}</span>. This will update the
            bid status and can optionally flag responses for knowledge base
            integration.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Outcome Selection */}
          <fieldset disabled={submitting}>
            <legend className="text-sm font-medium mb-3">
              Outcome <span className="text-destructive">*</span>
            </legend>
            <RadioGroup
              value={outcome}
              onValueChange={(value) => {
                setOutcome(value as ProcurementOutcome);
                // Reset KB integration checkbox if not won
                if (value !== 'won') {
                  setIntegrateToKb(false);
                }
              }}
              className="grid gap-2"
              aria-required
            >
              {OUTCOME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = outcome === option.value;
                return (
                  <label
                    key={option.value}
                    htmlFor={`outcome-${option.value}`}
                    className={`flex items-center gap-3 rounded-md border px-4 py-3 cursor-pointer transition-colors hover:bg-accent/50 ${
                      isSelected
                        ? 'border-primary bg-accent/30'
                        : 'border-input'
                    }`}
                  >
                    <RadioGroupItem
                      value={option.value}
                      id={`outcome-${option.value}`}
                    />
                    <Icon
                      className={`size-5 shrink-0 ${option.colourClass}`}
                      aria-hidden="true"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </fieldset>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="outcome-notes">Notes</Label>
            <Textarea
              id="outcome-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about the outcome (e.g. feedback from the buyer, reasons for withdrawal)"
              maxLength={5000}
              rows={3}
              disabled={submitting}
            />
          </div>

          {/* KB Integration Checkbox — only when 'won' */}
          {outcome === 'won' && (
            <div className="flex items-start gap-3 rounded-md border border-input p-3 bg-accent/20">
              <Checkbox
                id="integrate-to-kb"
                checked={integrateToKb}
                onCheckedChange={(checked) =>
                  setIntegrateToKb(checked === true)
                }
                disabled={submitting}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="integrate-to-kb"
                  className="text-sm font-medium cursor-pointer leading-none"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    Review responses for knowledge base integration
                  </span>
                </label>
                <span className="text-xs text-muted-foreground">
                  Winning responses will be analysed for potential addition to
                  the knowledge base as reusable content.
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !outcome}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Recording...
                </>
              ) : (
                'Record Outcome'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
