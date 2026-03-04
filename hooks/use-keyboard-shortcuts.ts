'use client';

import { useEffect, useCallback, useRef, useState } from 'react';

interface UseKeyboardShortcutsOptions {
  onFocusSearch?: () => void;
  onNavigate?: (direction: 'up' | 'down' | 'first' | 'last') => void;
  onSelect?: () => void;
  onEscape?: () => void;
  onGoToReview?: () => void;
  enabled?: boolean;
}

/**
 * Keyboard shortcut handler.
 *
 * Shortcuts:
 *  /         Focus search
 *  ?         Toggle shortcuts overlay
 *  j         Navigate down in list
 *  k         Navigate up in list
 *  Shift+R   Go to /review (Speed Review)
 *  Enter     Open selected item
 *  Escape    Close modal/overlay, blur input
 *  g g       Go to first item (two presses within 500ms)
 *  G         Go to last item (Shift+G)
 *
 * All shortcuts are suppressed when the target is an INPUT, TEXTAREA,
 * SELECT, or contentEditable element -- except Escape, which blurs the
 * active element instead.
 */
export function useKeyboardShortcuts(
  options: UseKeyboardShortcutsOptions = {},
) {
  const {
    onFocusSearch,
    onNavigate,
    onSelect,
    onEscape,
    onGoToReview,
    enabled = true,
  } = options;

  const [showShortcuts, setShowShortcuts] = useState(false);

  // Track last 'g' press timestamp for the g-g combo
  const lastGPressRef = useRef<number>(0);

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
      // otherwise delegates to onEscape callback
      if (e.key === 'Escape') {
        if (isInput) {
          (target as HTMLElement).blur();
          return;
        }
        onEscape?.();
        return;
      }

      // All other shortcuts are suppressed in form elements
      if (isInput) return;

      // / -- Focus search (prevent the character from being typed)
      if (e.key === '/' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onFocusSearch?.();
        return;
      }

      // ? (Shift+/) -- Toggle keyboard shortcuts overlay
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        window.dispatchEvent(new CustomEvent('kb:show-shortcuts'));
        return;
      }

      // j -- Navigate down
      if (e.key === 'j' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onNavigate?.('down');
        return;
      }

      // k -- Navigate up
      if (e.key === 'k' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onNavigate?.('up');
        return;
      }

      // R (Shift+R) -- Go to Speed Review
      if (
        e.key === 'R' &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        onGoToReview?.();
        return;
      }

      // G (Shift+G) -- Go to last item
      if (e.key === 'G' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onNavigate?.('last');
        return;
      }

      // g -- Go to first item (double tap within 500ms)
      if (e.key === 'g' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const now = Date.now();
        if (now - lastGPressRef.current < 500) {
          e.preventDefault();
          onNavigate?.('first');
          lastGPressRef.current = 0;
        } else {
          lastGPressRef.current = now;
        }
        return;
      }

      // Enter -- Open/select the current item
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onSelect?.();
        return;
      }
    },
    [enabled, onFocusSearch, onNavigate, onSelect, onEscape, onGoToReview],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showShortcuts, setShowShortcuts };
}
