'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { ArticleTab } from '@/hooks/intelligence/use-feed-articles';

interface FlagDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (notes?: string) => void;
  isPending: boolean;
  tab: ArticleTab;
}

export function FlagDialog({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  tab,
}: FlagDialogProps) {
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    onSubmit(notes.trim() || undefined);
    setNotes('');
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setNotes('');
      onClose();
    }
  };

  const label =
    tab === 'passed'
      ? 'Why is this article irrelevant?'
      : 'Why is this article relevant?';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Your feedback helps improve article filtering accuracy. Notes are
            optional but helpful.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="flag-notes">Notes (optional)</Label>
          <Textarea
            id="flag-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            placeholder="Describe why this article was incorrectly classified..."
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            {notes.length}/1000 characters
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? 'Submitting...' : 'Submit flag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
