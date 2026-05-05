'use client';

import { Check, Minus, AlertCircle, Loader2, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IngestionStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error' | 'skipped';
}

/** @public */
export interface IngestionProgressProps {
  steps: IngestionStep[];
  compact?: boolean;
  warnings?: string[];
}

function StepIcon({ status }: { status: IngestionStep['status'] }) {
  switch (status) {
    case 'done':
      return (
        <Check className="size-4 text-status-success" aria-hidden="true" />
      );
    case 'active':
      return (
        <Loader2
          className="size-4 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
      );
    case 'error':
      return (
        <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
      );
    case 'skipped':
      return (
        <SkipForward
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      );
    case 'pending':
    default:
      return (
        <Minus className="size-4 text-muted-foreground" aria-hidden="true" />
      );
  }
}

function statusLabel(status: IngestionStep['status']): string {
  switch (status) {
    case 'done':
      return 'Complete';
    case 'active':
      return 'In progress';
    case 'error':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'pending':
    default:
      return 'Pending';
  }
}

/**
 * Displays pipeline progress as a vertical step list or compact single line.
 *
 * Uses semantic colour tokens and respects `prefers-reduced-motion` for
 * the active spinner. Includes `aria-live="polite"` for screen reader
 * updates as steps complete.
 */
export function IngestionProgress({
  steps,
  compact = false,
  warnings,
}: IngestionProgressProps) {
  if (compact) {
    const activeStep = steps.find((s) => s.status === 'active');
    const doneCount = steps.filter((s) => s.status === 'done').length;
    const hasError = steps.some((s) => s.status === 'error');

    return (
      <div
        aria-live="polite"
        role="status"
        className="flex items-center gap-2 text-sm"
      >
        {activeStep ? (
          <>
            <Loader2
              className="size-4 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>
              {activeStep.label}... (step {doneCount + 1}/{steps.length})
            </span>
          </>
        ) : hasError ? (
          <>
            <AlertCircle
              className="size-4 text-destructive"
              aria-hidden="true"
            />
            <span className="text-destructive">Pipeline failed</span>
          </>
        ) : (
          <>
            <Check className="size-4 text-status-success" aria-hidden="true" />
            <span className="text-status-success">All steps complete</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div aria-live="polite" role="status">
      <ul className="space-y-2" aria-label="Ingestion pipeline steps">
        {steps.map((step, index) => (
          <li key={index} className="flex items-center gap-2">
            <StepIcon status={step.status} />
            <span
              className={cn(
                'text-sm',
                step.status === 'active' && 'font-medium text-foreground',
                step.status === 'done' && 'text-muted-foreground',
                step.status === 'error' && 'text-destructive',
                step.status === 'skipped' &&
                  'text-muted-foreground line-through',
                step.status === 'pending' && 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
            <span className="sr-only">({statusLabel(step.status)})</span>
          </li>
        ))}
      </ul>

      {warnings && warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-status-warning/30 bg-status-warning/10 p-3">
          <p className="mb-1 text-xs font-medium text-status-warning">
            {warnings.length === 1
              ? '1 warning'
              : `${warnings.length} warnings`}
          </p>
          <ul className="space-y-1">
            {warnings.map((warning, i) => (
              <li key={i} className="text-xs text-status-warning">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
