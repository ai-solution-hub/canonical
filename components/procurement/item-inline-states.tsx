'use client';

import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * STUB (functional minimum) — scaffolded by ID-145 {145.42} (145W-2), FILLED
 * by {145.43}.
 *
 * The item-page BI-19 empty/loading/error states — distinct from the
 * per-viewer §B6 states (147-O/`viewer-states.tsx` owns those). {145.43}
 * upgrades this to the full empty-card/spinner/soft-error-with-retry
 * treatment (BI-19); this stub keeps the page usably honest in the
 * meantime (never a blank pane) with a minimal loading spinner and a
 * non-colour-only error notice, replacing the previous bespoke skeleton
 * markup that lived inline in `page.tsx`.
 */
export type ItemInlineStateVariant = 'loading' | 'error';

export interface ItemInlineStatesProps {
  variant: ItemInlineStateVariant;
  message?: string;
}

const DEFAULT_ERROR_MESSAGE =
  'This item could not be loaded. It may have been deleted, or you may not have access.';

export function ItemInlineStates({ variant, message }: ItemInlineStatesProps) {
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
      <Button asChild variant="outline" className="mt-2">
        <Link href="/procurement">Return to Procurement</Link>
      </Button>
    </div>
  );
}
