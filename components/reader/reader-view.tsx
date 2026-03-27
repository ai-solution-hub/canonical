'use client';

import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';
import type { ReaderFontSize, ReaderMaxWidth } from '@/hooks/use-reader-preferences';

interface ReaderViewProps {
  html: string;
  fontSize?: ReaderFontSize;
  maxWidth?: ReaderMaxWidth;
  className?: string;
}

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'img', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'code', 'em', 'strong', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'figure', 'figcaption',
  'br', 'hr', 'span', 'div', 'sup', 'sub',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'];

const FONT_SIZE_CLASSES: Record<ReaderFontSize, string> = {
  small: 'prose-sm',
  medium: 'prose-base',
  large: 'prose-lg',
};

const MAX_WIDTH_CLASSES: Record<ReaderMaxWidth, string> = {
  narrow: 'max-w-[45ch]',
  medium: 'max-w-[65ch]',
  wide: 'max-w-none',
};

export function ReaderView({ html, fontSize, maxWidth, className }: ReaderViewProps) {
  // Memoise DOMPurify.sanitize() — only re-sanitise when the raw HTML changes
  const sanitised = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ADD_ATTR: ['target'],
      }),
    [html],
  );

  const fontSizeClass = fontSize ? FONT_SIZE_CLASSES[fontSize] : '';
  const maxWidthClass = maxWidth ? MAX_WIDTH_CLASSES[maxWidth] : 'max-w-none';

  return (
    <div
      className={cn(
        'prose',
        fontSizeClass,
        maxWidthClass,
        // When no fontSize/maxWidth props are passed (e.g. inline tab usage),
        // fall back to the original max-w-none behaviour
        !fontSize && !maxWidth && 'max-w-none',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: sanitised }}
    />
  );
}
