'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BRANDING } from '@/lib/client-config';
import {
  X,
  Clock,
  Users,
  History,
  Compass,
  UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelativeDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import { useHydrated } from '@/hooks/use-hydrated';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { cn } from '@/lib/utils';
import type {
  ReorientData,
  TeamChange,
  RecentWorkItem,
} from '@/types/reorient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'reorient-dismissed';
const NAME_NUDGE_DISMISS_KEY = 'display-name-nudge-dismissed';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WelcomeBack({
  displayName,
  lastActiveRelative,
}: {
  displayName: string | null;
  lastActiveRelative: string;
}) {
  const greeting = getGreeting();
  const nameStr = displayName ? `, ${displayName}` : '';
  const timeStr = lastActiveRelative
    ? `. You were last active ${lastActiveRelative}.`
    : '.';

  return (
    <p className="text-lg font-medium text-foreground" role="status">
      {greeting}
      {nameStr}
      {timeStr}
    </p>
  );
}

function TeamChanges({ changes }: { changes: TeamChange[] }) {
  const userIds = changes.map((c) => c.user_id).filter(Boolean);
  const displayNames = useDisplayNames(userIds);
  const { getDomainColourKey } = useTaxonomy();

  if (changes.length === 0) return null;

  // Group changes by user + action + entity type for compact display
  const grouped = new Map<
    string,
    {
      name: string;
      action: string;
      count: number;
      domain?: string;
      entityType: TeamChange['entity_type'];
    }
  >();
  for (const change of changes) {
    const name = displayNames.get(change.user_id) ?? 'A team member';
    // For bid responses, use entity_title (bid name) as grouping context instead of domain
    const context =
      change.entity_type === 'bid_response'
        ? change.entity_title
        : (change.domain ?? 'general');
    const key = `${change.user_id}::${change.action}::${change.entity_type}::${context}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        name,
        action: change.action,
        count: 1,
        domain:
          change.entity_type === 'bid_response'
            ? change.entity_title
            : change.domain,
        entityType: change.entity_type,
      });
    }
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Users className="size-3" aria-hidden="true" />
        Since you were away
      </h3>
      <ul className="space-y-1">
        {Array.from(grouped.values()).map((group, i) => {
          const domainColourClass = group.domain
            ? `text-[var(--domain-${getDomainColourKey(group.domain)}-text)]`
            : undefined;

          const noun =
            group.entityType === 'bid_response' ? 'response' : 'item';

          return (
            <li key={i} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{group.name}</span>{' '}
              {group.action} {group.count} {noun}
              {group.count === 1 ? '' : 's'}
              {group.domain && (
                <>
                  {' '}
                  in{' '}
                  <span
                    className={cn(
                      'font-medium',
                      domainColourClass ?? 'text-foreground',
                    )}
                  >
                    {group.domain}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecentWork({ items }: { items: RecentWorkItem[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="size-3" aria-hidden="true" />
        Pick up where you left off
      </h3>
      <ul className="space-y-1">
        {items.slice(0, 3).map((item) => (
          <li key={item.entity_id}>
            <Link
              href={item.href}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Clock
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-foreground group-hover:underline">
                {item.entity_title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatRelativeDate(item.created_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DisplayNameNudge() {
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!localStorage.getItem(NAME_NUDGE_DISMISS_KEY);
  });

  if (nudgeDismissed) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-3">
      <UserCircle
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          Set your display name in{' '}
          <Link
            href="/settings?section=profile"
            className="font-medium underline underline-offset-2 hover:text-primary"
          >
            Settings
          </Link>{' '}
          to personalise your experience.
        </p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={() => {
          localStorage.setItem(
            NAME_NUDGE_DISMISS_KEY,
            new Date().toISOString(),
          );
          setNudgeDismissed(true);
        }}
        aria-label="Dismiss display name suggestion"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ReorientSectionProps {
  data: ReorientData;
}

export function ReorientSection({ data }: ReorientSectionProps) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!sessionStorage.getItem(DISMISS_KEY);
  });

  // Don't render until client-side to avoid hydration mismatch (greeting depends on time)
  if (!hydrated || dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, new Date().toISOString());
    setDismissed(true);
  };

  const hasTeamChanges = data.team_changes.length > 0;
  const hasRecentWork = data.my_recent_work.length > 0;
  const isEmpty = !hasTeamChanges && !hasRecentWork;

  // First-login detection: no prior activity and no recent work
  const isFirstLogin =
    !data.last_active_at &&
    data.my_recent_work.length === 0 &&
    data.team_changes.length === 0;

  return (
    <section
      className="rounded-lg border bg-card p-5 shadow-sm"
      aria-label="Personal briefing"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Compass
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <WelcomeBack
            displayName={data.user_display_name}
            lastActiveRelative={data.last_active_relative}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss briefing"
        >
          <X className="size-4" />
        </Button>
      </div>

      {isEmpty ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {isFirstLogin
            ? `Welcome to ${BRANDING.productName}. Start by browsing the knowledge base or creating your first bid.`
            : 'Everything looks good \u2014 no urgent items and nothing new since your last visit.'}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <TeamChanges changes={data.team_changes} />
          <RecentWork items={data.my_recent_work} />
        </div>
      )}

      {/* Nudge to set display name when not explicitly configured */}
      {!data.has_display_name && (
        <div className="mt-4">
          <DisplayNameNudge />
        </div>
      )}
    </section>
  );
}
