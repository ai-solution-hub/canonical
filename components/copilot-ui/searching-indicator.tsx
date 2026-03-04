'use client';

import { Loader2, Search } from 'lucide-react';

/**
 * Inline indicator shown in the CopilotKit chat sidebar while a
 * knowledge base search is in progress.
 */
export function SearchingIndicator() {
  return (
    <div
      className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <Search className="size-4" aria-hidden="true" />
      <span>Searching knowledge base...</span>
    </div>
  );
}
