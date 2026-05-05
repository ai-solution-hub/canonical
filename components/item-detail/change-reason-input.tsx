'use client';

import type { ContentTabsEditConfig } from '@/components/item-detail/content-tabs';

/** @public */
export interface ChangeReasonInputProps {
  editConfig: ContentTabsEditConfig;
}

/**
 * S153 WP3(a): "Why change?" optional text input shown on inline edits.
 * NULL-acceptable -- an empty value is persisted as NULL in
 * `content_history.change_reason`.
 */
export function ChangeReasonInput({ editConfig }: ChangeReasonInputProps) {
  return (
    <div className="space-y-1">
      <label
        htmlFor="content-tabs-change-reason"
        className="text-xs font-medium text-muted-foreground"
      >
        Why change? <span className="font-normal">(optional)</span>
      </label>
      <input
        id="content-tabs-change-reason"
        type="text"
        value={editConfig.changeReason}
        onChange={(e) => editConfig.onChangeReasonChange(e.target.value)}
        placeholder="e.g. Updated to reflect 2026 rebrand"
        maxLength={500}
        className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
