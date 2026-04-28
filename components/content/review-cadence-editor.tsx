'use client';

import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { queryKeys } from '@/lib/query/query-keys';
import { captureClientException } from '@/lib/client-telemetry';

/**
 * Cadence preset options. Mirrors the DB CHECK constraint range [1, 1095].
 *
 * Hoisted at module level so reference equality is preserved across renders
 * (per CLAUDE.md "Stable empty array/object defaults in hook returns").
 */
const PRESETS = [
  { value: 'none', label: 'No recurring review', days: null as number | null },
  { value: '90', label: 'Every 3 months', days: 90 },
  { value: '182', label: 'Every 6 months', days: 182 },
  { value: '365', label: 'Every 12 months', days: 365 },
  { value: 'custom', label: 'Custom...', days: null as number | null },
] as const;

const CADENCE_MIN = 1;
const CADENCE_MAX = 1095;

/** Map an existing cadence value to the matching preset key, or 'custom'. */
function presetKeyForDays(days: number | null): string {
  if (days === null) return 'none';
  if (days === 90 || days === 182 || days === 365) return String(days);
  return 'custom';
}

interface ReviewCadenceEditorProps {
  itemId: string;
  /** Initial value of `content_items.next_review_date` (ISO YYYY-MM-DD or null) */
  nextReviewDate: string | null;
  /** Initial value of `content_items.review_cadence_days` (1..1095 or null) */
  reviewCadenceDays: number | null;
}

interface PatchPayload {
  field: 'next_review_date' | 'review_cadence_days';
  value: string | null;
}

/**
 * Editor for governance review schedule fields:
 *   - `next_review_date` (ISO date)
 *   - `review_cadence_days` (1..1095 or NULL)
 *
 * Mounted only when the parent passes `readOnly={false}` (i.e. EditorView).
 * Writes via `PATCH /api/items/:id` using existing field/value payloads
 * (validation accepted since S200 §5.5 Phase 1).
 *
 * Custom cadence input enforces integer + range CLIENT-SIDE so an invalid
 * value never reaches the API; this mirrors the DB CHECK constraint added
 * in §5.2 Phase 1b.
 */
export function ReviewCadenceEditor({
  itemId,
  nextReviewDate,
  reviewCadenceDays,
}: ReviewCadenceEditorProps) {
  const queryClient = useQueryClient();

  // Local state — initialised from props. The per-item page route at
  // `app/item/[id]/page.tsx` unmounts on URL change, so no useEffect sync
  // from prop → state is needed within a single mount.
  const [dateValue, setDateValue] = useState<string | null>(nextReviewDate);
  const [cadencePreset, setCadencePreset] = useState<string>(
    presetKeyForDays(reviewCadenceDays),
  );
  const [customValue, setCustomValue] = useState<string>(
    reviewCadenceDays !== null &&
      presetKeyForDays(reviewCadenceDays) === 'custom'
      ? String(reviewCadenceDays)
      : '',
  );
  const [customError, setCustomError] = useState<string | null>(null);

  // Tracks the most-recently-persisted date so onBlur can skip duplicate
  // PATCHes when the user re-blurs an unchanged input. Updated inside
  // handleDateChange after a successful mutateAsync.
  const lastPersistedDateRef = useRef<string | null>(nextReviewDate);

  // ---------------------------------------------------------------------
  // Mutation — PATCH /api/items/:id
  //
  // One mutation handles both fields; the field name is included in the
  // payload so we can invalidate the same query key on success regardless
  // of which control fired the change.
  // ---------------------------------------------------------------------
  const mutation = useMutation<void, Error, PatchPayload>({
    mutationFn: async (payload) => {
      const res = await fetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to update review schedule');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentItems.detail(itemId),
      });
    },
    onError: (err, payload) => {
      captureClientException(err, {
        scope: 'review-cadence-editor.patch',
        extras: { itemId, field: payload.field },
      });
      toast.error(
        err instanceof Error ? err.message : 'Failed to update review schedule',
      );
    },
  });

  const { mutateAsync } = mutation;

  // ---------------------------------------------------------------------
  // Date picker handlers
  // ---------------------------------------------------------------------
  const handleDateChange = useCallback(
    async (next: string | null) => {
      // Rollback target = last successfully persisted value (not the current
      // local state, which onChange may have already updated optimistically).
      const previous = lastPersistedDateRef.current;
      setDateValue(next);
      try {
        await mutateAsync({ field: 'next_review_date', value: next });
        lastPersistedDateRef.current = next;
      } catch {
        setDateValue(previous);
      }
    },
    [mutateAsync],
  );

  // ---------------------------------------------------------------------
  // Cadence preset handlers
  // ---------------------------------------------------------------------
  const persistCadence = useCallback(
    async (days: number | null) => {
      try {
        // Server validation expects an integer-string, mirroring schema in
        // lib/validation/schemas.ts (`review_cadence_days value must be an
        // integer string or null`).
        await mutateAsync({
          field: 'review_cadence_days',
          value: days === null ? null : String(days),
        });
      } catch {
        // onError already toasted; error captured by mutation
      }
    },
    [mutateAsync],
  );

  const handlePresetChange = useCallback(
    async (next: string) => {
      setCadencePreset(next);
      setCustomError(null);

      if (next === 'custom') {
        // Reveal numeric input but do NOT POST yet — wait for user to type
        // then blur or press Enter.
        return;
      }

      const preset = PRESETS.find((p) => p.value === next);
      if (!preset) return;

      // Clear the custom input so the UI does not display a stale value
      setCustomValue('');
      await persistCadence(preset.days);
    },
    [persistCadence],
  );

  /**
   * Validate + persist a custom cadence value. Returns true on success.
   * Pure-client validation; mirrors lib/validation/schemas.ts CHECK on
   * `review_cadence_days`.
   */
  const commitCustom = useCallback(async () => {
    const trimmed = customValue.trim();
    if (trimmed.length === 0) {
      setCustomError('Cadence is required');
      return;
    }
    if (!/^-?\d+$/.test(trimmed)) {
      setCustomError('Cadence must be a whole number');
      return;
    }
    const n = parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < CADENCE_MIN || n > CADENCE_MAX) {
      setCustomError(
        `Cadence must be an integer between ${CADENCE_MIN} and ${CADENCE_MAX}`,
      );
      return;
    }
    setCustomError(null);
    await persistCadence(n);
  }, [customValue, persistCadence]);

  // Display value for the date input — empty string when null
  const dateInputValue = dateValue ?? '';

  return (
    <div className="space-y-3" data-slot="review-cadence-editor">
      <h3 className="text-xs font-medium text-muted-foreground">
        Review Schedule
      </h3>

      {/* Next review date */}
      <div>
        <label
          htmlFor={`review-cadence-editor-date-${itemId}`}
          className="block text-xs text-muted-foreground"
        >
          Next review date
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id={`review-cadence-editor-date-${itemId}`}
            type="date"
            value={dateInputValue}
            placeholder="Not scheduled"
            disabled={mutation.isPending}
            onChange={(e) => {
              const next = e.target.value || null;
              setDateValue(next);
            }}
            onBlur={(e) => {
              const next = e.target.value || null;
              if (next !== lastPersistedDateRef.current) {
                handleDateChange(next);
              }
            }}
            className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground"
            aria-label="Next review date"
          />
          {dateValue && (
            <button
              type="button"
              onClick={() => handleDateChange(null)}
              disabled={mutation.isPending}
              className="flex items-center justify-center rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label="Clear next review date"
            >
              <X className="size-3.5" />
            </button>
          )}
          {!mutation.isPending &&
            mutation.isSuccess &&
            mutation.variables?.field === 'next_review_date' && (
              <Check
                className="size-3 text-[var(--success)]"
                aria-label="Saved"
              />
            )}
        </div>
        {!dateValue && (
          <p className="mt-1 text-xs text-muted-foreground">Not scheduled</p>
        )}
      </div>

      {/* Cadence preset */}
      <div>
        <label
          htmlFor={`review-cadence-editor-preset-${itemId}`}
          className="block text-xs text-muted-foreground"
        >
          Recurring cadence
        </label>
        <div className="mt-1">
          <Select
            value={cadencePreset}
            onValueChange={handlePresetChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger
              id={`review-cadence-editor-preset-${itemId}`}
              className="h-8 w-full"
              aria-label="Recurring cadence"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {cadencePreset === 'custom' && (
          <div className="mt-2 space-y-1">
            <label
              htmlFor={`review-cadence-editor-custom-${itemId}`}
              className="block text-xs text-muted-foreground"
            >
              Custom interval (days, {CADENCE_MIN}–{CADENCE_MAX})
            </label>
            <Input
              id={`review-cadence-editor-custom-${itemId}`}
              type="number"
              min={CADENCE_MIN}
              max={CADENCE_MAX}
              step={1}
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                setCustomError(null);
              }}
              onBlur={commitCustom}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitCustom();
                }
              }}
              disabled={mutation.isPending}
              aria-invalid={customError !== null}
              aria-describedby={
                customError
                  ? `review-cadence-editor-custom-error-${itemId}`
                  : undefined
              }
              className="h-8 text-sm"
            />
            {customError && (
              <p
                id={`review-cadence-editor-custom-error-${itemId}`}
                role="alert"
                className="text-xs text-status-error"
              >
                {customError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
