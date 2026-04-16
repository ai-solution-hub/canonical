'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';

const DISMISS_KEY = 'mcp-setup-nudge-dismissed';

interface McpSetupNudgeProps {
  /** Whether the KB has at least one content item. When false the nudge is
   *  hidden — there is nothing to connect to yet. */
  hasContent: boolean;
}

/**
 * One-shot nudge that points users at Settings → Connections to configure an
 * MCP connector. Appears once, dismisses permanently on close via
 * `localStorage`. Modelled on `DisplayNameNudge` in `reorient-section.tsx`.
 *
 * Gated on `hasContent` — only shown when the KB has ≥1 item (all roles).
 *
 * Rendered from `app/page.tsx` (the dashboard entry). The header no longer
 * contains a direct "Open in Claude" link (removed April 2026); this nudge
 * preserves the discoverability commitment made in the policy note on that
 * removal without re-adding a persistent header link.
 */
export function McpSetupNudge({ hasContent }: McpSetupNudgeProps) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    // Lazy initial state — runs once per mount. On SSR the effect never runs,
    // so we default to `true` (hidden) to avoid hydration mismatch; the real
    // value is read from localStorage on the client-side first render via the
    // `hydrated` gate below.
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // localStorage unavailable (private mode) — stay hidden
      return true;
    }
  });

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // best-effort
    }
  }

  if (!hasContent || !hydrated || dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-accent/30 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <Plug className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-foreground">
          Connect your workspace to Claude Desktop —{' '}
          <Link
            href="/settings/connections"
            className="font-medium text-foreground underline hover:no-underline"
          >
            set up a connection
          </Link>
          .
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={handleDismiss}
        aria-label="Dismiss MCP setup nudge"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
