'use client';

import { BookCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkActionsProps {
  selectedCount: number;
  onMarkSelectedRead: () => void;
  onCancel: () => void;
}

export function BulkActions({
  selectedCount,
  onMarkSelectedRead,
  onCancel,
}: BulkActionsProps) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5" role="status" aria-live="polite">
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>
      <Button
        variant="default"
        size="sm"
        onClick={onMarkSelectedRead}
        className="gap-1.5"
      >
        <BookCheck className="size-3.5" />
        Mark as read
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        className="gap-1.5"
      >
        <X className="size-3.5" />
        Cancel
      </Button>
    </div>
  );
}
