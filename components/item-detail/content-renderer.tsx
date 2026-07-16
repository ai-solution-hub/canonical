'use client';

/**
 * `<ContentRenderer>` — DR-040 Streamdown migration (ID-145.46, folded from
 * id-147 PRODUCT §I2/§I3, TECH §7). Was the last incumbent `react-markdown` +
 * `remark-gfm` site consumed by `qa-pair-renderer.tsx` (and, more broadly,
 * every other markdown-bearing item-detail surface — reference articles,
 * review cards, response-version-history, content-library results). GFM is
 * bundled by Streamdown natively, so no `remarkPlugins` are passed (§I2 — no
 * `remark-gfm` regression). Heading-id injection mirrors
 * `components/okf/file-render-pane.tsx`'s `Streamdown components={...}`
 * pattern. Internal `.md`-style relative links are pre-resolved via the same
 * `normaliseInternalMdLinksForStreamdown` shim `<FileRenderPane>` uses, so
 * they survive Streamdown's bundled `rehype-harden` pass instead of being
 * replaced with a `[blocked]` placeholder (§I3); the marker prefix is
 * stripped back off for display since this renderer has no bundle-tree
 * navigation target of its own. Any other link (a genuine external URL)
 * passes through `rehype-harden`'s default hardening untouched — Streamdown
 * already resolves it to its full absolute href and opens it in a new tab
 * (§I3 "external links hardened + full URL shown").
 */
import { useMemo } from 'react';
import { Streamdown, type Components } from 'streamdown';
import {
  normaliseInternalMdLinksForStreamdown,
  INTERNAL_LINK_MARKER,
} from '@/lib/okf/prepare-streamdown-content';
import { cn } from '@/lib/utils';

interface ContentRendererProps {
  content: string;
  className?: string;
}

const MARKDOWN_PATTERNS = [
  /^#{1,6}\s/m, // headings
  /\[.+?\]\(.+?\)/, // links
  /^\s*[-*]\s/m, // unordered lists
  /^\s*\d+\.\s/m, // ordered lists
  /\*\*.+?\*\*/, // bold
  /^\|.+\|$/m, // tables
  /^>\s/m, // blockquotes
  /^```/m, // code blocks
];

function hasMarkdown(text: string): boolean {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Slugify heading text into a URL-safe id.
 * Lowercase, replace spaces and punctuation with hyphens, strip special chars.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract plain text from React children (handles nested elements).
 */
function getTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(getTextContent).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return getTextContent(
      (children as React.ReactElement<{ children?: React.ReactNode }>).props
        .children,
    );
  }
  return '';
}

/**
 * Create Streamdown heading components that add slugified id attributes, plus
 * an `a` override handling the `normaliseInternalMdLinksForStreamdown` marker
 * (§I3). Heading-id tracking dedupes per render via a shared counter map.
 */
function createContentComponents(idCounts: Map<string, number>): Components {
  function makeHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
    return function HeadingWithId(props: React.ComponentProps<typeof Tag>) {
      const { children, ...rest } = props;
      const text = getTextContent(children);
      const baseId = slugify(text);

      const count = idCounts.get(baseId) ?? 0;
      idCounts.set(baseId, count + 1);
      const id = count === 0 ? baseId : `${baseId}-${count + 1}`;

      return (
        <Tag {...rest} id={id}>
          {children}
        </Tag>
      );
    };
  }

  return {
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    h5: makeHeading('h5'),
    h6: makeHeading('h6'),
    a: ({ href, children, ...rest }) => {
      // A resolved-internal-link marker (§I3) has no bundle-tree navigation
      // target here, unlike `<FileRenderPane>` — strip the marker back to a
      // plain relative path for display rather than leaking the internal
      // marker prefix. Any other href (a genuine external URL) is whatever
      // Streamdown's `rehype-harden` pass already resolved it to (the full
      // absolute URL) — shown verbatim, opened in a new tab.
      const resolvedHref =
        href && href.startsWith(INTERNAL_LINK_MARKER)
          ? `/${href.slice(INTERNAL_LINK_MARKER.length)}`
          : href;
      return (
        <a
          href={resolvedHref}
          target="_blank"
          rel="noopener noreferrer"
          {...rest}
        >
          {children}
        </a>
      );
    },
  };
}

export function ContentRenderer({ content, className }: ContentRendererProps) {
  // Memoise markdown detection — only re-evaluate when content changes
  const isMarkdown = useMemo(() => hasMarkdown(content), [content]);

  // Heading id deduplication — recreate on each content change
  const contentComponents = useMemo(() => {
    const idCounts = new Map<string, number>();
    return createContentComponents(idCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content dep is intentional: reset id counters when content changes
  }, [content]);

  // Pre-resolve internal `.md`-style relative links (§I3) — see
  // `normaliseInternalMdLinksForStreamdown`'s doc comment for why this must
  // happen up front rather than lazily in the `a` override.
  const preparedContent = useMemo(
    () => normaliseInternalMdLinksForStreamdown(content, ''),
    [content],
  );

  if (isMarkdown) {
    return (
      <div
        className={cn(
          'prose prose-sm max-w-[65ch]',
          'prose-headings:font-semibold prose-headings:tracking-tight',
          'prose-h1:text-xl prose-h2:text-lg prose-h3:text-base',
          'prose-p:leading-relaxed prose-p:text-foreground',
          'prose-a:text-primary prose-a:underline prose-a:underline-offset-2',
          'prose-li:text-foreground prose-li:leading-relaxed',
          'prose-blockquote:border-l-primary/50 prose-blockquote:text-muted-foreground',
          'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm',
          'prose-pre:bg-muted prose-pre:rounded-lg',
          'prose-table:text-sm',
          'prose-img:rounded-lg',
          className,
        )}
      >
        <Streamdown components={contentComponents}>
          {preparedContent}
        </Streamdown>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'max-w-[65ch] space-y-4 text-base leading-relaxed text-foreground',
        className,
      )}
    >
      {content.split('\n\n').map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </div>
  );
}
