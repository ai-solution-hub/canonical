'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  X,
  AlertTriangle,
  Clock,
  ArrowRight,
  Users,
  History,
  Briefcase,
  RefreshCw,
  ShieldCheck,
  Compass,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelativeDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import type { ReorientData, UrgentItem, TeamChange, RecentWorkItem } from '@/types/reorient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'reorient-dismissed';

// SSR-safe hydration check
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;
function useHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

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

function UrgentItems({ items }: { items: UrgentItem[] }) {
  if (items.length === 0) return null;

  const urgentIcon = (type: UrgentItem['type']) => {
    switch (type) {
      case 'bid_deadline':
        return Briefcase;
      case 'content_expired':
        return RefreshCw;
      case 'review_pending':
        return ShieldCheck;
      case 'quality_flag':
        return AlertTriangle;
    }
  };

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <AlertTriangle className="size-3" aria-hidden="true" />
        Needs your attention
      </h3>
      <div className="space-y-2">
        {items.map((item) => {
          const Icon = urgentIcon(item.type);
          return (
            <Link
              key={`${item.type}-${item.entity_id}`}
              href={item.href}
              className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50"
              aria-label={`${item.title} — ${item.detail}`}
            >
              <Icon
                className="mt-0.5 size-4 shrink-0 text-status-warning"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.detail}
                </p>
              </div>
              <ArrowRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function TeamChanges({ changes }: { changes: TeamChange[] }) {
  const userIds = changes.map((c) => c.user_id).filter(Boolean);
  const displayNames = useDisplayNames(userIds);

  if (changes.length === 0) return null;

  // Group changes by user + action for compact display
  const grouped = new Map<string, { name: string; action: string; count: number; domain?: string }>();
  for (const change of changes) {
    const name = displayNames.get(change.user_id) ?? 'A team member';
    const key = `${change.user_id}::${change.action}::${change.domain ?? 'general'}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        name,
        action: change.action,
        count: 1,
        domain: change.domain,
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
        {Array.from(grouped.values()).map((group, i) => (
          <li key={i} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{group.name}</span>{' '}
            {group.action} {group.count} item{group.count === 1 ? '' : 's'}
            {group.domain && (
              <> in <span className="font-medium">{group.domain}</span></>
            )}
          </li>
        ))}
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
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
            >
              <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
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

  const hasUrgent = data.urgent.length > 0;
  const hasTeamChanges = data.team_changes.length > 0;
  const hasRecentWork = data.my_recent_work.length > 0;
  const isEmpty = !hasUrgent && !hasTeamChanges && !hasRecentWork;

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      aria-label="Personal briefing"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Compass className="size-4 text-muted-foreground" aria-hidden="true" />
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
          Everything looks good — no urgent items and nothing new since your
          last visit.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <UrgentItems items={data.urgent} />
          <TeamChanges changes={data.team_changes} />
          <RecentWork items={data.my_recent_work} />
        </div>
      )}
    </section>
  );
}
