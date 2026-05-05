'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { createClient } from '@/lib/supabase/client';
import type { PrimaryFocus } from '@/lib/user-focus-constants';

const DISMISS_KEY = 'organisation-profile-nudge-dismissed';

// ---------------------------------------------------------------------------
// Persona-tailored nudge copy (spec §3.5)
// ---------------------------------------------------------------------------

const NUDGE_COPY: Record<PrimaryFocus | 'default', string> = {
  bid_writing: 'Add your company profile to improve bid context',
  account_management: 'Add your company profile to generate account briefs',
  marketing: 'Complete your company profile for better case studies',
  default: 'Tell us about your company to personalise your experience',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** @public */
export interface OrganisationProfileNudgeProps {
  /** Whether the organisation profile is complete */
  isProfileComplete: boolean;
  /** Whether the user is a first-time login (from deriveIsFirstLogin) */
  isFirstLogin: boolean;
  /** User role — viewers do not see the nudge */
  userRole: string;
}

export function OrganisationProfileNudge({
  isProfileComplete,
  isFirstLogin,
  userRole,
}: OrganisationProfileNudgeProps) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem(DISMISS_KEY);
  });
  const [primaryFocus, setPrimaryFocus] = useState<PrimaryFocus | null>(null);

  // Read primary_focus from user_metadata for persona-tailored copy
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const focus = data.user?.user_metadata?.primary_focus as
        | PrimaryFocus
        | undefined;
      if (focus) setPrimaryFocus(focus);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Gate: only show for admin/editor, first-login, incomplete profile
  if (userRole === 'viewer') return null;
  if (!isFirstLogin) return null;
  if (isProfileComplete) return null;
  if (!hydrated) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    setDismissed(true);
  };

  const nudgeText = primaryFocus
    ? NUDGE_COPY[primaryFocus]
    : NUDGE_COPY.default;

  return (
    <div
      className="relative flex items-center gap-4 rounded-lg border border-border bg-card p-4"
      data-testid="organisation-profile-nudge"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent">
        <Building2
          className="size-5 text-accent-foreground"
          aria-hidden="true"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{nudgeText}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          This helps personalise search, intelligence, and bid features.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings?section=organisation">Set up</Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss organisation profile nudge"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
