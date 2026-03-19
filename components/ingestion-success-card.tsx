'use client';

import Link from 'next/link';
import { CheckCircle, ExternalLink, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface IngestionSuccessCardProps {
  itemId: string;
  title: string;
  contentType: string;
  domain?: string;
  subtopic?: string;
  warnings?: string[];
  dedupMatches?: Array<{
    id: string;
    title: string;
    similarity: number;
  }>;
}

/**
 * Success card shown after content ingestion completes.
 *
 * Displays the created item with its classification results,
 * any warnings from the pipeline, and optional duplicate matches.
 * Provides navigation to the new item and a "Create another" action.
 */
export function IngestionSuccessCard({
  itemId,
  title,
  contentType,
  domain,
  subtopic,
  warnings,
  dedupMatches,
}: IngestionSuccessCardProps) {
  return (
    <div className="rounded-lg border border-status-success/30 bg-status-success/10 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle
          className="mt-0.5 size-5 shrink-0 text-status-success"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">
            Content ingested successfully
          </h3>

          {/* Title with link */}
          <Link
            href={`/item/${itemId}`}
            className="mt-1 block text-sm font-medium text-primary hover:underline"
          >
            {title}
          </Link>

          {/* Classification badges */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs">
              {contentType.replace(/_/g, ' ')}
            </Badge>
            {domain && (
              <Badge variant="secondary" className="text-xs">
                {domain}
              </Badge>
            )}
            {subtopic && (
              <Badge variant="secondary" className="text-xs">
                {subtopic}
              </Badge>
            )}
          </div>

          {/* Warnings */}
          {warnings && warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {warnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  <AlertTriangle
                    className="mt-0.5 size-3 shrink-0 text-status-warning"
                    aria-hidden="true"
                  />
                  <span className="text-status-warning">{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Dedup matches */}
          {dedupMatches && dedupMatches.length > 0 && (
            <div className="mt-3 rounded border border-status-warning/20 bg-status-warning/5 p-2">
              <p className="text-xs font-medium text-status-warning">
                Similar items found:
              </p>
              <ul className="mt-1 space-y-1">
                {dedupMatches.map((match) => (
                  <li key={match.id} className="flex items-center gap-1.5 text-xs">
                    <Link
                      href={`/item/${match.id}`}
                      className="text-primary hover:underline"
                    >
                      {match.title}
                    </Link>
                    <span className="text-muted-foreground">
                      ({Math.round(match.similarity * 100)}% similar)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/item/${itemId}`}>
                View item
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="gap-1.5">
              <Link href="/item/new">
                <Plus className="size-3" aria-hidden="true" />
                Create another
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
