'use client';

import { cn } from '@/lib/utils';

interface YouTubeEmbedProps {
  sourceUrl: string;
  title: string;
  className?: string;
}

/** Placeholder — YouTube embeds not yet implemented in Knowledge Hub. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function YouTubeEmbed({ sourceUrl, title, className }: YouTubeEmbedProps) {
  return (
    <div className={cn('rounded-lg border border-dashed border-border p-4', className)}>
      <p className="text-sm text-muted-foreground">
        YouTube embed not available.{' '}
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Watch on YouTube
        </a>
      </p>
    </div>
  );
}
