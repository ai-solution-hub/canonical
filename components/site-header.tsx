'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { Search, BookOpen, FolderOpen, Briefcase, Library, Menu, Settings, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ThemeSettings } from '@/components/theme-settings';
import { NotificationBell } from '@/components/notification-bell';
import { Separator } from '@/components/ui/separator';
import { useUserRole } from '@/hooks/use-user-role';
import { cn, getModifierKey } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/browse', label: 'Browse', icon: null },
  { href: '/library', label: 'Q&A Library', icon: Library },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/workspaces', label: 'Workspaces', icon: FolderOpen },
  { href: '/bid', label: 'Bids', icon: Briefcase },
  { href: '/digest', label: 'Digest', icon: BookOpen },
] as const;

const SETTINGS_LINK = { href: '/settings', label: 'Settings', icon: Settings };

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { canEdit, loading: roleLoading } = useUserRole();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      setQuery('');
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <nav
        className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6"
        aria-label="Main navigation"
      >
        {/* Mobile hamburger button */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>

        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 text-lg font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
        >
          Knowledge Hub
        </Link>

        <div className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {Icon && <Icon className="size-3.5" />}
                {label}
              </Link>
            );
          })}
          {(roleLoading || canEdit) && (
            <Link
              href="/review"
              aria-current={pathname === '/review' || pathname?.startsWith('/review/') ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                roleLoading && 'pointer-events-none opacity-50',
              )}
              tabIndex={roleLoading ? -1 : undefined}
            >
              <ShieldCheck className="size-3.5" />
              Review
            </Link>
          )}
        </div>

        <form
          onSubmit={handleSearch}
          className="relative mx-auto hidden w-full max-w-md sm:block"
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search knowledge base..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-9 pr-16"
            aria-label="Search knowledge base"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">{getModifierKey()}</span>K
          </kbd>
        </form>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => router.push('/search')}
            aria-label="Search"
          >
            <Search className="size-4" />
          </Button>
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/settings')}
            aria-label="Settings"
            className={cn(
              pathname === '/settings' || pathname?.startsWith('/settings/')
                ? 'text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <Settings className="size-4" />
          </Button>
          <ThemeSettings />
        </div>
      </nav>

      {/* Mobile navigation drawer */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-lg font-semibold">Knowledge Hub</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3" aria-label="Mobile navigation">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              aria-current={pathname === '/' ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                pathname === '/' ? 'bg-accent text-foreground' : 'text-muted-foreground',
              )}
            >
              Home
            </Link>
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href || pathname?.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    isActive
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {Icon && <Icon className="size-4" />}
                  {label}
                </Link>
              );
            })}
            {(roleLoading || canEdit) && (
              <Link
                href="/review"
                onClick={() => setMobileMenuOpen(false)}
                aria-current={pathname === '/review' || pathname?.startsWith('/review/') ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                  pathname === '/review' || pathname?.startsWith('/review/')
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground',
                  roleLoading && 'pointer-events-none opacity-50',
                )}
                tabIndex={roleLoading ? -1 : undefined}
              >
                <ShieldCheck className="size-4" />
                Review
              </Link>
            )}
            <Separator className="my-1" />
            <NotificationBell mobile />
            <Link
              href={SETTINGS_LINK.href}
              onClick={() => setMobileMenuOpen(false)}
              aria-current={pathname === SETTINGS_LINK.href ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                pathname === SETTINGS_LINK.href
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              <SETTINGS_LINK.icon className="size-4" />
              {SETTINGS_LINK.label}
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
