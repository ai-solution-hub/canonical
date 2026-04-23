'use client';

import { cn } from '@/lib/utils';
import { ContentRenderer } from '@/components/item-detail/content-renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QAPairRendererProps {
  /** The question text (rendered as a visually prominent block). */
  question?: string | null;
  /** Standard answer content (may contain markdown). */
  answerStandard?: string | null;
  /** Advanced answer content (may contain markdown). */
  answerAdvanced?: string | null;
  /** Additional CSS classes applied to the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a Q&A pair with markdown support for answer sections.
 *
 * Each non-empty section is rendered through `ContentRenderer` (which uses
 * react-markdown + remark-gfm for markdown content, or paragraph splitting
 * for plain text). Plain-text answers render identically to the pre-Phase-3
 * `<p className="whitespace-pre-line">` display.
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss4.3
 */
export function QAPairRenderer({
  question,
  answerStandard,
  answerAdvanced,
  className,
}: QAPairRendererProps) {
  const hasQuestion = !!question;
  const hasStandard = !!answerStandard;
  const hasAdvanced = !!answerAdvanced;

  if (!hasQuestion && !hasStandard && !hasAdvanced) {
    return null;
  }

  return (
    <div className={cn('space-y-4', className)}>
      {hasQuestion && (
        <div className="text-sm font-medium text-foreground leading-snug">
          {question}
        </div>
      )}

      {hasStandard && (
        <div className="text-sm text-foreground leading-relaxed">
          <ContentRenderer content={answerStandard!} />
        </div>
      )}

      {hasAdvanced && (
        <div className="text-sm text-foreground leading-relaxed">
          <ContentRenderer content={answerAdvanced!} />
        </div>
      )}
    </div>
  );
}
