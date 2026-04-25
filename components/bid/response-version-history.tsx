'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  History,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import { htmlToMarkdown } from '@/lib/content/html-to-markdown';
import type { BidResponseVersion } from '@/types/bid';

interface ResponseVersionHistoryProps {
  bidId: string;
  responseId: string | null;
  currentVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: () => void;
}

const REVIEW_STATUS_LABELS: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  draft: { label: 'Draft', variant: 'secondary' },
  ai_drafted: { label: 'Drafted', variant: 'outline' },
  edited: { label: 'Edited', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  needs_review: { label: 'Needs Review', variant: 'outline' },
};

function formatUKDateTime(isoString: string): string {
  const date = new Date(isoString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function ResponseVersionHistory({
  bidId,
  responseId,
  currentVersion,
  open,
  onOpenChange,
  onRestored,
}: ResponseVersionHistoryProps) {
  const [versions, setVersions] = useState<BidResponseVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!responseId || !bidId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/responses/${responseId}/history`,
      );
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch (err) {
      console.error('Failed to load response version history:', err);
      toast.error('Failed to load version history');
    } finally {
      setLoading(false);
    }
  }, [bidId, responseId]);

  useEffect(() => {
    if (open && responseId) {
      void fetchHistory();
    }
  }, [open, responseId, fetchHistory]);

  const handleRestore = async () => {
    if (restoreVersion === null || !responseId) return;
    setRestoring(true);
    try {
      const res = await fetch(
        `/api/bids/${bidId}/responses/${responseId}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: restoreVersion }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to restore');
      }
      toast.success(`Restored version ${restoreVersion}`);
      setRestoreVersion(null);
      onOpenChange(false);
      onRestored?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to restore version',
      );
    } finally {
      setRestoring(false);
    }
  };

  const toggleExpand = (version: number) => {
    setExpandedVersion((prev) => (prev === version ? null : version));
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <History className="size-4" aria-hidden="true" />
              Version History
            </SheetTitle>
            <SheetDescription>
              Current version: {currentVersion}. Previous versions are shown
              below.
            </SheetDescription>
          </SheetHeader>

          <div
            className="flex-1 overflow-y-auto px-4 pb-4"
            role="list"
            aria-label="Version history"
          >
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  className="size-5 animate-spin text-muted-foreground"
                  aria-label="Loading history"
                />
              </div>
            ) : versions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No previous versions yet. History is recorded when the response
                content changes.
              </p>
            ) : (
              <ul className="space-y-3">
                {versions.map((v) => {
                  const isExpanded = expandedVersion === v.version;
                  const statusConfig = REVIEW_STATUS_LABELS[
                    v.review_status
                  ] ?? {
                    label: v.review_status,
                    variant: 'secondary' as const,
                  };

                  return (
                    <li
                      key={v.id}
                      role="listitem"
                      className="rounded-lg border bg-card"
                    >
                      <div className="flex items-center justify-between gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm font-medium"
                              aria-label={`Version ${v.version}`}
                            >
                              v{v.version}
                            </span>
                            <Badge
                              variant={statusConfig.variant}
                              className="text-[10px]"
                            >
                              {statusConfig.label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatUKDateTime(v.created_at)}
                            {v.change_reason && (
                              <span className="ml-1">— {v.change_reason}</span>
                            )}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpand(v.version)}
                            aria-expanded={isExpanded}
                            aria-controls={`version-content-${v.version}`}
                            className="h-7 px-2 text-xs"
                          >
                            {isExpanded ? (
                              <ChevronUp
                                className="mr-1 size-3"
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronDown
                                className="mr-1 size-3"
                                aria-hidden="true"
                              />
                            )}
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRestoreVersion(v.version)}
                            className="h-7 px-2 text-xs"
                            aria-label={`Restore version ${v.version}`}
                          >
                            <RotateCcw
                              className="mr-1 size-3"
                              aria-hidden="true"
                            />
                            Restore
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div
                          id={`version-content-${v.version}`}
                          className="border-t px-3 py-3"
                        >
                          {v.response_text ? (
                            <div className="max-h-64 overflow-y-auto rounded bg-muted/50 p-3 text-sm">
                              <ContentRenderer
                                content={htmlToMarkdown(v.response_text)}
                                className="max-w-none"
                              />
                            </div>
                          ) : (
                            <p className="text-sm italic text-muted-foreground">
                              No response text in this version.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Restore confirmation dialog */}
      <AlertDialog
        open={restoreVersion !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreVersion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore version {restoreVersion}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current response content with version{' '}
              {restoreVersion}. The current version will be saved to history
              before being replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={restoring}>
              {restoring ? (
                <>
                  <Loader2
                    className="mr-2 size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Restoring…
                </>
              ) : (
                'Restore'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
