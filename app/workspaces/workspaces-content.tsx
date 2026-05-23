'use client';

import Link from 'next/link';
import {
  useLauncherTypes,
  formatTypeCount,
} from '@/hooks/workspaces/use-application-types';

interface WorkspacesContentProps {
  counts: Record<string, number>;
}

export function WorkspacesContent({ counts }: WorkspacesContentProps) {
  // ID-29.7: migrated from static getLauncherTypes() to useLauncherTypes() hook.
  // On first paint the hook returns [] (loading); existing grid container renders
  // empty until the hook resolves (~50ms from cache). Acceptable per TECH.md R-1 / AC-3a.
  const { data: launcherTypes = [] } = useLauncherTypes();

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
        {launcherTypes.map((wt) => {
          const Icon = wt.icon;
          const count = counts[wt.key] ?? 0;
          const countText = formatTypeCount(wt, count);

          if (wt.available && wt.route) {
            return (
              <Link
                key={wt.key}
                href={wt.route}
                className="group rounded-lg border bg-card p-6 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${wt.labelPlural} — ${countText}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Icon className="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{wt.labelPlural}</h2>
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
              key={wt.key}
              className="rounded-lg border bg-card p-6 opacity-60 shadow-sm"
              aria-disabled="true"
              aria-label={`${wt.labelPlural} — coming soon`}
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
                    <h2 className="text-lg font-semibold">{wt.labelPlural}</h2>
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
