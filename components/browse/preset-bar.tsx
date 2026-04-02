'use client';

import { BookmarkPlus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FilterPreset } from '@/types/filter-preset';
import { cn } from '@/lib/utils';

export interface PresetBarProps {
  presets: FilterPreset[];
  activePresetId: string | null;
  onApplyPreset: (presetId: string) => void;
  onClearFilters: () => void;
  onSavePreset: () => void;
  onManagePresets: () => void;
  canSave: boolean;
}

export function PresetBar({
  presets,
  activePresetId,
  onApplyPreset,
  onClearFilters,
  onSavePreset,
  onManagePresets,
  canSave,
}: PresetBarProps) {
  const hasUserPresets = presets.some((p) => !p.isSystem);

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
      role="toolbar"
      aria-label="Filter presets"
    >
      {presets.map((preset) => {
        const isActive = preset.id === activePresetId;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() =>
              isActive ? onClearFilters() : onApplyPreset(preset.id)
            }
            aria-pressed={isActive}
            aria-label={`${isActive ? 'Clear' : 'Apply'} preset: ${preset.name}`}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground hover:bg-accent',
            )}
          >
            {preset.name}
          </button>
        );
      })}

      {canSave && (
        <Button
          variant="outline"
          size="xs"
          onClick={onSavePreset}
          className="shrink-0 gap-1"
          aria-label="Save current filters as preset"
        >
          <BookmarkPlus className="size-3" />
          Save
        </Button>
      )}

      {hasUserPresets && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onManagePresets}
          className="shrink-0 gap-1 text-muted-foreground"
          aria-label="Manage filter presets"
        >
          <Settings2 className="size-3" />
          Manage
        </Button>
      )}
    </div>
  );
}
