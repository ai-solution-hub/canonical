'use client';

import { Clock, FileText, Mail, Play, Subtitles, User } from 'lucide-react';
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
    <div className="mb-4 rounded-lg border bg-muted/30 p-3">
      {displayName && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Mail className="size-3.5 shrink-0 text-muted-foreground" />
          {displayName}
        </div>
      )}
      {emailSubject && (
        <div className="mt-1 text-sm text-muted-foreground">{emailSubject}</div>
      )}
    </div>
  );
}

function PdfHeader({ metadata }: { metadata: Record<string, unknown> | null }) {
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
  // Video
  if (contentType === 'video') {
    return <VideoHeader metadata={metadata} authorName={authorName} />;
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
