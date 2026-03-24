'use client';

import { useState, useCallback, useRef } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
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
import type { FilterPreset } from '@/types/filter-preset';

interface ManagePresetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: FilterPreset[];
  onRename: (presetId: string, newName: string) => void;
  onDelete: (presetId: string) => void;
  onRestore?: (preset: FilterPreset) => void;
}

export function ManagePresetsDialog({
  open,
  onOpenChange,
  presets,
  onRename,
  onDelete,
  onRestore,
}: ManagePresetsDialogProps) {
  const userPresets = presets.filter((p) => !p.isSystem);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback((preset: FilterPreset) => {
    setEditingId(preset.id);
    setEditValue(preset.name);
    // Focus the input on next render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const confirmRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, onRename]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing();
      }
    },
    [confirmRename, cancelEditing],
  );

  const handleDelete = useCallback(
    (preset: FilterPreset) => {
      const deletedPreset = { ...preset };
      onDelete(preset.id);
      toast('Preset deleted', {
        action: {
          label: 'Undo',
          onClick: () => onRestore?.(deletedPreset),
        },
      });
    },
    [onDelete, onRestore],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage filter presets</DialogTitle>
          <DialogDescription>Rename or delete your saved filter presets.</DialogDescription>
        </DialogHeader>

        {userPresets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No custom presets yet. Save your current filters from the browse page.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="User presets">
            {userPresets.map((preset) => (
              <li
                key={preset.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                {editingId === preset.id ? (
                  <Input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={confirmRename}
                    maxLength={50}
                    className="h-7 flex-1 text-sm"
                    aria-label={`Rename preset: ${preset.name}`}
                  />
                ) : (
                  <span className="flex-1 truncate text-sm text-foreground">
                    {preset.name}
                  </span>
                )}

                {editingId !== preset.id && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => startEditing(preset)}
                      aria-label={`Rename preset: ${preset.name}`}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDelete(preset)}
                      aria-label={`Delete preset: ${preset.name}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
