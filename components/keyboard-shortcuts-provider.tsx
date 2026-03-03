'use client';

import { useState } from 'react';
import { KeyboardShortcutsOverlay } from '@/components/keyboard-shortcuts-overlay';

/**
 * Client component that mounts the keyboard shortcuts overlay.
 * Listens for the 'kb:show-shortcuts' custom event dispatched
 * by the useKeyboardShortcuts hook and the command palette.
 */
export function KeyboardShortcutsProvider() {
  const [open, setOpen] = useState(false);

  return <KeyboardShortcutsOverlay open={open} onOpenChange={setOpen} />;
}
