'use client';

import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface WarningsBannerProps {
  /**
   * Non-fatal warnings produced by the dashboard data fetch. Sourced from the
   * canonical `T & { warnings: readonly string[] }` sibling envelope used by
   * the dashboard route at `app/api/dashboard/route.ts:71-84`. Server-rendered
   * pages may construct this list directly from `unified.errors` plus any
   * page-level role-lookup warnings.
   */
  warnings: readonly string[];
}

/**
 * Dashboard partial-failure banner.
 *
 * Renders a dismissible warning banner when the dashboard data fetch
 * surfaces non-fatal sub-query failures. Hidden when `warnings` is empty
 * or has been dismissed in the current session.
 *
 * Accessibility: uses `role="status"` + `aria-live="polite"` (not
 * `role="alert"`) so screen readers announce the partial failure without
 * pre-empting the rest of the page. Icon plus text — never colour alone
 * for meaning. Dismiss button has an explicit aria-label and is keyboard
 * focusable via the standard Button primitive.
 */
export function WarningsBanner({ warnings }: WarningsBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (!warnings || warnings.length === 0) return null;

  const headingId = 'dashboard-warnings-banner-heading';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby={headingId}
      className="rounded-md border border-status-warning/30 bg-status-warning/10 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-status-warning"
            aria-hidden="true"
          />
          <div>
            <p
              id={headingId}
              className="text-sm font-medium text-status-warning"
            >
              {warnings.length === 1
                ? 'Some dashboard data could not be loaded'
                : `${warnings.length} dashboard sections could not be loaded`}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
              {warnings.map((warning, idx) => (
                <li key={`${idx}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss dashboard warnings"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
