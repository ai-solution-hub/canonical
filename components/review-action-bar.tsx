'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flag,
  HelpCircle,
  Pencil,
  Send,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReviewActionBarProps {
  onVerify: () => void;
  onFlag: () => void;
  onSkip: () => void;
  onBack: () => void;
  onExit: () => void;
  onEdit?: () => void;
  onPublish?: () => void;
  onShowHelp?: () => void;
  isActioning: boolean;
  canGoBack: boolean;
  isDraft?: boolean;
  className?: string;
}

type ActionId = 'verify' | 'flag' | 'skip' | 'back' | 'edit' | 'publish' | 'exit';

const flashClass = 'ring-2 ring-primary ring-offset-2 motion-safe:animate-pulse';

/**
 * Sticky action bar for the review page.
 * Three grouped button sections: Navigation | Primary Actions | Meta.
 * Verify is visually dominant (larger, filled). Flag uses amber colouring.
 * Brief flash animation on activation (150ms).
 */
export function ReviewActionBar({
  onVerify,
  onFlag,
  onSkip,
  onBack,
  onExit,
  onEdit,
  onPublish,
  onShowHelp,
  isActioning,
  canGoBack,
  isDraft = false,
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
    (action: ActionId) => {
      return () => {
        if (action !== 'exit' && isActioning) return;
        setFlashAction(action);
        switch (action) {
          case 'verify':
            onVerify();
            break;
          case 'flag':
            onFlag();
            break;
          case 'skip':
            onSkip();
            break;
          case 'back':
            onBack();
            break;
          case 'edit':
            onEdit?.();
            break;
          case 'publish':
            onPublish?.();
            break;
          case 'exit':
            onExit();
            break;
        }
      };
    },
    [isActioning, onVerify, onFlag, onSkip, onBack, onEdit, onPublish, onExit],
  );

  return (
    <div
      className={`sticky bottom-0 z-30 flex flex-wrap items-center justify-center gap-2 rounded-t-lg border border-border bg-card/95 p-3 shadow-[var(--shadow-review-bar)] backdrop-blur-sm sm:gap-3 ${className}`}
      role="toolbar"
      aria-label="Review actions"
    >
      {/* Navigation group (left) */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAction('back')}
          disabled={!canGoBack || isActioning}
          className={`min-h-[44px] gap-1.5 transition-colors ${flashAction === 'back' ? flashClass : ''}`}
          aria-label="Go back (keyboard shortcut: left arrow)"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Back</span>
          <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">{'\u2190'}</kbd>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAction('skip')}
          disabled={isActioning}
          className={`min-h-[44px] gap-1.5 transition-colors ${flashAction === 'skip' ? flashClass : ''}`}
          aria-label="Skip (keyboard shortcut: right arrow)"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Skip</span>
          <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">{'\u2192'}</kbd>
        </Button>
      </div>

      {/* Divider */}
      <div className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />

      {/* Primary actions (centre) */}
      <div className="flex items-center gap-2">
        {isDraft && onPublish ? (
          <Button
            size="default"
            onClick={handleAction('publish')}
            disabled={isActioning}
            className={`min-h-[48px] min-w-[120px] gap-2 text-base font-semibold transition-colors bg-amber-600 hover:bg-amber-700 text-white ${flashAction === 'publish' ? flashClass : ''}`}
            aria-label="Publish draft item (keyboard shortcut: Enter)"
          >
            <Send className="size-5" aria-hidden="true" />
            Publish
            <kbd aria-hidden="true" className="ml-1.5 rounded border border-white/20 bg-white/10 px-1 font-mono text-[10px]">Enter</kbd>
          </Button>
        ) : (
          <Button
            size="default"
            onClick={handleAction('verify')}
            disabled={isActioning}
            className={`min-h-[48px] min-w-[120px] gap-2 text-base font-semibold transition-colors ${flashAction === 'verify' ? flashClass : ''}`}
            aria-label="Verify (keyboard shortcut: Enter)"
          >
            <Check className="size-5" aria-hidden="true" />
            Verify
            <kbd aria-hidden="true" className="ml-1.5 rounded border border-border bg-muted px-1 font-mono text-[10px]">Enter</kbd>
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleAction('flag')}
          disabled={isActioning}
          className={`min-h-[44px] gap-1.5 text-muted-foreground border-border transition-colors hover:text-status-warning hover:border-status-warning/50 hover:bg-governance-pending-bg ${flashAction === 'flag' ? flashClass : ''}`}
          aria-label="Flag for review (keyboard shortcut: F)"
        >
          <Flag className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Flag</span>
          <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">F</kbd>
        </Button>
      </div>

      {/* Divider */}
      <div className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />

      {/* Meta group (right) */}
      <div className="flex items-center gap-1">
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAction('edit')}
            disabled={isActioning}
            className={`min-h-[44px] gap-1.5 transition-colors ${flashAction === 'edit' ? flashClass : ''}`}
            aria-label="Edit in new tab (keyboard shortcut: E)"
          >
            <Pencil className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Edit</span>
            <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">E</kbd>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAction('exit')}
          className={`min-h-[44px] gap-1.5 transition-colors ${flashAction === 'exit' ? flashClass : ''}`}
          aria-label="Exit review (keyboard shortcut: Escape)"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Exit</span>
          <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">Esc</kbd>
        </Button>
        {onShowHelp && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowHelp}
            className="min-h-[44px] gap-1.5 transition-colors"
            aria-label="Show keyboard shortcuts"
          >
            <HelpCircle className="size-4" aria-hidden="true" />
            <kbd aria-hidden="true" className="hidden rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">?</kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
