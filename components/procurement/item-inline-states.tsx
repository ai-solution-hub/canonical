'use client';

import Link from 'next/link';
import { AlertCircle, Inbox, Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * ID-145 {145.43} (BI-19) — the item-page empty/loading/error states, distinct
 * from the per-viewer §B6 states (`147-O`/`viewer-states.tsx` owns those, one
 * per document viewer). Replaces the {145.42} loading/error-only stub: adds
 * the `empty` variant (an "empty card" — used by `ItemWorkflowPanel` for the
 * defensive legacy-shape case where `workflow_state` is genuinely absent, see
 * `procurement-detail-shape.ts`'s {145.18} note) and a retry affordance on
 * `error` (soft-error + retry, never a silent dead end), modelled on the same
 * reload-based retry pattern as `SourceDocumentDetailError`
 * (`components/source-document-detail/source-document-detail-client.tsx`).
 * Never a blank pane; every variant carries a text label or icon meaning
 * (WCAG 2.1 AA, never colour-only).
 */
export type ItemInlineStateVariant = 'empty' | 'loading' | 'error';

export interface ItemInlineStatesProps {
  variant: ItemInlineStateVariant;
  message?: string;
  /**
   * Called when the user retries after an `error`. Omit to fall back to a
   * full page reload (the only retry a caller without its own refetch can
   * offer, e.g. `page.tsx`'s top-level fetch-failure render).
   */
  onRetry?: () => void;
}

const DEFAULT_ERROR_MESSAGE =
  'This item could not be loaded. It may have been deleted, or you may not have access.';
const DEFAULT_EMPTY_MESSAGE = 'Nothing to show here yet.';

function reloadPage() {
  window.location.reload();
}

export function ItemInlineStates({
  variant,
  message,
  onRetry,
}: ItemInlineStatesProps) {
  if (variant === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="item-inline-states-loading"
        className="flex flex-col items-center justify-center gap-3 py-20 text-center"
      >
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (variant === 'empty') {
    return (
      <div
        role="status"
        data-testid="item-inline-states-empty"
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center"
      >
        <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="max-w-sm text-sm text-muted-foreground">
          {message ?? DEFAULT_EMPTY_MESSAGE}
        </p>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="item-inline-states-error"
      className="flex flex-col items-center justify-center gap-2 py-20 text-center"
    >
      <AlertCircle
        className="size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="text-lg font-semibold text-foreground">
        Procurement not found
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {message ?? DEFAULT_ERROR_MESSAGE}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" onClick={onRetry ?? reloadPage}>
          <RefreshCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link href="/procurement">Return to Procurement</Link>
        </Button>
      </div>
    </div>
  );
}
