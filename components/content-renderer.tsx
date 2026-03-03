'use client';

import { useMemo } from 'react';
import Markdown from 'react-markdown';
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

export function ContentRenderer({ content, className }: ContentRendererProps) {
  // Memoise markdown detection — only re-evaluate when content changes
  const isMarkdown = useMemo(() => hasMarkdown(content), [content]);

  if (isMarkdown) {
    return (
      <div
        className={cn(
          'prose prose-sm dark:prose-invert max-w-[65ch]',
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
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
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
