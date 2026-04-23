'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Compass, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/hooks/use-hydrated';
import { createClient } from '@/lib/supabase/client';
import {
  PRIMARY_FOCUS_OPTIONS,
  type PrimaryFocus,
} from '@/lib/user-focus-constants';
import { cn } from '@/lib/utils';

// Spec §4.2 nominates EmptyState as the visual base. The card's extra
// affordances (dismiss button, persona hint row) exceed EmptyState's current
// composition API, so we render the same dashed-border shell directly — spec
// allows this "lower-diff" path explicitly. If EmptyState later grows a
// `className` + `primaryCtaVariant` escape hatch, migrate back to composition.

const DISMISS_KEY = 'dashboard-first-run-dismissed';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DashboardFirstRunCardProps {
  role: 'admin' | 'editor' | 'viewer';
}

export function DashboardFirstRunCard({ role }: DashboardFirstRunCardProps) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem(DISMISS_KEY);
  });
  const [selectedFocus, setSelectedFocus] = useState<PrimaryFocus | null>(null);
  const [savingFocus, setSavingFocus] = useState(false);

  // Hydrate the highlight state from user_metadata so a previously-chosen
  // persona stays highlighted after navigation back to the dashboard.
  useEffect(() => {
    if (role === 'viewer') return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const focus = data.user?.user_metadata?.primary_focus as
        | PrimaryFocus
        | undefined;
      if (focus) setSelectedFocus(focus);
    });
    return () => {
      cancelled = true;
    };
  }, [role]);

  // Viewers do not see the first-run card (handled by ReorientSection copy)
  if (role === 'viewer') return null;

  // useHydrated guard — prevent flash-of-dismissed-content per spec §4.2
  if (!hydrated) return null;

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    setDismissed(true);
  };

  const handlePersonaClick = async (value: PrimaryFocus) => {
    setSavingFocus(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: { primary_focus: value },
      });
      if (error) throw error;
      setSelectedFocus(value);
      toast.success("Preference saved — we'll tailor your experience.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save preference',
      );
    } finally {
      setSavingFocus(false);
    }
  };

  // Role-branched CTAs per spec §4.2
  const primaryCta =
    role === 'admin'
      ? { label: 'Import your first content', href: '/item/new' }
      : { label: 'Create your first item', href: '/item/new' };

  const secondaryCta =
    role === 'admin'
      ? { label: 'Configure settings', href: '/settings' }
      : { label: 'Browse the knowledge base', href: '/browse' };

  return (
    <div
      className="relative flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-12 text-center"
      data-testid="dashboard-first-run-card"
    >
      {/* Dismiss button */}
      <div className="absolute right-3 top-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss welcome card"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Icon */}
      <div className="text-muted-foreground" aria-hidden="true">
        <Compass className="size-10" />
      </div>

      {/* Title and description */}
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          Welcome to Knowledge Hub
        </h2>
        <p className="text-sm text-muted-foreground">
          Let&apos;s get your company knowledge organised.
        </p>
      </div>

      {/* CTA buttons — primary uses default variant for visual weight per spec §4.2 */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="default" size="sm" asChild>
          <Link href={primaryCta.href}>{primaryCta.label}</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
        </Button>
      </div>

      {/* Persona hint row — spec §4.3 */}
      <div className="mt-2 border-t border-border pt-4">
        <p className="mb-2 text-xs text-muted-foreground">
          I&apos;m primarily here for:
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {PRIMARY_FOCUS_OPTIONS.map((hint) => (
            <button
              key={hint.value}
              type="button"
              disabled={savingFocus}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selectedFocus === hint.value
                  ? 'font-medium text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => handlePersonaClick(hint.value)}
              aria-pressed={selectedFocus === hint.value}
            >
              {hint.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
