'use client';

import { Mail } from 'lucide-react';
import { ReaderView } from '@/components/reader/reader-view';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import { cn } from '@/lib/utils';
import type { ReaderFontSize, ReaderMaxWidth } from '@/hooks/use-reader-preferences';

interface NewsletterReaderCardProps {
  content: string | null;
  readerHtml: string | null | undefined;
  metadata: Record<string, unknown> | null;
  fontSize?: ReaderFontSize;
  maxWidth?: ReaderMaxWidth;
  className?: string;
}

export function NewsletterReaderCard({
  content,
  readerHtml,
  metadata,
  fontSize,
  maxWidth,
  className,
}: NewsletterReaderCardProps) {
  const newsletterName = metadata?.newsletter_name as string | undefined;
  const emailFrom = metadata?.email_from as string | undefined;
  const emailSubject = metadata?.email_subject as string | undefined;
  const displayName = newsletterName || emailFrom;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden',
        className,
      )}
    >
      {/* Newsletter header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <Mail className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            {displayName && (
              <div className="font-semibold text-foreground">{displayName}</div>
            )}
            {newsletterName && emailFrom && newsletterName !== emailFrom && (
              <div className="text-xs text-muted-foreground">{emailFrom}</div>
            )}
          </div>
        </div>
        {emailSubject && (
          <div className="mt-2 text-sm font-medium text-foreground">
            {emailSubject}
          </div>
        )}
      </div>

      {/* Newsletter body */}
      <div className="px-4 py-4">
        {readerHtml ? (
          <ReaderView
            html={readerHtml}
            fontSize={fontSize ?? 'medium'}
            maxWidth={maxWidth ?? 'wide'}
          />
        ) : content ? (
          <ContentRenderer content={content} className="max-w-none" />
        ) : (
          <p className="text-sm text-muted-foreground">
            No newsletter content available.
          </p>
        )}
      </div>
    </div>
  );
}
