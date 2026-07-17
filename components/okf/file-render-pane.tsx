'use client';

/**
 * `<FileRenderPane>` — the full-bundle file explorer's render pane (ID-132
 * {132.32} G-LANDING-IMPL, OKF-LANDING.md LI-5/LI-6/LI-16/LI-18).
 *
 * Renders the currently-selected file's markdown via **Streamdown**
 * (DR-040 / OQ-LAND-4) — the ratified renderer for all markdown surfaces
 * (`<ConceptDetail>` migrated too under the bl-427 sweep; the incumbent
 * `react-markdown` is gone). When the selected file is `index.md`, its
 * `##`/`###` themes → `* [title](path.md) — description` concept bullets
 * render as ordinary Markdown headings/list items, so the progressive-
 * disclosure structure (LI-6) reads as a legible table of contents without
 * any bespoke parsing here — `lib/okf/parse-index.ts` (the structured parse
 * used by the `[bundleId]` viewer's `<BundleNav>`) is a different consumer
 * of the same file, not reused by this render-only pane.
 *
 * Internal `[title](path.md)` links are pre-resolved by
 * `normaliseInternalMdLinksForStreamdown` (the same directory-relative
 * algorithm as `resolveInternalMdLink`, run up front — see that module's
 * doc comment for why Streamdown's bundled link-hardening pass requires
 * this rather than resolving lazily in the `a` override) to their
 * bundle-root-relative target behind `INTERNAL_LINK_MARKER`. A marked
 * target that is a known tree file (`knownMdPaths`, from
 * `<FileExplorer>`'s tree query) becomes an in-app navigation
 * (`onNavigate`) instead of a page load; anything else (external links,
 * an unresolvable or unknown target) falls back to a plain external
 * anchor.
 *
 * Pure presenter — the connected container (`<FileExplorer>`) owns the
 * `GET /api/okf/[bundleId]/file` TanStack Query call and passes
 * `content`/`isLoading`/`isError` down (mirrors the `<ConceptDetail>` /
 * `RelatedRecordsRail` pattern elsewhere in this codebase).
 *
 * `code`/`strong` overrides are the shared a11y/test-hostile-default fix
 * (ID-161, `components/shared/streamdown-components.tsx`) — merged with
 * this component's own `a` override below rather than replacing it, since
 * the in-app-navigation-vs-external-anchor logic here is site-specific.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { Streamdown, type Components } from 'streamdown';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  normaliseInternalMdLinksForStreamdown,
  INTERNAL_LINK_MARKER,
} from '@/lib/okf/prepare-streamdown-content';
import { sharedStreamdownComponents } from '@/components/shared/streamdown-components';

interface FileRenderPaneProps {
  bundleId: string;
  /** Bundle-root-relative path of the file being rendered, or `null` (nothing selected). */
  path: string | null;
  content: string | null;
  isLoading: boolean;
  isError: boolean;
  /** Every known `.md` path in this bundle's tree — internal links outside this set render as plain anchors. */
  knownMdPaths: Set<string>;
  onNavigate: (path: string) => void;
  className?: string;
}

export function FileRenderPane({
  bundleId,
  path,
  content,
  isLoading,
  isError,
  knownMdPaths,
  onNavigate,
  className,
}: FileRenderPaneProps) {
  const markdownComponents = useMemo<Components>(
    () => ({
      ...sharedStreamdownComponents,
      a: ({ href, children, ...props }) => {
        if (href && href.startsWith(INTERNAL_LINK_MARKER)) {
          const targetPath = href
            .slice(INTERNAL_LINK_MARKER.length)
            .split('#')[0];
          if (knownMdPaths.has(targetPath)) {
            return (
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => onNavigate(targetPath)}
              >
                {children}
              </button>
            );
          }
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
    }),
    [knownMdPaths, onNavigate],
  );

  const preparedContent = useMemo(
    () =>
      content === null || path === null
        ? ''
        : normaliseInternalMdLinksForStreamdown(content, path),
    [content, path],
  );

  const graphViewLink = (
    <Link
      href={`/okf/${encodeURIComponent(bundleId)}`}
      className="text-xs text-primary underline underline-offset-2"
    >
      Open graph view
    </Link>
  );

  if (!path) {
    return (
      <div
        data-testid="file-render-pane-empty"
        className={cn(
          'flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        <p>
          Select a file from the tree to view its contents. If this bundle has
          no index.md yet, browse the tree to find its concepts.
        </p>
        {graphViewLink}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        data-testid="file-render-pane-loading"
        className={cn('space-y-2 p-5', className)}
      >
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (isError || content === null) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-6 text-sm text-destructive',
          className,
        )}
      >
        Failed to load this file. Please retry shortly.
      </div>
    );
  }

  return (
    <article
      data-testid="file-render-pane"
      className={cn('overflow-y-auto p-5', className)}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{path}</span>
        {graphViewLink}
      </header>
      <div className="prose prose-sm max-w-none text-sm text-foreground">
        <Streamdown components={markdownComponents}>
          {preparedContent}
        </Streamdown>
      </div>
    </article>
  );
}
