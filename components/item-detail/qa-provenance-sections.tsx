'use client';

import Link from 'next/link';

export interface Workspace {
  id: string;
  name: string;
}

export interface RelatedQAItem {
  id: string;
  title: string | null;
}

/** @public */
export interface QAUsedInBidsProps {
  workspaces: Workspace[];
}

/**
 * Shows which bid workspaces a Q&A pair is used in.
 */
export function QAUsedInBids({ workspaces }: QAUsedInBidsProps) {
  if (workspaces.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border bg-card p-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Used in {workspaces.length} bid{workspaces.length !== 1 ? 's' : ''}
      </h3>
      <div className="flex flex-wrap gap-2">
        {workspaces.map((w) => (
          <Link
            key={w.id}
            href={`/bid/${w.id}`}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-accent transition-colors"
          >
            {w.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** @public */
export interface QARelatedPairsProps {
  relatedQA: RelatedQAItem[];
}

/**
 * Shows related Q&A pairs from the same source document.
 */
export function QARelatedPairs({ relatedQA }: QARelatedPairsProps) {
  if (relatedQA.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border bg-card p-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Related Q&A pairs (same source)
      </h3>
      <ul className="space-y-1">
        {relatedQA.map((q) => (
          <li key={q.id}>
            <Link
              href={`/item/${q.id}`}
              className="block rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
            >
              {q.title ?? 'Untitled'}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
