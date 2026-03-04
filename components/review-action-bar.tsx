'use client';

import { useState, useEffect, useCallback } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReviewActionBarProps {
  onVerify: () => void;
  onFlag: () => void;
  onSkip: () => void;
  onBack: () => void;
  onExit: () => void;
  onEdit?: () => void;
  onShowHelp?: () => void;
  isActioning: boolean;
  canGoBack: boolean;
  className?: string;
}

type ActionId = 'verify' | 'flag' | 'skip' | 'back' | 'edit' | 'exit';

/**
 * Fixed action bar for the review page.
 * Shows keyboard shortcuts with clickable buttons.
 * Brief flash animation on activation (150ms).
 */
export function ReviewActionBar({
  onVerify,
  onFlag,
  onSkip,
  onBack,
  onExit,
  onEdit,
  onShowHelp,
  isActioning,
  canGoBack,
  className = '',
}: ReviewActionBarProps) {
  const [flashAction, setFlashAction] = useState<ActionId | null>(null);

  // Clear flash after 150ms
  useEffect(() => {
    if (!flashAction) return;
    const timer = setTimeout(() => setFlashAction(null), 150);
    return () => clearTimeout(timer);
  }, [flashAction]);

  const handleAction = useCallback(
    (action: ActionId, handler: () => void) => {
      if (isActioning) return;
      setFlashAction(action);
      handler();
    },
    [isActioning],
  );

  const actions: Array<{
    id: ActionId;
    label: string;
    shortcut: string;
    handler: () => void;
    disabled: boolean;
    variant: 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
  }> = [
    {
      id: 'verify',
      label: 'Verify',
      shortcut: 'Enter',
      handler: onVerify,
      disabled: isActioning,
      variant: 'default',
    },
    {
      id: 'flag',
      label: 'Flag',
      shortcut: 'F',
      handler: onFlag,
      disabled: isActioning,
      variant: 'outline',
    },
    {
      id: 'skip',
      label: 'Skip',
      shortcut: '\u2192',
      handler: onSkip,
      disabled: isActioning,
      variant: 'ghost',
    },
    {
      id: 'back',
      label: 'Back',
      shortcut: '\u2190',
      handler: onBack,
      disabled: isActioning || !canGoBack,
      variant: 'ghost',
    },
    ...(onEdit
      ? [
          {
            id: 'edit' as ActionId,
            label: 'Edit',
            shortcut: 'E',
            handler: onEdit,
            disabled: isActioning,
            variant: 'ghost' as const,
          },
        ]
      : []),
    {
      id: 'exit',
      label: 'Exit',
      shortcut: 'Esc',
      handler: onExit,
      disabled: false,
      variant: 'ghost',
    },
  ];

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-card p-3 sm:gap-3 ${className}`}
      role="toolbar"
      aria-label="Review actions"
    >
      {actions.map(({ id, label, shortcut, handler, disabled, variant }) => (
        <Button
          key={id}
          variant={variant}
          size="sm"
          disabled={disabled}
          onClick={() => handleAction(id, handler)}
          className={`min-h-[44px] min-w-[44px] gap-1.5 transition-colors ${
            flashAction === id
              ? 'ring-2 ring-primary ring-offset-2 motion-safe:animate-pulse'
              : ''
          }`}
          aria-label={`${label} (keyboard shortcut: ${shortcut})`}
        >
          <kbd className="pointer-events-none inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
          <span>{label}</span>
        </Button>
      ))}
      {onShowHelp && (
        <button
          type="button"
          onClick={onShowHelp}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Show keyboard shortcuts"
        >
          <Keyboard className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Shortcuts</span>
        </button>
      )}
    </div>
  );
}
