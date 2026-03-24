'use client';

import Link from 'next/link';
import { Briefcase, FileText, type LucideIcon } from 'lucide-react';

interface WorkspaceType {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly href: string | null;
  readonly available: boolean;
}

const WORKSPACE_TYPES: readonly WorkspaceType[] = [
  {
    type: 'bid',
    label: 'Bids',
    description:
      'Manage bid responses and tender submissions using your knowledge base',
    icon: Briefcase,
    href: '/bid',
    available: true,
  },
  {
    type: 'proposal',
    label: 'Sales Proposals',
    description:
      'Draft and manage sales proposals drawing on your knowledge base',
    icon: FileText,
    href: null,
    available: false,
  },
] as const;

interface WorkspacesContentProps {
  counts: Record<string, number>;
}

function formatCount(count: number, type: string): string {
  const singular: Record<string, string> = {
    bid: 'active bid',
    proposal: 'active proposal',
  };
  const plural: Record<string, string> = {
    bid: 'active bids',
    proposal: 'active proposals',
  };
  if (count === 1) return `1 ${singular[type] ?? 'active workspace'}`;
  return `${count} ${plural[type] ?? 'active workspaces'}`;
}

export function WorkspacesContent({ counts }: WorkspacesContentProps) {
  return (
    <>
      {/* Header */}
      <div>
        <h1 className="text-fluid-2xl font-bold tracking-tight">Workspaces</h1>
        <p className="mt-1 text-muted-foreground">
          Use your knowledge base to power different types of work.
        </p>
      </div>

      {/* Type cards grid */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {WORKSPACE_TYPES.map((wt) => {
          const Icon = wt.icon;
          const count = counts[wt.type] ?? 0;
          const countText = formatCount(count, wt.type);

          if (wt.available && wt.href) {
            return (
              <Link
                key={wt.type}
                href={wt.href}
                className="group rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${wt.label} — ${countText}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Icon
                      className="size-5 text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{wt.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {wt.description}
                    </p>
                    {count > 0 && (
                      <p className="mt-3 text-sm font-medium text-foreground">
                        {countText}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            );
          }

          return (
            <div
              key={wt.type}
              className="rounded-lg border bg-card p-6 opacity-60 shadow-sm"
              aria-disabled="true"
              aria-label={`${wt.label} — coming soon`}
            >
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{wt.label}</h2>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Coming soon
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {wt.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
