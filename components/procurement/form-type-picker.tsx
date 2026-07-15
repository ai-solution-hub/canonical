'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { tryQuery } from '@/lib/supabase/safe';
import { queryKeys } from '@/lib/query/query-keys';

/**
 * `form_type` picker — net-new IA (ID-130 {130.12}, PRODUCT B-16 / TECH T-B16).
 *
 * Infer-then-confirm: the ingestion pipeline classifies an uploaded document and
 * writes the inferred type to `form_templates.form_type`; this picker presents
 * that inference pre-selected and lets the user confirm (the common, single-click
 * path) or override. Per B-14 the CONFIRMED/overridden choice — not the raw
 * inference — is authoritative; the consuming surface persists the choice as
 * `form_templates.form_type`. Consistent with the AI-invisible-infrastructure
 * policy, the inference is shown as an ordinary pre-filled field, not flagged as
 * an "AI guess".
 *
 * The picker does NOT re-run classification — there is a single classifier (the
 * pipeline); the UI consumes its output via the `inferredFormType` prop. When
 * inference is unavailable or low-confidence (no document), `inferredFormType`
 * is null/undefined and NO option is pre-selected: the user must pick before
 * confirming (confirm-first; never silent-assign).
 */

/**
 * Closed list of procurement-applicable `form_type` keys (TECH T-B12, post AD-4
 * `pqq`->`psq` rename). The picker's *option list* is fetched at runtime from
 * `api.form_types` (below) so the controlled vocabulary stays the single source
 * of truth — a future CV add/remove needs no code change. This enum exists ONLY
 * as the minimal compile-time tuple for request-body validation where a Zod
 * schema needs the closed set; it is NOT a second hand-maintained option list.
 *
 * No 'bid' entry (ID-145 BI-8/BI-12, {145.27}+{145.28}): 'Bid' is retired as a
 * first-class creation label — it no longer appears in `api.form_types`, so it
 * is dropped from this compile-time mirror too.
 */
export const procurementFormTypeKeys = [
  'checklist',
  'itt',
  'psq',
  'questionnaire',
  'rfp',
  'tender',
] as const;

export const procurementFormTypeEnum = z.enum(procurementFormTypeKeys);
export type ProcurementFormType = z.infer<typeof procurementFormTypeEnum>;

/** Option projected from `api.form_types` (the CV single source of truth). */
export interface FormTypeOption {
  key: string;
  label: string;
}

/**
 * Fetch the procurement-applicable form types from `api.form_types`, filtered to
 * `'procurement' = ANY(applicable_application_types)`. Returns options by their
 * human UK label (B-13 terminology).
 */
async function fetchProcurementFormTypes(): Promise<FormTypeOption[]> {
  const supabase = createClient();
  const result = await tryQuery<{ key: string | null; label: string | null }[]>(
    supabase
      .from('form_types')
      .select('key, label')
      .contains('applicable_application_types', ['procurement'])
      .order('label'),
    'procurement.form_types.list',
  );
  if (!result.ok) throw result.error;
  return (result.data ?? [])
    .filter(
      (row): row is { key: string; label: string } =>
        Boolean(row.key) && Boolean(row.label),
    )
    .map((row) => ({ key: row.key, label: row.label }));
}

/** TanStack Query hook for the CV-driven procurement form_type option list. */
export function useProcurementFormTypes() {
  return useQuery({
    queryKey: queryKeys.procurement.formTypes.list,
    queryFn: fetchProcurementFormTypes,
  });
}

export interface FormTypePickerProps {
  /**
   * The `form_type` key the platform inferred for this form (the value the
   * ingestion pipeline wrote to `form_templates.form_type`). `null`/`undefined`
   * when inference is unavailable or low-confidence (no document) — in which
   * case NO option is pre-selected and the user must pick (never silent-assign).
   */
  inferredFormType?: string | null;
  /**
   * Fired with the user's CONFIRMED choice. Per B-14 the confirmed/overridden
   * choice — not the raw inference — is authoritative; the consuming surface
   * persists it as `form_templates.form_type`.
   */
  onConfirm: (formType: string) => void;
  /** Disable interaction while the consumer persists the confirmed choice. */
  isConfirming?: boolean;
  className?: string;
}

export function FormTypePicker({
  inferredFormType,
  onConfirm,
  isConfirming = false,
  className,
}: FormTypePickerProps) {
  const { data, isLoading, isError } = useProcurementFormTypes();
  const options = useMemo(() => data ?? [], [data]);

  // Pre-select the inferred type on the common path; a null inference => no
  // pre-selection (confirm-first — the user must pick). Reset across forms via a
  // `key` prop at the call site (components/CLAUDE.md), not a setState effect.
  const [selected, setSelected] = useState<string | null>(
    inferredFormType ?? null,
  );

  if (isLoading) {
    return (
      <div
        role="status"
        className={cn('text-sm text-muted-foreground', className)}
      >
        Loading form types…
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className={cn('text-sm text-destructive', className)}>
        Could not load form types. Please try again.
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        role="radiogroup"
        aria-label="Form type"
        className="flex flex-col gap-2"
      >
        {options.map((option) => {
          const isSelected = selected === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={isConfirming}
              onClick={() => setSelected(option.key)}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                isSelected
                  ? 'border-primary bg-primary/10 font-medium text-foreground'
                  : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span>{option.label}</span>
              {/*
                WCAG: selection is conveyed by MORE than colour — an explicit
                check icon plus a textual "Selected" indicator accompany the
                aria-checked state.
              */}
              {isSelected ? (
                <span className="flex items-center gap-1 text-primary">
                  <Check aria-hidden="true" className="size-4" />
                  <span className="text-xs font-medium">Selected</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div>
        <Button
          type="button"
          disabled={selected === null || isConfirming}
          onClick={() => {
            if (selected !== null) onConfirm(selected);
          }}
        >
          Confirm form type
        </Button>
      </div>
    </div>
  );
}
