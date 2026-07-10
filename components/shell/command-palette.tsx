'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BRANDING } from '@/lib/client-config';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { Command } from 'cmdk';
import { Home, Search, Sun, Moon, Keyboard, Settings } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import { NAV_ZONES, visibleZoneEntries } from '@/components/shell/nav-config';

const GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';
const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { canEdit, canAdmin } = useUserRole();
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
            <Command className="overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
              <div className="flex items-center border-b border-border px-3">
                <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder={`Search ${BRANDING.productShortName}...`}
                  className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No results found.
                </Command.Empty>

                {/* Home — utility, not a zone member (BI-12) */}
                <Command.Item
                  value="Home dashboard"
                  onSelect={() => runCommand(() => router.push('/'))}
                  className={ITEM_CLASS}
                >
                  <Home className="size-4 text-muted-foreground" />
                  Home
                </Command.Item>

                {/* Applications / Knowledge / Governance — generated from
                    NAV_ZONES so the palette stays in lockstep with the
                    desktop bar + mobile drawer (BI-18/BI-19). */}
                {NAV_ZONES.map((zone) => (
                  <Command.Group
                    key={zone.id}
                    heading={zone.header}
                    className={GROUP_HEADING_CLASS}
                  >
                    {visibleZoneEntries(zone, { canEdit, canAdmin }).map(
                      (entry) => (
                        <Command.Item
                          key={entry.href}
                          value={entry.keywords ?? entry.label}
                          onSelect={() =>
                            runCommand(() => router.push(entry.href))
                          }
                          className={ITEM_CLASS}
                        >
                          <entry.icon className="size-4 text-muted-foreground" />
                          {entry.label}
                        </Command.Item>
                      ),
                    )}
                  </Command.Group>
                ))}

                {/* Settings — utility, not a zone member (BI-14) */}
                <Command.Item
                  value="Settings preferences profile"
                  onSelect={() =>
                    runCommand(() => router.push('/settings?section=profile'))
                  }
                  className={ITEM_CLASS}
                >
                  <Settings className="size-4 text-muted-foreground" />
                  Settings
                </Command.Item>
                {canAdmin && (
                  <>
                    <Command.Item
                      value="Settings taxonomy domains subtopics"
                      onSelect={() =>
                        runCommand(() =>
                          router.push('/settings?section=taxonomy'),
                        )
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Categories
                    </Command.Item>
                    <Command.Item
                      value="Settings team users members"
                      onSelect={() =>
                        runCommand(() => router.push('/settings?section=team'))
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Team
                    </Command.Item>
                    <Command.Item
                      value="Settings governance review posture"
                      onSelect={() =>
                        runCommand(() =>
                          router.push('/settings?section=governance'),
                        )
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Quality Review
                    </Command.Item>
                    <Command.Item
                      value="Settings tags keywords"
                      onSelect={() =>
                        runCommand(() => router.push('/settings?section=tags'))
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Tags
                    </Command.Item>
                    <Command.Item
                      value="Settings layers depth levels"
                      onSelect={() =>
                        runCommand(() =>
                          router.push('/settings?section=layers'),
                        )
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Depth Levels
                    </Command.Item>
                    <Command.Item
                      value="Settings entities organisations people"
                      onSelect={() =>
                        runCommand(() =>
                          router.push('/settings?section=entities'),
                        )
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Organisations &amp; People
                    </Command.Item>
                    <Command.Item
                      value="Settings guides reading paths"
                      onSelect={() =>
                        runCommand(() =>
                          router.push('/settings?section=guides'),
                        )
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Guides
                    </Command.Item>
                    <Command.Item
                      value="Settings integrations connections claude mcp"
                      onSelect={() =>
                        runCommand(() =>
                          router.push('/settings?section=integrations'),
                        )
                      }
                      className={ITEM_CLASS}
                    >
                      <Settings className="size-4 text-muted-foreground" />
                      Settings &rsaquo; Integrations
                    </Command.Item>
                  </>
                )}

                {/* Actions */}
                <Command.Group
                  heading="Actions"
                  className={GROUP_HEADING_CLASS}
                >
                  <Command.Item
                    value="Toggle theme"
                    onSelect={() =>
                      runCommand(() =>
                        setTheme(theme === 'dark' ? 'light' : 'dark'),
                      )
                    }
                    className={ITEM_CLASS}
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
                    className={ITEM_CLASS}
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
