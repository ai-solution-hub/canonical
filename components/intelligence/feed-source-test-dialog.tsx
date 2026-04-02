'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { TestPollResult } from '@/hooks/intelligence/use-feed-sources';

interface FeedSourceTestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  result: TestPollResult | null;
  isPending: boolean;
}

export function FeedSourceTestDialog({
  isOpen,
  onClose,
  result,
  isPending,
}: FeedSourceTestDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Feed Test Results</DialogTitle>
          <DialogDescription>
            Results from test polling the feed source.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {isPending ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2
                className="size-6 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                Polling feed source...
              </p>
            </div>
          ) : result?.success ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle
                  className="size-5 text-success"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-foreground">
                  Found {result.itemCount} article
                  {result.itemCount !== 1 ? 's' : ''}
                </p>
              </div>
              {result.sampleTitles.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Sample titles:
                  </p>
                  <ul className="space-y-1">
                    {result.sampleTitles.map((title, i) => (
                      <li key={i} className="text-sm text-foreground">
                        {title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <XCircle
                  className="size-5 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-foreground">
                  Feed test failed
                </p>
              </div>
              {result.error && (
                <p className="text-sm text-muted-foreground">{result.error}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Check that the URL is correct and the feed is publicly
                accessible.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
