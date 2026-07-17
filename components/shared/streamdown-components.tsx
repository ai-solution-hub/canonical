'use client';

/**
 * Shared Streamdown a11y/test-hostile-default overrides (ID-161). Extracted
 * from `components/item-detail/content-renderer.tsx` (commit aad8cc65),
 * which originated this fix for `<ContentRenderer>` alone; also consumed by
 * `components/okf/file-render-pane.tsx`, the other Streamdown render site
 * (merged with that site's own `a` override — see its doc comment).
 *
 * Streamdown ships two defaults that are a11y- and test-hostile if left
 * un-overridden:
 *
 *  - `code`: the default lazy-loads a Shiki highlighter chunk
 *    (`import('./highlighted-body-...')`) whose resolution lands outside
 *    React's `act()` — a leaked-act warning this repo's strict test setup
 *    (`__tests__/setup.ts`) turns into a hard failure (test-suite exit 1).
 *    This override renders plain, non-highlighted markup and never touches
 *    the Shiki path. Streamdown's default `pre` (left un-overridden) clones
 *    its rendered `code` child with a `data-block` prop for fenced/block
 *    code; a bare inline `` `code` `` span has no such prop — mirrors
 *    Streamdown's own internal inline/block distinction so `pre` doesn't
 *    need to be reimplemented here.
 *  - `strong`: the default renders `**bold**` as
 *    `<span data-streamdown="strong">`, not a semantic `<strong>` — a WCAG
 *    2.1 AA gap (screen-reader emphasis lost). Restores the semantic tag.
 *
 * `a` is deliberately NOT part of this shared pair — each render site's
 * internal-link resolution differs (`ContentRenderer`'s marker-stripping vs
 * `FileRenderPane`'s known-tree-path in-app-navigation `<button>`) and each
 * site already supplies its own semantic `<a>` override, so Streamdown's
 * link-safety-modal default never activates at either site. Heading-id
 * injection is likewise site-specific (`ContentRenderer` only) and stays
 * there.
 */
import type { Components, ExtraProps } from 'streamdown';
import type { ComponentProps } from 'react';

const streamdownCodeComponent: NonNullable<Components['code']> = ({
  className,
  children,
  ...rest
}: ComponentProps<'code'> & ExtraProps) => {
  const isBlockCode = 'data-block' in rest;
  if (isBlockCode) {
    return (
      <pre>
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    );
  }
  return (
    <code className={className} {...rest}>
      {children}
    </code>
  );
};

const streamdownStrongComponent: NonNullable<Components['strong']> = ({
  className,
  children,
  ...rest
}: ComponentProps<'strong'> & ExtraProps) => (
  <strong className={className} {...rest}>
    {children}
  </strong>
);

/**
 * Spread into a `<Streamdown components={{ ...sharedStreamdownComponents,
 * ...siteSpecificOverrides }}>` call — merge, never clobber, a consuming
 * site's own overrides (e.g. `a`, headings).
 */
export const sharedStreamdownComponents: Partial<Components> = {
  code: streamdownCodeComponent,
  strong: streamdownStrongComponent,
};
