'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  label: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: 'Navigation',
    shortcuts: [
      { keys: ['j'], description: 'Move down in list' },
      { keys: ['k'], description: 'Move up in list' },
      { keys: ['g', 'g'], description: 'Go to first item' },
      { keys: ['G'], description: 'Go to last item' },
      { keys: ['Enter'], description: 'Open selected item' },
      { keys: ['Esc'], description: 'Close modal / blur input' },
    ],
  },
  {
    label: 'Search',
    shortcuts: [
      { keys: ['/'], description: 'Focus search input' },
      { keys: ['\u2318', 'K'], description: 'Toggle command palette' },
    ],
  },
  {
    label: 'Other',
    shortcuts: [{ keys: ['?'], description: 'Show keyboard shortcuts' }],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsOverlay({
  open,
  onOpenChange,
}: KeyboardShortcutsOverlayProps) {
  // Also listen for the custom event dispatched by the hook / command palette
  const [isOpen, setIsOpen] = useState(open);

  useEffect(() => {
    setIsOpen(open);
  }, [open]);

  useEffect(() => {
    function handleShowShortcuts() {
      setIsOpen(true);
      onOpenChange(true);
    }
    window.addEventListener('kb:show-shortcuts', handleShowShortcuts);
    return () =>
      window.removeEventListener('kb:show-shortcuts', handleShowShortcuts);
  }, [onOpenChange]);

  function handleOpenChange(next: boolean) {
    setIsOpen(next);
    onOpenChange(next);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts available throughout IMS. Navigation shortcuts (j/k) work
            in list view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h3>
              <ul className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.description}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-foreground">
                      {shortcut.description}
                    </span>
                    <span className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 &&
                            shortcut.keys.length > 1 &&
                            key !== shortcut.keys[i - 1] && (
                              <span className="mx-0.5 text-xs text-muted-foreground">
                                +
                              </span>
                            )}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
