'use client';

import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface DedupMatch {
  id: string;
  title: string;
  similarity: number;
  match_type: 'exact' | 'near_duplicate';
}

export interface DedupWarningProps {
  matches: DedupMatch[];
  onViewMatch: (id: string) => void;
  onDismiss: () => void;
}

/**
 * Inline alert showing potential duplicate content matches.
 *
 * Non-blocking — appears as a dismissible warning banner rather
 * than a modal dialog. "View match" opens the item in a new tab.
 * Uses semantic colour tokens for WCAG 2.1 AA compliance.
 */
export function DedupWarning({
  matches,
  onViewMatch,
  onDismiss,
}: DedupWarningProps) {
  if (matches.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-md border border-status-warning/30 bg-status-warning/10 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-status-warning"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-status-warning">
              Potential {matches.length === 1 ? 'duplicate' : 'duplicates'}{' '}
              found
            </p>
            <ul className="mt-2 space-y-2">
              {matches.map((match) => (
                <li key={match.id} className="flex items-center gap-2 text-sm">
                  <span className="text-foreground">{match.title}</span>
                  <span className="shrink-0 rounded bg-status-warning/20 px-1.5 py-0.5 text-xs text-status-warning">
                    {match.match_type === 'exact'
                      ? 'Exact match'
                      : `${Math.round(match.similarity * 100)}% similar`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto gap-1 px-1.5 py-0.5 text-xs text-primary"
                    onClick={() => onViewMatch(match.id)}
                  >
                    View match
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          aria-label="Dismiss duplicate warning"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
