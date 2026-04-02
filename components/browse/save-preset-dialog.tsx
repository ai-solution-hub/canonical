'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SavePresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
  activeFilterCount: number;
}

export function SavePresetDialog({
  open,
  onOpenChange,
  onSave,
  activeFilterCount,
}: SavePresetDialogProps) {
  const [name, setName] = useState('');

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    toast.success('Preset saved');
    setName('');
    onOpenChange(false);
  }, [name, onSave, onOpenChange]);

  const handleCancel = useCallback(() => {
    setName('');
    onOpenChange(false);
  }, [onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && name.trim()) {
        e.preventDefault();
        handleSave();
      }
    },
    [name, handleSave],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save filter preset</DialogTitle>
          <DialogDescription>
            Name this filter combination for quick access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={50}
            autoFocus
            aria-label="Preset name"
          />
          <p className="text-sm text-muted-foreground">
            {activeFilterCount} active filter
            {activeFilterCount !== 1 ? 's' : ''} will be saved.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
