'use client';

import { useState, useCallback } from 'react';

interface UseContentLibraryDrawerReturn {
  isOpen: boolean;
  questionText: string | undefined;
  open: (questionText?: string) => void;
  close: () => void;
  toggle: (questionText?: string) => void;
}

/**
 * Manages Content Library Drawer open/close state.
 * The Cmd+L keyboard shortcut is registered in the session page so it can
 * pass the current question text to toggle().
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

  return { isOpen, questionText, open, close, toggle };
}
