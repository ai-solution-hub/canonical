'use client';

import { useEffect, useCallback, useState } from 'react';

interface UseReviewShortcutsOptions {
  onVerify: () => void;
  onFlag: () => void;
  onSkip: () => void;
  onBack: () => void;
  onExit: () => void;
  onEdit: () => void;
  onTogglePanel?: () => void;
  enabled: boolean;
}

/**
 * Review-specific keyboard shortcut handler.
 *
 * Shortcuts:
 *  Enter       Verify current item
 *  f           Flag current item for review
 *  ArrowRight  Skip to next item
 *  ArrowLeft   Go back to previous item
 *  Escape      Exit review (navigate to /browse)
 *  e           Open current item in new tab for editing
 *  ?           Toggle keyboard shortcuts help overlay
 *
 * All shortcuts are suppressed when the target is an INPUT, TEXTAREA,
 * SELECT, or contentEditable element -- except Escape, which blurs the
 * active element instead.
 *
 * This hook is separate from the global use-keyboard-shortcuts hook because
 * the review page repurposes Enter and uses arrow keys differently.
 */
export function useReviewShortcuts(options: UseReviewShortcutsOptions): {
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
} {
  const {
    onVerify,
    onFlag,
    onSkip,
    onBack,
    onExit,
    onEdit,
    onTogglePanel,
    enabled,
  } = options;
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Escape always works -- blurs active element if in an input,
      // otherwise closes help overlay or delegates to onExit callback
      if (e.key === 'Escape') {
        if (isInput) {
          target.blur();
          return;
        }
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        e.preventDefault();
        onExit();
        return;
      }

      // All other shortcuts are suppressed in form elements
      if (isInput) return;

      // ? (Shift+/) -- Toggle keyboard shortcuts overlay
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // Enter -- Verify
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        onVerify();
        return;
      }

      // f -- Flag
      if (
        e.key === 'f' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        onFlag();
        return;
      }

      // ArrowRight -- Skip
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onSkip();
        return;
      }

      // ArrowLeft -- Back
      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onBack();
        return;
      }

      // e -- Edit (open in new tab)
      if (
        e.key === 'e' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        onEdit();
        return;
      }

      // l -- Toggle review queue panel
      if (
        e.key === 'l' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        onTogglePanel?.();
        return;
      }
    },
    [
      enabled,
      onVerify,
      onFlag,
      onSkip,
      onBack,
      onExit,
      onEdit,
      onTogglePanel,
      showHelp,
    ],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showHelp, setShowHelp };
}
