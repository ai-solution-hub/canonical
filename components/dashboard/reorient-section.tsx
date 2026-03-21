'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  X,
  AlertTriangle,
  Bell,
  Clock,
  ArrowRight,
  Users,
  History,
  Briefcase,
  RefreshCw,
  ShieldCheck,
  Compass,
  UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelativeDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import { useHydrated } from '@/hooks/use-hydrated';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import { cn } from '@/lib/utils';
import type { ReorientData, UrgentItem, TeamChange, RecentWorkItem } from '@/types/reorient';

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

function getUrgentClaudePrompt(item: UrgentItem): string | undefined {
  switch (item.type) {
    case 'bid_deadline':
      return `The "${item.title}" bid needs attention — ${item.detail}. Show me the current progress and help me prioritise which unanswered questions to tackle first.`;
    case 'content_expired':
      return `Content item "${item.title}" has expired. Fetch it, check what's changed in this area, and help me update it.`;
    case 'review_pending':
      return `There's a governance review pending for "${item.title}". Show me the content and recommend whether to approve or request changes.`;
    case 'quality_flag':
      return `Content item "${item.title}" was flagged for quality issues. Fetch the item, diagnose the issue, and help me fix it.`;
    case 'notification':
      return `I have a notification: "${item.title}" — ${item.detail}. Help me understand what action is needed and guide me through resolving it.`;
    default:
      return undefined;
  }
}

function UrgentItems({ items }: { items: UrgentItem[] }) {
  if (items.length === 0) return null;

  const urgentIcon = (type: UrgentItem['type']): typeof AlertTriangle => {
    switch (type) {
      case 'bid_deadline':
        return Briefcase;
      case 'content_expired':
        return RefreshCw;
      case 'review_pending':
        return ShieldCheck;
      case 'quality_flag':
        return AlertTriangle;
      case 'notification':
        return Bell;
      default:
        return AlertTriangle;
    }
  };

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <AlertTriangle className="size-3" aria-hidden="true" />
        Needs your attention
      </h3>
      <div className={
        items.length <= 3
          ? cn(
              'grid grid-cols-1 gap-2',
              items.length === 1 && 'lg:grid-cols-1',
              items.length === 2 && 'lg:grid-cols-2',
              items.length === 3 && 'lg:grid-cols-3',
            )
          : 'space-y-2'
      }>
        {items.map((item) => {
          const Icon = urgentIcon(item.type);
          const claudePrompt = getUrgentClaudePrompt(item);
          // Use text-bid-overdue for overdue bids, text-status-warning for everything else
          const iconColour =
            item.type === 'bid_deadline' && item.deadline && new Date(item.deadline) < new Date()
              ? 'text-bid-overdue'
              : 'text-status-warning';
          return (
            <div
              key={`${item.type}-${item.entity_id}`}
              className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50"
            >
              <Icon
                className={`mt-0.5 size-4 shrink-0 ${iconColour}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  aria-label={`${item.title} — ${item.detail}`}
                >
                  <p className="text-sm font-medium text-foreground hover:underline">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.detail}
                  </p>
                </Link>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {claudePrompt && (
                  <ClaudePromptButton
                    prompt={claudePrompt}
                    size="sm"
                    className="h-auto px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  />
                )}
                <Link
                  href={item.href}
                  className="mt-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-label={`Go to ${item.title}`}
                  tabIndex={-1}
                >
                  <ArrowRight
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Known domain-to-CSS-token mapping. Domain names from the API (primary_domain)
 * are lowercase kebab-case. The CSS variables use `--domain-{key}-text` where
 * the key may differ (e.g. "product-feature" maps to "product"). Domains not in
 * this map fall back to `text-foreground`.
 *
 * NOTE: If new taxonomy domains are added, this map needs updating to match the
 * CSS variable names in globals.css. A fully dynamic solution would require the
 * TaxonomyContext here, but that couples the reorient section to taxonomy loading.
 */
const DOMAIN_COLOUR_CLASS: Record<string, string> = {
  security: 'text-[var(--domain-security-text)]',
  compliance: 'text-[var(--domain-compliance-text)]',
  implementation: 'text-[var(--domain-implementation-text)]',
  support: 'text-[var(--domain-support-text)]',
  corporate: 'text-[var(--domain-corporate-text)]',
  'product-feature': 'text-[var(--domain-product-text)]',
  methodology: 'text-[var(--domain-methodology-text)]',
};

function TeamChanges({ changes }: { changes: TeamChange[] }) {
  const userIds = changes.map((c) => c.user_id).filter(Boolean);
  const displayNames = useDisplayNames(userIds);

  if (changes.length === 0) return null;

  // Group changes by user + action + entity type for compact display
  const grouped = new Map<string, {
    name: string;
    action: string;
    count: number;
    domain?: string;
    entityType: TeamChange['entity_type'];
  }>();
  for (const change of changes) {
    const name = displayNames.get(change.user_id) ?? 'A team member';
    // For bid responses, use entity_title (bid name) as grouping context instead of domain
    const context = change.entity_type === 'bid_response'
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
        domain: change.entity_type === 'bid_response' ? change.entity_title : change.domain,
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
          const domainColourClass =
            group.domain
              ? DOMAIN_COLOUR_CLASS[group.domain.toLowerCase()] ?? 'text-foreground'
              : undefined;

          const noun = group.entityType === 'bid_response' ? 'response' : 'item';

          return (
            <li key={i} className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{group.name}</span>{' '}
              {group.action} {group.count} {noun}{group.count === 1 ? '' : 's'}
              {group.domain && (
                <> in <span className={cn('font-medium', domainColourClass ?? 'text-foreground')}>{group.domain}</span></>
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

function DisplayNameNudge() {
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!localStorage.getItem(NAME_NUDGE_DISMISS_KEY);
  });

  if (nudgeDismissed) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
      <UserCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
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
          localStorage.setItem(NAME_NUDGE_DISMISS_KEY, new Date().toISOString());
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

  const hasUrgent = data.urgent.length > 0;
  const hasTeamChanges = data.team_changes.length > 0;
  const hasRecentWork = data.my_recent_work.length > 0;
  const isEmpty = !hasUrgent && !hasTeamChanges && !hasRecentWork;

  // First-login detection: no prior activity and no recent work
  const isFirstLogin =
    !data.last_active_at &&
    data.my_recent_work.length === 0 &&
    data.team_changes.length === 0;

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
          {isFirstLogin
            ? 'Welcome to Knowledge Hub. Start by browsing the knowledge base or creating your first bid.'
            : 'Everything looks good \u2014 no urgent items and nothing new since your last visit.'}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <UrgentItems items={data.urgent} />
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
