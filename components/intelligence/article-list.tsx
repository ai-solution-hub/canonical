'use client';

import { useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight, FileText, Filter } from 'lucide-react';
import {
  useFeedArticles,
  useFlagArticle,
} from '@/hooks/intelligence/use-feed-articles';
import type {
  ArticleTab,
  FeedArticle,
} from '@/hooks/intelligence/use-feed-articles';
import { useFeedSources } from '@/hooks/intelligence/use-feed-sources';
import { ArticleCard } from '@/components/intelligence/article-card';
import { FlagDialog } from '@/components/intelligence/flag-dialog';

interface ArticleListProps {
  workspaceId: string;
}

export function ArticleList({ workspaceId }: ArticleListProps) {
  const [tab, setTab] = useState<ArticleTab>('passed');
  const [page, setPage] = useState(1);
  const [sourceId, setSourceId] = useState<string | undefined>(undefined);
  const [flagDialogOpen, setFlagDialogOpen] = useState(false);
  const [flaggingArticle, setFlaggingArticle] = useState<FeedArticle | null>(
    null,
  );
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const limit = 20;

  const { data: sources } = useFeedSources(workspaceId);
  const { data, isLoading, error } = useFeedArticles(workspaceId, {
    tab,
    page,
    limit,
    source_id: sourceId,
  });
  // Fetch count for the opposite tab so both tab badges can display totals.
  const inactiveTab: ArticleTab = tab === 'passed' ? 'filtered' : 'passed';
  const { data: inactiveData } = useFeedArticles(workspaceId, {
    tab: inactiveTab,
    page: 1,
    limit: 1,
    source_id: sourceId,
  });
  const passedTotal = tab === 'passed' ? data?.total : inactiveData?.total;
  const filteredTotal = tab === 'filtered' ? data?.total : inactiveData?.total;
  const flagMutation = useFlagArticle(workspaceId);

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const handleTabChange = useCallback((value: string) => {
    setTab(value as ArticleTab);
    setPage(1);
  }, []);

  const handleSourceChange = useCallback((value: string) => {
    setSourceId(value === 'all' ? undefined : value);
    setPage(1);
  }, []);

  const handleFlag = useCallback((article: FeedArticle) => {
    setFlaggingArticle(article);
    setFlagDialogOpen(true);
  }, []);

  const handleFlagSubmit = useCallback(
    (notes?: string) => {
      if (!flaggingArticle) return;
      const flagType = tab === 'passed' ? 'false_positive' : 'false_negative';
      flagMutation.mutate(
        {
          articleId: flaggingArticle.id,
          data: { flag_type: flagType, notes },
        },
        {
          onSuccess: () => {
            setFlaggedIds((prev) => new Set(prev).add(flaggingArticle.id));
            setFlagDialogOpen(false);
            setFlaggingArticle(null);
          },
        },
      );
    },
    [flaggingArticle, flagMutation, tab],
  );

  return (
    <div>
      {/* Tab bar and filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="passed" className="gap-1.5">
              Passed
              {passedTotal !== undefined && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {passedTotal}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="filtered" className="gap-1.5">
              Filtered
              {filteredTotal !== undefined && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {filteredTotal}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Source filter */}
        {sources && sources.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Select
              value={sourceId ?? 'all'}
              onValueChange={handleSourceChange}
            >
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border bg-card"
              role="status"
              aria-label="Loading article"
            >
              <span className="sr-only">Loading...</span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Failed to load articles. Please try refreshing.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && data && data.articles.length === 0 && (
        <div className="mt-8 text-center">
          <FileText
            className="mx-auto mb-3 size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-foreground">
            {tab === 'passed'
              ? 'No passed articles yet'
              : 'No filtered articles'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tab === 'passed'
              ? 'Articles matching your relevance criteria will appear here.'
              : 'Articles that did not pass the relevance filter will appear here for review.'}
          </p>
        </div>
      )}

      {/* Article list */}
      {!isLoading && !error && data && data.articles.length > 0 && (
        <div className="mt-4 space-y-3">
          {data.articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              tab={tab}
              onFlag={() => handleFlag(article)}
              flagged={flaggedIds.has(article.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} ({data?.total ?? 0} articles)
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-7"
            >
              <ChevronLeft className="size-3" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-7"
            >
              Next
              <ChevronRight className="size-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Flag dialog */}
      <FlagDialog
        isOpen={flagDialogOpen}
        onClose={() => {
          setFlagDialogOpen(false);
          setFlaggingArticle(null);
        }}
        onSubmit={handleFlagSubmit}
        isPending={flagMutation.isPending}
        tab={tab}
      />
    </div>
  );
}
