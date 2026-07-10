'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/browse/search-bar';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ThemeSettings } from '@/components/shell/theme-settings';
import { SignOutButton } from '@/components/shell/sign-out-button';
import { Separator } from '@/components/ui/separator';
import { useUserRole } from '@/hooks/use-user-role';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/shell/brand-logo';
import { BRANDING } from '@/lib/client-config';
import {
  NAV_ZONES,
  isEntryVisible,
  isEntryActive,
  isZoneActive,
} from '@/components/shell/nav-config';

const SETTINGS_LINK = { href: '/settings', label: 'Settings', icon: Settings };

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { canEdit, canAdmin } = useUserRole();

  return (
    <header className="sticky top-0 z-40 border-b bg-white shadow-[0_1px_3px_oklch(0.18_0.014_48/0.06)] dark:bg-background dark:shadow-[0_1px_3px_oklch(0.18_0.014_48/0.2)]">
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
          className="flex shrink-0 items-center gap-1.5 transition-opacity hover:opacity-80"
        >
          <BrandLogo />
        </Link>

        <div className="hidden items-center gap-1 sm:flex">
          {NAV_ZONES.map((zone) => {
            const visibleEntries = zone.entries.filter(
              (entry) =>
                !entry.reserved &&
                isEntryVisible(entry.visibility, { canEdit, canAdmin }),
            );
            if (visibleEntries.length === 0) return null;
            const zoneActive = isZoneActive(zone, pathname);
            return (
              <DropdownMenu key={zone.id}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'gap-1.5 text-sm',
                      zoneActive
                        ? 'font-semibold text-foreground underline underline-offset-4'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {zone.header}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {visibleEntries.map((entry) => {
                    const isActive = isEntryActive(entry.href, pathname);
                    const Icon = entry.icon;
                    return (
                      <DropdownMenuItem key={entry.href} asChild>
                        <Link
                          href={entry.href}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2',
                            isActive
                              ? 'font-semibold text-foreground'
                              : 'text-muted-foreground',
                          )}
                        >
                          <Icon className="size-3.5" />
                          {entry.label}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>

        <div className="mx-auto hidden w-full max-w-sm md:max-w-md lg:max-w-lg sm:block">
          <SearchBar variant="compact" />
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/settings')}
            aria-label="Settings"
            title="Settings"
            className={cn(
              pathname === '/settings' || pathname?.startsWith('/settings/')
                ? 'text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <Settings className="size-4" />
          </Button>
          <ThemeSettings />
          <SignOutButton />
        </div>
      </nav>

      {/* Mobile navigation drawer */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-lg font-semibold">
              {BRANDING.productShortName}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation menu
            </SheetDescription>
          </SheetHeader>
          <nav
            className="flex flex-col gap-1 p-3"
            aria-label="Mobile navigation"
          >
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              aria-current={pathname === '/' ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                pathname === '/'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              Home
            </Link>
            {NAV_ZONES.map((zone) => {
              const visibleEntries = zone.entries.filter(
                (entry) =>
                  !entry.reserved &&
                  isEntryVisible(entry.visibility, { canEdit, canAdmin }),
              );
              if (visibleEntries.length === 0) return null;
              return (
                <div key={zone.id} className="mt-2 first:mt-0">
                  <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {zone.header}
                  </p>
                  {visibleEntries.map((entry) => {
                    const isActive = isEntryActive(entry.href, pathname);
                    const Icon = entry.icon;
                    return (
                      <Link
                        key={entry.href}
                        href={entry.href}
                        onClick={() => setMobileMenuOpen(false)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                          isActive
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        <Icon className="size-4" />
                        {entry.label}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
            <Separator className="my-1" />
            <Link
              href={SETTINGS_LINK.href}
              onClick={() => setMobileMenuOpen(false)}
              aria-current={
                pathname === SETTINGS_LINK.href ? 'page' : undefined
              }
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
            <SignOutButton
              variant="mobile"
              onBeforeNavigate={() => setMobileMenuOpen(false)}
            />
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
