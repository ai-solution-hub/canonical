'use client';

import { useCallback, useRef } from 'react';
import {
  Folder,
  Briefcase,
  Lightbulb,
  Rocket,
  Target,
  FlaskConical,
  BookOpen,
  Code,
  Globe,
  Users,
  Star,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const WORKSPACE_ICONS = [
  'folder',
  'briefcase',
  'lightbulb',
  'rocket',
  'target',
  'flask-conical',
  'book-open',
  'code',
  'globe',
  'users',
  'star',
  'zap',
] as const;

export type WorkspaceIconName = (typeof WORKSPACE_ICONS)[number];

export const ICON_MAP: Record<WorkspaceIconName, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  lightbulb: Lightbulb,
  rocket: Rocket,
  target: Target,
  'flask-conical': FlaskConical,
  'book-open': BookOpen,
  code: Code,
  globe: Globe,
  users: Users,
  star: Star,
  zap: Zap,
};

/** Resolve an icon name string to a lucide-react component */
export function getWorkspaceIcon(name: string): LucideIcon {
  return ICON_MAP[name as WorkspaceIconName] ?? Folder;
}

interface WorkspaceIconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

export function WorkspaceIconPicker({
  value,
  onChange,
}: WorkspaceIconPickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();

      const currentIdx = WORKSPACE_ICONS.indexOf(value as WorkspaceIconName);
      let nextIdx: number;
      if (e.key === 'ArrowRight') {
        nextIdx = currentIdx < WORKSPACE_ICONS.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : WORKSPACE_ICONS.length - 1;
      }

      onChange(WORKSPACE_ICONS[nextIdx]);

      // Focus the newly selected button
      requestAnimationFrame(() => {
        const el = groupRef.current?.querySelector<HTMLElement>(
          `[data-icon-idx="${nextIdx}"]`,
        );
        el?.focus();
      });
    },
    [value, onChange],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Icon"
      className="flex flex-wrap gap-2"
      onKeyDown={handleKeyDown}
    >
      {WORKSPACE_ICONS.map((iconName, idx) => {
        const Icon = ICON_MAP[iconName];
        const selected = value === iconName;
        return (
          <button
            key={iconName}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconName}
            tabIndex={selected ? 0 : -1}
            data-icon-idx={idx}
            title={iconName}
            onClick={() => onChange(iconName)}
            className={cn(
              'flex size-9 items-center justify-center rounded-md border transition-colors hover:bg-accent',
              selected
                ? 'border-ring bg-accent ring-2 ring-ring ring-offset-1 ring-offset-background'
                : 'border-border',
            )}
          >
            <Icon className="size-4 text-foreground" />
          </button>
        );
      })}
    </div>
  );
}
