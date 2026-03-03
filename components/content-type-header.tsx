'use client';

import {
  ArrowUp,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  Play,
  Subtitles,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDuration } from '@/lib/format';

interface ContentTypeHeaderProps {
  contentType: string | null;
  platform: string | null;
  metadata: Record<string, unknown> | null;
  sourceUrl: string | null;
  authorName: string | null;
}

function VideoHeader({
  metadata,
  authorName,
}: {
  metadata: Record<string, unknown> | null;
  authorName: string | null;
}) {
  const channel = (metadata?.host as string) || authorName;
  const guest = metadata?.guest as string | undefined;
  const durationSeconds = metadata?.duration_seconds as number | undefined;
  const captionsType = metadata?.captions_type as string | undefined;

  return (
    <div className="mb-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
      {channel && (
        <span className="flex items-center gap-1">
          <Play className="size-3.5" />
          {channel}
        </span>
      )}
      {guest && (
        <span className="flex items-center gap-1">
          <User className="size-3.5" />
          {guest}
        </span>
      )}
      {durationSeconds != null && (
        <span className="flex items-center gap-1">
          <Clock className="size-3.5" />
          {formatDuration(durationSeconds)}
        </span>
      )}
      {captionsType && (
        <span className="flex items-center gap-1">
          <Subtitles className="size-3.5" />
          <Badge variant="secondary">{captionsType}</Badge>
        </span>
      )}
    </div>
  );
}

function RedditPostHeader({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  const subreddit = metadata?.subreddit as string | undefined;
  const score = metadata?.score as number | undefined;
  const postType = metadata?.post_type as string | undefined;

  return (
    <div className="mb-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
      {subreddit && (
        <a
          href={`https://reddit.com/r/${subreddit}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <MessageSquare className="size-3.5" />
          r/{subreddit}
        </a>
      )}
      {score != null && (
        <span className="flex items-center gap-1">
          <ArrowUp className="size-3.5" />
          {score.toLocaleString('en-GB')}
        </span>
      )}
      {postType && <Badge variant="secondary">{postType}</Badge>}
    </div>
  );
}

function LinkedInPostHeader({
  metadata,
  authorName,
}: {
  metadata: Record<string, unknown> | null;
  authorName: string | null;
}) {
  const authorHeadline = metadata?.author_headline as string | undefined;
  const isRepost = metadata?.is_repost as boolean | undefined;
  const repostAuthor = metadata?.repost_author as string | undefined;
  const articleUrl = metadata?.article_url as string | undefined;
  const articleTitle = metadata?.article_title as string | undefined;

  return (
    <div className="mb-4 flex flex-col gap-1 text-sm">
      {authorName && (
        <span className="font-medium text-foreground">{authorName}</span>
      )}
      {authorHeadline && (
        <span className="text-muted-foreground">{authorHeadline}</span>
      )}
      {isRepost && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Badge variant="secondary">Repost</Badge>
          {repostAuthor && <>by {repostAuthor}</>}
        </span>
      )}
      {articleUrl && (
        <a
          href={articleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          <span className="truncate">
            Shared: {articleTitle || articleUrl}
          </span>
        </a>
      )}
    </div>
  );
}

function NewsletterHeader({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  const newsletterName = metadata?.newsletter_name as string | undefined;
  const emailFrom = metadata?.email_from as string | undefined;
  const emailSubject = metadata?.email_subject as string | undefined;
  const displayName = newsletterName || emailFrom;

  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
      {displayName && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Mail className="size-3.5 shrink-0 text-muted-foreground" />
          {displayName}
        </div>
      )}
      {emailSubject && (
        <div className="mt-1 text-sm text-muted-foreground">
          {emailSubject}
        </div>
      )}
    </div>
  );
}

function PdfHeader({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  const pageCount = metadata?.page_count as number | undefined;

  return (
    <div className="mb-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
      <span className="flex items-center gap-1">
        <FileText className="size-3.5" />
        PDF Document
      </span>
      {pageCount != null && <span>{pageCount} pages</span>}
    </div>
  );
}

export function ContentTypeHeader({
  contentType,
  platform,
  metadata,
  authorName,
}: ContentTypeHeaderProps) {
  // Video or YouTube transcript
  if (
    contentType === 'video' ||
    (contentType === 'transcript' && platform === 'youtube')
  ) {
    return <VideoHeader metadata={metadata} authorName={authorName} />;
  }

  // Reddit post
  if (contentType === 'post' && platform === 'reddit') {
    return <RedditPostHeader metadata={metadata} />;
  }

  // LinkedIn post
  if (contentType === 'post' && platform === 'linkedin') {
    return (
      <LinkedInPostHeader metadata={metadata} authorName={authorName} />
    );
  }

  // Newsletter / email
  if (platform === 'email' || contentType === 'newsletter') {
    return <NewsletterHeader metadata={metadata} />;
  }

  // PDF
  if (contentType === 'pdf') {
    return <PdfHeader metadata={metadata} />;
  }

  return null;
}
