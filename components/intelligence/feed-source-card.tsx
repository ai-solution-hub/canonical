'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Pencil,
  Trash2,
  ExternalLink,
  Clock,
  AlertTriangle,
  Rss,
  Globe,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FeedSource } from '@/hooks/intelligence/use-feed-sources';

interface FeedSourceCardProps {
  source: FeedSource;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
  canAdmin: boolean;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never polled';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const SOURCE_TYPE_ICONS: Record<string, typeof Rss> = {
  rss: Rss,
  web: Globe,
  api: Zap,
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  rss: 'RSS',
  web: 'Web',
  api: 'API',
};

function StatusDot({ status }: { status: string | null }) {
  const colour =
    status === 'success'
      ? 'bg-success'
      : status === 'error' || status === 'timeout'
        ? 'bg-destructive'
        : 'bg-muted-foreground';

  return (
    <span
      className={cn('inline-block size-2 rounded-full', colour)}
      aria-label={`Status: ${status ?? 'unknown'}`}
    />
  );
}

export function FeedSourceCard({
  source,
  onEdit,
  onDelete,
  onToggleActive,
  canAdmin,
}: FeedSourceCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const TypeIcon = SOURCE_TYPE_ICONS[source.source_type] ?? Rss;

  return (
    <>
      <div
        className={cn(
          'rounded-lg border bg-card p-4 shadow-sm',
          !source.is_active && 'opacity-60',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusDot status={source.last_status} />
              <h3 className="truncate text-sm font-semibold text-foreground">
                {source.name}
              </h3>
            </div>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
            >
              {source.url.replace(/^https?:\/\//, '').slice(0, 50)}
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              aria-label={`Edit ${source.name}`}
              className="size-7"
            >
              <Pencil className="size-3" />
            </Button>
            {canAdmin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDeleteDialog(true)}
                aria-label={`Delete ${source.name}`}
                className="size-7 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Metadata */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1 text-xs">
            <TypeIcon className="size-3" aria-hidden="true" />
            {SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}
          </Badge>

          <span className="flex items-center gap-1">
            <Clock className="size-3" aria-hidden="true" />
            Every {source.polling_interval_minutes}m
          </span>

          <span>Last polled: {formatRelativeTime(source.last_polled_at)}</span>

          {source.consecutive_failures > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="size-3" aria-hidden="true" />
              {source.consecutive_failures} failure
              {source.consecutive_failures !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Toggle active/inactive */}
        <div className="mt-3 flex items-center justify-between">
          <Badge
            variant={source.is_active ? 'default' : 'secondary'}
            className="text-xs"
          >
            {source.is_active ? 'Active' : 'Archived'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleActive}
            className="text-xs"
          >
            {source.is_active ? 'Archive' : 'Reactivate'}
          </Button>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive feed source?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive <strong>{source.name}</strong>. The source and
              its article history will be preserved but it will stop being
              polled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
