'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Flag, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  FeedArticle,
  ArticleTab,
} from '@/hooks/intelligence/use-feed-articles';

interface ArticleCardProps {
  article: FeedArticle;
  tab: ArticleTab;
  onFlag: () => void;
  flagged?: boolean;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getRelevanceColourClass(score: number | null): string {
  if (score === null) return '';
  if (score >= 0.8)
    return 'bg-[var(--color-relevance-high)] text-[var(--color-relevance-high-text)]';
  if (score >= 0.5)
    return 'bg-[var(--color-relevance-medium)] text-[var(--color-relevance-medium-text)]';
  if (score >= 0.2)
    return 'bg-[var(--color-relevance-low)] text-[var(--color-relevance-low-text)]';
  return 'bg-[var(--color-relevance-irrelevant)] text-[var(--color-relevance-irrelevant-text)]';
}

function getRelevanceLabel(score: number | null): string {
  if (score === null) return 'Unknown';
  return `${(score * 100).toFixed(0)}%`;
}

export function ArticleCard({
  article,
  tab,
  onFlag,
  flagged = false,
}: ArticleCardProps) {
  const [expanded, setExpanded] = useState(false);

  const reasoning =
    tab === 'passed' ? article.ai_summary : article.relevance_reasoning;
  const reasoningLabel = tab === 'passed' ? 'Summary' : 'Relevance reasoning';

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              href={article.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm font-semibold text-foreground hover:underline"
            >
              {article.title}
              <ExternalLink
                className="ml-1 inline-block size-3 shrink-0"
                aria-hidden="true"
              />
            </a>
          </div>
          {article.source_name && (
            <Badge variant="outline" className="mt-1 text-xs">
              {article.source_name}
            </Badge>
          )}
        </div>

        {/* Relevance score badge */}
        {article.relevance_score !== null && (
          <Badge
            className={cn(
              'shrink-0 text-xs font-medium',
              getRelevanceColourClass(article.relevance_score),
            )}
          >
            {getRelevanceLabel(article.relevance_score)}
          </Badge>
        )}
      </div>

      {/* Body — reasoning / summary */}
      {reasoning && (
        <div className="mt-2">
          <p
            className={cn(
              'text-xs text-muted-foreground',
              !expanded && 'line-clamp-3',
            )}
          >
            <span className="font-medium text-foreground/70">
              {reasoningLabel}:{' '}
            </span>
            {reasoning}
          </p>
          {reasoning.length > 200 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="mt-1 h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <>
                  Show less <ChevronUp className="ml-0.5 size-3" />
                </>
              ) : (
                <>
                  Show more <ChevronDown className="ml-0.5 size-3" />
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          {article.published_at && (
            <span>Published: {formatDate(article.published_at)}</span>
          )}
          <span>Ingested: {formatDate(article.ingested_at)}</span>
          {article.flag_count > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <Flag className="size-3" aria-hidden="true" />
              {article.flag_count} flag{article.flag_count !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onFlag}
          disabled={flagged}
          className="h-7 gap-1.5 text-xs"
        >
          <Flag className="size-3" aria-hidden="true" />
          {flagged
            ? 'Flagged'
            : tab === 'passed'
              ? 'Flag as irrelevant'
              : 'Flag as relevant'}
        </Button>
      </div>
    </div>
  );
}
