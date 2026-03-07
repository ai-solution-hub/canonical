'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SearchResultItem {
  id: string;
  title: string;
  type?: string;
  domain?: string;
  similarity?: number;
  summary?: string;
  snippet?: string;
}

interface KBSearchResultsProps {
  results: SearchResultItem[];
}

/**
 * Renders KB search results inline in the CopilotKit chat sidebar.
 * Each result shows a title, content type badge, domain, similarity
 * score, and a short snippet or summary.
 */
export function KBSearchResults({ results }: KBSearchResultsProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-center text-sm text-muted-foreground">
        No matching content found in the knowledge base. Try different search terms.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileText className="size-3.5" aria-hidden="true" />
        {results.length} result{results.length !== 1 ? 's' : ''} found
      </div>
      <div className="divide-y rounded-md border">
        {results.map((item) => (
          <div key={item.id} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <a
                  href={`/item/${item.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="truncate">{item.title}</span>
                  <ExternalLink
                    className="size-3 shrink-0"
                    aria-hidden="true"
                  />
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {item.type && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {item.type.replace(/_/g, ' ')}
                    </Badge>
                  )}
                  {item.domain && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {item.domain}
                    </Badge>
                  )}
                  {item.similarity != null && (
                    <span className="text-[10px] text-muted-foreground">
                      {Math.round(item.similarity * 100)}% match
                    </span>
                  )}
                </div>
                {(item.summary || item.snippet) && (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                    {item.summary || item.snippet}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
