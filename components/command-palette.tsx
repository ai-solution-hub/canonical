'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { Command } from 'cmdk';
import {
  Home,
  LayoutGrid,
  Search,
  Sun,
  Moon,
  Keyboard,
  BookOpen,
  FolderOpen,
  ShieldCheck,
  Settings,
} from 'lucide-react';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Cmd+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus trap: keep focus within the dialog when open
  useEffect(() => {
    if (!open) return;

    function handleFocusTrap(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"]), a[href], [role="option"]',
      );
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [open]);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    setSearch('');
    command();
  }, []);

  // If search looks like a query (>3 words or user presses Enter with text)
  const handleSearchSubmit = useCallback(() => {
    if (search.trim()) {
      runCommand(() =>
        router.push(`/search?q=${encodeURIComponent(search.trim())}`),
      );
    }
  }, [search, router, runCommand]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          ref={dialogRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
          >
            <Command
              className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  search.trim().split(/\s+/).length > 3
                ) {
                  handleSearchSubmit();
                }
                if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            >
              <div className="flex items-center border-b border-border px-3">
                <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search Knowledge Hub..."
                  className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No results found. Press Enter to search.
                </Command.Empty>

                {/* Navigation */}
                <Command.Group
                  heading="Navigation"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  <Command.Item
                    value="Home dashboard"
                    onSelect={() => runCommand(() => router.push('/'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <Home className="size-4 text-muted-foreground" />
                    Home
                  </Command.Item>
                  <Command.Item
                    value="Browse all content"
                    onSelect={() => runCommand(() => router.push('/browse'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <LayoutGrid className="size-4 text-muted-foreground" />
                    Browse
                  </Command.Item>
                  <Command.Item
                    value="Search knowledge base"
                    onSelect={() => runCommand(() => router.push('/search'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <Search className="size-4 text-muted-foreground" />
                    Search
                  </Command.Item>
                  <Command.Item
                    value="Review content verification"
                    onSelect={() => runCommand(() => router.push('/review'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    Review
                  </Command.Item>
                  <Command.Item
                    value="Projects manage collections"
                    onSelect={() => runCommand(() => router.push('/projects'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <FolderOpen className="size-4 text-muted-foreground" />
                    Projects
                  </Command.Item>
                  <Command.Item
                    value="Content digest summary"
                    onSelect={() => runCommand(() => router.push('/digest'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <BookOpen className="size-4 text-muted-foreground" />
                    Content Digest
                  </Command.Item>
                  <Command.Item
                    value="Settings preferences"
                    onSelect={() => runCommand(() => router.push('/settings'))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <Settings className="size-4 text-muted-foreground" />
                    Settings
                  </Command.Item>
                </Command.Group>

                {/* Actions */}
                <Command.Group
                  heading="Actions"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  <Command.Item
                    value="Toggle theme"
                    onSelect={() =>
                      runCommand(() =>
                        setTheme(theme === 'dark' ? 'light' : 'dark'),
                      )
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    {theme === 'dark' ? (
                      <Sun className="size-4 text-muted-foreground" />
                    ) : (
                      <Moon className="size-4 text-muted-foreground" />
                    )}
                    Toggle theme
                  </Command.Item>
                  <Command.Item
                    value="Keyboard shortcuts"
                    onSelect={() =>
                      runCommand(() => {
                        window.dispatchEvent(
                          new CustomEvent('kb:show-shortcuts'),
                        );
                      })
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent"
                  >
                    <Keyboard className="size-4 text-muted-foreground" />
                    Keyboard shortcuts
                    <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      ?
                    </kbd>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
