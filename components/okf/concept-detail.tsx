'use client';

/**
 * `<ConceptDetail>` — the right-pane concept detail panel (ID-132 {132.14}
 * G-VIEWER, TS port of `viz.js`'s `showDetail` / `rewriteInternalLinks`).
 *
 * Renders the type chip, title, id, frontmatter `<dl>` (description /
 * resource / tags), the **Streamdown**-rendered body (DR-040 / bl-427 sweep
 * — GFM is bundled natively, so no `remarkPlugins`), and the "Cited by"
 * backlinks list. Internal `.md` links in the body focus another node
 * in-app (`onNavigate`) instead of navigating away — pre-resolved via
 * `normaliseInternalMdLinksForStreamdown` so they survive Streamdown's
 * bundled `rehype-harden` pass (see that module's doc comment), then
 * matched against `knownConceptIds` by the `a` override (the same
 * marker-recognition pattern as `<FileRenderPane>`, with a concept id
 * rather than a tree path as the navigation target). A `resource:` pointer
 * renders as a chip that lazily resolves via `useResource` (secondary lane,
 * TECH-ADDENDUM-reference-agents.md Part 2 §Reframe B) — gated behind a
 * click, never fetched as part of the graph load.
 */
import { useMemo, useState } from 'react';
import { Streamdown, type Components } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { conceptTypeTokenVars } from '@/lib/okf/concept-type-tokens';
import { parseCanonicalResourceUri } from '@/lib/okf/parse-canonical-uri';
import {
  normaliseInternalMdLinksForStreamdown,
  INTERNAL_LINK_MARKER,
} from '@/lib/okf/prepare-streamdown-content';
import { sharedStreamdownComponents } from '@/components/shared/streamdown-components';
import { useResource } from '@/hooks/okf/use-resource';
import type { OkfBundleGraphNode } from '@/lib/query/okf';

interface Backlink {
  id: string;
  label: string;
}

interface ConceptDetailProps {
  node: OkfBundleGraphNode | null;
  body: string;
  backlinks: Backlink[];
  /** Every known concept id in this bundle — internal links outside this set render as plain text. */
  knownConceptIds: Set<string>;
  onNavigate: (conceptId: string) => void;
  className?: string;
}

function ResourceChip({ uri }: { uri: string }) {
  const [clicked, setClicked] = useState(false);
  const parsed = useMemo(() => parseCanonicalResourceUri(uri), [uri]);
  const query = useResource(parsed ? uri : null, { enabled: clicked });

  if (!parsed) {
    // A plain external resource URL (the reference's un-parsed default case).
    return (
      <a
        href={uri}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 break-all"
      >
        {uri}
      </a>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setClicked(true)}
        className="w-fit rounded-md border border-border bg-muted px-2 py-1 text-left text-xs text-foreground hover:bg-accent"
      >
        {uri}
      </button>
      {clicked && query.isLoading && (
        <span className="text-xs text-muted-foreground">Resolving…</span>
      )}
      {clicked && query.isError && (
        <span className="text-xs text-destructive">
          Could not resolve this resource.
        </span>
      )}
      {clicked && query.isSuccess && query.data && 'record' in query.data && (
        <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-2 text-xs">
          {JSON.stringify(query.data.record, null, 2)}
        </pre>
      )}
      {clicked && query.isSuccess && query.data && 'records' in query.data && (
        <span className="text-xs text-muted-foreground">
          {query.data.records.length} matching Q&amp;A pair
          {query.data.records.length === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

export function ConceptDetail({
  node,
  body,
  backlinks,
  knownConceptIds,
  onNavigate,
  className,
}: ConceptDetailProps) {
  const markdownComponents = useMemo<Components>(
    () => ({
      ...sharedStreamdownComponents,
      a: ({ href, children, ...props }) => {
        const isMarked = Boolean(href?.startsWith(INTERNAL_LINK_MARKER));
        if (href && isMarked) {
          const markedTarget = href
            .slice(INTERNAL_LINK_MARKER.length)
            .split('#')[0];
          const targetId = markedTarget.endsWith('.md')
            ? markedTarget.slice(0, -3)
            : markedTarget;
          if (knownConceptIds.has(targetId)) {
            return (
              <button
                type="button"
                className="text-primary underline underline-offset-2"
                onClick={() => onNavigate(targetId)}
              >
                {children}
              </button>
            );
          }
        }
        // A resolved-but-unknown concept id (a link to a concept absent from
        // this bundle) falls back to a plain anchor — marker stripped back to
        // the bundle-root-relative path rather than leaking the internal
        // prefix (matches the reference's fallback-to-external behaviour).
        const resolvedHref =
          href && isMarked
            ? `/${href.slice(INTERNAL_LINK_MARKER.length)}`
            : href;
        return (
          <a
            href={resolvedHref}
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        );
      },
    }),
    [knownConceptIds, onNavigate],
  );

  // Pre-resolve internal `.md` links against this concept's bundle-root
  //-relative id (its "current path") so `rehype-harden` passes them through
  // — see `normaliseInternalMdLinksForStreamdown`'s doc comment.
  const preparedBody = useMemo(
    () =>
      node ? normaliseInternalMdLinksForStreamdown(body, node.data.id) : body,
    [body, node],
  );

  if (!node) {
    return (
      <div
        data-testid="concept-detail-empty"
        className={cn(
          'flex h-full items-center justify-center p-6 text-sm text-muted-foreground',
          className,
        )}
      >
        Click a node to see its details.
      </div>
    );
  }

  const tokenVars = conceptTypeTokenVars(node.data.type);

  return (
    <article
      data-testid="concept-detail"
      className={cn('overflow-y-auto p-5', className)}
    >
      <header className="mb-3">
        <Badge
          className={cn(
            `bg-[var(${tokenVars.bg})] text-[var(${tokenVars.text})]`,
            'uppercase tracking-wide',
          )}
        >
          {node.data.type}
        </Badge>
        <h1 className="mt-1 text-lg font-semibold">{node.data.label}</h1>
        <div className="text-xs text-muted-foreground">{node.data.id}</div>
      </header>

      <dl className="mb-4 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Description</dt>
        <dd>{node.data.description || '—'}</dd>
        <dt className="text-muted-foreground">Resource</dt>
        <dd>
          {node.data.resource ? <ResourceChip uri={node.data.resource} /> : '—'}
        </dd>
        <dt className="text-muted-foreground">Tags</dt>
        <dd>
          {node.data.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {node.data.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </span>
          ) : (
            '—'
          )}
        </dd>
      </dl>

      <hr className="mb-4 border-border" />

      <div className="prose prose-sm max-w-none text-sm text-foreground">
        <Streamdown components={markdownComponents}>{preparedBody}</Streamdown>
      </div>

      {backlinks.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-1 text-xs font-semibold text-muted-foreground">
            Cited by
          </h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {backlinks.map((bl) => (
              <li key={bl.id}>
                <button
                  type="button"
                  className="text-primary underline underline-offset-2"
                  onClick={() => onNavigate(bl.id)}
                >
                  {bl.label}
                </button>
                <span className="text-muted-foreground"> ({bl.id})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
