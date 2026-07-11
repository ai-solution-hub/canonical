'use client';

/**
 * `<BundleList>` — the `/okf` landing's bundle-enumeration list (ID-132
 * {132.32} G-LANDING-IMPL, OKF-LANDING.md LI-14).
 *
 * Renders every bundle `enumerateOkfBundles` (via `GET /api/okf/bundles`)
 * surfaced, each with two actions: "Browse files" opens the bundle's
 * full-tree file explorer inline (`<FileExplorer>`, LI-15) and "Open graph
 * view" links to the existing `/okf/[bundleId]` concept-graph viewer — the
 * landing COMPLEMENTS that viewer, never replaces it (LI-18).
 *
 * Two distinct graceful-empty-state copies (LI-4(a)/(b)): `configured`
 * distinguishes "no bundle root set up at all" from "root configured, no
 * bundles synced yet" — both render 200 + friendly UK-English copy, never a
 * blank screen or crash.
 */
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BundleListProps {
  bundles: string[];
  /** `false` when `OKF_BUNDLE_ROOT` itself is unset/blank (LI-4(a)). */
  configured: boolean;
  selectedBundleId: string | null;
  onSelectBundle: (bundleId: string) => void;
  className?: string;
}

export function BundleList({
  bundles,
  configured,
  selectedBundleId,
  onSelectBundle,
  className,
}: BundleListProps) {
  if (!configured) {
    return (
      <div
        data-testid="bundle-list-empty"
        className={cn(
          'flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        No concepts have been published yet.
      </div>
    );
  }

  if (bundles.length === 0) {
    return (
      <div
        data-testid="bundle-list-empty"
        className={cn(
          'flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        No bundles have been added yet.
      </div>
    );
  }

  return (
    <ul
      aria-label="Concept bundles"
      data-testid="bundle-list"
      className={cn('space-y-2 p-4', className)}
    >
      {bundles.map((bundleId) => {
        const selected = bundleId === selectedBundleId;
        return (
          <li
            key={bundleId}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md border border-border p-3',
              selected && 'bg-accent',
            )}
          >
            <span className="text-sm font-medium text-foreground">
              {bundleId}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelectBundle(bundleId)}
              >
                Browse files
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href={`/okf/${encodeURIComponent(bundleId)}`}>
                  Open graph view
                </Link>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
