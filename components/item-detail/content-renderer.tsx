'use client';

import { useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
 * Create react-markdown heading components that add slugified id attributes.
 * Tracks duplicates per render via a shared counter map.
 */
function createHeadingComponents(idCounts: Map<string, number>): Components {
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
  };
}

export function ContentRenderer({ content, className }: ContentRendererProps) {
  // Memoise markdown detection — only re-evaluate when content changes
  const isMarkdown = useMemo(() => hasMarkdown(content), [content]);

  // Heading id deduplication — recreate on each content change
  const headingComponents = useMemo(() => {
    const idCounts = new Map<string, number>();
    return createHeadingComponents(idCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content dep is intentional: reset id counters when content changes
  }, [content]);

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
        <Markdown remarkPlugins={[remarkGfm]} components={headingComponents}>
          {content}
        </Markdown>
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
