'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { cn } from '@/lib/utils';

/**
 * Sign-out button for the site header.
 *
 * Calls `supabase.auth.signOut()` (global scope — revokes refresh tokens
 * across all devices) and then full-navigates to `/login`. The full
 * navigation (rather than `router.push`) guarantees that the cleared
 * auth cookies are visible to `proxy.ts` on the next request, so the
 * user cannot bounce back onto a protected page via a stale cache.
 *
 * Two variants:
 *   - `desktop` (default): icon-only ghost button, matches the other
 *     header action buttons (Settings, ThemeSettings).
 *   - `mobile`: full-width row styled to match the mobile drawer nav
 *     links, for use inside the Sheet drawer.
 */
interface SignOutButtonProps {
  variant?: 'desktop' | 'mobile';
  /**
   * Optional callback invoked immediately before navigating away.
   * Used by the mobile drawer to close itself before the redirect.
   */
  onBeforeNavigate?: () => void;
}

export function SignOutButton({
  variant = 'desktop',
  onBeforeNavigate,
}: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      // Swallow — we always navigate to /login regardless. A failed
      // signOut just means the Supabase server-side revocation didn't
      // land; the local auth cookies will still be cleared by the
      // client-side supabase-js teardown, and the full navigation below
      // forces the next request through proxy.ts. Log for diagnostics.
      logBestEffortWarn(
        'auth.sign_out.supabase',
        'supabase.auth.signOut() failed',
        { err },
      );
    } finally {
      onBeforeNavigate?.();
      // Full navigation — clears auth cookies before the next request
      // hits proxy.ts. Matches the post-login pattern in app/login/page.tsx.
      window.location.href = '/login';
    }
  }

  if (variant === 'mobile') {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        aria-busy={isSigningOut}
        aria-label="Sign out"
        className={cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <LogOut className="size-4" />
        Sign out
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleSignOut}
      disabled={isSigningOut}
      aria-busy={isSigningOut}
      aria-label="Sign out"
      title="Sign out"
      className="text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-4" />
    </Button>
  );
}
