'use client';

import { useState, useCallback, useEffect } from 'react';

interface UseContentLibraryDrawerReturn {
  isOpen: boolean;
  questionText: string | undefined;
  open: (questionText?: string) => void;
  close: () => void;
  toggle: (questionText?: string) => void;
}

/**
 * Manages Content Library Drawer open/close state and Cmd+L keyboard shortcut.
 * Used in the bid session page to give coordinators quick access to KB content.
 */
export function useContentLibraryDrawer(): UseContentLibraryDrawerReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [questionText, setQuestionText] = useState<string | undefined>(undefined);

  const open = useCallback((text?: string) => {
    setQuestionText(text);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback((text?: string) => {
    setIsOpen((prev) => {
      if (!prev) setQuestionText(text);
      return !prev;
    });
  }, []);

  // Register Cmd+L / Ctrl+L keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        toggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return { isOpen, questionText, open, close, toggle };
}
