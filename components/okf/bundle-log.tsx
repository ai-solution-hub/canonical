'use client';

/**
 * `<BundleLog>` — the read-only `log.md` change history (ID-132 {132.14}
 * G-VIEWER NATIVE ADDITION; TECH-ADDENDUM-reference-agents.md Part 2).
 *
 * Reverse-chronological (ISO-8601 headings per DR-019) — `parseBundleLog`
 * already reverses the order, so this component renders `entries` as-given.
 * Read-only: no edit/accept/reject affordance here (that is ID-135's remit,
 * out of `{132.14}` scope per the addendum's cross-cutting takeaways).
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { OkfBundleLogEntry } from '@/lib/query/okf';

interface BundleLogProps {
  entries: OkfBundleLogEntry[];
  className?: string;
}

export function BundleLog({ entries, className }: BundleLogProps) {
  if (entries.length === 0) {
    return (
      <div
        data-testid="bundle-log"
        className={cn('p-4 text-sm text-muted-foreground', className)}
      >
        No run history recorded yet.
      </div>
    );
  }

  return (
    <div
      data-testid="bundle-log"
      className={cn('space-y-4 overflow-y-auto p-4', className)}
    >
      {entries.map((entry, i) => (
        <article
          key={`${entry.heading || 'entry'}-${i}`}
          className="border-b border-border pb-3 last:border-b-0"
        >
          {entry.heading && (
            <h3 className="text-xs font-semibold text-muted-foreground">
              {entry.heading}
            </h3>
          )}
          <div className="prose prose-sm mt-1 max-w-none text-sm text-foreground prose-p:my-1 prose-li:my-0.5">
            <Markdown remarkPlugins={[remarkGfm]}>{entry.body}</Markdown>
          </div>
        </article>
      ))}
    </div>
  );
}
