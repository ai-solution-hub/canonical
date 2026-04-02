'use client';

import { useState, useCallback } from 'react';
import { Copy, Check, Rss, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface RssFeedPanelProps {
  workspaceId: string;
  workspaceName: string;
}

interface FeedRowProps {
  label: string;
  description: string;
  url: string;
}

function FeedRow({ label, description, url }: FeedRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }, [url]);

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-[10px]"
        >
          Public
        </Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          {url}
        </code>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0"
          onClick={handleCopy}
          title="Copy feed URL"
        >
          {copied ? (
            <Check className="size-3.5 text-success" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          <span className="sr-only">
            {copied ? 'Copied' : 'Copy feed URL'}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0"
          asChild
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open feed in new tab"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Open feed in new tab</span>
          </a>
        </Button>
      </div>
    </div>
  );
}

export function RssFeedPanel({ workspaceId, workspaceName }: RssFeedPanelProps) {
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://knowledge-hub-seven-kappa.vercel.app';

  const passedUrl = `${baseUrl}/api/feeds/${workspaceId}/rss`;
  const filteredUrl = `${baseUrl}/api/feeds/${workspaceId}/rss/filtered`;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Rss className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">
          RSS Feeds
        </h3>
      </div>

      <div className="space-y-2">
        <FeedRow
          label="Passed Articles"
          description={`AI-filtered intelligence for ${workspaceName}`}
          url={passedUrl}
        />
        <FeedRow
          label="Filtered Articles (Near Misses)"
          description="Articles close to the threshold — review for false negatives"
          url={filteredUrl}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        These RSS feeds can be embedded in your intranet or added to any feed
        reader. They update automatically when new articles are processed. No
        authentication is required.
      </p>
    </div>
  );
}
