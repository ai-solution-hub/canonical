'use client';

import { ArrowUp, ExternalLink, Image, MessageSquare, Play, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ContentRenderer } from '@/components/content-renderer';
import { cn } from '@/lib/utils';

interface RedditReaderCardProps {
  content: string;
  metadata: Record<string, unknown> | null;
  authorName?: string | null;
  sourceUrl?: string | null;
  className?: string;
}

/** Pattern matching `[Linked: <url>]` content from Reddit ingestion */
const LINKED_PATTERN = /^\[Linked:\s*(https?:\/\/[^\]]+)\]$/;

/** Detect image URLs (i.redd.it, imgur, preview.redd.it, etc.) */
function isImageUrl(url: string): boolean {
  return (
    url.includes('i.redd.it') ||
    url.includes('preview.redd.it') ||
    url.includes('i.imgur.com') ||
    /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)
  );
}

/** Detect Reddit video URLs (v.redd.it) */
function isRedditVideoUrl(url: string): boolean {
  return url.includes('v.redd.it');
}

/**
 * Parse content to determine if it is a linked post (image, video, or generic link).
 * Returns the linked URL if the content matches `[Linked: <url>]`, else null.
 */
function parseLinkedContent(content: string): string | null {
  const match = content.trim().match(LINKED_PATTERN);
  return match ? match[1] : null;
}

export function RedditReaderCard({
  content,
  metadata,
  authorName,
  sourceUrl,
  className,
}: RedditReaderCardProps) {
  const subreddit = metadata?.subreddit as string | undefined;
  const score = metadata?.score as number | undefined;
  const numComments = metadata?.num_comments as number | undefined;
  const postType = metadata?.post_type as string | undefined;
  const linkedUrl = metadata?.linked_url as string | undefined;

  // Detect linked content from the post body (e.g. image/video posts)
  const parsedLinkedUrl = parseLinkedContent(content);
  const effectiveLinkedUrl = linkedUrl || parsedLinkedUrl;
  const isLinkedPost = !!parsedLinkedUrl;

  // Determine media type for linked content
  const isImage = effectiveLinkedUrl ? isImageUrl(effectiveLinkedUrl) : false;
  const isVideo = effectiveLinkedUrl ? isRedditVideoUrl(effectiveLinkedUrl) : false;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden',
        className,
      )}
    >
      {/* Subreddit header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          {subreddit && (
            <a
              href={`https://reddit.com/r/${subreddit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground hover:underline"
            >
              r/{subreddit}
            </a>
          )}
          {postType && (
            <Badge variant="secondary" className="text-xs">
              {postType}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {score != null && (
            <span className="flex items-center gap-1">
              <ArrowUp className="size-3.5" />
              {score.toLocaleString('en-GB')}
            </span>
          )}
          {numComments != null && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {numComments.toLocaleString('en-GB')}
            </span>
          )}
        </div>
      </div>

      {/* Author line */}
      {authorName && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm text-muted-foreground">
          <User className="size-3.5" />
          <span>u/{authorName}</span>
        </div>
      )}

      {/* Post content — varies by type */}
      <div className="px-4 py-4">
        {isLinkedPost && isImage ? (
          /* Image post: show a clickable thumbnail */
          <a
            href={effectiveLinkedUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="group block"
          >
            <div className="overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={effectiveLinkedUrl!}
                alt="Reddit post image"
                className="max-h-[500px] w-full object-contain transition-opacity group-hover:opacity-90"
                loading="lazy"
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Image className="size-3" />
              <span className="truncate">{effectiveLinkedUrl}</span>
            </div>
          </a>
        ) : isLinkedPost && isVideo ? (
          /* Video post: show a "Watch on Reddit" card (v.redd.it cannot be embedded) */
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <Play className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Reddit video cannot be embedded directly.
              </p>
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
                >
                  Watch on Reddit
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        ) : isLinkedPost ? (
          /* Generic link post: the linked URL card below handles display */
          null
        ) : (
          /* Text post: render with markdown */
          <ContentRenderer content={content} className="max-w-none" />
        )}
      </div>

      {/* Linked URL card — shown for link posts (from metadata or parsed content) that are not image/video */}
      {effectiveLinkedUrl && !isImage && !isVideo && (
        <div className="mx-4 mb-4">
          <a
            href={effectiveLinkedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start gap-2">
              <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-foreground group-hover:underline">
                  Linked content
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {effectiveLinkedUrl}
                </div>
              </div>
            </div>
          </a>
        </div>
      )}

      {/* "View on Reddit" footer — always shown when source URL exists */}
      {sourceUrl && (
        <div className="border-t border-border px-4 py-3">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
          >
            View on Reddit
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
