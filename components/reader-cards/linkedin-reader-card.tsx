'use client';

import { ExternalLink, Repeat2, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ContentRenderer } from '@/components/content-renderer';
import { cn } from '@/lib/utils';

interface LinkedInReaderCardProps {
  content: string;
  authorName: string | null;
  metadata: Record<string, unknown> | null;
  className?: string;
}

export function LinkedInReaderCard({
  content,
  authorName,
  metadata,
  className,
}: LinkedInReaderCardProps) {
  const authorHeadline = metadata?.author_headline as string | undefined;
  const isRepost = metadata?.is_repost as boolean | undefined;
  const repostAuthor = metadata?.repost_author as string | undefined;
  const articleUrl = metadata?.article_url as string | undefined;
  const articleTitle = metadata?.article_title as string | undefined;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden',
        className,
      )}
    >
      {/* Repost banner */}
      {isRepost && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
          <Repeat2 className="size-3.5" />
          <span>
            Reposted{repostAuthor ? ` by ${repostAuthor}` : ''}
          </span>
        </div>
      )}

      {/* Author header */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          {authorName && (
            <div className="font-semibold text-foreground">{authorName}</div>
          )}
          {authorHeadline && (
            <div className="text-sm text-muted-foreground line-clamp-2">
              {authorHeadline}
            </div>
          )}
          <Badge variant="secondary" className="mt-1 text-xs">
            LinkedIn
          </Badge>
        </div>
      </div>

      {/* Post content */}
      <div className="px-4 py-4">
        <ContentRenderer content={content} className="max-w-none" />
      </div>

      {/* Shared article card */}
      {articleUrl && (
        <div className="mx-4 mb-4">
          <a
            href={articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start gap-2">
              <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-foreground group-hover:underline">
                  {articleTitle || 'Shared article'}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {articleUrl}
                </div>
              </div>
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
