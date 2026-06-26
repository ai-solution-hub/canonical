'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, FileText, Plus, Calendar, Award } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProcurementWorkflowBadge } from '@/components/procurement/procurement-workflow-indicator';
import {
  FormTypePicker,
  useProcurementFormTypes,
} from '@/components/procurement/form-type-picker';
import { queryKeys } from '@/lib/query/query-keys';
import { formatDateUK } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ProcurementWorkflowState } from '@/lib/domains/procurement/procurement-workflow';
import type {
  ProcurementFormSummary,
  ProcurementRollup,
} from '@/lib/domains/procurement/procurement-detail-shape';

/**
 * Net-new multi-form navigation for the procurement detail surface
 * (ID-130 {130.13}, PRODUCT B-7/B-19, TECH T-B19).
 *
 * A procurement is an umbrella holding many forms (B-1); this card surfaces the
 * derived roll-up (nearest deadline + overall outcome, B-7) and lists each
 * child form with its `form_type`, `workflow_state`, `deadline` and `outcome`.
 * A single-form v1 procurement still renders a one-item list — the user is
 * never blocked from later adding a second form (B-19). Selecting a form opens
 * its composer ({130.15} composer surface — wired to the existing session
 * route until that lands). "Add a form" confirms a `form_type` via the
 * confirm-first picker ({130.12}) and persists it (B-14/B-16).
 */

export interface ProcurementFormsCardProps {
  procurementId: string;
  forms: ProcurementFormSummary[];
  rollup: ProcurementRollup | null;
  canEdit: boolean;
  className?: string;
}

function outcomeLabel(outcome: string | null): string | null {
  if (!outcome) return null;
  switch (outcome) {
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'shortlisted':
      return 'Shortlisted';
    case 'not_shortlisted':
      return 'Not shortlisted';
    default:
      return outcome;
  }
}

export function ProcurementFormsCard({
  procurementId,
  forms,
  rollup,
  canEdit,
  className,
}: ProcurementFormsCardProps) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  // CV-driven label resolution for each form's type key (single source of
  // truth = api.form_types, {130.12}).
  const { data: formTypeOptions } = useProcurementFormTypes();
  const labelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of formTypeOptions ?? [])
      map.set(option.key, option.label);
    return map;
  }, [formTypeOptions]);

  const createForm = useMutation({
    mutationFn: async (formType: string) => {
      const response = await fetch(`/api/procurement/${procurementId}/forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_type: formType }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add form');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Form added');
      setAddOpen(false);
      queryClient.invalidateQueries({
        queryKey: queryKeys.procurement.detail(procurementId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.procurement.forms.list(procurementId),
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add form');
    },
  });

  const nearestDeadline = rollup?.nearest_deadline ?? null;
  const overallOutcome = outcomeLabel(rollup?.overall_outcome ?? null);

  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Forms</h2>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add a form
          </Button>
        )}
      </div>

      {/* Roll-up summary (B-7): nearest deadline + overall outcome. */}
      {(nearestDeadline || overallOutcome) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {nearestDeadline && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden="true" />
              Nearest deadline: {formatDateUK(nearestDeadline)}
            </span>
          )}
          {overallOutcome && (
            <span className="inline-flex items-center gap-1.5">
              <Award className="size-3.5" aria-hidden="true" />
              Overall outcome: {overallOutcome}
            </span>
          )}
        </div>
      )}

      {forms.length === 0 ? (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
          <FileText
            className="size-6 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">No forms yet.</p>
          <p className="text-xs text-muted-foreground/70">
            Add a form (PSQ, ITT, tender, …) to start this engagement.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {forms.map((form) => {
            const typeLabel =
              (form.form_type && labelByKey.get(form.form_type)) ||
              form.form_type ||
              'Untyped form';
            const formOutcome = outcomeLabel(form.outcome);
            return (
              <li key={form.id}>
                <Link
                  href={`/procurement/${procurementId}/session`}
                  className="group flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium text-foreground">
                      {typeLabel}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <ProcurementWorkflowBadge
                        state={form.workflow_state as ProcurementWorkflowState}
                      />
                      {form.deadline && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3" aria-hidden="true" />
                          {formatDateUK(form.deadline)}
                        </span>
                      )}
                      {formOutcome && (
                        <span className="inline-flex items-center gap-1">
                          <Award className="size-3" aria-hidden="true" />
                          {formOutcome}
                        </span>
                      )}
                    </span>
                  </div>
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add-a-form dialog — confirm-first form_type picker ({130.12}). */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a form</DialogTitle>
            <DialogDescription>
              Choose the form type for this engagement, then confirm. You can
              upload its document afterwards.
            </DialogDescription>
          </DialogHeader>
          {/*
            `key` resets the picker's internal selection each time the dialog
            opens (components/CLAUDE.md: reset state via key, not setState).
            No `inferredFormType` here — an app-added form has no document yet,
            so the user must pick before confirming (confirm-first, B-16).
          */}
          <FormTypePicker
            key={addOpen ? 'open' : 'closed'}
            onConfirm={(formType) => createForm.mutate(formType)}
            isConfirming={createForm.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
