'use client';

import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { isPublicRoute } from '@/lib/routes';
import { SiteHeader } from '@/components/site-header';
import { FloatingCopilotButton } from '@/components/floating-copilot-button';

interface AuthAwareChromeProps {
  children: ReactNode;
}

/**
 * Conditionally renders authenticated-only chrome (SiteHeader, FloatingCopilotButton)
 * based on the current route. On public routes (login, auth callback, OAuth consent),
 * only the children are rendered — no navigation, no FAB, no notification polling.
 */
export function AuthAwareChrome({ children }: AuthAwareChromeProps) {
  const pathname = usePathname();

  if (isPublicRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteHeader />
      {children}
      <FloatingCopilotButton />
    </>
  );
}
